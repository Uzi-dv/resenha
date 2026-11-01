import { setSpeaking } from './stores';
import { createRnnoiseNode } from './NoiseSuppressor';

const SPEAKING_THRESHOLD = 0.012; // RMS (~ -38 dBFS)
const SPEAKING_HOLD_MS = 280;
const DETECT_INTERVAL_MS = 50;

/**
 * Nivelador de voz (no envio): o Discord processa o volume da voz antes de mandar, por isso as
 * vozes lá soam mais altas e parelhas no mesmo "100%". Aqui o compressor levanta as partes
 * fracas da fala e o limitador suave impede que gritos estourem.
 *
 * Medido com fala sintética (RMS dos trechos com voz): normal -23,7 → -17,1 dBFS, baixa
 * -33,1 → -21,6, alta -13,9 → -13,3, picos ≤ -1,1 dBFS. Atenção: o DynamicsCompressorNode já
 * aplica um ganho de compensação automático; trimDb é o ajuste fino depois dele.
 */
export const VOICE_LEVELER = {
  compressor: { threshold: -30, knee: 10, ratio: 3, attack: 0.005, release: 0.2 },
  trimDb: 4,
  ceilingDb: -1
};

/** Limitador de pico suave: linear até ~3 dB abaixo do teto, curva tanh acima (sem ganho extra). */
function createSoftLimiter(ctx, ceilingDb) {
  const shaper = ctx.createWaveShaper();
  const n = 4096;
  const curve = new Float32Array(n);
  const ceil = 10 ** (ceilingDb / 20);
  const knee = ceil * 0.7;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)));
  }
  shaper.curve = curve;
  shaper.oversample = '2x';
  return shaper;
}

function makeCompressor(ctx, { threshold, knee, ratio, attack, release }) {
  const node = ctx.createDynamicsCompressor();
  node.threshold.value = threshold;
  node.knee.value = knee;
  node.ratio.value = ratio;
  node.attack.value = attack;
  node.release.value = release;
  return node;
}

/** Cria a cadeia do nivelador. Exportada para os testes medirem o efeito com OfflineAudioContext. */
export function createVoiceLeveler(ctx) {
  const compressor = makeCompressor(ctx, VOICE_LEVELER.compressor);
  const trim = ctx.createGain();
  trim.gain.value = 10 ** (VOICE_LEVELER.trimDb / 20);
  const limiter = createSoftLimiter(ctx, VOICE_LEVELER.ceilingDb);
  compressor.connect(trim).connect(limiter);
  return { input: compressor, output: limiter, nodes: [compressor, trim, limiter] };
}

function rmsOf(analyser, buffer) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

/**
 * Áudio de toda a call num único AudioContext:
 * - Mixa as vozes recebidas com volume individual (0–200%) e ensurdecer.
 * - Toca o áudio das transmissões com volume próprio.
 * - Detecta quem está falando localmente (zero mensagens pela rede).
 * - Troca o dispositivo de saída de uma vez só (AudioContext.setSinkId).
 */
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.remotes = new Map(); // key -> { userId, kind, source, gain, analyser, element, lastLoud, speaking }
    this.userVolumes = new Map();
    this.streamVolumes = new Map();
    this.deafened = false;
    this.outputDeviceId = '';
    this.detectTimer = null;
    this.localProbe = null; // { userId, getLevel, lastLoud, speaking }
    this.buffer = new Float32Array(512);
  }

  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.deafened ? 0 : 1;
      // Limitador suave na saída: quem aumenta alguém para mais de 100% não ouve estalos (clipping)
      this.outputLimiter = createSoftLimiter(this.ctx, 0);
      this.master.connect(this.outputLimiter).connect(this.ctx.destination);
      if (this.outputDeviceId) this._applySink();
    }
    clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Início de uma call: mantém o áudio ligado e liga o detector de fala. */
  beginCall() {
    this.inCall = true;
    this.ensure();
    if (!this.detectTimer) this.detectTimer = setInterval(() => this._detect(), DETECT_INTERVAL_MS);
  }

  /**
   * Fora de call, suspende o AudioContext depois de alguns segundos: um contexto
   * ligado tocando silêncio custava ~1–2% de um núcleo o tempo todo.
   */
  scheduleSuspend(delayMs = 3000) {
    if (this.inCall || !this.ctx) return;
    clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (!this.inCall && this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
    }, delayMs);
  }

  addRemote(key, userId, kind, track) {
    this.removeRemote(key);
    const ctx = this.ensure();
    const stream = new MediaStream([track]);
    // Contorno do Chromium: áudio WebRTC remoto só flui pelo WebAudio se também estiver num <audio>
    const element = new Audio();
    element.muted = true;
    element.srcObject = stream;
    element.play().catch(() => {});

    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = this._volumeFor(userId, kind);
    source.connect(gain).connect(this.master);

    let analyser = null;
    if (kind === 'mic') {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
    }
    this.remotes.set(key, { userId, kind, source, gain, analyser, element, lastLoud: 0, speaking: false });
  }

  removeRemote(key) {
    const r = this.remotes.get(key);
    if (!r) return;
    try {
      r.source.disconnect();
      r.gain.disconnect();
    } catch {
      /* já desconectado */
    }
    r.element.srcObject = null;
    if (r.speaking) setSpeaking(r.userId, false);
    this.remotes.delete(key);
  }

  removeAll() {
    for (const key of [...this.remotes.keys()]) this.removeRemote(key);
  }

  _volumeFor(userId, kind) {
    const map = kind === 'mic' ? this.userVolumes : this.streamVolumes;
    return (map.get(String(userId)) ?? 100) / 100;
  }

  setUserVolume(userId, volume) {
    this.userVolumes.set(String(userId), volume);
    this._refreshGains(userId, 'mic');
  }

  setStreamVolume(userId, volume) {
    this.streamVolumes.set(String(userId), volume);
    this._refreshGains(userId, 'screen_audio');
  }

  _refreshGains(userId, kind) {
    for (const r of this.remotes.values()) {
      if (String(r.userId) === String(userId) && r.kind === kind && this.ctx) {
        r.gain.gain.setTargetAtTime(this._volumeFor(userId, kind), this.ctx.currentTime, 0.02);
      }
    }
  }

  setDeafened(deafened) {
    this.deafened = deafened;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(deafened ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  async setOutputDevice(deviceId) {
    this.outputDeviceId = deviceId || '';
    if (this.ctx) await this._applySink();
  }

  async _applySink() {
    if (typeof this.ctx.setSinkId !== 'function') return;
    try {
      await this.ctx.setSinkId(this.outputDeviceId || '');
    } catch (err) {
      console.warn('[Audio] Não foi possível trocar a saída:', err);
    }
  }

  /** Registra o próprio microfone para o indicador de fala local. */
  setLocalProbe(userId, getLevel) {
    if (this.localProbe?.speaking) setSpeaking(this.localProbe.userId, false);
    this.localProbe = getLevel ? { userId, getLevel, lastLoud: 0, speaking: false } : null;
  }

  _detect() {
    const now = performance.now();
    const update = (entry, level) => {
      if (level > SPEAKING_THRESHOLD) entry.lastLoud = now;
      const speaking = now - entry.lastLoud < SPEAKING_HOLD_MS;
      if (speaking !== entry.speaking) {
        entry.speaking = speaking;
        setSpeaking(entry.userId, speaking);
      }
    };
    for (const r of this.remotes.values()) {
      if (r.analyser) update(r, this.deafened ? 0 : rmsOf(r.analyser, this.buffer));
    }
    if (this.localProbe) update(this.localProbe, this.localProbe.getLevel());
  }

  close() {
    this.removeAll();
    this.setLocalProbe(null, null);
    clearInterval(this.detectTimer);
    this.detectTimer = null;
    this.inCall = false;
    // O contexto é reaproveitado entre calls (criar um novo é caro), mas fica suspenso
    this.scheduleSuspend();
  }
}

export const audioEngine = new AudioEngine();

/**
 * Microfone com trilha de saída estável: trocar de dispositivo não exige renegociar
 * com o SFU, e o mute/porta de ruído atuam num GainNode (sem cliques).
 */
export class Microphone {
  constructor() {
    this.raw = null;
    this.source = null;
    this.gate = null;
    this.analyser = null;
    this.destination = null;
    this.muted = false;
    this.threshold = null; // null = sensibilidade automática (sem porta de ruído)
    this.gateOpen = true;
    this.lastLoud = 0;
    this.buffer = new Float32Array(512);
    this.available = false;
    this.denoiser = null;
    this.useDenoiser = false;
    this.leveler = null;
    this.useLeveler = true;
  }

  get track() {
    return this.destination?.stream.getAudioTracks()[0] || null;
  }

  async start(settings = {}) {
    const ctx = audioEngine.ensure();
    if (!this.destination) {
      this.destination = ctx.createMediaStreamDestination();
      this.destination.channelCount = 1;
      this.gate = ctx.createGain();
      this.gate.connect(this.destination);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.leveler = createVoiceLeveler(ctx);
      this.leveler.output.connect(this.gate);
    }
    this.useLeveler = settings.voiceLeveling !== false;
    if (settings.aiNoiseSuppression) await this.setDenoiser(true).catch(() => {});
    await this._openDevice(settings);
    this._applyGain();
    return this.track;
  }

  /**
   * Liga/desliga o RNNoise entre o microfone e a porta de ruído.
   * Lança erro se não for possível carregar (o chamador decide como avisar).
   */
  async setDenoiser(enabled) {
    if (enabled && !this.denoiser) {
      this.denoiser = await createRnnoiseNode(audioEngine.ensure());
    }
    this.useDenoiser = enabled;
    this._wire();
  }

  /** Liga/desliga o nivelador de voz (sem reabrir o microfone). */
  setLeveling(enabled) {
    this.useLeveler = enabled;
    this._wire();
  }

  _wire() {
    if (!this.source) return;
    try {
      this.source.disconnect();
      this.denoiser?.disconnect();
    } catch {
      /* ok */
    }
    try {
      this.denoiser?.disconnect();
    } catch {
      /* ok */
    }
    let head = this.source;
    if (this.useDenoiser && this.denoiser) {
      this.source.connect(this.denoiser);
      head = this.denoiser;
    }
    // O medidor e a porta de ruído olham o sinal antes do nivelador (a sensibilidade não muda)
    head.connect(this.useLeveler && this.leveler ? this.leveler.input : this.gate);
    head.connect(this.analyser);
  }

  async _openDevice({
    deviceId,
    echoCancellation = true,
    noiseSuppression = true,
    autoGainControl = true,
    aiNoiseSuppression = false
  } = {}) {
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation,
        // Com RNNoise ativo, o supressor do navegador fica desligado (os dois juntos distorcem a voz)
        noiseSuppression: noiseSuppression && !aiNoiseSuppression,
        autoGainControl,
        channelCount: 1
      }
    };
    let raw = null;
    try {
      raw = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (deviceId) {
        console.warn('[Mic] Dispositivo salvo indisponível; usando o padrão.', err);
        try {
          raw = await navigator.mediaDevices.getUserMedia({ audio: { ...constraints.audio, deviceId: undefined } });
        } catch (fallbackErr) {
          console.warn('[Mic] Sem microfone:', fallbackErr);
        }
      } else {
        console.warn('[Mic] Sem microfone:', err);
      }
    }

    this._closeDevice();
    this.raw = raw;
    this.available = Boolean(raw);
    if (raw) {
      const ctx = audioEngine.ensure();
      this.source = ctx.createMediaStreamSource(raw);
      this._wire();
      raw.getAudioTracks()[0].enabled = !this.muted;
    }
  }

  async switchDevice(settings) {
    await this._openDevice(settings);
    this._applyGain();
  }

  _closeDevice() {
    try {
      this.source?.disconnect();
    } catch {
      /* ok */
    }
    this.source = null;
    this.raw?.getTracks().forEach((t) => t.stop());
    this.raw = null;
  }

  setMuted(muted) {
    this.muted = muted;
    this.raw?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this._applyGain();
  }

  /** threshold em RMS (0–0.2) ou null para desativar a porta de ruído */
  setThreshold(threshold) {
    this.threshold = threshold;
    this._applyGain();
  }

  /** Nível atual (RMS) já considerando mute — usado pelo indicador de fala e pela porta. */
  level() {
    if (!this.raw || this.muted) return 0;
    const level = rmsOf(this.analyser, this.buffer);
    if (this.threshold != null) {
      const now = performance.now();
      if (level > this.threshold) this.lastLoud = now;
      const open = now - this.lastLoud < 350;
      if (open !== this.gateOpen) {
        this.gateOpen = open;
        this._applyGain();
      }
      return open ? level : 0;
    }
    return level;
  }

  rawLevel() {
    return this.raw ? rmsOf(this.analyser, this.buffer) : 0;
  }

  _applyGain() {
    if (!this.gate) return;
    const open = !this.muted && (this.threshold == null || this.gateOpen);
    this.gate.gain.setTargetAtTime(open ? 1 : 0, audioEngine.ctx.currentTime, open ? 0.005 : 0.05);
  }

  stop() {
    this._closeDevice();
    try {
      this.gate?.disconnect();
      this.denoiser?.disconnect();
      this.leveler?.nodes.forEach((n) => n.disconnect());
    } catch {
      /* ok */
    }
    this.leveler = null;
    this.denoiser?.destroy();
    this.denoiser = null;
    this.destination?.stream.getTracks().forEach((t) => t.stop());
    this.destination = this.gate = this.analyser = null;
  }
}
