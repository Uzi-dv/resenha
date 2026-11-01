import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useServer } from '../context/ServerContext';
import { fetchInvitePreview, forgetInvitePreview } from '../services/invites';
import { InviteCounts, ServerIcon } from './InviteCard';
import Avatar from './Avatar';

/** "Você foi convidado": aberto por um link de convite (navegador, resenha:// ou cartão numa mensagem). */
export default function AcceptInviteModal({ code, onClose }) {
  const { servers, acceptInvite, selectServer } = useServer();
  const [preview, setPreview] = useState(undefined); // undefined = carregando, null = inválido
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchInvitePreview(code, { fresh: true })
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !joining && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [joining, onClose]);

  const server = preview?.server;
  const isMember = server && servers.some((s) => s.id === server.id);

  const join = async () => {
    setJoining(true);
    setError(null);
    try {
      if (isMember) await selectServer(server.id);
      else await acceptInvite(code);
      forgetInvitePreview(code);
      onClose();
    } catch (err) {
      setError(err.message);
      setJoining(false);
    }
  };

  return createPortal(
    <div className="anim-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 select-none" onPointerDown={() => !joining && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="accept-invite-title"
        onPointerDown={(e) => e.stopPropagation()}
        className="sheet relative w-full max-w-sm bg-chat text-fg p-6 text-center"
      >
        <button onClick={onClose} disabled={joining} className="absolute top-3 right-3 p-1.5 rounded text-fg-muted hover:text-fg-strong hover:bg-hover" title="Fechar (Esc)">
          <X className="w-5 h-5" />
        </button>

        {preview === undefined && (
          <div className="py-10 flex justify-center text-fg-muted">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {preview === null && (
          <>
            <h2 id="accept-invite-title" className="text-lg font-bold text-fg-strong mt-2">Convite expirado ou inválido</h2>
            <p className="text-sm text-fg-muted mt-2">{error || 'Peça um link novo a quem te convidou.'}</p>
            <button onClick={onClose} className="mt-6 w-full h-10 rounded-md bg-side hover:bg-hover text-sm font-semibold text-fg-strong">
              Fechar
            </button>
          </>
        )}

        {preview && (
          <>
            <ServerIcon server={server} className="w-20 h-20 rounded-[24px] text-2xl mx-auto" />
            <p className="text-sm text-fg-muted mt-4 flex items-center justify-center gap-1.5">
              {preview.inviter ? (
                <>
                  <Avatar user={preview.inviter} className="w-5 h-5 rounded-full object-cover bg-well" />
                  <span>
                    <strong className="text-fg">{preview.inviter.username}</strong> te convidou para
                  </span>
                </>
              ) : (
                'Você foi convidado para'
              )}
            </p>
            <h2 id="accept-invite-title" className="text-2xl font-extrabold text-fg-strong mt-1 break-words">{server.name}</h2>
            <InviteCounts online={preview.online} members={preview.members} className="justify-center mt-2" />
            {error && <p className="text-xs text-danger mt-3">{error}</p>}
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={join}
                disabled={joining}
                className="sticker-btn h-11 rounded-md bg-accent hover:bg-accent-hover disabled:opacity-60 text-on-accent text-sm font-semibold flex items-center justify-center gap-2"
              >
                {joining && <Loader2 className="w-4 h-4 animate-spin" />}
                {isMember ? 'Ir para o servidor' : joining ? 'Entrando...' : 'Entrar no servidor'}
              </button>
              <button onClick={onClose} disabled={joining} className="h-10 rounded-md text-sm font-medium text-fg-2 hover:text-fg-strong hover:underline">
                Agora não
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
