import React from 'react';

/*
 * Slider de volume perceptual (em decibéis), com 100% no meio da trilha.
 *   metade esquerda:  -40 dB … 0 dB  (silêncio no início absoluto)
 *   metade direita:     0 dB … +6 dB (até 200%)
 * O ouvido percebe volume em escala logarítmica: num slider linear, quase toda a
 * variação audível fica espremida no começo. Perto do meio o valor "gruda" em 100%.
 */
const MIN_DB = -40;
const MAX_DB = 20 * Math.log10(2); // +6,02 dB = 200%
const SNAP = 0.03; // ±3% da trilha em volta do meio fica travado em 100%
const STEPS = 1000;

// A zona de trava é "recortada" da curva: dentro dela fica em 100%, e logo fora ela
// continua de 99%/101% — todos os valores continuam alcançáveis (sem pulo).
function toCurve(pos) {
  if (pos < 0.5 - SNAP) return (pos / (0.5 - SNAP)) * 0.5;
  if (pos > 0.5 + SNAP) return 0.5 + ((pos - 0.5 - SNAP) / (0.5 - SNAP)) * 0.5;
  return 0.5;
}

function fromCurve(curve) {
  if (curve < 0.5) return (curve / 0.5) * (0.5 - SNAP);
  if (curve > 0.5) return 0.5 + SNAP + ((curve - 0.5) / 0.5) * (0.5 - SNAP);
  return 0.5;
}

export function positionToVolume(pos) {
  if (pos <= 0.005) return 0;
  const c = toCurve(pos);
  if (c === 0.5) return 100;
  const db = c < 0.5 ? MIN_DB * (1 - c / 0.5) : MAX_DB * ((c - 0.5) / 0.5);
  return Math.min(200, Math.max(1, Math.round(100 * 10 ** (db / 20))));
}

export function volumeToPosition(volume) {
  if (volume <= 0) return 0;
  if (volume === 100) return 0.5;
  const db = 20 * Math.log10(volume / 100);
  const c = volume < 100 ? 0.5 * (1 - db / MIN_DB) : 0.5 + 0.5 * (db / MAX_DB);
  return Math.min(1, Math.max(0, fromCurve(Math.min(1, Math.max(0, c)))));
}

export default function VolumeSlider({ value = 100, onChange, label = 'Volume', className = '' }) {
  const position = Math.round(volumeToPosition(value) * STEPS);
  return (
    <div className={`relative flex items-center w-full ${className}`}>
      <input
        type="range"
        min="0"
        max={STEPS}
        step="5"
        value={position}
        onChange={(e) => onChange(positionToVolume(Number(e.target.value) / STEPS))}
        onDoubleClick={() => onChange(100)}
        className="w-full h-1.5 bg-active rounded-lg appearance-none cursor-pointer accent-accent"
        title={`${label}: ${value}% (clique duplo volta para 100%)`}
        aria-label={label}
        aria-valuetext={`${value}%`}
      />
      {/* Marca do 100% (meio da trilha) */}
      <span
        aria-hidden
        className={`absolute left-1/2 -translate-x-1/2 w-0.5 h-3 rounded-full pointer-events-none ${
          value === 100 ? 'bg-transparent' : 'bg-fg-2/70'
        }`}
      />
    </div>
  );
}
