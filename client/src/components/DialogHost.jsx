import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../services/store';
import { dialogStore, closeDialog } from '../services/dialog';

export default function DialogHost() {
  const dialog = useStore(dialogStore);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement;
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDialog(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // Devolve o foco para onde estava (ex.: a caixa de mensagem)
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, [dialog]);

  if (!dialog) return null;
  const isConfirm = dialog.kind === 'confirm';

  return createPortal(
    <div className="anim-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 select-none" onPointerDown={() => closeDialog(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        onPointerDown={(e) => e.stopPropagation()}
        className="sheet w-full max-w-md bg-chat overflow-hidden"
      >
        <div className="p-5">
          <h2 className="text-xl font-extrabold tracking-tight text-fg-strong">{dialog.title}</h2>
          {dialog.message && <p className="mt-2 text-sm text-fg-2 leading-relaxed whitespace-pre-line">{dialog.message}</p>}
        </div>
        <div className="bg-panel px-5 py-3.5 flex justify-end gap-3">
          {isConfirm && (
            <button onClick={() => closeDialog(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-fg hover:underline">
              Cancelar
            </button>
          )}
          <button
            ref={confirmRef}
            onClick={() => closeDialog(true)}
            className={`sticker-btn px-5 py-2 rounded-lg text-sm font-bold outline-none ${
              dialog.danger ? 'bg-danger hover:bg-danger-hover text-white' : 'bg-accent hover:bg-accent-hover text-on-accent'
            }`}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
