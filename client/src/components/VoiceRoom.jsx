import React, { useState } from 'react';
import VolumeSlider from './VolumeSlider';
import Avatar from './Avatar';
import { useVoice } from '../context/VoiceContext';
import { useCallStats } from '../services/voice/stores';
import { useAuth } from '../context/AuthContext';
import { useChannelParticipants, useIsSpeaking } from '../services/voice/stores';
import {
  Mic, MicOff, Headphones, HeadphoneOff, Tv, PhoneOff, Volume2, SlidersHorizontal, Eye, LayoutGrid, AlertTriangle, X, Loader2,
  ScreenShare, ScreenShareOff, Repeat, Video, VideoOff
} from 'lucide-react';
import ScreenShareModal from './ScreenShareModal';
import AudioSettingsModal from './AudioSettingsModal';
import StreamVideoPlayer, { StreamThumbnail, useStreamVideo } from './StreamVideoPlayer';
import MobileBackButton from './MobileBackButton';

function ConnectionBadge({ connection }) {
  const { rtt } = useCallStats();
  if (connection === 'connected') {
    const color = rtt == null || rtt < 120 ? '#23a55a' : rtt < 250 ? '#f0b232' : '#f23f43';
    return (
      <span className="text-xs font-semibold px-2 py-0.5 rounded flex items-center gap-1" style={{ color, background: `${color}22` }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        Conectado{rtt != null ? ` · ${rtt} ms` : ''}
      </span>
    );
  }
  if (connection === 'failed') {
    return (
      <span className="text-xs font-semibold px-2 py-0.5 rounded flex items-center gap-1 text-danger bg-danger/15">
        <AlertTriangle className="w-3 h-3" /> Sem áudio/vídeo
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded flex items-center gap-1 text-warn bg-warn/15">
      <Loader2 className="w-3 h-3 animate-spin" />
      {connection === 'reconnecting' ? 'Reconectando...' : 'Conectando...'}
    </span>
  );
}

function CallButton({ onClick, active, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`press w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
        active ? 'bg-danger/20 text-danger hover:bg-danger/30' : 'bg-hover text-fg hover:bg-active'
      }`}
    >
      {children}
    </button>
  );
}

/** Vídeo da câmera ocupando o cartão. A minha prévia aparece espelhada, como num espelho (para os outros não). */
function CameraVideo({ stream, mirrored }) {
  const videoRef = useStreamVideo(stream);
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={`absolute inset-0 w-full h-full object-cover bg-black ${mirrored ? '-scale-x-100' : ''}`}
    />
  );
}

const ParticipantTile = React.memo(function ParticipantTile({
  participant,
  cameraStream,
  isMe,
  compact,
  isWatching,
  volume,
  onWatch,
  onFocus,
  onVolume,
  onOpenUserProfile,
  onUserContextMenu
}) {
  const speaking = useIsSpeaking(participant.user_id);
  const live = participant.is_sharing_screen;
  const clickable = live && !isMe;

  return (
    <div
      onClick={() => clickable && (isWatching ? onFocus(participant.user_id) : onWatch(participant.user_id))}
      onContextMenu={(e) =>
        onUserContextMenu?.(e, { id: participant.user_id, username: participant.username, avatar_url: participant.avatar_url })
      }
      className={`anim-zoom group/tile relative aspect-video rounded-xl bg-panel flex items-center justify-center overflow-hidden border ${
        compact ? 'w-44 shrink-0' : 'w-full'
      } ${speaking ? 'border-ok ring-1 ring-ok' : 'border-line'} ${clickable ? 'cursor-pointer hover:border-accent' : ''}`}
    >
      {cameraStream ? (
        <CameraVideo stream={cameraStream} mirrored={isMe} />
      ) : (
        <Avatar
          user={participant}
          alt={participant.username}
          onClick={(e) => {
            e.stopPropagation();
            onOpenUserProfile?.(participant.user_id);
          }}
          className={`${compact ? 'w-12 h-12' : 'w-20 h-20'} rounded-full object-cover bg-well cursor-pointer ${speaking ? 'speaking-ring' : ''}`}
        />
      )}

      {live && (
        <span className="absolute top-2 left-2 bg-danger text-white text-xs font-bold px-2 py-0.5 rounded-md border-2 border-ink">
          Ao vivo
        </span>
      )}
      {clickable && !isWatching && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onWatch(participant.user_id);
          }}
          className="absolute top-2 right-2 text-xs font-semibold bg-black/60 hover:bg-accent text-white px-2.5 py-1 rounded-md flex items-center gap-1.5 transition"
        >
          <Eye className="w-3.5 h-3.5" /> Assistir
        </button>
      )}

      <div className="absolute bottom-2 left-2 max-w-[calc(100%-16px)] flex items-center gap-1.5 bg-black/55 rounded-md px-2 py-0.5">
        {participant.is_muted && <MicOff className="w-3.5 h-3.5 text-danger shrink-0" />}
        {participant.is_deafened && <HeadphoneOff className="w-3.5 h-3.5 text-danger shrink-0" />}
        <span className={`${compact ? 'text-xs' : 'text-sm'} font-medium text-white truncate`}>{participant.username}</span>
      </div>

      {!isMe && !compact && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2 right-2 w-36 items-center gap-1.5 bg-black/55 rounded-md px-2 py-1 hidden group-hover/tile:flex"
        >
          <Volume2 className="w-3.5 h-3.5 text-white/80 shrink-0" />
          <VolumeSlider value={volume} onChange={(v) => onVolume(participant.user_id, v)} label="Volume" />
          <span className="text-[10px] text-white/80 w-8 text-right tabular-nums">{volume}%</span>
        </div>
      )}
    </div>
  );
});

export default function VoiceRoom({ onOpenUserProfile, onUserContextMenu }) {
  const { user: currentUser } = useAuth();
  const {
    activeVoiceChannel,
    connection,
    voiceError,
    clearVoiceError,
    isMuted,
    isDeafened,
    isSharingScreen,
    screenStreams,
    watching,
    watchStream,
    stopWatching,
    focusedStreamUserId,
    setFocusedStreamUserId,
    userVolumes,
    setUserVolume,
    streamVolumes,
    setStreamVolume,
    toggleMute,
    toggleDeafen,
    stopScreenShare,
    startNativeScreenShare,
    leaveVoice,
    isCameraOn,
    cameraStreams,
    toggleCamera
  } = useVoice();
  const participantsFromServer = useChannelParticipants(activeVoiceChannel?.id);
  const [showPicker, setShowPicker] = useState(false);
  const [showAudioSettings, setShowAudioSettings] = useState(false);

  if (!activeVoiceChannel) {
    return (
      <div className="flex-1 bg-chat flex flex-col items-center justify-center text-center p-6 text-fg-muted relative">
        <div className="absolute top-1 left-4">
          <MobileBackButton />
        </div>
        <Volume2 className="w-16 h-16 text-active mb-4" />
        <h3 className="text-xl font-bold text-fg-strong mb-1">Nenhum canal de voz ativo</h3>
        <p className="text-sm max-w-sm">Clique em um canal de voz na barra lateral para entrar.</p>
      </div>
    );
  }

  const me = currentUser?.id;
  // Garante que eu apareço mesmo antes da confirmação do servidor, com meu estado local imediato
  const participants = [
    ...(participantsFromServer.some((p) => p.user_id === me)
      ? []
      : [{ user_id: me, username: currentUser?.username, avatar_url: currentUser?.avatar_url, joined_at: 0 }]),
    ...participantsFromServer
  ].map((p) => (p.user_id === me ? { ...p, is_muted: isMuted, is_deafened: isDeafened, is_sharing_screen: isSharingScreen } : p));

  const streamUsers = participants.filter((p) => screenStreams[p.user_id] && (p.user_id === me || watching.has(p.user_id)));
  const focused = streamUsers.find((p) => p.user_id === focusedStreamUserId);
  const displayed = focused ? [focused] : streamUsers;
  const hasStreams = displayed.length > 0;
  const liveCount = participants.filter((p) => p.is_sharing_screen).length;

  const toggleFocus = (userId) => setFocusedStreamUserId(focusedStreamUserId === userId ? null : userId);

  const tiles = participants.map((p) => (
    <ParticipantTile
      key={p.user_id}
      participant={p}
      cameraStream={cameraStreams[p.user_id]}
      isMe={p.user_id === me}
      compact={hasStreams}
      isWatching={watching.has(p.user_id)}
      volume={userVolumes[p.user_id] ?? 100}
      onWatch={watchStream}
      onFocus={toggleFocus}
      onVolume={setUserVolume}
      onOpenUserProfile={onOpenUserProfile}
      onUserContextMenu={onUserContextMenu}
    />
  ));

  return (
    <div className="flex-1 bg-chat flex flex-col relative overflow-hidden select-none">
      <div className="h-12 border-b border-line px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <MobileBackButton />
          <Volume2 className="w-5 h-5 text-fg-muted shrink-0" />
          <h2 className="font-semibold text-fg-strong text-base truncate">{activeVoiceChannel.name}</h2>
          <span className="text-xs text-fg-muted shrink-0">
            {participants.length} {participants.length === 1 ? 'pessoa' : 'pessoas'}
          </span>
          <ConnectionBadge connection={connection} />
          {liveCount > 0 && (
            <span className="text-xs bg-danger/20 text-danger font-semibold px-2 py-0.5 rounded hidden md:inline-flex items-center gap-1">
              <Tv className="w-3 h-3" /> {liveCount} ao vivo
            </span>
          )}
        </div>
        {streamUsers.length > 1 && (
          <button
            onClick={() => setFocusedStreamUserId(focused ? null : streamUsers[0].user_id)}
            className="text-xs flex items-center gap-1.5 text-fg hover:text-fg-strong bg-side hover:bg-hover px-3 py-1.5 rounded transition"
          >
            <LayoutGrid className="w-3.5 h-3.5" /> {focused ? 'Ver todas' : 'Focar'}
          </button>
        )}
      </div>

      {voiceError && (
        <div className="mx-4 mt-3 bg-warn/15 border border-warn/40 text-warn text-xs rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{voiceError}</span>
          <button onClick={clearVoiceError} className="hover:text-fg-strong">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 px-2 md:px-4 pt-3 md:pt-4 pb-24 overflow-y-auto flex flex-col min-h-0">
        {hasStreams ? (
          <>
            <div
              className={`w-full flex-1 min-h-0 grid gap-3 mb-3 ${
                displayed.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
              }`}
            >
              {displayed.map((p) => (
                <StreamVideoPlayer
                  key={p.user_id}
                  stream={screenStreams[p.user_id]}
                  presenter={p}
                  isMe={p.user_id === me}
                  isFocused={focused?.user_id === p.user_id}
                  volume={streamVolumes[p.user_id] ?? 100}
                  onVolumeChange={(v) => setStreamVolume(p.user_id, v)}
                  onToggleFocus={streamUsers.length > 1 ? () => toggleFocus(p.user_id) : undefined}
                  onStopWatching={() => stopWatching(p.user_id)}
                />
              ))}
            </div>
            {/* Visão geral: com uma transmissão em foco, as outras ficam em miniaturas ao vivo */}
            {focused && streamUsers.length > 1 && (
              <div className="shrink-0 w-full flex items-center justify-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                {streamUsers
                  .filter((p) => p.user_id !== focused.user_id)
                  .map((p) => (
                    <StreamThumbnail
                      key={p.user_id}
                      stream={screenStreams[p.user_id]}
                      presenter={p}
                      onClick={() => setFocusedStreamUserId(p.user_id)}
                    />
                  ))}
              </div>
            )}
            <div className="shrink-0 w-full flex items-center justify-center gap-3 overflow-x-auto py-1 no-scrollbar">{tiles}</div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div
              className="grid gap-3 w-full max-w-6xl"
              style={{ gridTemplateColumns: `repeat(${Math.min(participants.length, participants.length > 4 ? 3 : 2)}, minmax(0, 1fr))`, maxWidth: participants.length === 1 ? '48rem' : undefined }}
            >
              {tiles}
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
        <div className="sheet pointer-events-auto flex items-center gap-1.5 md:gap-2 bg-panel p-2">
          <CallButton onClick={toggleMute} active={isMuted} title={isMuted ? 'Ativar microfone' : 'Silenciar microfone'}>
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </CallButton>
          <CallButton onClick={toggleDeafen} active={isDeafened} title={isDeafened ? 'Desativar ensurdecer' : 'Ensurdecer'}>
            {isDeafened ? <HeadphoneOff className="w-5 h-5" /> : <Headphones className="w-5 h-5" />}
          </CallButton>
          <CallButton onClick={toggleCamera} active={false} title={isCameraOn ? 'Desligar câmera' : 'Ligar câmera'}>
            {isCameraOn ? <Video className="w-5 h-5 text-ok" /> : <VideoOff className="w-5 h-5" />}
          </CallButton>
          <button
            onClick={() => (isSharingScreen ? stopScreenShare() : setShowPicker(true))}
            disabled={!window.electronAPI?.getSources && !navigator.mediaDevices?.getDisplayMedia}
            className={`sticker-btn h-11 px-3 md:px-4 rounded-xl flex items-center gap-2 font-bold text-sm disabled:opacity-40 max-md:disabled:hidden ${
              isSharingScreen ? 'bg-danger hover:bg-danger-hover text-white' : 'bg-accent hover:bg-accent-hover text-on-accent'
            }`}
            title={window.electronAPI?.getSources || navigator.mediaDevices?.getDisplayMedia ? '' : 'Seu navegador não permite compartilhar a tela'}
          >
            {isSharingScreen ? <ScreenShareOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
            <span className="hidden md:inline">{isSharingScreen ? 'Parar transmissão' : 'Compartilhar tela'}</span>
          </button>
          {isSharingScreen && (
            <CallButton onClick={() => setShowPicker('switch')} title="Trocar janela ou tela da transmissão">
              <Repeat className="w-5 h-5" />
            </CallButton>
          )}
          <CallButton onClick={() => setShowAudioSettings(true)} title="Configurações de voz">
            <SlidersHorizontal className="w-5 h-5" />
          </CallButton>
          <div className="w-px h-7 bg-line-strong mx-1" />
          <button
            onClick={leaveVoice}
            className="sticker-btn w-14 h-11 rounded-xl bg-danger hover:bg-danger-hover text-white flex items-center justify-center"
            title="Desconectar"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </div>

      {showPicker && (
        <ScreenShareModal switching={showPicker === 'switch'} onClose={() => setShowPicker(false)} onSelectSource={startNativeScreenShare} />
      )}
      {showAudioSettings && <AudioSettingsModal onClose={() => setShowAudioSettings(false)} />}
    </div>
  );
}
