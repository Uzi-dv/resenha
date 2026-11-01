import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useServer } from '../context/ServerContext';
import { useAuth } from '../context/AuthContext';
import { gateway } from '../services/gateway';
import { Hash, Users, RotateCw, Loader2, BarChart3, ImagePlus } from 'lucide-react';
import MessageContent, { parseDate } from './MessageContent';
import MessageRow from './MessageRow';
import Composer from './Composer';
import { ChatUsersProvider } from './MessageExtras';
import PollCard from './PollCard';
import CreatePollModal from './CreatePollModal';
import TypingIndicator from './TypingIndicator';
import { useNewMessageIds } from '../services/useNewMessages';
import { useFileDrop } from '../services/useFileDrop';
import { useJumpToMessage } from '../services/useJumpToMessage';
import { decodeMentions, encodeMentions, mentionsUser } from '../services/mentions';
import { confirmDialog, alertDialog } from '../services/dialog';
import { PERMS, hasPermission, roleColor } from '../services/permissions';
import MobileBackButton from './MobileBackButton';

const GROUP_WINDOW_MS = 7 * 60 * 1000;

export default function ChatArea({ onToggleMemberList, showMemberList, onOpenUserProfile, onUserContextMenu }) {
  const {
    currentServer,
    currentChannel,
    messages,
    sendMessage,
    retryMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    typingUsers,
    hasMoreMessages,
    loadingMessages,
    loadOlderMessages,
    createPoll,
    votePoll,
    closePoll
  } = useServer();
  const { user: currentUser } = useAuth();
  const [editing, setEditing] = useState(null); // { id, text }
  const [replyTo, setReplyTo] = useState(null);
  const [showPollModal, setShowPollModal] = useState(false);
  const scrollRef = useRef(null);
  const composerRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(null);
  const lastTypingRef = useRef(0);
  const freshIds = useNewMessageIds(messages, currentChannel?.id, !loadingMessages);
  const { dragging, dropHandlers } = useFileDrop((files) => composerRef.current?.addFiles(files));
  const { flashId, jumpTo } = useJumpToMessage(scrollRef);

  const members = (currentServer?.members || []).map((m) => m.user);
  const resolveUser = (id) => members.find((u) => u.id === id);

  const isManager = hasPermission(currentServer, currentUser?.id, PERMS.MANAGE_MESSAGES, currentUser);

  // Mantém a posição ao carregar mensagens antigas; desce só se o usuário já estava no fim
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevScrollHeightRef.current != null) {
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = null;
    } else if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    stickToBottomRef.current = true;
    composerRef.current?.focus();
  }, [currentChannel?.id]);

  useEffect(() => {
    const handleMention = (e) => {
      const username = e.detail?.username;
      if (username) composerRef.current?.insertMention(username);
    };
    window.addEventListener('insert-chat-mention', handleMention);
    return () => window.removeEventListener('insert-chat-mention', handleMention);
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && hasMoreMessages && !loadingMessages) {
      prevScrollHeightRef.current = el.scrollHeight;
      loadOlderMessages();
    }
  };

  const handleTyping = () => {
    const now = Date.now();
    if (currentChannel && now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      gateway.send('typing', { channel_id: currentChannel.id });
    }
  };

  const handleSend = (draft) => {
    stickToBottomRef.current = true;
    sendMessage(draft);
    lastTypingRef.current = 0;
  };

  const startEdit = (msg) => setEditing({ id: msg.id, text: decodeMentions(msg.content, resolveUser) });

  const editLast = () => {
    const mine = [...messages].reverse().find((m) => m.user_id === currentUser?.id && typeof m.id === 'number' && !m.poll);
    if (!mine) return false;
    startEdit(mine);
    return true;
  };

  const submitEdit = async () => {
    if (!editing) return;
    const text = encodeMentions(editing.text.trim(), members);
    const original = messages.find((m) => m.id === editing.id);
    setEditing(null);
    if (!text || text === original?.content) return;
    try {
      await editMessage(editing.id, text);
    } catch (err) {
      alertDialog(err.message);
    }
  };

  const handleDelete = async (msg) => {
    if (
      !(await confirmDialog({ title: 'Apagar mensagem', message: 'Tem certeza de que quer apagar esta mensagem?', confirmLabel: 'Apagar', danger: true }))
    ) {
      return;
    }
    try {
      await deleteMessage(msg.id);
    } catch (err) {
      alertDialog(err.message);
    }
  };

  const react = (msg, emoji) => toggleReaction(msg, emoji).catch((err) => alertDialog(err.message));

  if (!currentChannel) {
    return (
      <div className="flex-1 bg-chat flex flex-col items-center justify-center text-fg-muted">
        <Hash className="w-16 h-16 text-active mb-2" />
        <p>Selecione um canal para começar a conversar</p>
      </div>
    );
  }

  const channelTyping = (typingUsers[currentChannel.id] || []).filter((name) => name !== currentUser?.username);

  return (
    <ChatUsersProvider users={members} me={currentUser}>
      <div className="flex-1 bg-chat flex flex-col h-full overflow-hidden relative" {...dropHandlers}>
        <div className="h-12 border-b border-line px-4 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <MobileBackButton />
            <Hash className="w-5 h-5 text-fg-muted shrink-0" />
            <h2 className="font-semibold text-fg-strong text-base truncate">{currentChannel.name}</h2>
          </div>
          <button
            onClick={onToggleMemberList}
            className={`p-1.5 rounded transition ${showMemberList ? 'text-fg-strong bg-hover' : 'text-fg-2 hover:text-fg'}`}
            title="Lista de membros"
          >
            <Users className="w-5 h-5" />
          </button>
        </div>

        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 select-text">
          {!hasMoreMessages && !loadingMessages && (
            <div className="pt-8 pb-4 select-none">
              <div className="w-16 h-16 rounded-full bg-active flex items-center justify-center mb-2">
                <Hash className="w-10 h-10 text-fg-strong" />
              </div>
              <h3 className="text-2xl font-bold text-fg-strong mb-1">Boas-vindas a #{currentChannel.name}!</h3>
              <p className="text-sm text-fg-muted">Este é o começo do canal.</p>
              <div className="w-full h-px bg-active mt-4" />
            </div>
          )}
          {loadingMessages && (
            <div className="flex justify-center py-3 text-fg-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          {messages.map((msg, index) => {
            const prev = messages[index - 1];
            const grouped =
              prev &&
              !msg.reply_to_id &&
              prev.user_id === msg.user_id &&
              parseDate(msg.created_at) - parseDate(prev.created_at) < GROUP_WINDOW_MS;
            const mine = msg.user_id === currentUser?.id;
            const isEditing = editing?.id === msg.id;
            const sent = typeof msg.id === 'number';

            return (
              <MessageRow
                key={msg.id}
                msg={msg}
                author={msg.author}
                authorId={msg.user_id}
                authorColor={roleColor(currentServer, msg.user_id)}
                grouped={grouped}
                fresh={freshIds.has(msg.id)}
                mentioned={mentionsUser(msg, currentUser?.id)}
                flashing={flashId === msg.id}
                editing={isEditing}
                onOpenProfile={onOpenUserProfile}
                onUserContextMenu={onUserContextMenu}
                onReply={setReplyTo}
                onToggleReaction={react}
                onJumpToMessage={jumpTo}
                onEdit={mine && sent && !msg.poll && msg.content ? startEdit : undefined}
                onDelete={mine || isManager ? handleDelete : undefined}
              >
                {isEditing ? (
                  <div className="mt-1">
                    <textarea
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          submitEdit();
                        } else if (e.key === 'Escape') setEditing(null);
                      }}
                      rows={Math.min(6, editing.text.split('\n').length)}
                      className="w-full bg-hover rounded-lg px-3 py-2 text-sm text-fg-strong outline-none resize-none"
                    />
                    <div className="text-[11px] text-fg-muted">
                      Esc para <button className="text-link hover:underline" onClick={() => setEditing(null)}>cancelar</button> •
                      Enter para <button className="text-link hover:underline" onClick={submitEdit}>salvar</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {msg.poll ? (
                      <PollCard
                        poll={msg.poll}
                        currentUserId={currentUser?.id}
                        canClose={mine || isManager}
                        onVote={votePoll}
                        onClose={(pollId) => closePoll(pollId).catch((err) => alertDialog(err.message))}
                      />
                    ) : (
                      <MessageContent content={msg.content} />
                    )}
                    {msg.edited_at && <span className="text-[10px] text-fg-muted select-none">(editado)</span>}
                    {msg.failed && (
                      <div className="text-[11px] text-danger flex items-center gap-2 mt-0.5">
                        Falha ao enviar: {msg.failed}
                        <button onClick={() => retryMessage(msg.id)} className="flex items-center gap-1 hover:underline">
                          <RotateCw className="w-3 h-3" /> Tentar de novo
                        </button>
                        <button onClick={() => deleteMessage(msg.id)} className="hover:underline">
                          Descartar
                        </button>
                      </div>
                    )}
                  </>
                )}
              </MessageRow>
            );
          })}
        </div>

        <TypingIndicator names={channelTyping} />

        <Composer
          ref={composerRef}
          placeholder={`Conversar em #${currentChannel.name}`}
          onSend={handleSend}
          onTyping={handleTyping}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onEditLast={editLast}
          allowEveryone
          extraActions={
            <button onClick={() => setShowPollModal(true)} className="text-fg-2 hover:text-fg-strong shrink-0" title="Criar enquete">
              <BarChart3 className="w-5 h-5" />
            </button>
          }
        />

        {dragging && (
          <div className="anim-fade absolute inset-0 z-40 bg-black/60 flex items-center justify-center pointer-events-none">
            <div className="anim-pop bg-accent text-on-accent rounded-2xl px-8 py-6 flex flex-col items-center gap-2 shadow-2xl">
              <ImagePlus className="w-10 h-10" />
              <div className="text-lg font-bold">Solte para enviar em #{currentChannel.name}</div>
              <div className="text-sm opacity-80">Imagens até 8 MB (maiores são comprimidas)</div>
            </div>
          </div>
        )}

        {showPollModal && <CreatePollModal onClose={() => setShowPollModal(false)} onCreate={createPoll} />}
      </div>
    </ChatUsersProvider>
  );
}
