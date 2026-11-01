import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { gateway } from '../services/gateway';
import { createCallEngine } from '../services/voice/engine';
import { audioEngine, Microphone } from '../services/voice/AudioEngine';
import { GameAudioCapture } from '../services/voice/GameAudio';
import { SCREEN_AUDIO_BITRATE } from '../services/voice/sdp';
import {
  CODEC_CHAIN,
  GPU_ERROR_MESSAGE,
  chooseVideoCodec,
  hardwareCodecs,
  markCodecFailed,
  mimeOf,
  onHardwareCodecsChange,
  probeHardwareCodecs
} from '../services/voice/codecs';
import { alertDialog } from '../services/dialog';
import { callStatsStore, voiceStatesStore, useVoiceStates } from '../services/voice/stores';
import { useAuth } from './AuthContext';
import { playSound } from '../services/sounds';

const VoiceContext = createContext(null);

// Transmissões limitadas a 720p30: qualidade boa para jogos com ~2,5 Mbps por espectador,
// o que também economiza a franquia gratuita do Cloudflare.
const MAX_STREAM_FPS = 30;
const SOURCE_CLOSED_MESSAGE = 'A transmissão foi encerrada porque a janela compartilhada foi fechada.';
const RESOLUTIONS = {
  480: { width: 854, height: 480, bitrate: 1_200_000 },
  720: { width: 1280, height: 720, bitrate: 2_500_000 }
};

function screenBitrate(resolution, fps) {
  const base = (RESOLUTIONS[resolution] || RESOLUTIONS[720]).bitrate;
  return Math.round(base * (fps >= 30 ? 1 : 0.6));
}

// Codec de vídeo (sempre em hardware): AV1 → H265 → H264, acordado entre publicador e espectadores
const VIDEO_KINDS = ['screen', 'camera'];
const CODEC_UPGRADE_DELAY_MS = 10000; // subir de codec só depois de estável (evita trocar a cada entra-e-sai)
const HEALTH_GRACE_MS = 5000; // tempo para o codificador começar depois de (re)publicar
const SOFTWARE_STRIKES = 2; // leituras seguidas (a cada 2 s) em software antes de descartar o codec
const MISMATCH_TIMEOUT_MS = 10000; // espectador esperando o publicador trocar para um codec que ele decodifica

// Cliente antigo não informa: assume H264, que praticamente toda GPU decodifica
const decodeOf = (st) => st.decode ?? ['H264'];

/** O publicador codifica algum codec que eu decodifico em hardware? (publicador antigo: não dá para saber) */
function sharesHardwareCodec(st) {
  const { decode } = hardwareCodecs();
  return !st.encode || st.encode.some((c) => decode.includes(c));
}

/** O vídeo, no codec em que está sendo enviado agora, dá para decodificar em hardware? */
function canDecodeCurrent(st, kind) {
  const current = st.video_codecs?.[kind];
  return !current || hardwareCodecs().decode.includes(current);
}

function sameCodecs(a = {}, b = {}) {
  return VIDEO_KINDS.every((k) => (a[k] || null) === (b[k] || null));
}

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

const DEFAULT_SETTINGS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  aiNoiseSuppression: true,
  voiceLeveling: true, // nivelador de voz (volume parecido com o do Discord)
  inputThreshold: null
};

// v2: supressão por IA passou a vir ligada para todos (inclusive quem salvou configurações antes)
// v3: de novo, na volta ao WebRTC do Chromium (quem desligou por causa do DeepFilterNet3 volta ao RNNoise)
const SETTINGS_VERSION = 3;

function loadVoiceSettings() {
  const saved = loadJSON('resenha_voice_settings', {});
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  if ((saved.settingsVersion || 1) < SETTINGS_VERSION) settings.aiNoiseSuppression = true;
  settings.settingsVersion = SETTINGS_VERSION;
  return settings;
}

function applyVoiceState(state) {
  voiceStatesStore.setState((prev) => {
    const next = { ...prev };
    if (state.channel_id == null) delete next[state.user_id];
    else next[state.user_id] = { ...prev[state.user_id], ...state };
    return next;
  });
}

export function VoiceProvider({ children }) {
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;

  const [activeVoiceChannel, setActiveVoiceChannel] = useState(null);
  const [connection, setConnection] = useState('disconnected');
  const [voiceError, setVoiceError] = useState(null);
  const [isMuted, setIsMuted] = useState(() => loadJSON('resenha_muted', false));
  const [isDeafened, setIsDeafened] = useState(() => loadJSON('resenha_deafened', false));
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [shareInfo, setShareInfo] = useState(null); // { source, captureAudio, resolution, fps } da transmissão atual
  const [streamSendVolume, setStreamSendVolumeState] = useState(() => loadJSON('resenha_stream_send_volume', 100));
  const [screenStreams, setScreenStreams] = useState({});
  const [cameraStreams, setCameraStreams] = useState({}); // userId -> MediaStream (inclusive a minha prévia)
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [videoInputDevices, setVideoInputDevices] = useState([]);
  const [selectedVideoInput, setSelectedVideoInput] = useState(() => localStorage.getItem('resenha_video_input') || '');
  const [watching, setWatching] = useState(() => new Set());
  const [focusedStreamUserId, setFocusedStreamUserId] = useState(null);
  const [userVolumes, setUserVolumes] = useState(() => loadJSON('resenha_user_volumes', {}));
  const [streamVolumes, setStreamVolumes] = useState(() => loadJSON('resenha_stream_volumes', {}));
  const [voiceSettings, setVoiceSettings] = useState(loadVoiceSettings);
  const [audioInputDevices, setAudioInputDevices] = useState([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState(() => localStorage.getItem('resenha_audio_input') || '');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState(() => localStorage.getItem('resenha_audio_output') || '');

  const voiceStates = useVoiceStates();

  const engineRef = useRef(null);
  const micRef = useRef(null);
  const gameAudioRef = useRef(null);
  const screenTrackRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const refreshDevicesRef = useRef(null);
  const videoInputRef = useRef(selectedVideoInput);
  const activeRef = useRef(null);
  const joinSoundPendingRef = useRef(false);
  const watchingRef = useRef(watching);
  const flagsRef = useRef({ muted: isMuted, deafened: isDeafened, mutedBeforeDeafen: isMuted });
  const settingsRef = useRef(voiceSettings);
  const inputRef = useRef(selectedAudioInput);
  settingsRef.current = voiceSettings;
  inputRef.current = selectedAudioInput;
  const [codecCaps, setCodecCaps] = useState(hardwareCodecs);
  const videoCodecsRef = useRef({}); // kind -> codec que estou publicando (screen/camera)
  const codecTimingRef = useRef({ publishedAt: {}, upgrades: {}, strikes: new Map(), mismatch: new Map() });

  useEffect(() => {
    probeHardwareCodecs();
  }, []);

  // ------------------------------------------------------- codec de vídeo
  const pickVideoCodec = useCallback((kind) => {
    const channelId = activeRef.current?.id;
    const me = userRef.current?.id;
    const viewers = Object.values(voiceStatesStore.getState()).filter(
      (st) => st.channel_id === channelId && st.user_id !== me && (kind === 'camera' || st.watching?.includes(me))
    );
    return chooseVideoCodec(hardwareCodecs().encode, viewers.map(decodeOf));
  }, []);

  const sendVideoCodecs = useCallback(() => {
    gateway.send('voice_update', { video_codecs: { ...videoCodecsRef.current } });
  }, []);

  const recordVideoCodec = useCallback((kind, codec) => {
    videoCodecsRef.current = { ...videoCodecsRef.current, [kind]: codec };
    codecTimingRef.current.publishedAt[kind] = Date.now();
  }, []);

  const forgetVideoCodec = useCallback((kind) => {
    const timing = codecTimingRef.current;
    const rest = { ...videoCodecsRef.current };
    delete rest[kind];
    videoCodecsRef.current = rest;
    clearTimeout(timing.upgrades[kind]?.timer);
    delete timing.upgrades[kind];
    delete timing.publishedAt[kind];
    timing.strikes.delete(`out:${kind}`);
  }, []);

  const applyVideoCodec = useCallback(
    async (kind, codec) => {
      recordVideoCodec(kind, codec);
      await engineRef.current.setVideoCodec(kind, mimeOf(codec));
      if (videoCodecsRef.current[kind] === codec) sendVideoCodecs();
    },
    [recordVideoCodec, sendVideoCodecs]
  );

  // ------------------------------------------------------------- engine
  if (!engineRef.current) engineRef.current = createCallEngine();

  useEffect(() => {
    const engine = engineRef.current;
    const offs = [
      engine.on('state', (s) => setConnection(s === 'idle' ? 'disconnected' : s)),
      engine.on('stats', (stats) => callStatsStore.setState(stats)),
      engine.on('error', (err) => {
        if (err?.status === 503 || err?.status === 502) setVoiceError(err.message);
      }),
      engine.on('track', ({ key, userId, kind, track }) => {
        if (kind === 'screen') {
          setScreenStreams((prev) => ({ ...prev, [userId]: new MediaStream([track]) }));
        } else if (kind === 'camera') {
          setCameraStreams((prev) => ({ ...prev, [userId]: new MediaStream([track]) }));
        } else {
          audioEngine.addRemote(key, userId, kind, track);
        }
      }),
      engine.on('track-ended', ({ key, userId, kind }) => {
        if (kind === 'screen' || kind === 'camera') {
          const setter = kind === 'screen' ? setScreenStreams : setCameraStreams;
          setter((prev) => {
            if (!prev[userId] || userId === userRef.current?.id) return prev;
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        } else {
          audioEngine.removeRemote(key);
        }
      }),
      engine.on('state', (s) => {
        if (s === 'connected') setVoiceError(null);
      })
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Recalcula o que assinar no SFU: voz de todos no canal + telas que estou assistindo
  const syncSubscriptions = useCallback(() => {
    const channel = activeRef.current;
    const me = userRef.current?.id;
    if (!channel) return;
    const desired = [];
    for (const st of Object.values(voiceStatesStore.getState())) {
      if (st.channel_id !== channel.id || st.user_id === me || !st.tracks) continue;
      if (st.tracks.mic) desired.push({ userId: st.user_id, kind: 'mic', trackName: st.tracks.mic });
      // Câmeras aparecem sozinhas para quem está na call (como no Discord), se a GPU decodifica o codec
      if (st.tracks.camera && sharesHardwareCodec(st) && canDecodeCurrent(st, 'camera')) {
        desired.push({ userId: st.user_id, kind: 'camera', trackName: st.tracks.camera });
      }
      if (watchingRef.current.has(st.user_id)) {
        // Codec que não decodifico em hardware: espera o publicador trocar
        if (st.tracks.screen && canDecodeCurrent(st, 'screen')) {
          desired.push({ userId: st.user_id, kind: 'screen', trackName: st.tracks.screen });
        }
        if (st.tracks.screen_audio) {
          desired.push({ userId: st.user_id, kind: 'screen_audio', trackName: st.tracks.screen_audio });
        }
      }
    }
    engineRef.current.setDesired(desired);
  }, []);

  useEffect(() => voiceStatesStore.subscribe(syncSubscriptions), [syncSubscriptions]);
  useEffect(() => {
    watchingRef.current = watching;
    syncSubscriptions();
    // O publicador escolhe o codec pelos espectadores
    if (activeRef.current) gateway.send('voice_update', { watching: [...watching] });
  }, [watching, syncSubscriptions]);

  // Para de "assistir" quem encerrou a transmissão, saiu da call ou só envia codecs que minha GPU não decodifica
  useEffect(() => {
    const gone = [...watchingRef.current].filter((uid) => {
      const st = voiceStates[uid];
      return !st || st.channel_id !== activeRef.current?.id || !st.is_sharing_screen || !sharesHardwareCodec(st);
    });
    if (!gone.length) return;
    if (gone.some((uid) => voiceStates[uid]?.is_sharing_screen && !sharesHardwareCodec(voiceStates[uid]))) {
      setVoiceError(GPU_ERROR_MESSAGE);
    }
    setWatching((prev) => {
      const next = new Set(prev);
      gone.forEach((uid) => next.delete(uid));
      return next.size === prev.size ? prev : next;
    });
  }, [voiceStates, codecCaps]);

  const sendVoiceFlags = useCallback(() => {
    const { muted, deafened } = flagsRef.current;
    gateway.send('voice_update', { muted, deafened });
  }, []);

  // ------------------------------------------------------- limpeza local
  const stopScreenShareLocal = useCallback(() => {
    forgetVideoCodec('screen');
    if (screenTrackRef.current) screenTrackRef.current.onended = null;
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    gameAudioRef.current?.stop();
    gameAudioRef.current = null;
    window.electronAPI?.watchShareSource?.(null);
    setIsSharingScreen(false);
    setShareInfo(null);
    const me = userRef.current?.id;
    setScreenStreams((prev) => {
      if (!prev[me]) return prev;
      const next = { ...prev };
      delete next[me];
      return next;
    });
  }, [forgetVideoCodec]);

  const stopCameraLocal = useCallback(() => {
    forgetVideoCodec('camera');
    if (cameraTrackRef.current) cameraTrackRef.current.onended = null;
    cameraTrackRef.current?.stop();
    cameraTrackRef.current = null;
    setIsCameraOn(false);
  }, [forgetVideoCodec]);

  const cleanupLocal = useCallback(() => {
    engineRef.current.stop();
    stopScreenShareLocal();
    stopCameraLocal();
    setCameraStreams({});
    audioEngine.close();
    micRef.current?.stop();
    micRef.current = null;
    const me = userRef.current?.id;
    if (me != null && activeRef.current) applyVoiceState({ user_id: me, channel_id: null });
    activeRef.current = null;
    setActiveVoiceChannel(null);
    setScreenStreams({});
    setWatching(new Set());
    setFocusedStreamUserId(null);
    setConnection('disconnected');
    codecTimingRef.current.strikes.clear();
    codecTimingRef.current.mismatch.clear();
    callStatsStore.setState({ rtt: null });
    window.electronAPI?.setInCall?.(false);
  }, [stopScreenShareLocal, stopCameraLocal]);

  // ------------------------------------------------------- eventos gateway
  useEffect(() => {
    const offs = [
      gateway.on('READY', (d) => {
        const states = {};
        for (const st of d.voice_states || []) states[st.user_id] = st;
        voiceStatesStore.setState(states);
        // Reconectou no meio da call: retoma (o servidor nos segurou por alguns segundos)
        if (activeRef.current) gateway.send('voice_join', { channel_id: activeRef.current.id, ...hardwareCodecs() });
      }),
      gateway.on('VOICE_STATE_UPDATE', (d) => {
        // Sons de entrada/saída/transmissão para quem está no mesmo canal que eu
        const channelId = activeRef.current?.id;
        const prev = voiceStatesStore.getState()[d.user_id];
        if (channelId && d.user_id !== userRef.current?.id) {
          const wasHere = prev?.channel_id === channelId;
          const isHere = d.channel_id === channelId;
          if (!wasHere && isHere) playSound('join');
          else if (wasHere && !isHere) playSound('leave');
          else if (isHere && d.is_sharing_screen && !prev?.is_sharing_screen) playSound('stream');
        }
        applyVoiceState(d);
      }),
      gateway.on('VOICE_JOINED', (d) => {
        if (!activeRef.current || d.channel_id !== activeRef.current.id) return;
        if (joinSoundPendingRef.current) {
          joinSoundPendingRef.current = false;
          playSound('join');
        }
        applyVoiceState(d);
        const { muted, deafened } = flagsRef.current;
        if (d.is_muted !== muted || d.is_deafened !== deafened) sendVoiceFlags();
        const engine = engineRef.current;
        if (engine.starting) return;
        if (!engine.active || engine.sessionId !== d.session_id) engine.start();
      }),
      gateway.on('VOICE_DISCONNECTED', (d) => {
        if (!activeRef.current) return;
        if (d.reason === 'moved') setVoiceError('Você entrou na call por outra janela/dispositivo.');
        // A tela da call fecha em seguida, então o aviso vai num diálogo
        else if (d.reason === 'admin') alertDialog('Um administrador tirou você da call. Você pode entrar de novo.', 'Desconectado da call');
        playSound('disconnect');
        cleanupLocal();
      }),
      gateway.on('VOICE_ERROR', (d) => {
        setVoiceError(d.message);
        cleanupLocal();
      }),
      gateway.on('INVALID_SESSION', () => cleanupLocal())
    ];
    return () => offs.forEach((off) => off());
  }, [cleanupLocal, sendVoiceFlags]);

  // Logout / troca de conta encerra a call
  useEffect(() => {
    if (!user && activeRef.current) cleanupLocal();
  }, [user, cleanupLocal]);

  // ------------------------------------------------------------- ações
  const joinVoice = useCallback(
    async (channel) => {
      if (!channel || activeRef.current?.id === channel.id) return;
      if (activeRef.current) cleanupLocal();

      activeRef.current = channel;
      joinSoundPendingRef.current = true;
      setActiveVoiceChannel(channel);
      setConnection('connecting');
      setVoiceError(null);

      audioEngine.beginCall();
      const mic = new Microphone();
      micRef.current = mic;
      await mic.start({ deviceId: inputRef.current, ...settingsRef.current });
      if (activeRef.current?.id !== channel.id) {
        mic.stop();
        return;
      }
      mic.setThreshold(settingsRef.current.inputThreshold);
      mic.setMuted(flagsRef.current.muted);
      audioEngine.setDeafened(flagsRef.current.deafened);
      audioEngine.setLocalProbe(userRef.current?.id, () => mic.level());
      if (!mic.available) setVoiceError('Nenhum microfone encontrado — você entrou só ouvindo.');

      engineRef.current.publish([{ kind: 'mic', track: mic.track }]);
      // Os codecs de hardware vão junto: quem transmite já sabe o que eu decodifico
      await probeHardwareCodecs();
      if (activeRef.current?.id !== channel.id) return;
      gateway.send('voice_join', { channel_id: channel.id, ...hardwareCodecs() });
      window.electronAPI?.setInCall?.(true);
    },
    [cleanupLocal]
  );

  const leaveVoice = useCallback(() => {
    if (!activeRef.current) return;
    gateway.send('voice_leave');
    playSound('leave');
    cleanupLocal();
  }, [cleanupLocal]);

  const setMuted = useCallback(
    (muted) => {
      flagsRef.current.muted = muted;
      micRef.current?.setMuted(muted);
      setIsMuted(muted);
      localStorage.setItem('resenha_muted', JSON.stringify(muted));
      sendVoiceFlags();
    },
    [sendVoiceFlags]
  );

  const setDeafened = useCallback(
    (deafened) => {
      flagsRef.current.deafened = deafened;
      audioEngine.setDeafened(deafened);
      setIsDeafened(deafened);
      localStorage.setItem('resenha_deafened', JSON.stringify(deafened));
    },
    []
  );

  const toggleMute = useCallback(() => {
    const next = !flagsRef.current.muted;
    if (!next && flagsRef.current.deafened) setDeafened(false);
    setMuted(next);
    playSound(next ? 'mute' : 'unmute');
  }, [setMuted, setDeafened]);

  const toggleDeafen = useCallback(() => {
    const next = !flagsRef.current.deafened;
    if (next) {
      flagsRef.current.mutedBeforeDeafen = flagsRef.current.muted;
      setDeafened(true);
      setMuted(true);
    } else {
      setDeafened(false);
      setMuted(flagsRef.current.mutedBeforeDeafen);
    }
    playSound(next ? 'deafen' : 'undeafen');
  }, [setMuted, setDeafened]);

  // Menu da bandeja: mostra o estado atual e executa mutar/ensurdecer/sair da call com a janela escondida
  useEffect(() => {
    window.electronAPI?.sendTrayState?.({ muted: isMuted, deafened: isDeafened, inCall: Boolean(activeVoiceChannel) });
  }, [isMuted, isDeafened, activeVoiceChannel]);

  useEffect(() => {
    return window.electronAPI?.onTrayAction?.((action) => {
      if (action === 'toggle-mute') toggleMute();
      else if (action === 'toggle-deafen') toggleDeafen();
      else if (action === 'leave-voice') leaveVoice();
    });
  }, [toggleMute, toggleDeafen, leaveVoice]);

  // ------------------------------------------------------------- câmera
  const openCamera = async (deviceId) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
    const track = stream.getVideoTracks()[0];
    track.contentHint = 'motion';
    return track;
  };

  const publishCamera = async (track, codec) => {
    recordVideoCodec('camera', codec);
    await engineRef.current.publish([
      {
        kind: 'camera',
        track,
        options: {
          encodings: [{ maxBitrate: 1_200_000, maxFramerate: 30 }],
          codec: mimeOf(codec),
          degradation: 'balanced'
        }
      }
    ]);
    if (videoCodecsRef.current.camera) sendVideoCodecs();
  };

  const stopCamera = useCallback(async () => {
    const me = userRef.current?.id;
    stopCameraLocal();
    setCameraStreams((prev) => {
      if (!prev[me]) return prev;
      const next = { ...prev };
      delete next[me];
      return next;
    });
    await engineRef.current.unpublish(['camera']);
  }, [stopCameraLocal]);

  const startCamera = useCallback(async () => {
    if (!activeRef.current || cameraTrackRef.current) return;
    await probeHardwareCodecs();
    const codec = pickVideoCodec('camera');
    if (!codec) {
      setVoiceError(GPU_ERROR_MESSAGE);
      return;
    }
    let track;
    try {
      track = await openCamera(videoInputRef.current);
    } catch (err) {
      const reason =
        err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError'
          ? 'nenhuma câmera encontrada'
          : err?.name === 'NotReadableError'
            ? 'a câmera está sendo usada por outro programa'
            : err?.name === 'NotAllowedError'
              ? 'o acesso à câmera foi bloqueado'
              : err?.message || 'erro desconhecido';
      setVoiceError(`Não foi possível ligar a câmera: ${reason}.`);
      return;
    }
    track.onended = () => stopCamera();
    cameraTrackRef.current = track;
    setIsCameraOn(true);
    setVoiceError((e) => (e?.includes('câmera') ? null : e)); // some o aviso de uma tentativa anterior
    setCameraStreams((prev) => ({ ...prev, [userRef.current?.id]: new MediaStream([track]) }));
    refreshDevicesRef.current?.(); // com a permissão dada, os nomes das câmeras aparecem
    // Os espectadores podem ter mudado enquanto a câmera abria
    await publishCamera(track, pickVideoCodec('camera') || codec);
  }, [stopCamera, pickVideoCodec]);

  const toggleCamera = useCallback(() => (cameraTrackRef.current ? stopCamera() : startCamera()), [startCamera, stopCamera]);

  const setVideoInput = useCallback(async (deviceId) => {
    videoInputRef.current = deviceId;
    setSelectedVideoInput(deviceId);
    localStorage.setItem('resenha_video_input', deviceId);
    // Com a câmera ligada, troca na hora (mesmo transceiver: quem vê não perde a imagem)
    if (!cameraTrackRef.current) return;
    try {
      const track = await openCamera(deviceId);
      const old = cameraTrackRef.current;
      old.onended = null;
      old.stop();
      track.onended = () => stopCamera();
      cameraTrackRef.current = track;
      setCameraStreams((prev) => ({ ...prev, [userRef.current?.id]: new MediaStream([track]) }));
      await publishCamera(track, videoCodecsRef.current.camera || pickVideoCodec('camera') || 'H264');
    } catch (err) {
      setVoiceError(`Não foi possível trocar de câmera: ${err.message}`);
    }
  }, [stopCamera, pickVideoCodec]);

  const stopScreenShare = useCallback(async () => {
    stopScreenShareLocal();
    await engineRef.current.unpublish(['screen', 'screen_audio']);
  }, [stopScreenShareLocal]);

  /**
   * Inicia a transmissão ou, se já estiver ao vivo, troca a janela/tela sem derrubar quem assiste
   * (a track é substituída no mesmo transceiver, sem nova negociação).
   */
  const startNativeScreenShare = useCallback(
    async ({ source, captureAudio = true, resolution: requested = '720', fps: requestedFps = 30 }) => {
      const resolution = RESOLUTIONS[requested] ? requested : '720';
      const fps = Math.min(Number(requestedFps) || MAX_STREAM_FPS, MAX_STREAM_FPS);
      if (!activeRef.current) return;
      const switching = Boolean(screenTrackRef.current);
      const dims = RESOLUTIONS[resolution];
      // Sem codificador por hardware nem abre a captura
      await probeHardwareCodecs();
      if (!(switching ? videoCodecsRef.current.screen : pickVideoCodec('screen'))) {
        setVoiceError(GPU_ERROR_MESSAGE);
        return;
      }

      let videoTrack;
      let browserAudio = null; // na versão web, o áudio vem junto do seletor do navegador
      try {
        if (source.browser) {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: { max: dims.width }, height: { max: dims.height }, frameRate: { ideal: fps, max: fps } },
            audio: captureAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
            systemAudio: 'include',
            selfBrowserSurface: 'exclude',
            surfaceSwitching: 'include'
          });
          videoTrack = stream.getVideoTracks()[0];
          browserAudio = stream.getAudioTracks()[0] || null;
          const surface = videoTrack.getSettings().displaySurface;
          source = { ...source, id: 'browser', name: videoTrack.label || 'Tela', isScreen: surface === 'monitor' };
        } else {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: source.id,
                maxWidth: dims.width,
                maxHeight: dims.height,
                maxFrameRate: fps
              }
            }
          });
          videoTrack = stream.getVideoTracks()[0];
        }
      } catch (err) {
        // Cancelar o seletor do navegador não é erro
        if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') setVoiceError(`Não foi possível capturar a tela: ${err.message}`);
        return;
      }
      videoTrack.contentHint = fps >= 30 ? 'motion' : 'detail';
      videoTrack.onended = () => {
        stopScreenShare();
        setVoiceError(SOURCE_CLOSED_MESSAGE);
      };

      // Troca: a track antiga sai sem disparar o "fim da transmissão"
      const oldTrack = screenTrackRef.current;
      if (oldTrack) {
        oldTrack.onended = null;
        oldTrack.stop();
      }
      screenTrackRef.current = videoTrack;

      const entries = [
        {
          kind: 'screen',
          track: videoTrack,
          options: {
            encodings: [
              { maxBitrate: screenBitrate(resolution, fps), maxFramerate: fps, priority: 'high', networkPriority: 'high' }
            ],
            degradation: fps >= 30 ? 'maintain-framerate' : 'maintain-resolution'
          }
        }
      ];

      gameAudioRef.current?.stop();
      gameAudioRef.current = null;
      let audioOk = false;
      if (browserAudio) {
        // Áudio da aba/tela escolhida no navegador (sem o ganho ajustável do WASAPI)
        audioOk = true;
        entries.push({
          kind: 'screen_audio',
          track: browserAudio,
          options: { stereo: true, encodings: [{ maxBitrate: SCREEN_AUDIO_BITRATE, priority: 'high' }] }
        });
      } else if (captureAudio && GameAudioCapture.supported && !source.browser) {
        try {
          const capture = new GameAudioCapture(sendVolumeRef.current);
          const audioTrack = await capture.start(source.isScreen ? 0 : source.pid);
          gameAudioRef.current = capture;
          audioOk = true;
          entries.push({
            kind: 'screen_audio',
            track: audioTrack,
            options: { stereo: true, encodings: [{ maxBitrate: SCREEN_AUDIO_BITRATE, priority: 'high' }] }
          });
        } catch (err) {
          console.warn('[Voice] Áudio da transmissão indisponível:', err);
          setVoiceError('Transmitindo sem áudio: não foi possível capturar o som do jogo.');
        }
      }

      const me = userRef.current?.id;
      setScreenStreams((prev) => ({ ...prev, [me]: new MediaStream([videoTrack]) }));
      setIsSharingScreen(true);
      setShareInfo({ source, captureAudio, resolution, fps });
      if (!source.browser) window.electronAPI?.watchShareSource?.(source.id);

      if (switching && !audioOk) await engineRef.current.unpublish(['screen_audio']);
      // Registrado junto com o publish (sem await no meio) para a reconciliação ver o mesmo codec que o engine
      const codec = videoCodecsRef.current.screen || pickVideoCodec('screen') || 'H264';
      entries[0].options.codec = mimeOf(codec);
      if (!switching) recordVideoCodec('screen', codec);
      await engineRef.current.publish(entries);
      if (!switching && videoCodecsRef.current.screen) sendVideoCodecs();
      if (switching) {
        // Ajusta a taxa de bits se a resolução/FPS mudou (o transceiver é o mesmo)
        try {
          await engineRef.current.setSendParameters('screen', { maxBitrate: screenBitrate(resolution, fps), maxFramerate: fps });
        } catch {
          /* mantém os parâmetros anteriores */
        }
      }
    },
    [stopScreenShare, pickVideoCodec, recordVideoCodec, sendVideoCodecs]
  );

  // A janela compartilhada fechou (ex.: fechou o jogo): encerra a transmissão
  useEffect(() => {
    return window.electronAPI?.onShareSourceClosed?.(() => {
      if (!screenTrackRef.current) return;
      stopScreenShare();
      setVoiceError(SOURCE_CLOSED_MESSAGE);
    });
  }, [stopScreenShare]);

  const sendVolumeRef = useRef(streamSendVolume);
  const setStreamSendVolume = useCallback((volume) => {
    sendVolumeRef.current = volume;
    gameAudioRef.current?.setVolume(volume);
    setStreamSendVolumeState(volume);
    localStorage.setItem('resenha_stream_send_volume', JSON.stringify(volume));
  }, []);

  const toggleScreenShare = useCallback(() => {
    if (screenTrackRef.current) stopScreenShare();
  }, [stopScreenShare]);

  const watchStream = useCallback(
    async (userId, channel = null) => {
      if (channel && activeRef.current?.id !== channel.id) await joinVoice(channel);
      if (userId !== userRef.current?.id) {
        await probeHardwareCodecs();
        const st = voiceStatesStore.getState()[userId];
        if (st && !sharesHardwareCodec(st)) {
          setVoiceError(GPU_ERROR_MESSAGE);
          return;
        }
        setWatching((prev) => (prev.has(userId) ? prev : new Set(prev).add(userId)));
      }
      setFocusedStreamUserId(userId);
    },
    [joinVoice]
  );

  const stopWatching = useCallback((userId) => {
    setWatching((prev) => {
      if (!prev.has(userId)) return prev;
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
    setFocusedStreamUserId((f) => (f === userId ? null : f));
  }, []);

  /**
   * Publicador: recalcula o codec de cada vídeo quando espectadores/capacidades mudam.
   * Descer de codec é imediato (alguém não decodifica); subir espera estabilizar.
   */
  const reconcileVideoCodecs = useCallback(() => {
    if (!activeRef.current) return;
    const { encode } = hardwareCodecs();
    const timing = codecTimingRef.current;
    for (const kind of VIDEO_KINDS) {
      const current = videoCodecsRef.current[kind];
      if (!current) continue; // não estou publicando este vídeo
      const target = pickVideoCodec(kind);
      const pending = timing.upgrades[kind];
      if (!target) {
        setVoiceError(GPU_ERROR_MESSAGE);
        if (kind === 'screen') stopScreenShare();
        else stopCamera();
        continue;
      }
      if (target === current || pending?.target === target) {
        if (target === current && pending) {
          clearTimeout(pending.timer);
          delete timing.upgrades[kind];
        }
        continue;
      }
      if (pending) {
        clearTimeout(pending.timer);
        delete timing.upgrades[kind];
      }
      const upgrade = encode.includes(current) && CODEC_CHAIN.indexOf(target) < CODEC_CHAIN.indexOf(current);
      if (!upgrade) {
        applyVideoCodec(kind, target);
        continue;
      }
      timing.upgrades[kind] = {
        target,
        timer: setTimeout(() => {
          delete timing.upgrades[kind];
          if (videoCodecsRef.current[kind] && pickVideoCodec(kind) === target) applyVideoCodec(kind, target);
        }, CODEC_UPGRADE_DELAY_MS)
      };
    }
  }, [pickVideoCodec, applyVideoCodec, stopScreenShare, stopCamera]);

  useEffect(() => voiceStatesStore.subscribe(reconcileVideoCodecs), [reconcileVideoCodecs]);

  // Um codec caiu para software: avisa o servidor e reescolhe (publicando e assistindo)
  useEffect(
    () =>
      onHardwareCodecsChange((caps) => {
        setCodecCaps(caps);
        if (activeRef.current) gateway.send('voice_update', { encode: caps.encode, decode: caps.decode });
        reconcileVideoCodecs();
        syncSubscriptions();
      }),
    [reconcileVideoCodecs, syncSubscriptions]
  );

  // Confere nas estatísticas (a cada 2 s) se o vídeo está mesmo em hardware e no codec combinado
  useEffect(() => {
    const engine = engineRef.current;
    const timing = codecTimingRef.current;
    const strike = (key, bad) => {
      const count = bad ? (timing.strikes.get(key) || 0) + 1 : 0;
      timing.strikes.set(key, count);
      return count >= SOFTWARE_STRIKES;
    };
    const offs = [
      engine.on('codec-failed', ({ codec }) => markCodecFailed('encode', codec)),
      engine.on('video-health', ({ outbound, inbound }) => {
        const now = Date.now();
        for (const o of outbound) {
          const expected = videoCodecsRef.current[o.kind];
          if (!expected || now - (timing.publishedAt[o.kind] || 0) < HEALTH_GRACE_MS) continue;
          const bad = o.hardware === false || (o.codec != null && o.codec !== expected);
          if (strike(`out:${o.kind}`, bad)) {
            timing.strikes.delete(`out:${o.kind}`);
            markCodecFailed('encode', expected);
          }
        }
        for (const i of inbound) {
          if (!i.codec) continue;
          if (strike(`in:${i.key}:${i.codec}`, i.hardware === false)) {
            timing.strikes.delete(`in:${i.key}:${i.codec}`);
            markCodecFailed('decode', i.codec);
          }
        }

        // Transmissão num codec que não decodifico: se o publicador não trocar a tempo, desisto
        const states = voiceStatesStore.getState();
        for (const uid of watchingRef.current) {
          const st = states[uid];
          if (st?.tracks?.screen && !canDecodeCurrent(st, 'screen')) {
            const since = timing.mismatch.get(uid) ?? now;
            timing.mismatch.set(uid, since);
            if (now - since > MISMATCH_TIMEOUT_MS) {
              timing.mismatch.delete(uid);
              stopWatching(uid);
              setVoiceError(GPU_ERROR_MESSAGE);
            }
          } else {
            timing.mismatch.delete(uid);
          }
        }

        // O servidor perde codecs/espectadores ao recriar a sessão: reenvia se divergir
        const mine = states[userRef.current?.id];
        if (mine && 'video_codecs' in mine) {
          const codecs = Object.fromEntries(Object.entries(videoCodecsRef.current).filter(([k]) => mine.tracks?.[k]));
          if (!sameCodecs(codecs, mine.video_codecs)) gateway.send('voice_update', { video_codecs: codecs });
          const watchingNow = [...watchingRef.current].map(Number).sort((a, b) => a - b);
          if (watchingNow.join() !== (mine.watching || []).join()) gateway.send('voice_update', { watching: watchingNow });
        }
      })
    ];
    return () => offs.forEach((off) => off());
  }, [stopWatching]);

  const setUserVolume = useCallback((userId, volume) => {
    audioEngine.setUserVolume(userId, volume);
    setUserVolumes((prev) => {
      const next = { ...prev, [userId]: volume };
      localStorage.setItem('resenha_user_volumes', JSON.stringify(next));
      return next;
    });
  }, []);

  const setStreamVolume = useCallback((userId, volume) => {
    audioEngine.setStreamVolume(userId, volume);
    setStreamVolumes((prev) => {
      const next = { ...prev, [userId]: volume };
      localStorage.setItem('resenha_stream_volumes', JSON.stringify(next));
      return next;
    });
  }, []);

  // Aplica volumes salvos ao motor de áudio na inicialização
  useEffect(() => {
    Object.entries(userVolumes).forEach(([uid, v]) => audioEngine.setUserVolume(uid, v));
    Object.entries(streamVolumes).forEach(([uid, v]) => audioEngine.setStreamVolume(uid, v));
    if (selectedAudioOutput) audioEngine.setOutputDevice(selectedAudioOutput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------------------------------- dispositivos
  const refreshAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputDevices(devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default'));
      setAudioOutputDevices(devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default'));
      setVideoInputDevices(devices.filter((d) => d.kind === 'videoinput'));
    } catch (err) {
      console.warn('[Voice] Erro ao listar dispositivos:', err);
    }
  }, []);

  refreshDevicesRef.current = refreshAudioDevices;
  useEffect(() => {
    refreshAudioDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshAudioDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshAudioDevices);
  }, [refreshAudioDevices]);

  const setAudioInput = useCallback(async (deviceId) => {
    setSelectedAudioInput(deviceId);
    localStorage.setItem('resenha_audio_input', deviceId);
    await micRef.current?.switchDevice({ deviceId, ...settingsRef.current });
  }, []);

  const setAudioOutput = useCallback(async (deviceId) => {
    setSelectedAudioOutput(deviceId);
    localStorage.setItem('resenha_audio_output', deviceId);
    await audioEngine.setOutputDevice(deviceId);
  }, []);

  const updateVoiceSettings = useCallback(async (patch) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setVoiceSettings(next);
    localStorage.setItem('resenha_voice_settings', JSON.stringify(next));
    if ('inputThreshold' in patch) micRef.current?.setThreshold(next.inputThreshold);
    const mic = micRef.current;
    if ('aiNoiseSuppression' in patch && mic) {
      try {
        await mic.setDenoiser(next.aiNoiseSuppression);
      } catch (err) {
        console.warn('[Voice] RNNoise indisponível:', err);
        setVoiceError('Não foi possível ativar a supressão de ruído por IA neste computador.');
        const reverted = { ...settingsRef.current, aiNoiseSuppression: false };
        settingsRef.current = reverted;
        setVoiceSettings(reverted);
        localStorage.setItem('resenha_voice_settings', JSON.stringify(reverted));
        return;
      }
    }
    if (['echoCancellation', 'noiseSuppression', 'autoGainControl', 'aiNoiseSuppression'].some((k) => k in patch)) {
      await mic?.switchDevice({ deviceId: inputRef.current, ...settingsRef.current });
    }
  }, []);

  const getMicLevel = useCallback(() => micRef.current?.rawLevel() ?? 0, []);

  // ------------------------------------------------------------- derivados
  const voiceUsers = useMemo(() => {
    if (!activeVoiceChannel) return [];
    return Object.values(voiceStates).filter(
      (v) => v.channel_id === activeVoiceChannel.id && v.user_id !== user?.id
    );
  }, [voiceStates, activeVoiceChannel, user?.id]);

  const value = {
    activeVoiceChannel,
    connection,
    voiceError,
    clearVoiceError: () => setVoiceError(null),
    voiceUsers,
    isMuted,
    isDeafened,
    isSharingScreen,
    isCameraOn,
    cameraStreams,
    toggleCamera,
    videoInputDevices,
    selectedVideoInput,
    setVideoInput,
    shareInfo,
    streamSendVolume,
    setStreamSendVolume,
    screenStreams,
    watching,
    watchStream,
    stopWatching,
    // compatibilidade com componentes antigos
    watchUserStream: watchStream,
    focusedStreamUserId,
    setFocusedStreamUserId,
    userVolumes,
    setUserVolume,
    streamVolumes,
    setStreamVolume,
    voiceSettings,
    updateVoiceSettings,
    getMicLevel,
    audioInputDevices,
    audioOutputDevices,
    selectedAudioInput,
    selectedAudioOutput,
    setAudioInput,
    setAudioOutput,
    refreshAudioDevices,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    startNativeScreenShare,
    stopScreenShare
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  const context = useContext(VoiceContext);
  if (!context) throw new Error('useVoice deve ser usado dentro de um VoiceProvider');
  return context;
}
