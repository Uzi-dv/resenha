import React, { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { useAuth } from '../context/AuthContext';
import { useVoice } from '../context/VoiceContext';
import { useIsSpeaking } from '../services/voice/stores';
import { Mic, MicOff, Headphones, HeadphoneOff, Settings, Radio, AudioLines, Palette, UserRound, MonitorCog, ShieldAlert } from 'lucide-react';
import AdminPanel from './AdminPanel';
import { IS_WEB } from '../services/api';
import { Download, RefreshCw } from 'lucide-react';

// Página de download do servidor (sempre baixa o instalador mais novo)
const DOWNLOAD_PAGE_URL = `${window.location.origin}/download`;
import AudioSettingsModal from './AudioSettingsModal';
import AppearanceModal from './AppearanceModal';
import DesktopSettingsModal from './DesktopSettingsModal';

const PRESENCE = {
  online: { dot: 'bg-ok', label: 'Disponível' },
  idle: { dot: 'bg-warn', label: 'Ausente' },
  dnd: { dot: 'bg-danger', label: 'Não perturbe' },
  invisible: { dot: 'bg-fg-faint', label: 'Invisível' },
  offline: { dot: 'bg-fg-faint', label: 'Offline' }
};

function PanelButton({ onClick, title, danger, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`press w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
        danger ? 'text-danger hover:bg-danger/15' : 'text-fg-2 hover:bg-hover hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

function SettingsMenu({ onClose, onProfile, onAudio, onAppearance, onDesktop, onAdmin }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => !ref.current?.contains(e.target) && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const item = (Icon, label, action, hint) => (
    <button
      onClick={() => {
        onClose();
        action();
      }}
      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm text-fg-2 hover:bg-accent hover:text-on-accent transition"
    >
      <Icon className="w-4 h-4" />
      <span className="flex-1 text-left">{label}</span>
      {hint && <span className="text-[10px] opacity-70">{hint}</span>}
    </button>
  );

  return (
    <div ref={ref} className="sheet-sm absolute bottom-full right-0 mb-2 w-56 bg-float p-1.5 z-50 anim-rise origin-bottom-right">
      {item(UserRound, 'Meu perfil', onProfile)}
      {item(AudioLines, 'Voz e áudio', onAudio)}
      {item(Palette, 'Aparência', onAppearance)}
      {window.electronAPI?.getDesktopSettings && item(MonitorCog, 'Windows e bandeja', onDesktop)}
      {onAdmin && item(ShieldAlert, 'Painel de admin', onAdmin)}
      {IS_WEB && item(Download, 'Baixar o app para Windows', () => window.open(DOWNLOAD_PAGE_URL, '_blank', 'noopener'))}
      {window.electronAPI?.checkForUpdates && item(RefreshCw, 'Procurar atualizações', () => window.electronAPI.checkForUpdates(), 'Ctrl+R')}
      {/* Na versão web o servidor é o próprio site: não há o que configurar */}
      {!IS_WEB && (
        <>
          <div className="h-px bg-line-strong my-1 mx-1" />
          {item(Radio, 'Servidor e túnel', () => window.dispatchEvent(new CustomEvent('open-server-config')), 'F3')}
        </>
      )}
    </div>
  );
}

export default function UserControlBar({ onOpenProfile }) {
  const { user } = useAuth();
  const { isMuted, isDeafened, toggleMute, toggleDeafen } = useVoice();
  const [modal, setModal] = useState(null); // 'audio' | 'appearance'
  const [menuOpen, setMenuOpen] = useState(false);
  const isSpeaking = useIsSpeaking(user?.id);

  if (!user) return null;
  const presence = PRESENCE[user.presence] || PRESENCE.online;

  return (
    <div className="h-14 px-2 flex items-center gap-1 select-none">
      <button
        onClick={onOpenProfile}
        className="flex-1 min-w-0 flex items-center gap-2 p-1 rounded-md hover:bg-hover transition text-left"
        title="Ver perfil"
      >
        <div className="relative shrink-0">
          <Avatar
            user={user}
            alt={user.username}
            className={`w-8 h-8 rounded-full bg-well object-cover ${isSpeaking ? 'speaking-ring' : ''}`}
          />
          <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-[3px] border-panel ${presence.dot}`} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-fg-strong truncate leading-tight">{user.username}</span>
          <span className="text-xs text-fg-muted truncate leading-tight">{user.custom_status || presence.label}</span>
        </div>
      </button>

      <div className="flex items-center shrink-0 relative">
        <PanelButton onClick={toggleMute} danger={isMuted} title={isMuted ? 'Ativar microfone' : 'Silenciar microfone'}>
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </PanelButton>
        <PanelButton onClick={toggleDeafen} danger={isDeafened} title={isDeafened ? 'Desativar ensurdecer' : 'Ensurdecer'}>
          {isDeafened ? <HeadphoneOff className="w-5 h-5" /> : <Headphones className="w-5 h-5" />}
        </PanelButton>
        <PanelButton onClick={() => setMenuOpen((v) => !v)} title="Configurações">
          <Settings className="w-5 h-5" />
        </PanelButton>
        {menuOpen && (
          <SettingsMenu
            onClose={() => setMenuOpen(false)}
            onProfile={onOpenProfile}
            onAudio={() => setModal('audio')}
            onAppearance={() => setModal('appearance')}
            onDesktop={() => setModal('desktop')}
            onAdmin={user.is_superadmin ? () => setModal('admin') : null}
          />
        )}
      </div>

      {modal === 'audio' && <AudioSettingsModal onClose={() => setModal(null)} />}
      {modal === 'appearance' && <AppearanceModal onClose={() => setModal(null)} />}
      {modal === 'desktop' && <DesktopSettingsModal onClose={() => setModal(null)} />}
      {modal === 'admin' && <AdminPanel onClose={() => setModal(null)} />}
    </div>
  );
}
