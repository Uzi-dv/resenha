import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVoice } from '../context/VoiceContext';
import { X, Mic, Headphones, Volume2, Activity, Sparkles, BellRing, Video } from 'lucide-react';
import { playSound, setSoundEffectsEnabled, soundEffectsEnabled } from '../services/sounds';

// Converte RMS em 0–100 numa escala de -60 dB a 0 dB (mais intuitivo que linear)
const toPercent = (rms) => (rms <= 0 ? 0 : Math.max(0, Math.min(100, ((20 * Math.log10(rms) + 60) / 60) * 100)));
const fromPercent = (p) => 10 ** ((p / 100) * 60 / 20 - 3);

function Toggle({ label, description, checked, onChange, disabled = false }) {
  return (
    <label className={`flex items-start justify-between gap-3 py-1 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <div>
        <div className="text-sm text-fg-strong font-medium">{label}</div>
        {description && <div className="text-[11px] text-fg-muted">{description}</div>}
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent w-4 h-4 mt-1"
      />
    </label>
  );
}

export default function AudioSettingsModal({ onClose }) {
  const {
    activeVoiceChannel,
    audioInputDevices,
    audioOutputDevices,
    selectedAudioInput,
    selectedAudioOutput,
    setAudioInput,
    setAudioOutput,
    refreshAudioDevices,
    videoInputDevices,
    selectedVideoInput,
    setVideoInput,
    voiceSettings,
    updateVoiceSettings,
    getMicLevel
  } = useVoice();

  const [level, setLevel] = useState(0);
  const [sounds, setSounds] = useState(soundEffectsEnabled);
  const testRef = useRef(null);
  const frameRef = useRef(null);
  const auto = voiceSettings.inputThreshold == null;
  const thresholdPercent = auto ? 0 : toPercent(voiceSettings.inputThreshold);

  useEffect(() => {
    refreshAudioDevices();
  }, [refreshAudioDevices]);

  // Medidor: usa o microfone da call se estiver numa; senão abre um de teste
  useEffect(() => {
    let cancelled = false;
    let readLevel = getMicLevel;

    async function openTestMic() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : true
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(512);
        testRef.current = { stream, ctx };
        readLevel = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          return Math.sqrt(sum / buf.length);
        };
      } catch (err) {
        console.warn('[AudioSettings] Microfone indisponível para teste:', err);
      }
    }

    if (!activeVoiceChannel) openTestMic();
    const tick = () => {
      setLevel(toPercent(readLevel()));
      frameRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameRef.current);
      if (testRef.current) {
        testRef.current.stream.getTracks().forEach((t) => t.stop());
        testRef.current.ctx.close().catch(() => {});
        testRef.current = null;
      }
    };
  }, [activeVoiceChannel, selectedAudioInput, getMicLevel]);

  const passing = auto || level >= thresholdPercent;

  // Portal: a barra lateral cria um contexto de empilhamento que prenderia o modal atrás do conteúdo
  return createPortal(
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onPointerDown={onClose}>
      <div
        className="sheet bg-chat w-full max-w-lg max-h-[90dvh] overflow-y-auto flex flex-col"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-panel flex items-center justify-between">
          <div className="flex items-center gap-2 text-fg-strong">
            <Volume2 className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-bold">Voz e áudio</h3>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg-strong p-1 rounded-md hover:bg-hover">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-fg-2 uppercase flex items-center gap-1.5">
                <Mic className="w-4 h-4 text-ok" /> Entrada
              </label>
              <select
                value={selectedAudioInput}
                onChange={(e) => setAudioInput(e.target.value)}
                className="w-full bg-well text-fg-strong text-sm rounded-lg px-3 py-2.5 border border-line-strong focus:outline-none focus:border-accent"
              >
                <option value="">Padrão do sistema</option>
                {audioInputDevices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microfone ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-fg-2 uppercase flex items-center gap-1.5">
                <Headphones className="w-4 h-4 text-accent" /> Saída
              </label>
              <select
                value={selectedAudioOutput}
                onChange={(e) => setAudioOutput(e.target.value)}
                className="w-full bg-well text-fg-strong text-sm rounded-lg px-3 py-2.5 border border-line-strong focus:outline-none focus:border-accent"
              >
                <option value="">Padrão do sistema</option>
                {audioOutputDevices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Alto-falante ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-fg-2 uppercase flex items-center gap-1.5">
              <Video className="w-4 h-4 text-accent" /> Câmera
            </label>
            <select
              value={selectedVideoInput}
              onChange={(e) => setVideoInput(e.target.value)}
              className="w-full bg-well text-fg-strong text-sm rounded-lg px-3 py-2.5 border border-line-strong focus:outline-none focus:border-accent"
            >
              <option value="">Padrão do sistema</option>
              {videoInputDevices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Câmera ${i + 1}`}
                </option>
              ))}
            </select>
            {videoInputDevices.length === 0 && <span className="text-[11px] text-fg-muted">Nenhuma câmera encontrada.</span>}
          </div>

          <div className="bg-side p-4 rounded-lg border border-panel flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-fg-2 uppercase flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-accent" /> Sensibilidade de entrada
              </span>
              <label className="flex items-center gap-2 text-xs text-fg cursor-pointer">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => updateVoiceSettings({ inputThreshold: e.target.checked ? null : fromPercent(35) })}
                  className="accent-accent"
                />
                Automática
              </label>
            </div>

            <div className="relative h-6 flex items-center">
              <div className="absolute inset-x-0 h-2.5 rounded-full bg-well overflow-hidden">
                <div
                  className="h-full transition-[width] duration-75"
                  style={{ width: `${level}%`, background: passing ? '#23a55a' : '#f0b232' }}
                />
              </div>
              {!auto && (
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(thresholdPercent)}
                  onChange={(e) => updateVoiceSettings({ inputThreshold: fromPercent(Number(e.target.value)) })}
                  className="absolute inset-x-0 w-full appearance-none bg-transparent cursor-pointer accent-white"
                  title="Abaixo desta linha o microfone fica fechado"
                />
              )}
            </div>
            <p className="text-[11px] text-fg-muted">
              {auto
                ? 'O supressor de ruído decide sozinho. Desmarque para definir um limite manual (porta de ruído).'
                : 'Arraste o marcador: sons abaixo dele (teclado, ventilador) não são transmitidos.'}
            </p>
          </div>

          <div className="bg-side p-4 rounded-lg border border-panel flex flex-col gap-1">
            <span className="text-xs font-bold text-fg-2 uppercase flex items-center gap-1.5 mb-1">
              <Sparkles className="w-4 h-4 text-warn" /> Processamento de voz
            </span>
            <Toggle
              label={
                <span className="flex items-center gap-1.5">
                  Supressão de ruído por IA
                  <span className="text-[9px] font-bold bg-accent text-on-accent px-1.5 py-0.5 rounded">RNNoise</span>
                </span>
              }
              description="Remove teclado, ventilador, cachorro e barulho de rua. Usa ~1–2% da CPU."
              checked={voiceSettings.aiNoiseSuppression}
              onChange={(v) => updateVoiceSettings({ aiNoiseSuppression: v })}
            />
            <Toggle
              label="Supressão de ruído padrão"
              description={
                voiceSettings.aiNoiseSuppression
                  ? 'Desativada automaticamente enquanto a supressão por IA estiver ligada.'
                  : 'Remove ruído constante de fundo (do próprio navegador).'
              }
              checked={voiceSettings.noiseSuppression && !voiceSettings.aiNoiseSuppression}
              disabled={voiceSettings.aiNoiseSuppression}
              onChange={(v) => updateVoiceSettings({ noiseSuppression: v })}
            />
            <Toggle
              label="Cancelamento de eco"
              description="Necessário se você usa caixas de som em vez de fone."
              checked={voiceSettings.echoCancellation}
              onChange={(v) => updateVoiceSettings({ echoCancellation: v })}
            />
            <Toggle
              label="Ganho automático"
              description="Ajusta o ganho do microfone conforme você fala mais perto ou mais longe."
              checked={voiceSettings.autoGainControl}
              onChange={(v) => updateVoiceSettings({ autoGainControl: v })}
            />
            <Toggle
              label="Nivelar volume da voz"
              description="Deixa sua voz mais alta e constante para quem ouve, como no Discord (sem estourar quando você grita)."
              checked={voiceSettings.voiceLeveling !== false}
              onChange={(v) => updateVoiceSettings({ voiceLeveling: v })}
            />
          </div>

          <div className="bg-side p-4 rounded-lg border border-panel flex flex-col gap-1">
            <span className="text-xs font-bold text-fg-2 uppercase flex items-center gap-1.5 mb-1">
              <BellRing className="w-4 h-4 text-ok" /> Sons
            </span>
            <Toggle
              label="Efeitos sonoros"
              description="Entrar/sair da call, mutar, ensurdecer, transmissão iniciada e novas mensagens."
              checked={sounds}
              onChange={(v) => {
                setSoundEffectsEnabled(v);
                setSounds(v);
                if (v) playSound('join');
              }}
            />
          </div>
        </div>

        <div className="px-6 py-4 bg-side border-t border-panel flex justify-end">
          <button onClick={onClose} className="sticker-btn bg-accent hover:bg-accent-hover text-on-accent text-sm font-semibold px-5 py-2 rounded-lg">
            Pronto
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
