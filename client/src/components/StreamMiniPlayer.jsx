import React, { useRef, useState } from 'react';
import { Undo2, PictureInPicture2, X, GripHorizontal, Volume2, VolumeX } from 'lucide-react';
import VolumeSlider from './VolumeSlider';
import { useVoice } from '../context/VoiceContext';
import { useServer } from '../context/ServerContext';
import { useAuth } from '../context/AuthContext';
import { useVoiceStates } from '../services/voice/stores';
import { togglePictureInPicture, useStreamVideo } from './StreamVideoPlayer';
import { showMobileContent } from '../services/mobile';

const WIDTH = 320;
const HEIGHT = 180;
const POS_KEY = 'resenha_miniplayer_pos';

function loadPosition() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY));
    if (Number.isFinite(p?.right) && Number.isFinite(p?.bottom)) return p;
  } catch {
    /* padrão */
  }
  return { right: 16, bottom: 16 };
}

/**
 * Mini player flutuante (como o PiP do Discord): aparece quando você sai da tela da call
 * enquanto assiste uma transmissão. Arraste pelo topo; clique para voltar à call.
 * No celular (mobile=true) fica preso no canto, com os botões sempre visíveis (não há "hover"):
 * acima do painel do usuário na lista de canais, ou abaixo do cabeçalho dentro de um chat.
 */
export default function StreamMiniPlayer({ visible, mobile = false, placement = 'nav' }) {
  const { user } = useAuth();
  const { screenStreams, watching, focusedStreamUserId, activeVoiceChannel, stopWatching, streamVolumes, setStreamVolume } = useVoice();
  const { currentServer, selectServer, selectChannel } = useServer();
  const voiceStates = useVoiceStates();
  const [pos, setPos] = useState(loadPosition);
  const dragRef = useRef(null);

  const candidates = Object.keys(screenStreams)
    .map(Number)
    .filter((uid) => uid !== user?.id && watching.has(uid));
  const userId = candidates.includes(focusedStreamUserId) ? focusedStreamUserId : candidates[0];
  const stream = userId ? screenStreams[userId] : null;
  const videoRef = useStreamVideo(visible ? stream : null);

  if (!visible || !stream || !activeVoiceChannel) return null;
  const presenter = voiceStates[userId];

  const goToCall = async () => {
    if (currentServer?.id !== activeVoiceChannel.server_id) await selectServer(activeVoiceChannel.server_id);
    selectChannel(activeVoiceChannel);
    showMobileContent();
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, start: pos };
  };
  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const parent = e.currentTarget.closest('[data-miniplayer-bounds]') || document.body;
    const maxRight = parent.clientWidth - WIDTH - 8;
    const maxBottom = parent.clientHeight - HEIGHT - 8;
    setPos({
      right: Math.min(maxRight, Math.max(8, drag.start.right - (e.clientX - drag.x))),
      bottom: Math.min(maxBottom, Math.max(8, drag.start.bottom - (e.clientY - drag.y)))
    });
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setPos((p) => {
      localStorage.setItem(POS_KEY, JSON.stringify(p));
      return p;
    });
  };

  return (
    <div
      className="absolute z-40 rounded-xl overflow-hidden bg-black shadow-2xl border border-well group anim-pop"
      style={
        mobile
          ? {
              width: 'min(280px, calc(100vw - 16px))',
              aspectRatio: '16 / 9',
              right: 8,
              ...(placement === 'nav' ? { bottom: 'calc(var(--user-area-h, 64px) + 16px)' } : { top: 56 })
            }
          : { width: WIDTH, height: HEIGHT, right: pos.right, bottom: pos.bottom }
      }
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onClick={goToCall}
        className="w-full h-full object-contain cursor-pointer"
        title="Voltar para a call"
      />
      <div
        onPointerDown={mobile ? undefined : onPointerDown}
        onPointerMove={mobile ? undefined : onPointerMove}
        onPointerUp={mobile ? undefined : onPointerUp}
        className={`absolute top-0 inset-x-0 h-9 px-2 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent transition ${
          mobile ? '' : 'opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing'
        }`}
      >
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white truncate">
          {!mobile && <GripHorizontal className="w-3.5 h-3.5 text-fg-2" />}
          <span className="w-1.5 h-1.5 rounded-full bg-danger" />
          {presenter?.username || 'Transmissão'}
        </span>
        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={goToCall} className={`${mobile ? 'p-2' : 'p-1'} rounded hover:bg-white/15 text-white`} title="Voltar para a call">
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          {document.pictureInPictureEnabled && (
            <button
              onClick={() => togglePictureInPicture(videoRef.current)}
              className="p-1 rounded hover:bg-white/15 text-white"
              title="Janela flutuante (fica por cima do jogo)"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => stopWatching(userId)} className={`${mobile ? 'p-2' : 'p-1'} rounded hover:bg-danger text-white`} title="Parar de assistir">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {/* Volume da transmissão sem precisar voltar para a call (no celular, o volume é o do aparelho) */}
      {!mobile && (
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-0 inset-x-0 h-9 px-2 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition"
      >
        <button
          onClick={() => setStreamVolume(userId, (streamVolumes[userId] ?? 100) === 0 ? 100 : 0)}
          className="p-1 rounded hover:bg-white/15 text-white shrink-0"
          title={(streamVolumes[userId] ?? 100) === 0 ? 'Ativar som' : 'Silenciar transmissão'}
        >
          {(streamVolumes[userId] ?? 100) === 0 ? <VolumeX className="w-3.5 h-3.5 text-danger" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
        <VolumeSlider value={streamVolumes[userId] ?? 100} onChange={(v) => setStreamVolume(userId, v)} label="Volume da transmissão" />
        <span className="text-[10px] text-white/80 w-8 text-right tabular-nums shrink-0">{streamVolumes[userId] ?? 100}%</span>
      </div>
      )}
    </div>
  );
}
