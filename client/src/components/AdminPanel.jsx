import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ShieldAlert, X, Search, RefreshCw, PhoneOff, LogOut, Pencil, Ban, ShieldCheck, Trash2, UserX, Volume2, MicOff, HeadphoneOff,
  Video, MonitorUp, Users, Server, Check
} from 'lucide-react';
import Avatar from './Avatar';
import { api, formatMediaUrl } from '../services/api';
import { alertDialog, confirmDialog } from '../services/dialog';
import { useAuth } from '../context/AuthContext';

const PRESENCE_DOT = { online: 'bg-ok', idle: 'bg-warn', dnd: 'bg-danger', offline: 'bg-fg-faint' };

function ActionButton({ onClick, title, danger, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
        danger ? 'text-danger hover:bg-danger hover:text-white' : 'text-fg-2 hover:bg-hover hover:text-fg-strong'
      }`}
    >
      {children}
    </button>
  );
}

function UserRow({ u, isMe, onAction }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(u.username);
  const protectedUser = isMe || u.is_superadmin;

  const submitRename = async () => {
    const next = name.trim();
    if (!next || next === u.username) return setRenaming(false);
    if (await onAction('rename', u, next)) setRenaming(false);
  };

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-hover/50 ${u.banned ? 'opacity-60' : ''}`}>
      <div className="relative shrink-0">
        <Avatar user={u} alt="" className="w-9 h-9 rounded-full object-cover bg-well" />
        <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-[3px] border-chat ${PRESENCE_DOT[u.presence] || PRESENCE_DOT.offline}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {renaming ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              onBlur={submitRename}
              maxLength={32}
              className="bg-well text-sm text-fg-strong px-2 py-0.5 rounded border border-accent outline-none w-48"
            />
          ) : (
            <span className="text-sm font-semibold text-fg-strong truncate">{u.username}</span>
          )}
          {isMe && <span className="text-[10px] font-bold uppercase px-1.5 rounded bg-hover text-fg-2">você</span>}
          {u.is_superadmin && <span className="text-[10px] font-bold uppercase px-1.5 rounded bg-accent text-on-accent">super admin</span>}
          {u.banned && <span className="text-[10px] font-bold uppercase px-1.5 rounded bg-danger text-white">suspensa</span>}
        </div>
        <div className="text-[11px] text-fg-muted truncate">
          {u.email} · {u.servers} servidor{u.servers === 1 ? '' : 'es'}
          {u.connections > 1 ? ` · ${u.connections} conexões` : ''}
        </div>
        {u.voice && (
          <div className="text-[11px] text-ok flex items-center gap-1 mt-0.5 min-w-0">
            <Volume2 className="w-3 h-3 shrink-0" />
            <span className="truncate">
              {u.voice.channel_name} · {u.voice.server_name}
            </span>
            {u.voice.muted && <MicOff className="w-3 h-3 text-danger shrink-0" />}
            {u.voice.deafened && <HeadphoneOff className="w-3 h-3 text-danger shrink-0" />}
            {u.voice.camera && <Video className="w-3 h-3 shrink-0" />}
            {u.voice.sharing_screen && <MonitorUp className="w-3 h-3 text-danger shrink-0" />}
          </div>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <ActionButton onClick={() => setRenaming(true)} title="Renomear">
          <Pencil className="w-4 h-4" />
        </ActionButton>
        {!protectedUser && (
          <>
            {u.voice && (
              <ActionButton onClick={() => onAction('voice', u)} title="Tirar da call">
                <PhoneOff className="w-4 h-4" />
              </ActionButton>
            )}
            {u.connections > 0 && (
              <ActionButton onClick={() => onAction('revoke', u)} title="Encerrar sessão (desconecta do app)">
                <LogOut className="w-4 h-4" />
              </ActionButton>
            )}
            {u.banned ? (
              <ActionButton onClick={() => onAction('unban', u)} title="Reativar conta">
                <ShieldCheck className="w-4 h-4 text-ok" />
              </ActionButton>
            ) : (
              <ActionButton onClick={() => onAction('ban', u)} title="Suspender conta" danger>
                <Ban className="w-4 h-4" />
              </ActionButton>
            )}
            <ActionButton onClick={() => onAction('delete', u)} title="Excluir conta" danger>
              <UserX className="w-4 h-4" />
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}

function ServerRow({ s, onDelete }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-hover/50">
      <div className="w-9 h-9 rounded-xl bg-rail-item overflow-hidden flex items-center justify-center text-xs font-bold text-fg shrink-0">
        {s.icon_url ? <img src={formatMediaUrl(s.icon_url)} alt="" className="w-full h-full object-cover" /> : s.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-fg-strong truncate">{s.name}</div>
        <div className="text-[11px] text-fg-muted">
          dono: {s.owner} · {s.members} membro{s.members === 1 ? '' : 's'} · {s.online} online
          {s.in_voice > 0 && <span className="text-ok"> · {s.in_voice} em call</span>}
        </div>
      </div>
      <ActionButton onClick={() => onDelete(s)} title="Excluir servidor" danger>
        <Trash2 className="w-4 h-4" />
      </ActionButton>
    </div>
  );
}

/** Painel do super admin: pessoas (call, sessão, suspensão, nome, exclusão) e servidores. Atualiza sozinho. */
export default function AdminPanel({ onClose }) {
  const { user: me } = useAuth();
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState(null);
  const [servers, setServers] = useState(null);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([api.adminUsers(), api.adminServers()]);
      setUsers(u);
      setServers(s);
    } catch (err) {
      alertDialog(err.message, 'Não foi possível carregar o painel');
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [load, onClose]);

  const done = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
    load();
  };

  const onAction = async (kind, u, extra) => {
    try {
      if (kind === 'voice') {
        if (!(await confirmDialog({ title: `Tirar ${u.username} da call?`, message: 'A pessoa sai da call na hora (pode entrar de novo).', confirmLabel: 'Tirar da call', danger: true }))) return false;
        await api.adminDisconnectVoice(u.id);
        done(`${u.username} foi tirado(a) da call.`);
      } else if (kind === 'revoke') {
        if (!(await confirmDialog({ title: `Encerrar a sessão de ${u.username}?`, message: 'O app da pessoa desconecta e volta para a tela de login. Ela pode entrar de novo com a senha.', confirmLabel: 'Encerrar sessão', danger: true }))) return false;
        await api.adminRevokeSessions(u.id);
        done(`Sessão de ${u.username} encerrada.`);
      } else if (kind === 'ban') {
        if (!(await confirmDialog({ title: `Suspender ${u.username}?`, message: 'A pessoa é desconectada e não consegue mais entrar até você reativar a conta. Mensagens e servidores dela continuam.', confirmLabel: 'Suspender', danger: true }))) return false;
        await api.adminSetBan(u.id, true);
        done(`${u.username} foi suspenso(a).`);
      } else if (kind === 'unban') {
        await api.adminSetBan(u.id, false);
        done(`${u.username} foi reativado(a).`);
      } else if (kind === 'delete') {
        const owned = u.owned_servers || 0;
        const ok = await confirmDialog({
          title: `Excluir a conta de ${u.username}?`,
          message:
            'A conta é apagada de vez, com todas as mensagens, reações e conversas privadas dela. A pessoa é desconectada e não consegue mais entrar (pode criar uma conta nova).' +
            (owned
              ? ` ${owned === 1 ? 'O servidor criado por ela passa' : `Os ${owned} servidores criados por ela passam`} para o membro mais antigo; servidor sem mais ninguém é apagado.`
              : '') +
            ' Isso não pode ser desfeito.',
          confirmLabel: 'Excluir conta',
          danger: true
        });
        if (!ok) return false;
        await api.adminDeleteUser(u.id);
        done(`Conta de ${u.username} excluída.`);
      } else if (kind === 'rename') {
        await api.adminRename(u.id, extra);
        done(`Nome alterado para ${extra}.`);
      }
      return true;
    } catch (err) {
      alertDialog(err.message);
      return false;
    }
  };

  const deleteServer = async (s) => {
    const ok = await confirmDialog({
      title: `Excluir "${s.name}"?`,
      message: `O servidor de ${s.owner} será apagado para todos os ${s.members} membros, com canais e mensagens. Isso não pode ser desfeito.`,
      confirmLabel: 'Excluir servidor',
      danger: true
    });
    if (!ok) return;
    try {
      await api.adminDeleteServer(s.id);
      done(`Servidor "${s.name}" excluído.`);
    } catch (err) {
      alertDialog(err.message);
    }
  };

  const q = query.trim().toLowerCase();
  const shownUsers = (users || []).filter((u) => !q || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  const shownServers = (servers || []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.owner.toLowerCase().includes(q));
  const online = (users || []).filter((u) => u.presence !== 'offline').length;
  const inVoice = (users || []).filter((u) => u.voice).length;

  return createPortal(
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 select-none" onPointerDown={onClose}>
      <div onPointerDown={(e) => e.stopPropagation()} className="sheet relative w-full max-w-3xl h-[85dvh] flex flex-col bg-chat text-fg">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-lg font-bold text-fg-strong flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-danger" /> Painel de admin
            </h2>
            <p className="text-xs text-fg-muted">
              {users ? `${users.length} contas · ${online} online · ${inVoice} em call · ${servers?.length ?? 0} servidores` : 'Carregando...'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={load} className="p-1.5 rounded text-fg-muted hover:text-fg-strong hover:bg-hover" title="Atualizar">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded text-fg-muted hover:text-fg-strong hover:bg-hover" title="Fechar (Esc)">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 flex items-center gap-3 border-b border-line">
          {[
            { id: 'users', label: 'Pessoas', icon: Users, count: users?.length },
            { id: 'servers', label: 'Servidores', icon: Server, count: servers?.length }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-2 text-sm font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
                tab === t.id ? 'border-accent text-fg-strong' : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              <t.icon className="w-4 h-4" /> {t.label} {t.count != null && <span className="text-xs text-fg-faint">({t.count})</span>}
            </button>
          ))}
          <div className="ml-auto mb-2 flex items-center gap-2 bg-well rounded-md px-2.5 h-8 w-64">
            <Search className="w-4 h-4 text-fg-muted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'users' ? 'Buscar por nome ou e-mail' : 'Buscar servidor ou dono'}
              className="flex-1 bg-transparent text-sm text-fg outline-none placeholder-fg-faint"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {tab === 'users'
            ? shownUsers.map((u) => <UserRow key={u.id} u={u} isMe={u.id === me?.id} onAction={onAction} />)
            : shownServers.map((s) => <ServerRow key={s.id} s={s} onDelete={deleteServer} />)}
          {users && (tab === 'users' ? shownUsers : shownServers).length === 0 && (
            <div className="text-center text-sm text-fg-muted py-10">Nada encontrado.</div>
          )}
        </div>

        {toast && (
          <div className="anim-rise absolute bottom-6 left-1/2 -translate-x-1/2 bg-ok text-white text-sm font-semibold px-4 py-2 rounded-full shadow-xl flex items-center gap-2">
            <Check className="w-4 h-4" /> {toast}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
