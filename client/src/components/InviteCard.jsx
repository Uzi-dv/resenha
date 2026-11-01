import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatMediaUrl } from '../services/api';
import { useServer } from '../context/ServerContext';
import { fetchInvitePreview, forgetInvitePreview, serverInitials } from '../services/invites';

export function ServerIcon({ server, className = '' }) {
  const [failed, setFailed] = useState(false);
  if (server?.icon_url && !failed) {
    return (
      <img
        src={formatMediaUrl(server.icon_url)}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className={`object-cover bg-well shrink-0 ${className}`}
      />
    );
  }
  return (
    <span className={`flex items-center justify-center bg-accent text-on-accent font-bold shrink-0 ${className}`}>
      {serverInitials(server?.name)}
    </span>
  );
}

export function InviteCounts({ online, members, className = '' }) {
  return (
    <p className={`flex items-center gap-3 text-xs text-fg-muted tabular-nums ${className}`}>
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-ok" />
        {online} online
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-fg-faint" />
        {members} {members === 1 ? 'membro' : 'membros'}
      </span>
    </p>
  );
}

/** Cartão abaixo de uma mensagem que contém um link de convite. */
export default function InviteCard({ code }) {
  const { servers, acceptInvite, selectServer } = useServer();
  const [preview, setPreview] = useState(undefined); // undefined = carregando, null = inválido
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchInvitePreview(code)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const server = preview?.server;
  const isMember = server && servers.some((s) => s.id === server.id);

  const join = async () => {
    setJoining(true);
    setError(null);
    try {
      if (isMember) await selectServer(server.id);
      else {
        await acceptInvite(code);
        forgetInvitePreview(code);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="sheet-sm mt-2 mb-1 w-full max-w-[420px] bg-side p-3.5 select-none">
      <p className="text-xs font-medium text-fg-muted mb-2.5">
        {preview?.inviter ? `${preview.inviter.username} te convidou para um servidor` : 'Convite para um servidor'}
      </p>
      {preview === undefined ? (
        <div className="h-12 flex items-center text-fg-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : preview === null ? (
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-2xl bg-well border border-line shrink-0" />
          <div>
            <p className="text-sm font-semibold text-fg-strong">Convite expirado ou inválido</p>
            <p className="text-xs text-fg-muted">Peça um link novo a quem enviou.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <ServerIcon server={server} className="w-12 h-12 rounded-2xl text-base" />
          <div className="flex-1 min-w-0">
            <p className="text-lg leading-tight font-extrabold tracking-tight text-fg-strong truncate">{server.name}</p>
            <InviteCounts online={preview.online} members={preview.members} />
          </div>
          <button
            onClick={join}
            disabled={joining}
            className={`shrink-0 h-9 px-4 rounded-lg text-sm font-bold flex items-center gap-1.5 disabled:opacity-60 ${
              isMember ? 'bg-hover hover:bg-active text-fg-strong' : 'sticker-btn bg-accent hover:bg-accent-hover text-on-accent'
            }`}
          >
            {joining && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isMember ? 'Ir para o servidor' : 'Entrar'}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-danger mt-2">{error}</p>}
    </div>
  );
}
