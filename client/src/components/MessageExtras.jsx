import React, { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerUpLeft, ExternalLink, Image as ImageIcon, SmilePlus, X } from 'lucide-react';
import Avatar from './Avatar';
import EmojiPicker from './EmojiPicker';
import { formatMediaUrl } from '../services/api';
import { decodeMentions } from '../services/mentions';

/**
 * Quem pode aparecer numa conversa (membros do servidor ou os dois da DM):
 * resolve <@id> em nomes, alimenta o autocompletar de @ e as dicas das reações.
 */
export const ChatUsersContext = createContext({ users: [], resolveUser: () => null, me: null });
export const useChatUsers = () => useContext(ChatUsersContext);

export function ChatUsersProvider({ users, me, children }) {
  const byId = new Map(users.filter(Boolean).map((u) => [u.id, u]));
  const value = { users: [...byId.values()], resolveUser: (id) => byId.get(id) || null, me };
  return <ChatUsersContext.Provider value={value}>{children}</ChatUsersContext.Provider>;
}

/** Linha "respondendo a" acima da mensagem. Clique leva à original (se estiver carregada). */
export function ReplyReference({ message, onJump }) {
  const { resolveUser } = useChatUsers();
  const reply = message.reply_to;
  if (!message.reply_to_id) return null;

  return (
    <div className="relative flex items-center gap-1.5 pl-[56px] mb-0.5 text-[13px] text-fg-muted min-w-0 select-none">
      {/* traço curvo ligando ao avatar, como no Discord */}
      <span className="absolute left-[19px] top-[9px] w-[31px] h-[9px] border-l-2 border-t-2 border-line-strong rounded-tl-md" />
      {reply ? (
        <button onClick={() => onJump?.(reply.id)} className="flex items-center gap-1.5 min-w-0 hover:text-fg text-left">
          <Avatar user={reply.author} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
          <span className="font-semibold text-fg-2 shrink-0">@{reply.author?.username}</span>
          <span className="truncate">
            {reply.content ? (
              decodeMentions(reply.content, resolveUser)
            ) : (
              <span className="italic inline-flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5" /> Clique para ver o anexo
              </span>
            )}
          </span>
        </button>
      ) : (
        <span className="italic flex items-center gap-1">
          <CornerUpLeft className="w-3.5 h-3.5" /> A mensagem original foi apagada
        </span>
      )}
    </div>
  );
}

function displaySize(a, maxW, maxH) {
  if (!a.width || !a.height) return { width: maxW, height: maxH };
  const scale = Math.min(1, maxW / a.width, maxH / a.height);
  return { width: Math.round(a.width * scale), height: Math.round(a.height * scale) };
}

/** Imagens anexadas. O tamanho é reservado antes de carregar (sem pulos na rolagem). */
export function Attachments({ attachments }) {
  const [viewing, setViewing] = useState(null);
  if (!attachments?.length) return null;
  const single = attachments.length === 1;

  return (
    <>
      <div className={`mt-1 ${single ? '' : 'grid grid-cols-2 gap-1 max-w-[420px]'}`}>
        {attachments.map((a) => {
          const size = single ? displaySize(a, 420, 320) : null;
          return (
            <button
              key={a.url}
              onClick={() => setViewing(a)}
              className={`block rounded-lg overflow-hidden bg-well ${single ? '' : 'aspect-square'}`}
              style={size || undefined}
              title={a.name}
            >
              <img src={formatMediaUrl(a.url)} alt={a.name || ''} loading="lazy" draggable={false} className="w-full h-full object-cover" />
            </button>
          );
        })}
      </div>
      {viewing && <ImageViewer attachment={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

export function ImageViewer({ attachment, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const src = formatMediaUrl(attachment.url);

  return createPortal(
    <div className="anim-backdrop fixed inset-0 z-[120] bg-black/85 flex flex-col items-center justify-center p-8" onPointerDown={onClose}>
      <img
        src={src}
        alt={attachment.name || ''}
        onPointerDown={(e) => e.stopPropagation()}
        className="max-w-full max-h-[calc(100%-48px)] object-contain rounded-md shadow-2xl"
      />
      <div className="mt-3 flex items-center gap-4 text-sm text-white/80" onPointerDown={(e) => e.stopPropagation()}>
        <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-white hover:underline">
          <ExternalLink className="w-4 h-4" /> Abrir no navegador
        </a>
        <button onClick={onClose} className="flex items-center gap-1.5 hover:text-white">
          <X className="w-4 h-4" /> Fechar (Esc)
        </button>
      </div>
    </div>,
    document.body
  );
}

/** Pílulas de reação abaixo da mensagem; clique alterna a sua reação. */
export function ReactionBar({ message, onToggle }) {
  const { resolveUser, me } = useChatUsers();
  const [picker, setPicker] = useState(null);
  const reactions = message.reactions || [];
  if (!reactions.length) return null;

  const names = (ids) => {
    const list = ids.map((id) => (id === me?.id ? 'você' : resolveUser(id)?.username || 'alguém'));
    return list.length > 3 ? `${list.slice(0, 3).join(', ')} e mais ${list.length - 3}` : list.join(', ');
  };

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {reactions.map((r) => {
        const mine = r.users.includes(me?.id);
        return (
          <button
            key={r.emoji}
            onClick={() => onToggle(message, r.emoji)}
            title={`${names(r.users)} reagiu com ${r.emoji}`}
            className={`anim-zoom h-6 px-1.5 rounded-md flex items-center gap-1 text-sm border transition-colors ${
              mine ? 'bg-accent/15 border-accent text-fg-strong' : 'bg-well border-transparent text-fg-2 hover:border-line-strong'
            }`}
          >
            <span className="text-base leading-none">{r.emoji}</span>
            <span className="text-xs font-semibold tabular-nums">{r.count}</span>
          </button>
        );
      })}
      <button
        onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
        className="h-6 w-7 rounded-md flex items-center justify-center bg-well text-fg-muted hover:text-fg border border-transparent hover:border-line-strong"
        title="Adicionar reação"
      >
        <SmilePlus className="w-4 h-4" />
      </button>
      {picker && (
        <EmojiPicker
          anchor={picker}
          // Pelo seletor só adiciona (clicar num emoji que você já usou não deve removê-lo)
          onPick={(e) => !reactions.find((r) => r.emoji === e)?.users.includes(me?.id) && onToggle(message, e)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
