import { useMemo } from 'react';
import { createStore, useStore } from '../store';

/** user_id -> presença efetiva ('online' | 'idle' | 'dnd'); ausente = offline */
export const presenceStore = createStore({});

/** user_id -> estado de voz (vindo do servidor) */
export const voiceStatesStore = createStore({});

/** RTT da mídia fica fora do contexto para não re-renderizar a árvore a cada 2 s */
export const callStatsStore = createStore({ rtt: null });
export const useCallStats = () => useStore(callStatsStore);

/** user_id -> true quando está falando (detectado localmente, sem tráfego de rede) */
export const speakingStore = createStore({});

export function usePresence(userId) {
  return useStore(presenceStore, (s) => s[userId] || 'offline');
}

export function useIsSpeaking(userId) {
  return useStore(speakingStore, (s) => Boolean(s[userId]));
}

export function useVoiceStates() {
  return useStore(voiceStatesStore);
}

export function useChannelParticipants(channelId) {
  const byUser = useStore(voiceStatesStore);
  return useMemo(
    () =>
      Object.values(byUser)
        .filter((v) => v.channel_id === channelId)
        .sort((a, b) => a.joined_at - b.joined_at),
    [byUser, channelId]
  );
}

export function setSpeaking(userId, speaking) {
  speakingStore.setState((s) => {
    if (Boolean(s[userId]) === speaking) return s;
    const next = { ...s };
    if (speaking) next[userId] = true;
    else delete next[userId];
    return next;
  });
}
