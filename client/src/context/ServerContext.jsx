import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { gateway } from '../services/gateway';
import { presenceStore, voiceStatesStore } from '../services/voice/stores';
import { useAuth } from './AuthContext';
import { playSound } from '../services/sounds';
import { mentionsUser } from '../services/mentions';
import { replyPreviewOf, toggleReactionLocal } from '../services/reactions';

const ServerContext = createContext(null);

const PAGE_SIZE = 50;
const TYPING_TTL_MS = 8000;

function mergePresences(entries) {
  presenceStore.setState((prev) => {
    const next = { ...prev };
    for (const [uid, presence] of entries) {
      if (!presence || presence === 'offline') delete next[uid];
      else next[uid] = presence;
    }
    return next;
  });
}

function seedServerRealtime(detail) {
  mergePresences(detail.members.map((m) => [m.user.id, m.user.presence]));
  voiceStatesStore.setState((prev) => {
    const next = {};
    // Mantém estados de outros servidores; substitui os deste
    for (const [uid, st] of Object.entries(prev)) if (st.server_id !== detail.id) next[uid] = st;
    for (const st of detail.voice_states || []) next[st.user_id] = st;
    return next;
  });
}

export function ServerProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const [servers, setServers] = useState([]);
  const [currentServer, setCurrentServer] = useState(null);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [typing, setTyping] = useState({}); // channelId -> { userId: { username, expires } }
  const [unread, setUnread] = useState({}); // channelId -> serverId
  const [mentions, setMentions] = useState({}); // channelId -> { serverId, count }
  const [loading, setLoading] = useState(false);

  const serverRef = useRef(null);
  const channelRef = useRef(null);
  const userRef = useRef(user);
  const requestRef = useRef(0);
  serverRef.current = currentServer;
  channelRef.current = currentChannel;
  userRef.current = user;

  const loadServers = useCallback(async () => {
    try {
      setServers(await api.getServers());
    } catch (err) {
      console.error('Erro ao carregar servidores:', err);
    }
  }, []);

  // ------------------------------------------------------------- mensagens
  const loadLatestMessages = useCallback(async (channel) => {
    const req = ++requestRef.current;
    setLoadingMessages(true);
    try {
      const page = await api.getMessages(channel.id, { limit: PAGE_SIZE });
      if (req !== requestRef.current) return;
      setMessages((prev) => {
        // Preserva mensagens pendentes (enviadas offline/no meio da recarga)
        const pending = prev.filter((m) => m.pending && m.channel_id === channel.id);
        return [...page, ...pending];
      });
      setHasMoreMessages(page.length === PAGE_SIZE);
    } catch (err) {
      console.error('Erro ao buscar mensagens:', err);
    } finally {
      if (req === requestRef.current) setLoadingMessages(false);
    }
  }, []);

  const loadOlderMessages = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel || loadingMessages || !hasMoreMessages) return;
    const oldest = messages.find((m) => !m.pending);
    if (!oldest) return;
    setLoadingMessages(true);
    try {
      const page = await api.getMessages(channel.id, { before: oldest.id, limit: PAGE_SIZE });
      if (channelRef.current?.id !== channel.id) return;
      setMessages((prev) => [...page, ...prev]);
      setHasMoreMessages(page.length === PAGE_SIZE);
    } catch (err) {
      console.error('Erro ao buscar mensagens antigas:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, [messages, loadingMessages, hasMoreMessages]);

  const selectChannel = useCallback(
    (channel) => {
      if (!channel) return;
      setCurrentChannel(channel);
      localStorage.setItem(`resenha_last_channel_${channel.server_id}`, String(channel.id));
      if (channel.type === 'text') {
        setMessages([]);
        setHasMoreMessages(false);
        setUnread((prev) => {
          if (!(channel.id in prev)) return prev;
          const next = { ...prev };
          delete next[channel.id];
          return next;
        });
        setMentions((prev) => {
          if (!(channel.id in prev)) return prev;
          const next = { ...prev };
          delete next[channel.id];
          return next;
        });
        loadLatestMessages(channel);
      }
    },
    [loadLatestMessages]
  );

  const pickDefaultChannel = (detail) => {
    const lastId = Number(localStorage.getItem(`resenha_last_channel_${detail.id}`));
    const last = detail.channels.find((c) => c.id === lastId && c.type === 'text');
    return last || detail.channels.find((c) => c.type === 'text') || null;
  };

  const applyServerDetail = useCallback(
    (detail, { keepChannel = false } = {}) => {
      seedServerRealtime(detail);
      setCurrentServer(detail);
      const current = channelRef.current;
      const stillExists = keepChannel && current && detail.channels.some((c) => c.id === current.id);
      if (stillExists) {
        if (current.type === 'text') loadLatestMessages(current);
      } else {
        const channel = pickDefaultChannel(detail);
        if (channel) selectChannel(channel);
        else setCurrentChannel(null);
      }
    },
    [selectChannel, loadLatestMessages]
  );

  const selectServer = useCallback(
    async (serverId) => {
      if (!serverId) {
        setCurrentServer(null);
        setCurrentChannel(null);
        setMessages([]);
        localStorage.removeItem('resenha_last_server');
        return;
      }
      try {
        setLoading(true);
        const detail = await api.getServerDetail(serverId);
        localStorage.setItem('resenha_last_server', String(serverId));
        applyServerDetail(detail);
      } catch (err) {
        console.error('Erro ao abrir servidor:', err);
      } finally {
        setLoading(false);
      }
    },
    [applyServerDetail]
  );

  // Carga inicial
  useEffect(() => {
    if (!isAuthenticated) {
      setServers([]);
      setCurrentServer(null);
      setCurrentChannel(null);
      setMessages([]);
      return;
    }
    loadServers().then(() => {
      const last = Number(localStorage.getItem('resenha_last_server'));
      if (last) selectServer(last);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  /** draft: { content, attachments?, replyTo? } (menções já convertidas para <@id>) */
  const sendMessage = useCallback(async (draft) => {
    const channel = channelRef.current;
    const text = (draft.content || '').trim();
    const attachments = draft.attachments || [];
    if (!channel || channel.type !== 'text' || (!text && !attachments.length)) return;
    const me = userRef.current;
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic = {
      id: tempId,
      channel_id: channel.id,
      user_id: me.id,
      content: text,
      attachments,
      reply_to_id: draft.replyTo?.id ?? null,
      reply_to: replyPreviewOf(draft.replyTo),
      reactions: [],
      created_at: new Date().toISOString(),
      author: me,
      pending: true,
      draft
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const saved = await api.sendMessage(channel.id, {
        content: text,
        attachments,
        reply_to_id: draft.replyTo?.id ?? null
      });
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        return withoutTemp.some((m) => m.id === saved.id) ? withoutTemp : [...withoutTemp, saved];
      });
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: err.message } : m)));
    }
  }, []);

  const retryMessage = useCallback(
    (tempId) => {
      const msg = messages.find((m) => m.id === tempId);
      if (!msg) return;
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      sendMessage(msg.draft || { content: msg.content });
    },
    [messages, sendMessage]
  );

  const editMessage = useCallback(async (messageId, content) => {
    const channel = channelRef.current;
    if (!channel) return;
    const saved = await api.editMessage(channel.id, messageId, content);
    setMessages((prev) => prev.map((m) => (m.id === saved.id ? saved : m)));
  }, []);

  const upsertMessage = useCallback((saved) => {
    setMessages((prev) => {
      if (channelRef.current?.id !== saved.channel_id) return prev;
      return prev.some((m) => m.id === saved.id) ? prev.map((m) => (m.id === saved.id ? saved : m)) : [...prev, saved];
    });
  }, []);

  const createPoll = useCallback(
    async (question, options, multiple) => {
      const channel = channelRef.current;
      if (!channel) return;
      upsertMessage(await api.createPoll(channel.id, question, options, multiple));
    },
    [upsertMessage]
  );

  const votePoll = useCallback(async (pollId, optionIds) => upsertMessage(await api.votePoll(pollId, optionIds)), [upsertMessage]);
  const closePoll = useCallback(async (pollId) => upsertMessage(await api.closePoll(pollId)), [upsertMessage]);

  const toggleReaction = useCallback(async (message, emoji) => {
    const channel = channelRef.current;
    const me = userRef.current;
    if (!channel || typeof message.id !== 'number' || !me) return;
    const add = !message.reactions?.some((r) => r.emoji === emoji && r.users.includes(me.id));
    const setReactions = (reactions) =>
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, reactions } : m)));
    setReactions(toggleReactionLocal(message.reactions, emoji, me.id, add));
    try {
      const res = add
        ? await api.addReaction(channel.id, message.id, emoji)
        : await api.removeReaction(channel.id, message.id, emoji);
      setReactions(res.reactions);
    } catch (err) {
      setReactions(message.reactions || []);
      throw err;
    }
  }, []);

  const deleteMessage = useCallback(async (messageId) => {
    const channel = channelRef.current;
    if (!channel) return;
    if (typeof messageId === 'string') {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      return;
    }
    await api.deleteMessage(channel.id, messageId);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  // ------------------------------------------------------------- servidores
  const createServer = async (name, iconUrl) => {
    const detail = await api.createServer(name, iconUrl);
    setServers((prev) => [...prev, detail]);
    localStorage.setItem('resenha_last_server', String(detail.id));
    applyServerDetail(detail);
    return detail;
  };

  const joinServer = async (inviteCode) => {
    const detail = await api.joinServer(inviteCode);
    setServers((prev) => (prev.some((s) => s.id === detail.id) ? prev : [...prev, detail]));
    localStorage.setItem('resenha_last_server', String(detail.id));
    applyServerDetail(detail);
    return detail;
  };

  /** Entra por um convite em link (ou já é membro: só abre o servidor). */
  const acceptInvite = async (code) => {
    let detail;
    try {
      detail = await api.acceptInvite(code);
    } catch (err) {
      // Servidor ainda sem convites em link (anterior à 2.11): a rota antiga aceita o código antigo
      if (err.status !== 404 && err.status !== 405) throw err;
      detail = await api.joinServer(code).catch(() => {
        throw err;
      });
    }
    setServers((prev) => (prev.some((s) => s.id === detail.id) ? prev : [...prev, detail]));
    localStorage.setItem('resenha_last_server', String(detail.id));
    applyServerDetail(detail);
    return detail;
  };

  const leaveServer = async (serverId) => {
    await api.leaveServer(serverId);
    setServers((prev) => prev.filter((s) => s.id !== serverId));
    if (serverRef.current?.id === serverId) selectServer(null);
  };

  const deleteServer = async (serverId) => {
    await api.deleteServer(serverId);
    setServers((prev) => prev.filter((s) => s.id !== serverId));
    if (serverRef.current?.id === serverId) selectServer(null);
  };

  const createChannel = async (name, type) => {
    const server = serverRef.current;
    if (!server) return null;
    const channel = await api.createChannel(server.id, name, type);
    setCurrentServer((prev) =>
      prev && prev.id === server.id && !prev.channels.some((c) => c.id === channel.id)
        ? { ...prev, channels: [...prev.channels, channel] }
        : prev
    );
    if (type === 'text') selectChannel(channel);
    return channel;
  };

  /** Salva a nova ordem da barra lateral (otimista; desfaz se o servidor recusar). */
  const reorderServers = useCallback(async (orderedIds) => {
    let previous;
    setServers((prev) => {
      previous = prev;
      const byId = new Map(prev.map((s) => [s.id, s]));
      return orderedIds.map((id) => byId.get(id)).filter(Boolean);
    });
    try {
      await api.reorderServers(orderedIds);
    } catch (err) {
      console.error('Erro ao salvar ordem dos servidores:', err);
      if (previous) setServers(previous);
    }
  }, []);

  const deleteChannel = async (channelId) => {
    const server = serverRef.current;
    if (server) await api.deleteChannel(server.id, channelId);
  };

  // ------------------------------------------------------------- tempo real
  useEffect(() => {
    const updateMembers = (serverId, fn) =>
      setCurrentServer((prev) => (prev && prev.id === serverId ? { ...prev, members: fn(prev.members || []) } : prev));

    const offs = [
      gateway.on('READY', (d) => {
        presenceStore.setState(
          Object.fromEntries(Object.entries(d.presences || {}).map(([uid, p]) => [Number(uid), p]))
        );
        // Ressincroniza o que pode ter mudado enquanto estávamos desconectados
        loadServers();
        const server = serverRef.current;
        if (server) {
          api.getServerDetail(server.id)
            .then((detail) => applyServerDetail(detail, { keepChannel: true }))
            .catch(() => {});
        }
      }),

      gateway.on('PRESENCE_UPDATE', (d) => mergePresences([[d.user_id, d.presence]])),

      gateway.on('USER_UPDATE', (u) => {
        updateMembers(serverRef.current?.id, (members) =>
          members.map((m) => (m.user.id === u.id ? { ...m, user: { ...m.user, ...u } } : m))
        );
        // Foto/nome novos aparecem também nas mensagens que já estão na tela
        setMessages((prev) =>
          prev.some((m) => m.user_id === u.id)
            ? prev.map((m) => (m.user_id === u.id ? { ...m, author: { ...m.author, ...u } } : m))
            : prev
        );
      }),

      gateway.on('MESSAGE_CREATE', (msg) => {
        const channel = channelRef.current;
        if (channel && msg.channel_id === channel.id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            // Mensagem própria chegou pelo socket antes da resposta HTTP: substitui a otimista
            const tempIndex = prev.findIndex((m) => m.pending && m.user_id === msg.user_id && m.content === msg.content);
            if (tempIndex !== -1) {
              const next = [...prev];
              next[tempIndex] = msg;
              return next;
            }
            return [...prev, msg];
          });
        } else if (msg.user_id !== userRef.current?.id) {
          setUnread((prev) => (prev[msg.channel_id] ? prev : { ...prev, [msg.channel_id]: msg.server_id }));
        }
        const mine = msg.user_id === userRef.current?.id;
        const mentioned = mentionsUser(msg, userRef.current?.id);
        if (mentioned && !(channel && msg.channel_id === channel.id)) {
          setMentions((prev) => ({
            ...prev,
            [msg.channel_id]: { serverId: msg.server_id, count: (prev[msg.channel_id]?.count || 0) + 1 }
          }));
        }
        const viewing = channel && msg.channel_id === channel.id && document.hasFocus();
        if (!mine && !viewing && userRef.current?.presence !== 'dnd') playSound(mentioned ? 'mention' : 'message');
        setTyping((prev) => {
          if (!prev[msg.channel_id]?.[msg.user_id]) return prev;
          const forChannel = { ...prev[msg.channel_id] };
          delete forChannel[msg.user_id];
          return { ...prev, [msg.channel_id]: forChannel };
        });
      }),

      gateway.on('MESSAGE_UPDATE', (msg) => {
        if (channelRef.current?.id === msg.channel_id) {
          setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
        }
      }),

      gateway.on('MESSAGE_REACTIONS', (d) => {
        if (channelRef.current?.id === d.channel_id) {
          setMessages((prev) => prev.map((m) => (m.id === d.message_id ? { ...m, reactions: d.reactions } : m)));
        }
      }),

      gateway.on('MESSAGE_DELETE', (d) => {
        if (channelRef.current?.id === d.channel_id) {
          setMessages((prev) => prev.filter((m) => m.id !== d.message_id));
        }
      }),

      gateway.on('TYPING_START', (d) => {
        setTyping((prev) => ({
          ...prev,
          [d.channel_id]: { ...prev[d.channel_id], [d.user_id]: { username: d.username, expires: Date.now() + TYPING_TTL_MS } }
        }));
      }),

      gateway.on('MEMBER_ADD', (member) => {
        mergePresences([[member.user.id, member.user.presence]]);
        updateMembers(member.server_id, (members) =>
          members.some((m) => m.user_id === member.user_id) ? members : [...members, member]
        );
      }),

      gateway.on('MEMBER_REMOVE', (d) => {
        updateMembers(d.server_id, (members) => members.filter((m) => m.user_id !== d.user_id));
      }),

      // Conta excluída pelo admin: some das mensagens; o servidor aberto é recarregado (pode ter mudado de dono)
      gateway.on('USER_DELETE', (d) => {
        setMessages((prev) => (prev.some((m) => m.user_id === d.user_id) ? prev.filter((m) => m.user_id !== d.user_id) : prev));
        loadServers();
        const server = serverRef.current;
        if (server?.members?.some((m) => m.user_id === d.user_id)) {
          api.getServerDetail(server.id)
            .then((detail) => applyServerDetail(detail, { keepChannel: true }))
            .catch(() => {});
        }
      }),

      // Cargos: lista do servidor e cargos de cada membro (a lista de membros se reagrupa sozinha)
      gateway.on('ROLES_UPDATE', (d) => {
        setCurrentServer((prev) => {
          if (!prev || prev.id !== d.server_id) return prev;
          const valid = new Set(d.roles.map((r) => r.id));
          return {
            ...prev,
            roles: d.roles,
            members: (prev.members || []).map((m) => ({ ...m, role_ids: (m.role_ids || []).filter((id) => valid.has(id)) }))
          };
        });
      }),

      gateway.on('MEMBER_ROLES_UPDATE', (d) => {
        updateMembers(d.server_id, (members) => members.map((m) => (m.user_id === d.user_id ? { ...m, role_ids: d.role_ids } : m)));
      }),

      gateway.on('CHANNEL_CREATE', (channel) => {
        setCurrentServer((prev) =>
          prev && prev.id === channel.server_id && !prev.channels.some((c) => c.id === channel.id)
            ? { ...prev, channels: [...prev.channels, channel] }
            : prev
        );
      }),

      gateway.on('CHANNEL_UPDATE', (channel) => {
        setCurrentServer((prev) =>
          prev && prev.id === channel.server_id
            ? { ...prev, channels: prev.channels.map((c) => (c.id === channel.id ? channel : c)) }
            : prev
        );
        if (channelRef.current?.id === channel.id) setCurrentChannel(channel);
      }),

      gateway.on('CHANNEL_DELETE', (d) => {
        const server = serverRef.current;
        if (!server || server.id !== d.server_id) return;
        const channels = server.channels.filter((c) => c.id !== d.channel_id);
        setCurrentServer({ ...server, channels });
        if (channelRef.current?.id === d.channel_id) {
          const fallback = channels.find((c) => c.type === 'text');
          if (fallback) selectChannel(fallback);
          else setCurrentChannel(null);
        }
      }),

      gateway.on('SERVER_UPDATE', (srv) => {
        setServers((prev) => prev.map((s) => (s.id === srv.id ? { ...s, ...srv } : s)));
        setCurrentServer((prev) => (prev && prev.id === srv.id ? { ...prev, ...srv } : prev));
      }),

      gateway.on('SERVER_DELETE', (d) => {
        setServers((prev) => prev.filter((s) => s.id !== d.server_id));
        if (serverRef.current?.id === d.server_id) selectServer(null);
      })
    ];
    return () => offs.forEach((off) => off());
  }, [applyServerDetail, loadServers, selectChannel, selectServer]);

  // Expira indicadores de digitação
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        let changed = false;
        const next = {};
        for (const [cid, users] of Object.entries(prev)) {
          const alive = Object.fromEntries(Object.entries(users).filter(([, t]) => t.expires > now));
          if (Object.keys(alive).length !== Object.keys(users).length) changed = true;
          if (Object.keys(alive).length) next[cid] = alive;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const typingUsers = Object.fromEntries(
    Object.entries(typing).map(([cid, users]) => [cid, Object.values(users).map((u) => u.username)])
  );
  const unreadServers = new Set(Object.values(unread));
  const mentionsByServer = {};
  for (const { serverId, count } of Object.values(mentions)) {
    mentionsByServer[serverId] = (mentionsByServer[serverId] || 0) + count;
  }

  return (
    <ServerContext.Provider
      value={{
        servers,
        currentServer,
        currentChannel,
        messages,
        hasMoreMessages,
        loadingMessages,
        loadOlderMessages,
        typingUsers,
        unread,
        unreadServers,
        mentions,
        mentionsByServer,
        toggleReaction,
        loading,
        selectServer,
        selectChannel,
        sendMessage,
        retryMessage,
        editMessage,
        deleteMessage,
        createPoll,
        votePoll,
        closePoll,
        createServer,
        joinServer,
        acceptInvite,
        leaveServer,
        deleteServer,
        createChannel,
        deleteChannel,
        reorderServers,
        refreshServers: loadServers
      }}
    >
      {children}
    </ServerContext.Provider>
  );
}

export function useServer() {
  const context = useContext(ServerContext);
  if (!context) throw new Error('useServer deve ser usado dentro de um ServerProvider');
  return context;
}
