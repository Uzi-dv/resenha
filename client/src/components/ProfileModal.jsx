import React, { useEffect, useState } from 'react';
import VolumeSlider from './VolumeSlider';
import { X, Calendar, Pencil, LogOut, Sparkles, MessageSquare, Volume2, Copy, CheckCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDM } from '../context/DMContext';
import { useServer } from '../context/ServerContext';
import { useVoice } from '../context/VoiceContext';
import { api, formatMediaUrl } from '../services/api';
import { usePresence } from '../services/voice/stores';
import Avatar from './Avatar';
import ProfileEditor from './ProfileEditor';
import { parseDate } from './MessageContent';
import { memberRoles } from '../services/permissions';

const PRESENCE = {
  online: { color: '#23a55a', label: 'Online' },
  idle: { color: '#f0b232', label: 'Ausente' },
  dnd: { color: '#f23f43', label: 'Não perturbe' },
  invisible: { color: '#80848e', label: 'Invisível' },
  offline: { color: '#80848e', label: 'Offline' }
};

export default function ProfileModal({ targetUserId, onClose }) {
  const { user: currentUser, logout } = useAuth();
  const { startOrOpenDM } = useDM();
  const { selectServer, currentServer } = useServer();
  const { activeVoiceChannel, voiceUsers, userVolumes, setUserVolume } = useVoice();
  const isMe = !targetUserId || targetUserId === currentUser?.id;

  const [fetched, setFetched] = useState(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const livePresence = usePresence(isMe ? currentUser?.id : targetUserId);

  useEffect(() => {
    if (isMe) return;
    let cancelled = false;
    api.getUserProfile(targetUserId)
      .then((u) => !cancelled && setFetched(u))
      .catch((e) => console.error('Erro ao buscar perfil:', e));
    return () => {
      cancelled = true;
    };
  }, [targetUserId, isMe]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !editing && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  if (editing) return <ProfileEditor onClose={() => setEditing(false)} />;

  const profile = isMe ? currentUser : fetched;
  if (!profile) return null;

  const presence = PRESENCE[isMe ? profile.presence || 'online' : livePresence] || PRESENCE.offline;
  const joinDate = profile.created_at
    ? parseDate(profile.created_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Recentemente';
  const inVoiceWithMe = !isMe && activeVoiceChannel && voiceUsers.some((u) => u.user_id === profile.id);
  const volume = userVolumes[profile.id] ?? 100;

  const openDM = async () => {
    try {
      await startOrOpenDM({ targetUserId: profile.id });
      selectServer(null);
      onClose();
    } catch (e) {
      console.error('Erro ao abrir DM:', e);
    }
  };

  const copyId = () => {
    navigator.clipboard.writeText(String(profile.id));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 select-none" onPointerDown={onClose}>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="sheet w-full max-w-sm max-h-[92dvh] overflow-y-auto no-scrollbar bg-panel text-fg-strong"
      >
        <div
          className="h-28 bg-accent relative bg-cover bg-center"
          style={profile.banner_url ? { backgroundImage: `url(${formatMediaUrl(profile.banner_url)})` } : undefined}
        >
          <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full bg-black/40 hover:bg-black/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-end justify-between -mt-11 mb-3">
            <div className="relative">
              <Avatar user={profile} className="w-[88px] h-[88px] rounded-full border-[6px] border-panel bg-well object-cover" />
              <span
                className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full border-[4px] border-panel"
                style={{ background: presence.color }}
                title={presence.label}
              />
            </div>
            {isMe ? (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover px-3 py-1.5 rounded-md text-xs font-semibold"
              >
                <Pencil className="w-3.5 h-3.5" /> Editar perfil
              </button>
            ) : (
              <button
                onClick={openDM}
                className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover px-3 py-1.5 rounded-md text-xs font-semibold"
              >
                <MessageSquare className="w-3.5 h-3.5" /> Mensagem
              </button>
            )}
          </div>

          <div className="bg-float rounded-xl p-4 space-y-4 border border-well">
            <div>
              <h3 className="text-xl font-bold break-words">{profile.username}</h3>
              <p className="text-xs text-fg-muted">
                {presence.label} · #{String(profile.id).padStart(4, '0')}
              </p>
              {profile.custom_status && (
                <p className="mt-2 text-xs text-fg flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="break-words">{profile.custom_status}</span>
                </p>
              )}
            </div>

            <div className="h-px bg-side" />

            <div>
              <div className="text-[13px] font-semibold text-fg-2 mb-1">Sobre mim</div>
              <p className="text-xs text-fg leading-relaxed whitespace-pre-wrap break-words">
                {profile.bio || 'Ainda não escreveu nada.'}
              </p>
            </div>

            {inVoiceWithMe && (
              <div className="bg-well p-3 rounded-lg border border-side space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-ok">
                    <Volume2 className="w-4 h-4" /> Na call: {activeVoiceChannel.name}
                  </span>
                  <span className="font-mono text-accent-soft font-bold">{volume}%</span>
                </div>
                <VolumeSlider value={volume} onChange={(v) => setUserVolume(profile.id, v)} label={`Volume de ${profile.username}`} />
              </div>
            )}

            <div>
              <div className="text-[13px] font-semibold text-fg-2 mb-1">Membro desde</div>
              <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                <Calendar className="w-3.5 h-3.5" /> {joinDate}
              </div>
            </div>
            {currentServer?.members?.some((m) => m.user_id === profile.id) && memberRoles(currentServer, profile.id).length > 0 && (
              <div>
                <div className="text-[13px] font-semibold text-fg-2 mb-1">Cargos em {currentServer.name}</div>
                <div className="flex flex-wrap gap-1">
                  {memberRoles(currentServer, profile.id).map((r) => (
                    <span key={r.id} className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-well border border-line text-fg-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color || 'var(--c-fg-faint)' }} />
                      {r.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 flex justify-between items-center px-1">
            <button onClick={copyId} className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg-strong">
              {copied ? <CheckCheck className="w-3.5 h-3.5 text-ok" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado!' : 'Copiar ID'}
            </button>
            {isMe && (
              <button
                onClick={() => {
                  onClose();
                  logout();
                }}
                className="flex items-center gap-1.5 text-xs text-danger hover:underline font-semibold"
              >
                <LogOut className="w-3.5 h-3.5" /> Sair da conta
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
