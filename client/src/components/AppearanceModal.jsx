import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Palette } from 'lucide-react';
import { useStore } from '../services/store';
import { appearance, setAppearance, resolveMode, THEMES, ACCENTS, MODES } from '../services/theme';

/** Miniatura do app desenhada com as cores do tema (trilho, barra lateral, chat). */
function ThemePreview({ colors, accent, oled, light }) {
  const [frame, side, chat] = colors;
  const line = oled ? (light ? '#e4e4e7' : '#2a2a2f') : 'transparent';
  // Barrinhas de "texto" da miniatura: claras no escuro, escuras no claro
  const bar = light ? 'bg-black/15' : 'bg-white/15';
  const barStrong = light ? 'bg-black/25' : 'bg-white/20';
  const barSoft = light ? 'bg-black/10' : 'bg-white/10';
  return (
    <div className="h-20 rounded-md overflow-hidden flex border" style={{ background: frame, borderColor: line }}>
      <div className="w-5 flex flex-col items-center gap-1 pt-2">
        <span className="w-3 h-3 rounded-full" style={{ background: accent }} />
        <span className={`w-3 h-3 rounded-full ${bar}`} />
        <span className={`w-3 h-3 rounded-full ${bar}`} />
      </div>
      <div className="flex-1 flex mt-1.5 rounded-tl-md overflow-hidden border-t border-l" style={{ borderColor: line }}>
        <div className="w-10 p-1.5 space-y-1 border-r" style={{ background: side, borderColor: line }}>
          <span className={`block h-1.5 rounded-full ${barStrong}`} />
          <span className={`block h-1.5 rounded-full ${barSoft}`} />
          <span className={`block h-1.5 rounded-full ${barSoft}`} />
        </div>
        <div className="flex-1 p-2 space-y-1.5" style={{ background: chat }}>
          <span className={`block h-1.5 w-3/4 rounded-full ${barStrong}`} />
          <span className={`block h-1.5 w-1/2 rounded-full ${barSoft}`} />
          <span className={`block h-1.5 w-2/3 rounded-full ${barSoft}`} />
        </div>
      </div>
    </div>
  );
}

export default function AppearanceModal({ onClose }) {
  const { theme, accent, reduceMotion, mode } = useStore(appearance);
  const light = resolveMode(mode) === 'light';
  const accentColor = ACCENTS.find((a) => a.id === accent)?.color;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 select-none" onPointerDown={onClose}>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="sheet w-full max-w-2xl max-h-[90dvh] overflow-y-auto bg-chat text-fg"
      >
        {/* Cabeçalho fixo: no celular a janela rola e o X (fechar) continua à vista */}
        <div className="sticky top-0 z-10 bg-chat flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold text-fg-strong flex items-center gap-2">
            <Palette className="w-5 h-5 text-accent" /> Aparência
          </h2>
          <button onClick={onClose} className="p-1 rounded text-fg-muted hover:text-fg-strong hover:bg-hover transition" title="Fechar (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-6">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-fg-muted">Tema</h3>
              <div className="flex bg-well p-0.5 rounded-lg gap-0.5" role="radiogroup" aria-label="Modo de cor">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    role="radio"
                    aria-checked={mode === m.id}
                    onClick={() => setAppearance({ mode: m.id })}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                      mode === m.id ? 'bg-accent text-on-accent shadow' : 'text-fg-muted hover:text-fg-strong'
                    }`}
                    title={m.id === 'system' ? 'Segue o modo claro/escuro do Windows' : undefined}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {THEMES.map((t) => {
                const selected = theme === t.id;
                // O tema Resenha ocupa a linha inteira; os outros 12 fecham a grade de 4 colunas
                const featured = t.id === 'resenha';
                return (
                  <button
                    key={t.id}
                    onClick={() => setAppearance(t.accent ? { theme: t.id, accent: t.accent } : { theme: t.id })}
                    className={`text-left rounded-lg p-2 border-2 transition ${featured ? 'col-span-2 sm:col-span-4 flex items-center gap-4' : ''} ${
                      selected ? 'border-accent bg-hover' : 'border-transparent hover:bg-hover'
                    }`}
                  >
                    <div className={featured ? 'w-32 sm:w-44 shrink-0' : ''}>
                    <ThemePreview colors={light ? t.previewLight : t.preview} light={light} accent={ACCENTS.find((a) => a.id === t.accent)?.color || accentColor} oled={t.id === 'oled'} />
                    </div>
                    <div className={featured ? 'flex-1 min-w-0' : ''}>
                    <div className={`${featured ? '' : 'mt-2 '}flex items-center justify-between`}>
                      <span className="text-sm font-semibold text-fg-strong">{(light && t.labelLight) || t.label}</span>
                      {selected && (
                        <span className="w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                          <Check className="w-3 h-3 text-on-accent" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-fg-muted leading-tight">{(light && t.hintLight) || t.hint}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-fg-muted mb-2">Cor de destaque</h3>
            <div className="flex flex-wrap gap-3">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAppearance({ accent: a.id })}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition hover:scale-110 ${
                    accent === a.id ? 'ring-2 ring-white ring-offset-2 ring-offset-chat' : ''
                  }`}
                  style={{ background: a.color }}
                  title={a.label}
                >
                  {accent === a.id && <Check className="w-5 h-5 text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-fg-muted mt-2">Usada em botões, links, menções e seleções.</p>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-fg-muted mb-2">Movimento</h3>
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <div className="text-sm font-medium text-fg-strong">Desativar animações</div>
                <div className="text-[11px] text-fg-muted">Menus, mensagens e janelas aparecem na hora, sem transição. Também é ativado automaticamente se o Windows estiver com as animações desligadas.</div>
              </div>
              <button
                role="switch"
                aria-checked={reduceMotion}
                onClick={() => setAppearance({ reduceMotion: !reduceMotion })}
                className={`relative w-10 h-6 rounded-full shrink-0 transition-colors ${reduceMotion ? 'bg-ok' : 'bg-active'}`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${reduceMotion ? 'translate-x-4' : ''}`}
                />
              </button>
            </label>
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}
