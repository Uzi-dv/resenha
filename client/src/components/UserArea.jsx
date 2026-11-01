import React, { useLayoutEffect, useRef } from 'react';
import UserControlBar from './UserControlBar';
import VoiceConnectionBar from './VoiceConnectionBar';

/**
 * Painel flutuante no canto inferior esquerdo (como no Discord): cobre o trilho de servidores
 * e a barra lateral, então o nome do usuário tem espaço de sobra.
 * Publica a própria altura em --user-area-h para as listas acima reservarem espaço.
 */
export default function UserArea({ onOpenProfile }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--user-area-h', `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="sheet-sm absolute left-2 bottom-2 z-30 w-[calc(var(--rail-w)+var(--sidebar-w)-20px)] bg-panel"
    >
      <VoiceConnectionBar />
      <UserControlBar onOpenProfile={onOpenProfile} />
    </div>
  );
}
