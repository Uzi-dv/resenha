import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { useDM } from '../context/DMContext';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../services/voice/stores';
import { ImagePlus } from 'lucide-react';
import MessageContent, { parseDate } from './MessageContent';
import MessageRow from './MessageRow';
import Composer from './Composer';
import { ChatUsersProvider } from './MessageExtras';
import TypingIndicator from './TypingIndicator';
import { useNewMessageIds } from '../services/useNewMessages';
import { useFileDrop } from '../services/useFileDrop';
import { useJumpToMessage } from '../services/useJumpToMessage';
import { mentionsUser } from '../services/mentions';
import { alertDialog } from '../services/dialog';
import MobileBackButton from './MobileBackButton';

const GROUP_WINDOW_MS = 7 * 60 * 1000;
const PRESENCE_COLORS = { online: 'bg-ok', idle: 'bg-warn', dnd: 'bg-danger', offline: 'bg-fg-faint' };

export default function DMChatArea({ onOpenUserProfile, onUserContextMenu }) {
  const { activeConversation, dmMessages, sendDirectMessage, toggleDMReaction, sendTyping, dmTypingUsers, hasMoreDM, loadOlderDMs } = useDM();
  const { user: currentUser } = useAuth();
  const [replyTo, setReplyTo] = useState(null);
  const scrollRef = useRef(null);
  const composerRef = useRef(null);
  const freshIds = useNewMessageIds(dmMessages, activeConversation?.id);
  const stickRef = useRef(true);
  const prevHeightRef = useRef(null);
  const lastTypingRef = useRef(0);
  const friend = activeConversation?.recipient;
  const presence = usePresence(friend?.id);
  const { dragging, dropHandlers } = useFileDrop((files) => composerRef.current?.addFiles(files));
  const { flashId, jumpTo } = useJumpToMessage(scrollRef);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevHeightRef.current != null) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
      prevHeightRef.current = null;
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [dmMessages]);

  useEffect(() => {
    stickRef.current = true;
    composerRef.current?.focus();
  }, [activeConversation?.id]);

  if (!activeConversation) return null;

  const handleScroll = () => {
    const el = scrollRef.current;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && hasMoreDM) {
      prevHeightRef.current = el.scrollHeight;
      loadOlderDMs().catch(() => (prevHeightRef.current = null));
    }
  };

  const handleTyping = () => {
    const now = Date.now();
    if (now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      sendTyping();
    }
  };

  const handleSend = (draft) => {
    stickRef.current = true;
    sendDirectMessage(draft);
    lastTypingRef.current = 0;
  };

  const react = (msg, emoji) => toggleDMReaction(msg, emoji).catch((err) => alertDialog(err.message));
  const typingList = (dmTypingUsers[activeConversation.id] || []).filter((u) => u !== currentUser?.username);

  return (
    <ChatUsersProvider users={[currentUser, friend]} me={currentUser}>
      <div className="flex-1 bg-chat flex flex-col h-full overflow-hidden relative" {...dropHandlers}>
        <div className="h-12 border-b border-line px-4 flex items-center shrink-0 select-none">
          <MobileBackButton />
          <div
            className="flex items-center gap-3 cursor-pointer min-w-0"
            onClick={() => onOpenUserProfile?.(friend?.id)}
            onContextMenu={(e) => onUserContextMenu?.(e, friend)}
          >
            <div className="relative shrink-0">
              <Avatar user={friend} alt="" className="w-7 h-7 rounded-full object-cover bg-well" />
              <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-chat ${PRESENCE_COLORS[presence]}`} />
            </div>
            <span className="font-semibold text-fg-strong text-base hover:underline">{friend?.username}</span>
            {friend?.custom_status && <span className="text-xs text-fg-muted truncate">— {friend.custom_status}</span>}
          </div>
        </div>

        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 select-text">
          {!hasMoreDM && (
            <div className="pt-8 pb-4 select-none">
              <Avatar user={friend} alt="" className="w-20 h-20 rounded-full object-cover mb-3 bg-well" />
              <h3 className="text-2xl font-bold text-fg-strong mb-1">{friend?.username}</h3>
              <p className="text-xs text-fg-muted">
                Este é o começo do seu histórico de mensagens diretas com <strong>{friend?.username}</strong>.
              </p>
              <div className="w-full h-px bg-active mt-4" />
            </div>
          )}

          {dmMessages.map((msg, index) => {
            const prev = dmMessages[index - 1];
            const grouped =
              prev &&
              !msg.reply_to_id &&
              prev.sender_id === msg.sender_id &&
              parseDate(msg.created_at) - parseDate(prev.created_at) < GROUP_WINDOW_MS;
            return (
              <MessageRow
                key={msg.id}
                msg={msg}
                author={msg.sender}
                authorId={msg.sender_id}
                grouped={grouped}
                fresh={freshIds.has(msg.id)}
                mentioned={mentionsUser(msg, currentUser?.id)}
                flashing={flashId === msg.id}
                onOpenProfile={onOpenUserProfile}
                onUserContextMenu={onUserContextMenu}
                onReply={setReplyTo}
                onToggleReaction={react}
                onJumpToMessage={jumpTo}
              >
                <MessageContent content={msg.content} />
                {msg.failed && <div className="text-[11px] text-danger">Falha ao enviar: {msg.failed}</div>}
              </MessageRow>
            );
          })}
        </div>

        <TypingIndicator names={typingList} />

        <Composer
          ref={composerRef}
          placeholder={`Conversar com @${friend?.username}`}
          onSend={handleSend}
          onTyping={handleTyping}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />

        {dragging && (
          <div className="anim-fade absolute inset-0 z-40 bg-black/60 flex items-center justify-center pointer-events-none">
            <div className="anim-pop bg-accent text-on-accent rounded-2xl px-8 py-6 flex flex-col items-center gap-2 shadow-2xl">
              <ImagePlus className="w-10 h-10" />
              <div className="text-lg font-bold">Solte para enviar para {friend?.username}</div>
              <div className="text-sm opacity-80">Imagens até 8 MB (maiores são comprimidas)</div>
            </div>
          </div>
        )}
      </div>
    </ChatUsersProvider>
  );
}
