import React from 'react';

/** Linha "Fulano está digitando" com os três pontos animados, como no Discord. */
export default function TypingIndicator({ names }) {
  return (
    <div className="h-6 px-4 text-xs text-fg flex items-center gap-1.5 shrink-0 select-none">
      {names.length > 0 && (
        <span className="anim-fade flex items-center gap-1.5">
          <span className="typing-dots text-fg-2">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>{names.slice(0, 3).join(', ')}</strong>
            {names.length === 1 ? ' está digitando...' : ' estão digitando...'}
          </span>
        </span>
      )}
    </div>
  );
}
