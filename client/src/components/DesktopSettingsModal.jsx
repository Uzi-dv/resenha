import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MonitorCog, X } from 'lucide-react';

function Switch({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full shrink-0 transition-colors disabled:opacity-40 ${checked ? 'bg-ok' : 'bg-active'}`}
    >
      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function Row({ title, description, children }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3 border-b border-line last:border-0">
      <div>
        <div className="text-sm font-medium text-fg-strong">{title}</div>
        <div className="text-[11px] text-fg-muted leading-snug">{description}</div>
      </div>
      {children}
    </label>
  );
}

/** Comportamento da janela no Windows: bandeja do sistema e iniciar junto com o PC. */
export default function DesktopSettingsModal({ onClose }) {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    window.electronAPI?.getDesktopSettings?.().then(setSettings);
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = async (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    setSettings(await window.electronAPI.setDesktopSettings(patch));
  };

  return createPortal(
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 select-none" onPointerDown={onClose}>
      <div onPointerDown={(e) => e.stopPropagation()} className="sheet w-full max-w-md bg-chat text-fg">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-lg font-bold text-fg-strong flex items-center gap-2">
            <MonitorCog className="w-5 h-5 text-accent" /> Windows
          </h2>
          <button onClick={onClose} className="p-1 rounded text-fg-muted hover:text-fg-strong hover:bg-hover transition" title="Fechar (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pb-4">
          {!settings ? (
            <div className="py-6 text-center text-sm text-fg-muted">Carregando...</div>
          ) : (
            <>
              <Row
                title="Fechar minimiza para a bandeja"
                description="O X esconde a janela e o Resenha continua rodando perto do relógio (você segue na call e recebe mensagens). Para sair de vez, use o botão direito no ícone da bandeja."
              >
                <Switch checked={settings.closeToTray} onChange={(v) => update({ closeToTray: v })} />
              </Row>
              <Row
                title="Iniciar com o Windows"
                description={
                  settings.loginItemAvailable
                    ? 'Abre o Resenha automaticamente quando você liga o PC.'
                    : 'Disponível só no app instalado (Resenha-Setup).'
                }
              >
                <Switch checked={settings.openAtLogin} disabled={!settings.loginItemAvailable} onChange={(v) => update({ openAtLogin: v })} />
              </Row>
              <Row title="Iniciar escondido na bandeja" description="Ao abrir junto com o Windows, começa só com o ícone na bandeja, sem a janela.">
                <Switch
                  checked={settings.startHidden}
                  disabled={!settings.loginItemAvailable || !settings.openAtLogin || !settings.closeToTray}
                  onChange={(v) => update({ startHidden: v })}
                />
              </Row>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
