import React, { useState, useEffect, useRef } from 'react';
import VolumeSlider from './VolumeSlider';
import { useAuth } from '../context/AuthContext';
import { useVoice } from '../context/VoiceContext';
import { useDM } from '../context/DMContext';
import { useServer } from '../context/ServerContext';
import { useStore } from '../services/store';
import { voiceStatesStore } from '../services/voice/stores';
import { api } from '../services/api';
import { alertDialog, confirmDialog } from '../services/dialog';
import { PhoneOff, LogOut as LogOutIcon, Ban, ShieldAlert, UserX, Check as CheckIcon } from 'lucide-react';
import { PERMS, canManageRole, hasPermission, memberRoles, outranks } from '../services/permissions';
import {
  User,
  AtSign,
  MessageSquare,
  Volume2,
  VolumeX,
  Tv,
  Copy,
  CheckCheck
} from 'lucide-react';

export default function UserContextMenu({
  user,
  position,
  onClose,
  onOpenProfile,
  onMention
}) {
  const { user: currentUser } = useAuth();
  const { userVolumes, setUserVolume, streamVolumes, setStreamVolume, watching, watchStream, stopWatching } = useVoice();
  const { startOrOpenDM } = useDM();
  const { currentServer, selectServer, selectChannel } = useServer();

  const menuRef = useRef(null);
  const [copiedId, setCopiedId] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(100);

  const targetId = user?.id || user?.user_id;
  const isMe = targetId === currentUser?.id;
  const currentVolume = targetId ? (userVolumes[targetId] ?? 100) : 100;
  const isMutedLocally = currentVolume === 0;

  const targetVoice = useStore(voiceStatesStore, (s) => s[targetId]);
  const isUserSharingScreen = Boolean(targetVoice?.is_sharing_screen);
  const isWatching = watching.has(targetId);

  // Close on outside click or escape
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!user || !position) return null;

  // Clamp coordinates to prevent clipping
  const menuWidth = 230;
  const menuHeight = 360;
  const x = Math.max(10, Math.min(position.x, window.innerWidth - menuWidth - 10));
  const y = Math.max(10, Math.min(position.y, window.innerHeight - menuHeight - 10));

  const handleOpenProfile = () => {
    onOpenProfile(user.id);
    onClose();
  };

  const handleMention = () => {
    if (onMention) {
      onMention(user.username);
    } else {
      window.dispatchEvent(
        new CustomEvent('insert-chat-mention', { detail: { username: user.username } })
      );
    }
    onClose();
  };

  const handleDirectMessage = async () => {
    try {
      await startOrOpenDM({ targetUserId: user.id });
      selectServer(null);
      onClose();
    } catch (e) {
      console.error('Erro ao abrir DM via menu de contexto:', e);
    }
  };

  const handleToggleMute = (e) => {
    e.stopPropagation();
    if (!targetId) return;
    if (isMutedLocally) {
      setUserVolume(targetId, previousVolume || 100);
    } else {
      setPreviousVolume(currentVolume);
      setUserVolume(targetId, 0);
    }
  };

  // ------------------------------------------------------------ cargos e moderação do servidor
  const isMember = Boolean(currentServer?.members?.some((m) => m.user_id === targetId));
  const targetRoles = isMember ? memberRoles(currentServer, targetId) : [];
  const canEditRoles = isMember && (outranks(currentServer, currentUser, targetId) || isMe);
  const assignable = canEditRoles
    ? [...(currentServer.roles || [])].filter((r) => canManageRole(currentServer, currentUser, r)).sort((a, b) => b.position - a.position)
    : [];
  const canMove =
    !isMe && targetVoice?.server_id === currentServer?.id && outranks(currentServer, currentUser, targetId) &&
    hasPermission(currentServer, currentUser?.id, PERMS.MOVE_MEMBERS, currentUser);
  const canKick =
    !isMe && isMember && outranks(currentServer, currentUser, targetId) &&
    hasPermission(currentServer, currentUser?.id, PERMS.KICK_MEMBERS, currentUser);

  const toggleRole = async (role) => {
    const has = targetRoles.some((r) => r.id === role.id);
    const ids = has ? targetRoles.filter((r) => r.id !== role.id).map((r) => r.id) : [...targetRoles.map((r) => r.id), role.id];
    try {
      await api.setMemberRoles(currentServer.id, targetId, ids);
    } catch (err) {
      alertDialog(err.message);
    }
  };

  const serverAction = async (kind) => {
    onClose();
    const name = user.username || 'esta pessoa';
    const config = {
      move: { title: `Desconectar ${name} da call?`, message: 'A pessoa sai da call na hora (pode entrar de novo).', confirmLabel: 'Desconectar', run: () => api.disconnectMemberVoice(currentServer.id, targetId) },
      kick: { title: `Expulsar ${name} de ${currentServer.name}?`, message: 'A pessoa sai do servidor e só volta com um novo convite.', confirmLabel: 'Expulsar', run: () => api.kickMember(currentServer.id, targetId) }
    }[kind];
    if (!(await confirmDialog({ ...config, danger: true }))) return;
    try {
      await config.run();
    } catch (err) {
      alertDialog(err.message);
    }
  };

  const adminAction = async (kind) => {
    onClose();
    const name = user.username || 'esta pessoa';
    const config = {
      voice: { title: `Tirar ${name} da call?`, message: 'A pessoa sai da call na hora (pode entrar de novo).', confirmLabel: 'Tirar da call', run: () => api.adminDisconnectVoice(targetId) },
      revoke: { title: `Encerrar a sessão de ${name}?`, message: 'O app da pessoa volta para a tela de login. Ela pode entrar de novo com a senha.', confirmLabel: 'Encerrar sessão', run: () => api.adminRevokeSessions(targetId) },
      ban: { title: `Suspender ${name}?`, message: 'A pessoa é desconectada e não consegue mais entrar até você reativar a conta (Painel de admin).', confirmLabel: 'Suspender', run: () => api.adminSetBan(targetId, true) }
    }[kind];
    if (!(await confirmDialog({ ...config, danger: true }))) return;
    try {
      await config.run();
    } catch (err) {
      alertDialog(err.message);
    }
  };

  const handleCopyId = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(user.id.toString());
    setCopiedId(true);
    setTimeout(() => {
      setCopiedId(false);
      onClose();
    }, 1200);
  };

  return (
    <div
      ref={menuRef}
      style={{ top: `${y}px`, left: `${x}px` }}
      className="fixed z-[999] w-[220px] bg-float border border-well rounded-xl shadow-2xl p-1.5 text-xs text-fg select-none anim-pop origin-top-left"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. Perfil */}
      <button
        onClick={handleOpenProfile}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-accent hover:text-on-accent transition font-medium text-left"
      >
        <User className="w-4 h-4" />
        <span>Perfil</span>
      </button>

      {/* 2. Mencionar */}
      <button
        onClick={handleMention}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-accent hover:text-on-accent transition font-medium text-left"
      >
        <AtSign className="w-4 h-4" />
        <span>Mencionar</span>
      </button>

      {/* 3. Mensagem Direta */}
      {!isMe && (
        <button
          onClick={handleDirectMessage}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-accent hover:text-on-accent transition font-medium text-left"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Mensagem</span>
        </button>
      )}

      <div className="h-[1px] bg-panel my-1" />

      {/* 4. Volume do Usuário */}
      {!isMe && (
        <div className="px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-fg-muted">
            <span className="flex items-center gap-1.5 text-fg-strong">
              {isMutedLocally ? (
                <VolumeX className="w-3.5 h-3.5 text-danger" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-ok" />
              )}
              Volume do Usuário
            </span>
            <span className="font-mono text-accent font-bold">{currentVolume}%</span>
          </div>

          <VolumeSlider value={currentVolume} onChange={(v) => setUserVolume(targetId, v)} label="Volume do usuário" />
        </div>
      )}

      {/* Volume da transmissão (o áudio do jogo dessa pessoa), separado do volume da voz */}
      {!isMe && isUserSharingScreen && (
        <div className="px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-fg-muted">
            <span className="flex items-center gap-1.5 text-fg-strong">
              <Volume2 className="w-3.5 h-3.5 text-danger" />
              Volume da Transmissão
            </span>
            <span className="font-mono text-accent font-bold">{streamVolumes[targetId] ?? 100}%</span>
          </div>
          <VolumeSlider
            value={streamVolumes[targetId] ?? 100}
            onChange={(v) => setStreamVolume(targetId, v)}
            label="Volume da transmissão"
          />
        </div>
      )}

      {/* 5. Silenciar Local */}
      {!isMe && (
        <div
          onClick={handleToggleMute}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-side transition cursor-pointer"
        >
          <span>Silenciar</span>
          <input
            type="checkbox"
            checked={isMutedLocally}
            onChange={handleToggleMute}
            className="accent-accent w-3.5 h-3.5 rounded cursor-pointer"
          />
        </div>
      )}

      {/* 6. Assistir Transmissão / Ocultar Vídeo */}
      {!isMe && isUserSharingScreen && (
        <>
          {isWatching ? (
            <button
              onClick={() => {
                stopWatching(targetId);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-danger hover:text-white transition font-medium text-left"
            >
              <Tv className="w-4 h-4" />
              <span>Parar de assistir</span>
            </button>
          ) : (
            <button
              onClick={() => {
                onClose();
                const targetChannel = currentServer?.channels?.find((c) => c.id === targetVoice?.channel_id);
                if (targetChannel) selectChannel(targetChannel);
                watchStream(targetId, targetChannel);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-accent hover:text-on-accent transition font-medium text-left"
            >
              <Tv className="w-4 h-4 text-ok" />
              <span>Assistir transmissão</span>
            </button>
          )}
        </>
      )}

      {/* Cargos (como no Discord: marca e desmarca na hora) */}
      {assignable.length > 0 && (
        <>
          <div className="h-[1px] bg-panel my-1" />
          <div className="px-2.5 pt-1 pb-0.5 text-xs font-semibold text-fg-muted">Cargos</div>
          <div className="max-h-48 overflow-y-auto">
            {assignable.map((role) => {
              const has = targetRoles.some((r) => r.id === role.id);
              return (
                <button
                  key={role.id}
                  onClick={() => toggleRole(role)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-hover transition text-left"
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${has ? 'bg-accent border-accent' : 'border-fg-faint'}`}
                  >
                    {has && <CheckIcon className="w-3 h-3 text-on-accent" strokeWidth={3} />}
                  </span>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: role.color || 'var(--c-fg-faint)' }} />
                  <span className="truncate">{role.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {(canMove || canKick) && (
        <>
          <div className="h-[1px] bg-panel my-1" />
          {canMove && (
            <button
              onClick={() => serverAction('move')}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-danger hover:text-white transition font-medium text-left"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Desconectar da call</span>
            </button>
          )}
          {canKick && (
            <button
              onClick={() => serverAction('kick')}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-danger hover:bg-danger hover:text-white transition font-medium text-left"
            >
              <UserX className="w-4 h-4" />
              <span>Expulsar de {currentServer.name}</span>
            </button>
          )}
        </>
      )}

      {/* Moderação do super admin */}
      {currentUser?.is_superadmin && !isMe && (
        <>
          <div className="h-[1px] bg-panel my-1" />
          <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-danger flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" /> Super admin
          </div>
          {targetVoice?.channel_id && (
            <button
              onClick={() => adminAction('voice')}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-danger hover:text-white transition font-medium text-left"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Tirar da call</span>
            </button>
          )}
          <button
            onClick={() => adminAction('revoke')}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-danger hover:text-white transition font-medium text-left"
          >
            <LogOutIcon className="w-4 h-4" />
            <span>Encerrar sessão</span>
          </button>
          <button
            onClick={() => adminAction('ban')}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-danger hover:bg-danger hover:text-white transition font-medium text-left"
          >
            <Ban className="w-4 h-4" />
            <span>Suspender conta</span>
          </button>
        </>
      )}

      <div className="h-[1px] bg-panel my-1" />

      {/* 7. Copiar ID do Usuário */}
      <button
        onClick={handleCopyId}
        className="w-full flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-side hover:text-fg-strong transition font-medium text-left"
      >
        <span className="flex items-center gap-2">
          {copiedId ? (
            <CheckCheck className="w-4 h-4 text-ok" />
          ) : (
            <Copy className="w-4 h-4 text-fg-muted" />
          )}
          <span>{copiedId ? 'ID Copiado!' : 'Copiar ID do usuário'}</span>
        </span>
        <span className="text-[10px] font-mono text-fg-faint">#{user.id}</span>
      </button>
    </div>
  );
}
