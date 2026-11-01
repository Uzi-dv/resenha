import React, { useState } from 'react';
import Avatar from './Avatar';
import { useServer } from '../context/ServerContext';
import { useVoice } from '../context/VoiceContext';
import { useAuth } from '../context/AuthContext';
import { useChannelParticipants, useIsSpeaking } from '../services/voice/stores';
import { confirmDialog, alertDialog } from '../services/dialog';
import { PERMS, hasPermission, roleColor } from '../services/permissions';
import ServerSettingsModal from './ServerSettingsModal';
import { showMobileContent } from '../services/mobile';
import { Hash, Volume2, Plus, ChevronDown, UserPlus, MicOff, Headphones, Trash2, LogOut, Settings } from 'lucide-react';

function VoiceParticipant({ participant, channel, onOpenUserProfile, onUserContextMenu }) {
  const speaking = useIsSpeaking(participant.user_id);
  const { currentServer: server } = useServer();
  const color = roleColor(server, participant.user_id);
  const { watchStream } = useVoice();
  const { selectChannel } = useServer();
  const live = participant.is_sharing_screen;

  const openStream = (e) => {
    e.stopPropagation();
    selectChannel(channel);
    watchStream(participant.user_id, channel);
    showMobileContent();
  };

  const handleClick = (e) => {
    if (live) {
      openStream(e);
      return;
    }
    e.stopPropagation();
    onOpenUserProfile?.(participant.user_id);
  };

  return (
    <div
      onClick={handleClick}
      onContextMenu={(e) => onUserContextMenu?.(e, { ...participant, id: participant.user_id })}
      className="group/p flex items-center justify-between py-1 px-1.5 rounded hover:bg-hover/60 text-xs cursor-pointer anim-slide-left"
      title={live ? `Assistir ${participant.username}` : participant.username}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Avatar
          user={participant}
          alt=""
          className={`w-5 h-5 rounded-full object-cover shrink-0 ${speaking ? 'speaking-ring' : ''}`}
        />
        <span
          className={`truncate font-medium ${speaking ? 'text-fg-strong' : 'text-fg-muted'} group-hover/p:text-fg-strong`}
          style={color ? { color } : undefined}
        >
          {participant.username}
        </span>
      </div>
      <div className="flex items-center gap-1 text-fg-muted shrink-0">
        {live && (
          <button
            onClick={openStream}
            className="px-1.5 py-0.5 rounded bg-danger-hover hover:bg-danger-hover text-white text-[9px] font-bold uppercase tracking-wider"
          >
            <span className="group-hover/p:hidden">Ao vivo</span>
            <span className="hidden group-hover/p:inline">Assistir</span>
          </button>
        )}
        {participant.is_muted && <MicOff className="w-3.5 h-3.5 text-danger" />}
        {participant.is_deafened && <Headphones className="w-3.5 h-3.5 text-danger" />}
      </div>
    </div>
  );
}

function VoiceChannelItem({ channel, isSelected, canManage, onDelete, onOpenUserProfile, onUserContextMenu }) {
  const { activeVoiceChannel, joinVoice } = useVoice();
  const { selectChannel } = useServer();
  const participants = useChannelParticipants(channel.id);
  const inCall = activeVoiceChannel?.id === channel.id;

  return (
    <div>
      <div
        role="button"
        onClick={() => {
          selectChannel(channel);
          joinVoice(channel);
          showMobileContent();
        }}
        className={`group w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition cursor-pointer ${
          isSelected ? 'bg-hover text-fg-strong font-medium' : 'text-fg-muted hover:bg-hover/50 hover:text-fg'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Volume2 className={`w-5 h-5 shrink-0 ${inCall ? 'text-ok' : 'text-fg-faint'}`} />
          <span className="truncate">{channel.name}</span>
        </div>
        <div className="flex items-center gap-1">
          {canManage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(channel);
              }}
              className="hidden group-hover:block text-fg-faint hover:text-danger"
              title="Excluir canal"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {participants.length > 0 && (
            <span className="text-[11px] font-bold px-1.5 rounded-full bg-well text-fg-2">{participants.length}</span>
          )}
        </div>
      </div>
      {participants.length > 0 && (
        <div className="ml-5 pl-2 border-l border-hover space-y-0.5 my-1">
          {participants.map((p) => (
            <VoiceParticipant
              key={p.user_id}
              participant={p}
              channel={channel}
              onOpenUserProfile={onOpenUserProfile}
              onUserContextMenu={onUserContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChannelSidebar({ onOpenCreateChannel, onOpenUserProfile, onUserContextMenu, onOpenInvite }) {
  const { currentServer, currentChannel, selectChannel, unread, mentions, leaveServer, deleteServer, deleteChannel } = useServer();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  if (!currentServer) {
    return (
      <div className="w-[var(--sidebar-w)] bg-side border-r border-line flex flex-col shrink-0 select-none">
        <div className="p-4 text-center text-sm text-fg-muted">Carregando servidor...</div>
      </div>
    );
  }

  const isOwner = currentServer.owner_id === user?.id;
  const canManage = hasPermission(currentServer, user?.id, PERMS.MANAGE_CHANNELS, user);
  const canInvite = hasPermission(currentServer, user?.id, PERMS.CREATE_INVITE, user);
  const canOpenSettings =
    hasPermission(currentServer, user?.id, PERMS.MANAGE_ROLES, user) || hasPermission(currentServer, user?.id, PERMS.MANAGE_SERVER, user);
  const textChannels = currentServer.channels.filter((c) => c.type === 'text');
  const voiceChannels = currentServer.channels.filter((c) => c.type === 'voice');

  const handleDeleteChannel = async (channel) => {
    const ok = await confirmDialog({
      title: `Excluir #${channel.name}`,
      message: 'O canal e todas as mensagens dele serão apagados. Isso não pode ser desfeito.',
      confirmLabel: 'Excluir canal',
      danger: true
    });
    if (!ok) return;
    try {
      await deleteChannel(channel.id);
    } catch (err) {
      alertDialog(err.message);
    }
  };

  const handleLeaveOrDelete = async () => {
    setMenuOpen(false);
    const ok = await confirmDialog(
      isOwner
        ? {
            title: `Excluir "${currentServer.name}"`,
            message: 'O servidor será excluído para todos os membros. Isso não pode ser desfeito.',
            confirmLabel: 'Excluir servidor',
            danger: true
          }
        : {
            title: `Sair de "${currentServer.name}"`,
            message: 'Você só poderá voltar com um novo convite.',
            confirmLabel: 'Sair do servidor',
            danger: true
          }
    );
    if (!ok) return;
    try {
      if (isOwner) await deleteServer(currentServer.id);
      else await leaveServer(currentServer.id);
    } catch (err) {
      alertDialog(err.message);
    }
  };

  return (
    <aside className="w-[var(--sidebar-w)] bg-side border-r border-line flex flex-col shrink-0 select-none relative z-10">
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="w-full h-12 px-4 flex items-center justify-between font-semibold text-[15px] text-fg-strong border-b border-line hover:bg-hover/60 transition"
        >
          <span className="truncate">{currentServer.name}</span>
          <ChevronDown className={`w-5 h-5 text-fg-muted transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>
        {menuOpen && (
          <div className="absolute top-14 left-2 right-2 bg-float rounded-md p-1.5 shadow-xl border border-line z-50 text-xs anim-drop origin-top">
            {canInvite && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpenInvite();
                }}
                className="w-full flex items-center justify-between p-2 rounded text-accent-soft hover:bg-accent hover:text-on-accent font-medium"
              >
                <span>Convidar pessoas</span>
                <UserPlus className="w-4 h-4" />
              </button>
            )}
            {canOpenSettings && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setShowSettings(true);
                }}
                className="w-full flex items-center justify-between p-2 rounded text-fg-2 hover:bg-hover hover:text-fg-strong font-medium"
              >
                <span>Configurações do servidor</span>
                <Settings className="w-4 h-4" />
              </button>
            )}
            {canManage && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpenCreateChannel();
                }}
                className="w-full flex items-center justify-between p-2 rounded text-fg-2 hover:bg-hover hover:text-fg-strong font-medium"
              >
                <span>Criar canal</span>
                <Plus className="w-4 h-4" />
              </button>
            )}
            <div className="h-px bg-side my-1" />
            <button
              onClick={handleLeaveOrDelete}
              className="w-full flex items-center justify-between p-2 rounded text-danger hover:bg-danger hover:text-white font-medium"
            >
              <span>{isOwner ? 'Excluir servidor' : 'Sair do servidor'}</span>
              {isOwner ? <Trash2 className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pt-3 space-y-4 no-scrollbar pb-[calc(var(--user-area-h,64px)+16px)]" onClick={() => menuOpen && setMenuOpen(false)}>
        <div>
          <div className="flex items-center justify-between px-1 mb-1 text-[13px] font-semibold text-fg-muted">
            <span>Canais de texto</span>
            <button onClick={() => onOpenCreateChannel('text')} className={`hover:text-fg-strong ${canManage ? '' : 'hidden'}`} title="Criar canal de texto">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-0.5">
            {textChannels.map((ch) => {
              const active = currentChannel?.id === ch.id;
              const hasUnread = Boolean(unread[ch.id]);
              return (
                <div
                  key={ch.id}
                  role="button"
                  onClick={() => {
                    selectChannel(ch);
                    showMobileContent();
                  }}
                  className={`group relative w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition ${
                    active
                      ? 'bg-hover text-fg-strong font-medium'
                      : hasUnread
                        ? 'text-fg-strong font-semibold hover:bg-hover/50'
                        : 'text-fg-muted hover:bg-hover/50 hover:text-fg'
                  }`}
                >
                  {hasUnread && !active && <span className="absolute -left-2 w-1 h-2 bg-white rounded-r-full" />}
                  <Hash className="w-5 h-5 shrink-0 text-fg-faint" />
                  <span className="truncate flex-1">{ch.name}</span>
                  {!active && mentions[ch.id]?.count > 0 && (
                    <span className="anim-zoom min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center">
                      {mentions[ch.id].count > 99 ? '99+' : mentions[ch.id].count}
                    </span>
                  )}
                  {canManage && textChannels.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteChannel(ch);
                      }}
                      className="hidden group-hover:block text-fg-faint hover:text-danger"
                      title="Excluir canal"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between px-1 mb-1 text-[13px] font-semibold text-fg-muted">
            <span>Canais de voz</span>
            <button onClick={() => onOpenCreateChannel('voice')} className={`hover:text-fg-strong ${canManage ? '' : 'hidden'}`} title="Criar canal de voz">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1">
            {voiceChannels.map((ch) => (
              <VoiceChannelItem
                key={ch.id}
                channel={ch}
                isSelected={currentChannel?.id === ch.id}
                canManage={canManage}
                onDelete={handleDeleteChannel}
                onOpenUserProfile={onOpenUserProfile}
                onUserContextMenu={onUserContextMenu}
              />
            ))}
          </div>
        </div>
      </div>

      {showSettings && <ServerSettingsModal onClose={() => setShowSettings(false)} />}
    </aside>
  );
}
