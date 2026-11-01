import React from 'react';

/** Logo do Resenha: um balão de conversa com olhos (os olhos são furos, regra evenodd). */
export default function ResenhaLogo({ className = "w-8 h-8" }) {
  return (
    <svg viewBox="80 120 840 805" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path
        d="M 240 140 H 760 A 140 140 0 0 1 900 280 V 620 A 140 140 0 0 1 760 760 H 430 L 230 905 L 280 760 H 240 A 140 140 0 0 1 100 620 V 280 A 140 140 0 0 1 240 140 Z M 448 450 A 48 72 0 1 1 352 450 A 48 72 0 1 1 448 450 Z M 648 450 A 48 72 0 1 1 552 450 A 48 72 0 1 1 648 450 Z"
        stroke="#000000"
        strokeWidth="15"
        strokeLinejoin="round"
        fillRule="evenodd"
        fill="#FFB547"
      />
    </svg>
  );
}
