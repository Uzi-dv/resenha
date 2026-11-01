import React, { useEffect, useRef, useState } from 'react';
import VolumeSlider from './VolumeSlider';
import { Tv, Volume2, VolumeX, Maximize2, Minimize2, EyeOff, Expand, Loader2, PictureInPicture2 } from 'lucide-react';

const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled;

/** PiP nativo do sistema: janela flutuante que fica por cima de tudo (inclusive do jogo). */
export async function togglePictureInPicture(video) {
  if (!video || !pipSupported) return;
  try {
    if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch (err) {
    console.warn('[PiP] Não foi possível abrir:', err);
  }
}

export function useStreamVideo(stream) {
  const videoRef = useRef(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream || null;
    if (stream) video.play().catch(() => {});
  }, [stream]);
  return videoRef;
}

/** Miniatura ao vivo de uma transmissão (faixa da visão geral). */
export function StreamThumbnail({ stream, presenter, onClick }) {
  const videoRef = useStreamVideo(stream);
  return (
    <button
      onClick={onClick}
      className="relative w-48 h-28 shrink-0 rounded-lg overflow-hidden bg-black border border-well hover:border-accent transition group"
      title={`Focar na transmissão de ${presenter?.username}`}
    >
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover pointer-events-none" />
      <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-danger" />
        {presenter?.username}
      </span>
      <span className="absolute inset-0 bg-accent/0 group-hover:bg-accent/15 transition" />
    </button>
  );
}

/**
 * Exibe uma transmissão. O <video> é sempre mudo: o áudio do jogo é tocado pelo
 * mixer da call (respeita o dispositivo de saída e o ensurdecer).
 */
const StreamVideoPlayer = React.memo(function StreamVideoPlayer({
  stream,
  presenter,
  isMe = false,
  isFocused = false,
  volume = 100,
  onVolumeChange,
  onToggleFocus,
  onStopWatching
}) {
  const containerRef = useRef(null);
  const videoRef = useStreamVideo(stream);
  const lastVolumeRef = useRef(volume || 100);
  const [hovered, setHovered] = useState(false);
  const [resolution, setResolution] = useState(null);
  const [waiting, setWaiting] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [inPip, setInPip] = useState(false);

  useEffect(() => setWaiting(true), [stream]);

  // React não expõe os eventos de PiP como props: escuta direto no elemento
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const enter = () => setInPip(true);
    const leave = () => setInPip(false);
    video.addEventListener('enterpictureinpicture', enter);
    video.addEventListener('leavepictureinpicture', leave);
    return () => {
      video.removeEventListener('enterpictureinpicture', enter);
      video.removeEventListener('leavepictureinpicture', leave);
    };
  }, [videoRef]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = (e) => {
    e?.stopPropagation();
    const el = containerRef.current;
    const video = videoRef.current;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen(); // Safari do iPad
    else if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iPhone: só o <video> vai para tela cheia
  };

  // Toque (celular): não existe "passar o mouse", então um toque mostra/esconde os controles
  const hideTimer = useRef(null);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const onTouchTap = (e) => {
    if (e.pointerType !== 'touch' || e.target.closest('button, input')) return;
    clearTimeout(hideTimer.current);
    setHovered((shown) => {
      if (!shown) hideTimer.current = setTimeout(() => setHovered(false), 4000);
      return !shown;
    });
  };

  const muted = volume === 0;
  const toggleMute = (e) => {
    e.stopPropagation();
    if (muted) onVolumeChange?.(lastVolumeRef.current || 100);
    else {
      lastVolumeRef.current = volume;
      onVolumeChange?.(0);
    }
  };

  const iconButton = 'bg-black/70 hover:bg-hover text-white p-1.5 rounded-md backdrop-blur-md transition';

  return (
    <div
      ref={containerRef}
      onPointerEnter={(e) => e.pointerType !== 'touch' && setHovered(true)}
      onPointerLeave={(e) => e.pointerType !== 'touch' && setHovered(false)}
      onPointerUp={onTouchTap}
      onDoubleClick={toggleFullscreen}
      className="relative w-full h-full min-h-[200px] bg-black rounded-lg overflow-hidden flex items-center justify-center border border-well shadow-xl"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onPlaying={() => setWaiting(false)}
        onResize={(e) => setResolution(`${e.currentTarget.videoWidth}×${e.currentTarget.videoHeight}`)}
        className="w-full h-full object-contain pointer-events-none"
      />

      {waiting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-fg-muted text-xs pointer-events-none">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          Carregando transmissão...
        </div>
      )}
      {inPip && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-fg-2 text-sm bg-float">
          <PictureInPicture2 className="w-10 h-10 text-accent" />
          Assistindo em janela flutuante
          <button onClick={() => togglePictureInPicture(videoRef.current)} className="text-xs text-link hover:underline">
            Trazer de volta
          </button>
        </div>
      )}

      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-full text-xs text-white shadow">
          <Tv className="w-3.5 h-3.5 text-accent" />
          <span className="font-semibold truncate max-w-[200px]">
            {presenter?.username || 'Usuário'} {isMe ? '(Você)' : ''}
          </span>
          <span className="bg-danger text-white uppercase text-[9px] font-extrabold px-1.5 py-0.5 rounded tracking-wide">
            Ao vivo
          </span>
          {resolution && hovered && <span className="text-[10px] font-mono text-fg-2">{resolution}</span>}
        </div>

        <div className={`flex items-center gap-2 transition-opacity duration-150 ${hovered ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          {onStopWatching && !isMe && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStopWatching();
              }}
              className="bg-black/70 hover:bg-danger text-white px-2.5 py-1.5 rounded-md text-xs flex items-center gap-1.5 backdrop-blur-md transition"
              title="Parar de assistir"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span className="hidden md:inline font-medium">Parar de assistir</span>
            </button>
          )}
          {onToggleFocus && !isFullscreen && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFocus();
              }}
              className={iconButton}
              title={isFocused ? 'Minimizar (ver todas as transmissões)' : 'Focar nesta transmissão'}
            >
              {isFocused ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
          {pipSupported && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePictureInPicture(videoRef.current);
              }}
              className={iconButton}
              title="Janela flutuante (fica por cima do jogo)"
            >
              <PictureInPicture2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={toggleFullscreen} className={iconButton} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia (duplo clique)'}>
            <Expand className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMe && onVolumeChange && (
        <div
          className={`absolute bottom-3 left-3 flex items-center gap-2 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-white text-xs transition-opacity duration-150 ${
            hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button onClick={toggleMute} className="p-1 rounded hover:bg-white/10" title={muted ? 'Ativar som' : 'Silenciar transmissão'}>
            {muted ? <VolumeX className="w-4 h-4 text-danger" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <VolumeSlider value={volume} onChange={onVolumeChange} label="Volume da transmissão" className="w-24" />
          <span className="text-[11px] font-mono text-fg w-9 text-right">{volume}%</span>
        </div>
      )}
    </div>
  );
});

export default StreamVideoPlayer;
