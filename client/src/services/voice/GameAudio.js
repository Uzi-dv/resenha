import { audioEngine } from './AudioEngine';

// Buffer circular de PCM 16-bit estéreo 48 kHz rodando na thread de áudio.
// Mantém ~40 ms de folga contra jitter e descarta excesso acima de 200 ms (latência baixa).
const WORKLET_SOURCE = `
class ResenhaPcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48000 * 2;           // 1 s estéreo intercalado
    this.buf = new Float32Array(this.capacity);
    this.read = 0; this.write = 0; this.size = 0;
    this.primed = false;
    this.port.onmessage = (e) => this.push(new Int16Array(e.data));
  }
  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      if (this.size === this.capacity) { this.read = (this.read + 1) % this.capacity; this.size--; }
      this.buf[this.write] = samples[i] / 32768;
      this.write = (this.write + 1) % this.capacity;
      this.size++;
    }
    const max = 48000 * 2 * 0.2;
    if (this.size > max) {
      const drop = (this.size - 48000 * 2 * 0.05) & ~1;
      this.read = (this.read + drop) % this.capacity; this.size -= drop;
    }
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0], right = out[1] || out[0];
    if (!this.primed) {
      if (this.size >= 48000 * 2 * 0.04) this.primed = true;
      else { left.fill(0); right.fill(0); return true; }
    }
    for (let i = 0; i < left.length; i++) {
      if (this.size >= 2) {
        left[i] = this.buf[this.read];
        right[i] = this.buf[(this.read + 1) % this.capacity];
        this.read = (this.read + 2) % this.capacity;
        this.size -= 2;
      } else {
        left[i] = 0; right[i] = 0; this.primed = false;
      }
    }
    return true;
  }
}
registerProcessor('resenha-pcm-player', ResenhaPcmPlayer);
`;

let moduleUrl = null;
const loadedContexts = new WeakSet();

/**
 * Captura o áudio do jogo via WASAPI (processo nativo do Electron) e o transforma
 * numa MediaStreamTrack estéreo. Em "tela inteira" o Electron exclui o próprio
 * Resenha da captura — a call não volta como eco para quem está assistindo.
 */
export class GameAudioCapture {
  constructor(volume = 100) {
    this.node = null;
    this.gain = null;
    this.destination = null;
    this.unsubscribe = null;
    this.volume = volume;
  }

  /** Volume do áudio enviado para quem assiste (0–200%). */
  setVolume(percent) {
    this.volume = percent;
    if (this.gain) this.gain.gain.setTargetAtTime(percent / 100, this.gain.context.currentTime, 0.02);
  }

  static get supported() {
    return Boolean(window.electronAPI?.startAudioLoopback);
  }

  async start(pid) {
    const ctx = audioEngine.ensure();
    if (!loadedContexts.has(ctx)) {
      moduleUrl ||= URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(moduleUrl);
      loadedContexts.add(ctx);
    }

    const result = await window.electronAPI.startAudioLoopback({ pid: pid || 0 });
    if (!result?.success) throw new Error(result?.error || 'Falha ao iniciar captura de áudio');

    this.node = new AudioWorkletNode(ctx, 'resenha-pcm-player', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume / 100;
    this.destination = ctx.createMediaStreamDestination();
    this.destination.channelCount = 2;
    this.node.connect(this.gain);
    this.gain.connect(this.destination);

    this.unsubscribe = window.electronAPI.onAudioPcmChunk((chunk) => {
      if (!this.node || !chunk?.byteLength) return;
      const copy = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
      this.node.port.postMessage(copy, [copy]);
    });

    return this.destination.stream.getAudioTracks()[0];
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.electronAPI?.stopAudioLoopback?.().catch(() => {});
    try {
      this.node?.disconnect();
      this.gain?.disconnect();
    } catch {
      /* ok */
    }
    this.destination?.stream.getTracks().forEach((t) => t.stop());
    this.node = this.gain = this.destination = null;
  }
}
