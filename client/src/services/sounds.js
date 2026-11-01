import { audioEngine } from './voice/AudioEngine';

/**
 * Efeitos sonoros sintetizados (sem arquivos de áudio). Tocam pelo mesmo AudioContext
 * da call, então respeitam o dispositivo de saída escolhido.
 */
const STORAGE_KEY = 'resenha_sound_effects';
const VOLUME = 0.22;

// Cada som: lista de notas [frequência Hz, início s, duração s, forma de onda]
const SOUNDS = {
  join: [[587.33, 0, 0.12, 'sine'], [880, 0.09, 0.18, 'sine']],
  leave: [[880, 0, 0.12, 'sine'], [587.33, 0.09, 0.18, 'sine']],
  disconnect: [[659.25, 0, 0.1, 'triangle'], [440, 0.09, 0.1, 'triangle'], [329.63, 0.18, 0.2, 'triangle']],
  mute: [[392, 0, 0.09, 'triangle']],
  unmute: [[659.25, 0, 0.09, 'triangle']],
  deafen: [[523.25, 0, 0.08, 'triangle'], [349.23, 0.07, 0.12, 'triangle']],
  undeafen: [[349.23, 0, 0.08, 'triangle'], [523.25, 0.07, 0.12, 'triangle']],
  stream: [[523.25, 0, 0.1, 'sine'], [659.25, 0.08, 0.1, 'sine'], [783.99, 0.16, 0.18, 'sine']],
  message: [[987.77, 0, 0.07, 'sine'], [1318.51, 0.06, 0.16, 'sine']],
  mention: [[1174.66, 0, 0.07, 'sine'], [1567.98, 0.06, 0.08, 'sine'], [1174.66, 0.13, 0.16, 'sine']]
};

const lastPlayed = new Map();

export function soundEffectsEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setSoundEffectsEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
}

export function playSound(name) {
  const notes = SOUNDS[name];
  if (!notes || !soundEffectsEnabled()) return;
  // Evita "metralhadora" quando vários eventos chegam juntos
  const now = performance.now();
  if (now - (lastPlayed.get(name) || 0) < 250) return;
  lastPlayed.set(name, now);

  try {
    const ctx = audioEngine.ensure();
    const out = ctx.createGain();
    out.gain.value = VOLUME;
    out.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.01;
    let end = t0;
    for (const [freq, start, duration, type] of notes) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const s = t0 + start;
      env.gain.setValueAtTime(0, s);
      env.gain.linearRampToValueAtTime(1, s + 0.012);
      env.gain.exponentialRampToValueAtTime(0.001, s + duration);
      osc.connect(env).connect(out);
      osc.start(s);
      osc.stop(s + duration + 0.02);
      end = Math.max(end, s + duration + 0.05);
    }
    setTimeout(() => {
      out.disconnect();
      audioEngine.scheduleSuspend();
    }, (end - ctx.currentTime) * 1000 + 100);
  } catch (err) {
    console.warn('[Sons] Não foi possível tocar efeito:', err);
  }
}
