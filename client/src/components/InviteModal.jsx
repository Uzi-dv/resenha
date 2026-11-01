import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Search, Loader2, Link2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useServer } from '../context/ServerContext';
import { useDM } from '../context/DMContext';
import { api } from '../services/api';
import { MAX_AGE_OPTIONS, MAX_USES_OPTIONS, describeInvite, displayLink } from '../services/invites';
import Avatar from './Avatar';

const MAX_SERVERS_TO_SCAN = 15;

/** Pessoas para quem dá para mandar o convite: DMs recentes primeiro, depois quem está em servidores em comum. */
function usePeople(server) {
  const { user: me } = useAuth();
  const { servers } = useServer();
  const { conversations } = useDM();
  const [shared, setShared] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const others = servers.filter((s) => s.id !== server.id).slice(0, MAX_SERVERS_TO_SCAN);
    Promise.allSettled(others.map((s) => api.getServerDetail(s.id))).then((results) => {
      if (cancelled) return;
      setShared(results.flatMap((r) => (r.status === 'fulfilled' ? (r.value.members || []).map((m) => m.user) : [])));
    });
    return () => {
      cancelled = true;
    };
  }, [servers, server.id]);

  return useMemo(() => {
    const seen = new Set([me?.id]);
    const list = [];
    for (const user of [...conversations.map((c) => c.recipient), ...shared]) {
      if (!user || seen.has(user.id)) continue;
      seen.add(user.id);
      list.push(user);
    }
    return list;
  }, [conversations, shared, me?.id]);
}

function SendButton({ state, onClick }) {
  if (state === 'member') {
    return <span className="text-xs text-fg-faint shrink-0">Já está no servidor</span>;
  }
  const sent = state === 'sent';
  return (
    <button
      onClick={onClick}
      disabled={state === 'sending' || sent}
      className={`shrink-0 h-8 min-w-[84px] px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
        sent ? 'bg-transparent text-ok border border-ok/50' : 'bg-accent hover:bg-accent-hover text-on-accent disabled:opacity-60'
      }`}
    >
      {state === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sent ? <Check className="w-3.5 h-3.5" /> : null}
      {sent ? 'Enviado' : 'Enviar'}
    </button>
  );
}

/** "Convidar amigos": link do convite (com validade e limite de usos) e envio direto por DM. */
export default function InviteModal({ server, onClose }) {
  const { sendDirectTo } = useDM();
  const people = usePeople(server);
  const [invite, setInvite] = useState(null);
  const [legacy, setLegacy] = useState(false); // servidor anterior à 2.11: só o código antigo
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState({ maxAge: 604800, maxUses: 0 });
  const [generating, setGenerating] = useState(false);
  const [query, setQuery] = useState('');
  const [sendState, setSendState] = useState({}); // user_id -> 'sending' | 'sent'

  const generate = async (opts) => {
    setGenerating(true);
    setError(null);
    try {
      setInvite(await api.createInvite(server.id, opts));
      setEditing(false);
    } catch (err) {
      if (err.status === 404 || err.status === 405) setLegacy(true);
      else setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    generate(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const link = legacy ? server.invite_code : invite?.url;
  const message = legacy ? `Entra no ${server.name} no Resenha! Código de convite: ${server.invite_code}` : invite?.url;
  const memberIds = useMemo(() => new Set((server.members || []).map((m) => m.user_id)), [server.members]);

  const q = query.trim().toLowerCase();
  const filtered = people.filter((u) => !q || u.username.toLowerCase().includes(q));

  const copy = () => {
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const send = async (user) => {
    if (!message) return;
    setSendState((s) => ({ ...s, [user.id]: 'sending' }));
    try {
      await sendDirectTo(user.id, message);
      setSendState((s) => ({ ...s, [user.id]: 'sent' }));
    } catch (err) {
      setSendState((s) => ({ ...s, [user.id]: undefined }));
      setError(err.message);
    }
  };

  return createPortal(
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 select-none" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
        onPointerDown={(e) => e.stopPropagation()}
        className="sheet w-full max-w-md max-h-[90dvh] flex flex-col bg-chat text-fg"
      >
        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="invite-title" className="text-lg font-bold text-fg-strong">Convidar amigos</h2>
            <p className="text-sm text-fg-muted truncate">para o {server.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 -mr-1.5 rounded text-fg-muted hover:text-fg-strong hover:bg-hover" title="Fechar (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5">
          <h3 className="text-sm font-semibold text-fg-strong mb-2">Enviar por mensagem direta</h3>
          <div className="flex items-center gap-2 bg-well rounded-md px-2.5 h-9 border border-line focus-within:border-accent">
            <Search className="w-4 h-4 text-fg-muted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar amigos"
              aria-label="Buscar amigos"
              className="flex-1 bg-transparent text-sm text-fg outline-none placeholder-fg-faint"
            />
          </div>
        </div>

        <div className="flex-1 min-h-[120px] max-h-72 overflow-y-auto px-3 py-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-fg-muted text-center py-8 px-4">
              {people.length === 0 ? 'Ninguém por aqui ainda. Mande o link abaixo para os seus amigos.' : 'Ninguém com esse nome.'}
            </p>
          ) : (
            filtered.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-hover/50">
                <Avatar user={u} className="w-8 h-8 rounded-full object-cover bg-well shrink-0" />
                <span className={`flex-1 min-w-0 truncate text-sm font-medium ${memberIds.has(u.id) ? 'text-fg-muted' : 'text-fg-strong'}`}>
                  {u.username}
                </span>
                <SendButton state={memberIds.has(u.id) ? 'member' : sendState[u.id]} onClick={() => send(u)} />
              </div>
            ))
          )}
        </div>

        <div className="px-5 pt-3 pb-5 border-t border-line">
          <h3 className="text-sm font-semibold text-fg-strong mb-2">{legacy ? 'Ou envie o código do convite' : 'Ou envie o link do convite'}</h3>
          <div className="flex items-center gap-2 bg-well rounded-md p-1.5 pl-3 border border-line">
            <input
              readOnly
              value={link ? (legacy ? link : displayLink(link)) : generating ? 'Gerando link...' : ''}
              aria-label="Link do convite"
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 bg-transparent text-sm text-fg-strong outline-none"
            />
            <button
              onClick={copy}
              disabled={!link}
              className={`shrink-0 h-8 px-3 rounded text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 ${
                copied ? 'bg-ok text-white' : 'bg-accent hover:bg-accent-hover text-on-accent'
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado!' : legacy ? 'Copiar código' : 'Copiar link'}
            </button>
          </div>

          {legacy ? (
            <p className="text-xs text-fg-muted mt-2">Seus amigos colam o código no botão + da barra de servidores.</p>
          ) : invite && !editing ? (
            <p className="text-xs text-fg-muted mt-2">
              {describeInvite(invite)} ·{' '}
              <button onClick={() => setEditing(true)} className="text-link hover:underline font-medium">
                Editar
              </button>
            </p>
          ) : null}

          {editing && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-fg-2 flex flex-col gap-1">
                Expira em
                <select
                  value={settings.maxAge}
                  onChange={(e) => setSettings((s) => ({ ...s, maxAge: Number(e.target.value) }))}
                  className="h-9 bg-well border border-line rounded-md px-2 text-sm text-fg outline-none focus:border-accent"
                >
                  {MAX_AGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-fg-2 flex flex-col gap-1">
                Limite de usos
                <select
                  value={settings.maxUses}
                  onChange={(e) => setSettings((s) => ({ ...s, maxUses: Number(e.target.value) }))}
                  className="h-9 bg-well border border-line rounded-md px-2 text-sm text-fg outline-none focus:border-accent"
                >
                  {MAX_USES_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'Sem limite' : n === 1 ? '1 uso' : `${n} usos`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="col-span-2 flex justify-end gap-2">
                <button onClick={() => setEditing(false)} className="h-9 px-3 text-sm text-fg-2 hover:text-fg-strong hover:underline">
                  Cancelar
                </button>
                <button
                  onClick={() => generate(settings)}
                  disabled={generating}
                  className="sticker-btn h-9 px-4 rounded-md bg-accent hover:bg-accent-hover disabled:opacity-60 text-on-accent text-sm font-semibold flex items-center gap-1.5"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                  Gerar novo link
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-danger mt-2">{error}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
