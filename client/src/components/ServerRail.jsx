import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { useServer } from '../context/ServerContext';
import { useDM } from '../context/DMContext';
import { formatMediaUrl } from '../services/api';
import ResenhaLogo from './ResenhaLogo';
import Avatar from './Avatar';

function Pill({ active, unread }) {
  return (
    <div
      className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
        active ? 'h-10' : unread ? 'h-2 group-hover:h-5' : 'h-0 group-hover:h-5'
      }`}
    />
  );
}

function Badge({ count }) {
  return (
    <span className="anim-zoom absolute -bottom-0.5 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center border-[3px] border-frame pointer-events-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function ServerRail({ onOpenCreateServer }) {
  const { servers, currentServer, selectServer, unreadServers, mentionsByServer, reorderServers } = useServer();
  const { conversations, unreadDMs, selectConversation } = useDM();

  // Ordem local durante o arraste; salva no servidor ao soltar
  const [order, setOrder] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  // Dica com o nome ao passar o mouse (portal: a lista rola e cortaria um balão absoluto)
  const [tip, setTip] = useState(null);
  const tipProps = (label) => ({
    'aria-label': label,
    onMouseEnter: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ label, top: r.top + r.height / 2, left: r.right + 12 });
    },
    onMouseLeave: () => setTip(null),
    onMouseDown: () => setTip(null) // o item pode sumir ao clicar (ex.: DM lida) sem disparar mouseleave
  });
  useEffect(() => setOrder(null), [servers]);

  const byId = new Map(servers.map((s) => [s.id, s]));
  const displayed = (order || servers.map((s) => s.id)).map((id) => byId.get(id)).filter(Boolean);

  const unreadConversations = conversations.filter((c) => unreadDMs[c.id]);

  const handleDragOver = (e, targetId) => {
    e.preventDefault();
    if (draggingId == null || draggingId === targetId) return;
    const ids = displayed.map((s) => s.id);
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(ids);
  };

  const handleDragEnd = () => {
    const ids = displayed.map((s) => s.id);
    const changed = ids.some((id, i) => id !== servers[i]?.id);
    setDraggingId(null);
    if (changed) reorderServers(ids);
    else setOrder(null);
  };

  return (
    <nav className="w-[var(--rail-w)] bg-frame flex flex-col items-center pt-2 gap-2 select-none shrink-0 z-20">
      <div className="relative group flex items-center justify-center w-full">
        <Pill active={!currentServer} />
        <button
          onClick={() => selectServer(null)}
          className={`w-12 h-12 flex items-center justify-center transition-all duration-200 p-2.5 ${
            !currentServer
              ? 'rail-active rail-home-mono rounded-[16px] bg-accent text-on-accent ring-[2.5px] ring-ink shadow-[3px_3px_0_var(--c-ink)]'
              : 'rail-home rounded-[24px] bg-rail-item hover:rounded-[16px] hover:bg-accent hover:text-on-accent'
          }`}
          {...tipProps('Início')}
        >
          {/* Parado: o logo colorido. Selecionado ou no hover: silhueta sobre a cor de destaque, como no Discord */}
          <ResenhaLogo className="w-full h-full" />
        </button>
      </div>

      {/* DMs não lidas (somem ao abrir a conversa) */}
      {unreadConversations.map((conv) => (
        <div key={conv.id} className="relative group flex items-center justify-center w-full anim-zoom">
          <Pill unread />
          <button
            onClick={() => {
              selectServer(null);
              selectConversation(conv);
            }}
            className="w-12 h-12 rounded-[24px] hover:rounded-[16px] overflow-hidden transition-all duration-200"
            {...tipProps(conv.recipient.username)}
          >
            <Avatar user={conv.recipient} className="w-full h-full object-cover bg-rail-item" />
          </button>
          <Badge count={unreadDMs[conv.id]} />
        </div>
      ))}

      <div className="flex-1 w-full overflow-y-auto overflow-x-hidden no-scrollbar pt-1 pb-[calc(var(--user-area-h,64px)+16px)]">
        {/* Trilha: os servidores "colados" numa faixa só, com o contorno do visual novo.
            O fundo fica atrás dos itens (que ocupam a largura toda), então a barrinha de
            selecionado continua na borda da janela. */}
        <div className="relative flex flex-col items-center gap-2 py-1.5">
          <div className="rail-tray absolute inset-y-0 left-1/2 -translate-x-1/2 w-[60px] rounded-[30px] bg-side border-[2.5px] border-ink pointer-events-none" />
        {displayed.map((server) => {
          const isActive = currentServer?.id === server.id;
          const hasUnread = !isActive && unreadServers.has(server.id);
          const initials = server.name
            .split(' ')
            .map((w) => w[0])
            .slice(0, 2)
            .join('')
            .toUpperCase();

          return (
            <div
              key={server.id}
              draggable
              onDragStart={(e) => {
                setDraggingId(server.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => handleDragOver(e, server.id)}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={handleDragEnd}
              className={`relative group flex items-center justify-center w-full ${draggingId === server.id ? 'opacity-40' : ''}`}
            >
              <Pill active={isActive} unread={hasUnread} />
              <button
                onClick={() => selectServer(server.id)}
                className={`relative w-12 h-12 flex items-center justify-center font-semibold text-sm transition-all duration-200 overflow-hidden ${
                  isActive
                    ? // Com foto, o fundo é da cor do contorno: o laranja vazava pelo canto arredondado
                      `rail-active rounded-[16px] ring-[2.5px] ring-ink shadow-[3px_3px_0_var(--c-ink)] ${server.icon_url ? 'bg-ink' : 'bg-accent text-on-accent'}`
                    : `rounded-[24px] bg-rail-item text-fg hover:rounded-[16px] ${server.icon_url ? '' : 'hover:bg-accent hover:text-on-accent'}`
                }`}
                {...tipProps(server.name)}
              >
                {server.icon_url ? (
                  <img src={formatMediaUrl(server.icon_url)} alt={server.name} draggable={false} className="w-full h-full object-cover" />
                ) : (
                  <span>{initials}</span>
                )}
              </button>
              {!isActive && mentionsByServer[server.id] > 0 && <Badge count={mentionsByServer[server.id]} />}
            </div>
          );
        })}

        <div className="relative group flex items-center justify-center w-full">
          <div className="absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 h-0 group-hover:h-5" />
          <button
            onClick={onOpenCreateServer}
            className="w-12 h-12 rounded-[24px] bg-rail-item text-ok flex items-center justify-center hover:rounded-[16px] hover:bg-ok hover:text-white transition-all duration-200 group"
            {...tipProps('Adicionar um servidor')}
          >
            <Plus className="w-6 h-6 transition-transform group-hover:rotate-90 duration-200" />
          </button>
        </div>
        </div>
      </div>
      {tip && draggingId == null &&
        createPortal(
          <div
            key={tip.label}
            className="anim-slide-left fixed z-[200] -translate-y-1/2 pointer-events-none bg-float text-fg-strong text-sm font-semibold px-3 py-2 rounded-lg shadow-xl border border-line max-w-xs truncate"
            style={{ top: tip.top, left: tip.left }}
          >
            {tip.label}
          </div>,
          document.body
        )}
    </nav>
  );
}
