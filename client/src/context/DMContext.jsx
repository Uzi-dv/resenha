import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { gateway } from '../services/gateway';
import { useAuth } from './AuthContext';
import { playSound } from '../services/sounds';
import { replyPreviewOf, toggleReactionLocal } from '../services/reactions';

const DMContext = createContext(null);
const PAGE_SIZE = 50;
const TYPING_TTL_MS = 8000;

// Última mensagem lida por conversa (por usuário), para os avisos sobreviverem a reinícios do app
const lastReadKey = (userId) => `resenha_dm_last_read_${userId}`;
function loadLastRead(userId) {
  try {
    return JSON.parse(localStorage.getItem(lastReadKey(userId)));
  } catch {
    return null;
  }
}

export function DMProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
  const [hasMoreDM, setHasMoreDM] = useState(false);
  const [dmTyping, setDmTyping] = useState({}); // convId -> { username, expires }
  const [unreadDMs, setUnreadDMs] = useState({}); // convId -> mensagens não lidas
  const [loading, setLoading] = useState(false);

  const activeRef = useRef(null);
  const userRef = useRef(user);
  const homeVisibleRef = useRef(true);
  const lastReadRef = useRef({});
  const conversationsRef = useRef([]);
  activeRef.current = activeConversation;
  userRef.current = user;
  conversationsRef.current = conversations;

  /** A conversa só conta como lida se estiver aberta E a tela de DMs estiver visível. */
  const isViewing = (convId) => homeVisibleRef.current && activeRef.current?.id === convId;

  const markRead = useCallback((convId, lastMessageId) => {
    const uid = userRef.current?.id;
    if (uid && lastMessageId && (lastReadRef.current[convId] || 0) < lastMessageId) {
      lastReadRef.current = { ...lastReadRef.current, [convId]: lastMessageId };
      localStorage.setItem(lastReadKey(uid), JSON.stringify(lastReadRef.current));
    }
    setUnreadDMs((prev) => {
      if (!(convId in prev)) return prev;
      const next = { ...prev };
      delete next[convId];
      return next;
    });
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      setLoading(true);
      const list = await api.getDMConversations();
      setConversations(list);
      const uid = userRef.current?.id;
      const stored = uid ? loadLastRead(uid) : null;
      if (stored === null && uid) {
        // Primeira vez nesta versão: considera tudo lido (sem avisos falsos)
        lastReadRef.current = Object.fromEntries(list.filter((c) => c.last_message).map((c) => [c.id, c.last_message.id]));
        localStorage.setItem(lastReadKey(uid), JSON.stringify(lastReadRef.current));
      } else if (stored) {
        lastReadRef.current = stored;
      }
      setUnreadDMs((prev) => {
        const next = { ...prev };
        for (const c of list) {
          const last = c.last_message;
          if (last && last.sender_id !== uid && last.id > (lastReadRef.current[c.id] || 0) && !isViewing(c.id)) {
            next[c.id] = Math.max(next[c.id] || 0, 1);
          }
        }
        return next;
      });
    } catch (err) {
      console.error('Erro ao carregar conversas:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadConversations();
    else {
      setConversations([]);
      setActiveConversation(null);
      setDmMessages([]);
    }
  }, [isAuthenticated, loadConversations]);

  const selectConversation = useCallback(async (conv) => {
    setActiveConversation(conv);
    setDmMessages([]);
    setHasMoreDM(false);
    if (!conv) return;
    const latest = conversationsRef.current.find((c) => c.id === conv.id)?.last_message || conv.last_message;
    if (homeVisibleRef.current) markRead(conv.id, latest?.id);
    try {
      const page = await api.getDMMessages(conv.id, { limit: PAGE_SIZE });
      if (activeRef.current?.id !== conv.id) return;
      setDmMessages(page);
      setHasMoreDM(page.length === PAGE_SIZE);
    } catch (err) {
      console.error('Erro ao carregar mensagens da DM:', err);
    }
  }, [markRead]);

  /** Chamado pelo layout: true quando a tela inicial (DMs) está aparecendo. */
  const setHomeVisible = useCallback(
    (visible) => {
      homeVisibleRef.current = visible;
      const conv = activeRef.current;
      if (visible && conv) {
        const latest = conversationsRef.current.find((c) => c.id === conv.id)?.last_message;
        markRead(conv.id, latest?.id);
      }
    },
    [markRead]
  );

  const loadOlderDMs = useCallback(async () => {
    const conv = activeRef.current;
    const oldest = dmMessages.find((m) => !m.pending);
    if (!conv || !oldest || !hasMoreDM) return;
    const page = await api.getDMMessages(conv.id, { before: oldest.id, limit: PAGE_SIZE });
    if (activeRef.current?.id !== conv.id) return;
    setDmMessages((prev) => [...page, ...prev]);
    setHasMoreDM(page.length === PAGE_SIZE);
  }, [dmMessages, hasMoreDM]);

  const startOrOpenDM = useCallback(
    async ({ targetUserId = null, username = null }) => {
      const conv = await api.startDMConversation(targetUserId, username);
      setConversations((prev) =>
        prev.some((c) => c.id === conv.id) ? prev.map((c) => (c.id === conv.id ? conv : c)) : [conv, ...prev]
      );
      await selectConversation(conv);
      return conv;
    },
    [selectConversation]
  );

  /** Manda uma mensagem para alguém sem sair da tela atual (ex.: convite enviado pela janela "Convidar amigos"). */
  const sendDirectTo = useCallback(async (targetUserId, content) => {
    const conv = await api.startDMConversation(targetUserId);
    setConversations((prev) => (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]));
    return api.sendDMMessage(conv.id, { content });
  }, []);

  /** draft: { content, attachments?, replyTo? } */
  const sendDirectMessage = useCallback(async (draft) => {
    const conv = activeRef.current;
    const text = (draft.content || '').trim();
    const attachments = draft.attachments || [];
    if (!conv || (!text && !attachments.length)) return;
    const me = userRef.current;
    const tempId = `tmp-${Date.now()}`;
    setDmMessages((prev) => [
      ...prev,
      {
        id: tempId,
        conversation_id: conv.id,
        sender_id: me.id,
        sender: me,
        content: text,
        attachments,
        reply_to_id: draft.replyTo?.id ?? null,
        reply_to: replyPreviewOf(draft.replyTo),
        reactions: [],
        created_at: new Date().toISOString(),
        pending: true
      }
    ]);
    try {
      const saved = await api.sendDMMessage(conv.id, { content: text, attachments, reply_to_id: draft.replyTo?.id ?? null });
      setDmMessages((prev) => {
        const rest = prev.filter((m) => m.id !== tempId);
        return rest.some((m) => m.id === saved.id) ? rest : [...rest, saved];
      });
    } catch (err) {
      setDmMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: err.message } : m)));
    }
  }, []);

  const toggleDMReaction = useCallback(async (message, emoji) => {
    const conv = activeRef.current;
    const me = userRef.current;
    if (!conv || typeof message.id !== 'number' || !me) return;
    const add = !message.reactions?.some((r) => r.emoji === emoji && r.users.includes(me.id));
    const setReactions = (reactions) =>
      setDmMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, reactions } : m)));
    setReactions(toggleReactionLocal(message.reactions, emoji, me.id, add));
    try {
      const res = add
        ? await api.addDMReaction(conv.id, message.id, emoji)
        : await api.removeDMReaction(conv.id, message.id, emoji);
      setReactions(res.reactions);
    } catch (err) {
      setReactions(message.reactions || []);
      throw err;
    }
  }, []);

  const sendTyping = useCallback(() => {
    const conv = activeRef.current;
    if (conv) gateway.send('dm_typing', { conversation_id: conv.id });
  }, []);

  useEffect(() => {
    const offs = [
      gateway.on('READY', () => {
        loadConversations();
        const conv = activeRef.current;
        if (conv) {
          api.getDMMessages(conv.id, { limit: PAGE_SIZE })
            .then((page) => {
              if (activeRef.current?.id === conv.id) setDmMessages((prev) => [...page, ...prev.filter((m) => m.pending)]);
            })
            .catch(() => {});
        }
      }),

      gateway.on('DM_MESSAGE_REACTIONS', ({ conversation_id, message_id, reactions }) => {
        if (activeRef.current?.id === conversation_id) {
          setDmMessages((prev) => prev.map((m) => (m.id === message_id ? { ...m, reactions } : m)));
        }
      }),

      gateway.on('DM_MESSAGE_CREATE', ({ conversation_id, message }) => {
        const mine = message.sender_id === userRef.current?.id;
        const viewing = isViewing(conversation_id);
        if (!mine && !(viewing && document.hasFocus()) && userRef.current?.presence !== 'dnd') {
          playSound('message');
        }
        if (mine || viewing) markRead(conversation_id, message.id);
        else setUnreadDMs((prev) => ({ ...prev, [conversation_id]: (prev[conversation_id] || 0) + 1 }));
        if (activeRef.current?.id === conversation_id) {
          setDmMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            const tempIndex = prev.findIndex(
              (m) => m.pending && m.sender_id === message.sender_id && m.content === message.content
            );
            if (tempIndex !== -1) {
              const next = [...prev];
              next[tempIndex] = message;
              return next;
            }
            return [...prev, message];
          });
        }
        setDmTyping((prev) => {
          if (!prev[conversation_id]) return prev;
          const next = { ...prev };
          delete next[conversation_id];
          return next;
        });
        setConversations((prev) => {
          const target = prev.find((c) => c.id === conversation_id);
          if (!target) {
            loadConversations();
            return prev;
          }
          const updated = { ...target, last_message: message, updated_at: message.created_at };
          return [updated, ...prev.filter((c) => c.id !== conversation_id)];
        });
      }),

      gateway.on('DM_TYPING_START', (d) => {
        setDmTyping((prev) => ({ ...prev, [d.conversation_id]: { username: d.username, expires: Date.now() + TYPING_TTL_MS } }));
      }),

      gateway.on('PRESENCE_UPDATE', (d) => {
        setConversations((prev) =>
          prev.some((c) => c.recipient.id === d.user_id)
            ? prev.map((c) => (c.recipient.id === d.user_id ? { ...c, recipient: { ...c.recipient, presence: d.presence } } : c))
            : prev
        );
      }),

      // Conta excluída pelo admin: a conversa com ela deixa de existir
      gateway.on('USER_DELETE', (d) => {
        setConversations((prev) => prev.filter((c) => c.recipient.id !== d.user_id));
        if (activeRef.current?.recipient.id === d.user_id) {
          setActiveConversation(null);
          setDmMessages([]);
        }
      }),

      gateway.on('USER_UPDATE', (u) => {
        setConversations((prev) =>
          prev.map((c) => (c.recipient.id === u.id ? { ...c, recipient: { ...c.recipient, ...u } } : c))
        );
        setActiveConversation((prev) =>
          prev && prev.recipient.id === u.id ? { ...prev, recipient: { ...prev.recipient, ...u } } : prev
        );
        setDmMessages((prev) =>
          prev.some((m) => m.sender_id === u.id)
            ? prev.map((m) => (m.sender_id === u.id ? { ...m, sender: { ...m.sender, ...u } } : m))
            : prev
        );
      })
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversations, markRead]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setDmTyping((prev) => {
        const alive = Object.fromEntries(Object.entries(prev).filter(([, t]) => t.expires > now));
        return Object.keys(alive).length === Object.keys(prev).length ? prev : alive;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const dmTypingUsers = Object.fromEntries(Object.entries(dmTyping).map(([cid, t]) => [cid, [t.username]]));

  return (
    <DMContext.Provider
      value={{
        conversations,
        activeConversation,
        dmMessages,
        hasMoreDM,
        loadOlderDMs,
        dmTypingUsers,
        unreadDMs,
        setHomeVisible,
        loading,
        selectConversation,
        startOrOpenDM,
        sendDirectTo,
        sendDirectMessage,
        toggleDMReaction,
        sendTyping,
        refreshConversations: loadConversations
      }}
    >
      {children}
    </DMContext.Provider>
  );
}

export function useDM() {
  const context = useContext(DMContext);
  if (!context) throw new Error('useDM deve ser usado dentro de um DMProvider');
  return context;
}
