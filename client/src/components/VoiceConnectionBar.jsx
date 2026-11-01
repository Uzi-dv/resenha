import React, { useEffect, useRef, useState } from 'react';
import { useVoice } from '../context/VoiceContext';
import { useCallStats } from '../services/voice/stores';
import { useServer } from '../context/ServerContext';
import { PhoneOff, Signal, Loader2, ScreenShare, ScreenShareOff, Repeat, Volume2, AudioLines, AudioWaveform, Video, VideoOff } from 'lucide-react';
import ScreenShareModal from './ScreenShareModal';
import AudioSettingsModal from './AudioSettingsModal';
import VolumeSlider from './VolumeSlider';

function PanelButton({ onClick, title, active, danger, disabled, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`press h-8 rounded-lg flex items-center justify-center transition-colors disabled:bg-transparent disabled:text-fg-faint disabled:opacity-60 disabled:pointer-events-none ${
        danger
          ? 'bg-danger text-white border-2 border-ink hover:bg-danger-hover'
          : active
            ? 'bg-accent text-on-accent border-2 border-ink hover:bg-accent-hover'
            : 'bg-hover text-fg-2 hover:bg-active hover:text-fg-strong'
      }`}
    >
      {children}
    </button>
  );
}

/** Volume do áudio que vai junto com a transmissão (o que os outros ouvem do jogo). */
function SendVolumePopover({ onClose }) {
  const { streamSendVolume, setStreamSendVolume } = useVoice();
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => !ref.current?.contains(e.target) && onClose();
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div ref={ref} className="sheet-sm anim-rise absolute bottom-full left-0 right-0 mb-2 bg-float p-3 z-50">
      <div className="text-xs font-semibold text-fg-strong mb-0.5">Volume do áudio transmitido</div>
      <div className="text-[11px] text-fg-muted mb-2">Quanto do som do jogo os outros ouvem. Cada pessoa ainda ajusta o próprio volume.</div>
      <div className="flex items-center gap-2">
        <Volume2 className="w-4 h-4 text-fg-muted shrink-0" />
        <VolumeSlider value={streamSendVolume} onChange={setStreamSendVolume} label="Volume do áudio transmitido" />
        <span className="text-xs text-fg-2 w-10 text-right tabular-nums">{streamSendVolume}%</span>
      </div>
    </div>
  );
}

export default function VoiceConnectionBar() {
  const {
    activeVoiceChannel,
    connection,
    leaveVoice,
    isSharingScreen,
    shareInfo,
    stopScreenShare,
    startNativeScreenShare,
    voiceSettings,
    updateVoiceSettings,
    isCameraOn,
    toggleCamera
  } = useVoice();
  const { servers, currentServer, selectChannel, selectServer } = useServer();
  const { rtt } = useCallStats();
  const [modal, setModal] = useState(null); // 'share' | 'switch' | 'audio'
  const [volumeOpen, setVolumeOpen] = useState(false);

  if (!activeVoiceChannel) return null;

  const connected = connection === 'connected';
  const failed = connection === 'failed';
  const color = failed
    ? '#f23f43'
    : !connected
      ? '#f0b232'
      : rtt == null || rtt < 120
        ? '#23a55a'
        : rtt < 250
          ? '#f0b232'
          : '#f23f43';
  const label = connected
    ? 'Voz conectada'
    : failed
      ? 'Voz indisponível'
      : connection === 'reconnecting'
        ? 'Reconectando...'
        : 'Conectando...';
  const serverName = servers?.find((s) => s.id === activeVoiceChannel.server_id)?.name;
  const canShare = Boolean(window.electronAPI?.getSources || navigator.mediaDevices?.getDisplayMedia);
  const denoise = voiceSettings.aiNoiseSuppression;

  const goToChannel = async () => {
    if (currentServer?.id !== activeVoiceChannel.server_id) await selectServer(activeVoiceChannel.server_id);
    selectChannel(activeVoiceChannel);
  };

  return (
    <div className="px-2 pt-2 pb-2 border-b border-line select-none relative">
      <div className="flex items-center gap-1">
        <button onClick={goToChannel} className="flex-1 min-w-0 flex items-center gap-2.5 p-1 rounded-md hover:bg-hover transition text-left" title="Ir para a sala de voz">
          <span
            className="w-9 h-9 rounded-lg border-2 border-ink flex items-center justify-center shrink-0 text-black transition-colors"
            style={{ backgroundColor: color }}
          >
            {connected || failed ? <Signal className="w-[18px] h-[18px]" strokeWidth={2.5} /> : <Loader2 className="w-[18px] h-[18px] animate-spin" strokeWidth={2.5} />}
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-extrabold tracking-tight leading-tight" style={{ color }}>
              {label}
              {connected && rtt != null && <span className="font-normal text-[11px] text-fg-muted ml-1.5">{rtt} ms</span>}
            </span>
            <span className="text-[13px] font-semibold text-fg-muted truncate leading-tight">
              {activeVoiceChannel.name}
              {serverName ? ` / ${serverName}` : ''}
            </span>
          </div>
        </button>
        <button
          onClick={() => updateVoiceSettings({ aiNoiseSuppression: !denoise })}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition hover:bg-hover ${denoise ? 'text-fg-strong' : 'text-fg-faint'}`}
          title={denoise ? 'Supressão de ruído por IA: ligada (clique para desligar)' : 'Supressão de ruído por IA: desligada (clique para ligar)'}
        >
          {denoise ? <AudioWaveform className="w-5 h-5" /> : <AudioLines className="w-5 h-5" />}
        </button>
        <button
          onClick={leaveVoice}
          className="sticker-btn ml-1 w-9 h-8 rounded-lg flex items-center justify-center bg-danger hover:bg-danger-hover text-white shrink-0"
          title="Desconectar"
        >
          <PhoneOff className="w-[18px] h-[18px]" />
        </button>
      </div>

      {isSharingScreen && shareInfo && (
        <div className="anim-drop mt-1.5 mx-1 flex items-center gap-1.5 text-[11px] text-fg-muted min-w-0">
          <span className="px-1.5 rounded-md bg-danger text-white text-[11px] font-bold border-[1.5px] border-ink shrink-0">Ao vivo</span>
          {shareInfo.source.appIcon && <img src={shareInfo.source.appIcon} alt="" className="w-3.5 h-3.5 shrink-0" />}
          <span className="truncate" title={shareInfo.source.name}>
            {shareInfo.source.isScreen ? 'Tela inteira' : shareInfo.source.name}
          </span>
          <span className="shrink-0">· {shareInfo.resolution}p {shareInfo.fps}fps</span>
        </div>
      )}

      <div className="grid grid-cols-5 gap-1.5 mt-2 relative">
        <PanelButton onClick={toggleCamera} active={isCameraOn} disabled={!connected} title={isCameraOn ? 'Desligar câmera' : 'Ligar câmera'}>
          {isCameraOn ? <Video className="w-[18px] h-[18px]" /> : <VideoOff className="w-[18px] h-[18px]" />}
        </PanelButton>
        {isSharingScreen ? (
          <PanelButton onClick={stopScreenShare} danger title="Parar transmissão">
            <ScreenShareOff className="w-[18px] h-[18px]" />
          </PanelButton>
        ) : (
          <PanelButton
            onClick={() => setModal('share')}
            disabled={!canShare || !connected}
            title={canShare ? 'Compartilhar tela' : 'Disponível apenas no app desktop'}
          >
            <ScreenShare className="w-[18px] h-[18px]" />
          </PanelButton>
        )}
        <PanelButton onClick={() => setModal('switch')} disabled={!isSharingScreen} title="Trocar janela ou tela da transmissão">
          <Repeat className="w-[18px] h-[18px]" />
        </PanelButton>
        <PanelButton
          onClick={() => setVolumeOpen((v) => !v)}
          active={volumeOpen}
          disabled={!isSharingScreen || !shareInfo?.captureAudio}
          title="Volume do áudio transmitido"
        >
          <Volume2 className="w-[18px] h-[18px]" />
        </PanelButton>
        <PanelButton onClick={() => setModal('audio')} title="Configurações de voz e áudio">
          <AudioLines className="w-[18px] h-[18px]" />
        </PanelButton>
        {volumeOpen && isSharingScreen && <SendVolumePopover onClose={() => setVolumeOpen(false)} />}
      </div>

      {(modal === 'share' || modal === 'switch') && (
        <ScreenShareModal switching={modal === 'switch'} onClose={() => setModal(null)} onSelectSource={startNativeScreenShare} />
      )}
      {modal === 'audio' && <AudioSettingsModal onClose={() => setModal(null)} />}
    </div>
  );
}
