import { useRef, useState } from 'react';
import { alertDialog } from './dialog';

/** Rola até uma mensagem já carregada e a destaca por um instante (usado ao clicar numa resposta). */
export function useJumpToMessage(scrollRef) {
  const [flashId, setFlashId] = useState(null);
  const timer = useRef(null);

  const jumpTo = (id) => {
    const el = scrollRef.current?.querySelector(`[data-message-id="${id}"]`);
    if (!el) {
      alertDialog('Essa mensagem é antiga e não está carregada. Role o chat para cima para encontrá-la.', 'Mensagem não carregada');
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlashId(null), 1600);
  };
  return { flashId, jumpTo };
}
