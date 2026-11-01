import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Clock } from 'lucide-react';
import { EMOJI_CATEGORIES, getRecentEmojis, pushRecentEmoji, searchEmojis } from '../services/emojiData';

const WIDTH = 344;
const HEIGHT = 380;

/**
 * Seletor de emojis em popover, posicionado junto ao elemento que o abriu (`anchor`: DOMRect).
 * Abre para cima quando não cabe embaixo.
 */
export default function EmojiPicker({ anchor, onPick, onClose }) {
  const ref = useRef(null);
  const listRef = useRef(null);
  const [query, setQuery] = useState('');
  const [recent] = useState(getRecentEmojis);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    const margin = 8;
    const below = anchor.bottom + margin;
    const top = below + HEIGHT > window.innerHeight - margin ? Math.max(margin, anchor.top - HEIGHT - margin) : below;
    const left = Math.min(Math.max(margin, anchor.right - WIDTH), window.innerWidth - WIDTH - margin);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e) => !ref.current?.contains(e.target) && onClose();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const pick = (emoji) => {
    pushRecentEmoji(emoji);
    onPick(emoji);
    onClose();
  };

  const results = query ? searchEmojis(query) : null;
  const sections = results
    ? [{ id: 'busca', label: results.length ? 'Resultados' : 'Nenhum emoji encontrado', emojis: results }]
    : [
        ...(recent.length ? [{ id: 'recentes', label: 'Usados recentemente', emojis: recent }] : []),
        ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, label: c.label, emojis: c.emojis.map(([e]) => e) }))
      ];

  const jump = (id) => {
    const el = listRef.current?.querySelector(`[data-section="${id}"]`);
    if (el) listRef.current.scrollTop = el.offsetTop - 4;
  };

  return createPortal(
    <div
      ref={ref}
      style={{ top: pos.top, left: pos.left, width: WIDTH, height: HEIGHT }}
      className="anim-pop fixed z-[150] bg-float border border-line rounded-xl shadow-2xl flex flex-col overflow-hidden select-none"
    >
      <div className="p-2 border-b border-line">
        <div className="flex items-center gap-2 bg-well rounded-md px-2.5 h-8">
          <Search className="w-4 h-4 text-fg-muted shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && results?.[0] && pick(results[0])}
            placeholder="Buscar emoji (ex.: risada, fogo, coração)"
            className="flex-1 bg-transparent text-sm text-fg outline-none placeholder-fg-faint"
          />
        </div>
      </div>
      <div className="flex flex-1 min-h-0">
        {!results && (
          <div className="w-10 shrink-0 border-r border-line flex flex-col items-center gap-1 py-2">
            {recent.length > 0 && (
              <button onClick={() => jump('recentes')} className="w-8 h-8 rounded-md hover:bg-hover flex items-center justify-center" title="Recentes">
                <Clock className="w-4 h-4 text-fg-muted" />
              </button>
            )}
            {EMOJI_CATEGORIES.map((c) => (
              <button key={c.id} onClick={() => jump(c.id)} className="w-8 h-8 rounded-md hover:bg-hover text-lg" title={c.label}>
                {c.icon}
              </button>
            ))}
          </div>
        )}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 relative">
          {sections.map((s) => (
            <div key={s.id} data-section={s.id} className="mb-2">
              <div className="text-[13px] font-semibold text-fg-muted px-1 py-1">{s.label}</div>
              <div className="grid grid-cols-8 gap-0.5">
                {s.emojis.map((e) => (
                  <button
                    key={e}
                    onClick={() => pick(e)}
                    className="w-9 h-9 rounded-md hover:bg-hover text-[22px] leading-none flex items-center justify-center transition-transform hover:scale-110"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
