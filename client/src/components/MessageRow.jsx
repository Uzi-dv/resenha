import React, { useState } from 'react';
import { CornerUpLeft, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import Avatar from './Avatar';
import EmojiPicker from './EmojiPicker';
import { Attachments, ReactionBar, ReplyReference, useChatUsers } from './MessageExtras';
import { QUICK_REACTIONS } from '../services/emojiData';
import { formatTimestamp } from './MessageContent';

function ToolbarButton({ onClick, title, danger, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 flex items-center justify-center transition-colors ${
        danger ? 'text-danger hover:bg-danger/15' : 'text-fg-2 hover:text-fg-strong hover:bg-hover'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Uma mensagem (canal ou DM): resposta, cabeçalho, corpo (`children`), anexos, reações e a
 * barra de ações que aparece ao passar o mouse.
 */
export default function MessageRow({
  msg,
  author,
  authorId,
  authorColor,
  grouped,
  fresh,
  mentioned,
  flashing,
  editing,
  onOpenProfile,
  onUserContextMenu,
  onReply,
  onToggleReaction,
  onJumpToMessage,
  onEdit,
  onDelete,
  children
}) {
  const [picker, setPicker] = useState(null);
  const { me } = useChatUsers();
  const ts = formatTimestamp(msg.created_at);
  const sent = typeof msg.id === 'number';
  const showToolbar = sent && !editing;
  const openMenu = (e) => onUserContextMenu?.(e, author || { id: authorId });

  return (
    <div
      data-message-id={msg.id}
      className={`group relative -mx-4 px-4 py-0.5 ${grouped ? '' : 'mt-3.5'} ${msg.pending ? 'opacity-60' : ''} ${
        fresh ? 'anim-rise' : ''
      } ${
        mentioned
          ? 'bg-warn/[0.08] hover:bg-warn/[0.12] before:absolute before:left-0 before:inset-y-0 before:w-0.5 before:bg-warn'
          : flashing
            ? 'bg-accent/15'
            : 'hover:bg-hover/60'
      } ${picker ? 'bg-hover/60' : ''} transition-colors duration-500`}
    >
      <ReplyReference message={msg} onJump={onJumpToMessage} />

      <div className="flex gap-4">
        {grouped ? (
          <div className="w-10 shrink-0 text-[10px] text-fg-muted opacity-0 group-hover:opacity-100 text-right pt-1 select-none">
            {ts.time}
          </div>
        ) : (
          <Avatar
            user={author}
            alt=""
            onClick={() => onOpenProfile?.(authorId)}
            onContextMenu={openMenu}
            className="w-10 h-10 rounded-full object-cover shrink-0 cursor-pointer hover:opacity-80 bg-well mt-0.5"
          />
        )}

        <div className="flex-1 min-w-0">
          {!grouped && (
            <div className="flex items-baseline gap-2">
              <span
                onClick={() => onOpenProfile?.(authorId)}
                onContextMenu={openMenu}
                className={`font-semibold text-sm hover:underline cursor-pointer ${authorColor ? '' : 'text-fg-strong'}`}
                style={authorColor ? { color: authorColor } : undefined}
              >
                {author?.username}
              </span>
              <span className="text-[11px] text-fg-muted">{ts.full}</span>
            </div>
          )}
          {children}
          {!editing && (
            <>
              <Attachments attachments={msg.attachments} />
              {sent && <ReactionBar message={msg} onToggle={onToggleReaction} />}
            </>
          )}
        </div>
      </div>

      {showToolbar && (
        <div
          className={`absolute -top-4 right-4 ${picker ? 'flex' : 'hidden group-hover:flex'} items-center bg-chat border border-line rounded-lg shadow-lg overflow-hidden z-10`}
        >
          {QUICK_REACTIONS.slice(0, 3).map((e) => (
            <button
              key={e}
              onClick={() => onToggleReaction(msg, e)}
              className="w-8 h-8 flex items-center justify-center text-lg hover:bg-hover transition-transform hover:scale-110"
              title={`Reagir com ${e}`}
            >
              {e}
            </button>
          ))}
          <ToolbarButton onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())} title="Adicionar reação">
            <SmilePlus className="w-[18px] h-[18px]" />
          </ToolbarButton>
          <div className="w-px h-5 bg-line-strong mx-0.5" />
          <ToolbarButton onClick={() => onReply(msg)} title="Responder">
            <CornerUpLeft className="w-[18px] h-[18px]" />
          </ToolbarButton>
          {onEdit && (
            <ToolbarButton onClick={() => onEdit(msg)} title="Editar">
              <Pencil className="w-4 h-4" />
            </ToolbarButton>
          )}
          {onDelete && (
            <ToolbarButton onClick={() => onDelete(msg)} title="Apagar" danger>
              <Trash2 className="w-4 h-4" />
            </ToolbarButton>
          )}
        </div>
      )}

      {picker && (
        <EmojiPicker
          anchor={picker}
          // Pelo seletor só adiciona: escolher um emoji que você já usou não remove a reação
          onPick={(e) => !msg.reactions?.find((r) => r.emoji === e)?.users.includes(me?.id) && onToggleReaction(msg, e)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
