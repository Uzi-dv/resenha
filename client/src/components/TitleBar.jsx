import React from 'react';
import { Users, Radio } from 'lucide-react';
import { useServer } from '../context/ServerContext';
import { useDM } from '../context/DMContext';
import { formatMediaUrl } from '../services/api';
import Avatar from './Avatar';

/**
 * Barra de título da janela (32 px). Arrasta a janela; à direita ficam os botões nativos
 * do Windows (titleBarOverlay), por isso o padding reservado.
 */
export default function TitleBar({ minimal = false }) {
  const { currentServer } = useServer();
  const { activeConversation } = useDM();
  const isElectron = Boolean(window.electronAPI?.isElectron);
  if (!isElectron && import.meta.env.PROD) return null;

  let icon;
  let title;
  if (minimal) {
    title = 'Resenha';
  } else if (currentServer) {
    title = currentServer.name;
    icon = currentServer.icon_url ? (
      <img src={formatMediaUrl(currentServer.icon_url)} alt="" className="w-4 h-4 rounded object-cover" />
    ) : (
      <span className="w-4 h-4 rounded bg-accent text-on-accent text-[9px] font-bold flex items-center justify-center">
        {currentServer.name.slice(0, 1).toUpperCase()}
      </span>
    );
  } else if (activeConversation) {
    title = activeConversation.recipient?.username;
    icon = <Avatar user={activeConversation.recipient} alt="" className="w-4 h-4 rounded-full object-cover" />;
  } else {
    title = 'Amigos';
    icon = <Users className="w-4 h-4 text-fg-2" />;
  }

  return (
    <header
      className={`app-drag h-8 shrink-0 bg-frame flex items-center select-none relative ${isElectron ? 'pr-[140px]' : 'pr-2'}`}
    >
      <div className="absolute inset-x-0 flex items-center justify-center pointer-events-none">
        <div className="flex items-center gap-2 max-w-[40%] text-[13px] font-semibold text-fg-strong">
          {icon}
          <span className="truncate">{title}</span>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-1 relative">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-server-config'))}
          className="app-no-drag w-7 h-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-hover transition"
          title="Servidor e túnel (F3)"
        >
          <Radio className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
