import { useRef } from 'react';

const EMPTY = Symbol('canal vazio');
const NONE = new Set();

/**
 * IDs das mensagens que chegaram com o canal já aberto, para animar só essas.
 * Carga inicial e histórico antigo (inserido no topo) não animam. Uma mensagem própria
 * que troca o id provisório pelo definitivo também não repete a animação.
 * `loaded`: a primeira página já chegou (distingue "canal vazio" de "ainda carregando").
 *
 * O ref é lido durante o render de propósito: é só memória entre renders da mesma lista
 * e não precisa disparar renderização.
 */
export function useNewMessageIds(messages, channelKey, loaded = true) {
  const ref = useRef({ key: undefined, lastId: null, fresh: new Set() });
  if (ref.current.key !== channelKey) {
    ref.current = { key: channelKey, lastId: null, fresh: new Set() };
  }
  const s = ref.current;

  if (messages.length === 0) {
    if (loaded && s.lastId == null) s.lastId = EMPTY;
    return s.fresh.size ? s.fresh : NONE;
  }

  const last = messages[messages.length - 1].id;
  if (last !== s.lastId) {
    const idx = s.lastId === EMPTY ? -1 : s.lastId == null ? null : messages.findIndex((m) => m.id === s.lastId);
    // idx -1 com canal antes vazio: tudo é novo; não encontrado em outro caso: id trocado, não anima
    const known = s.lastId === EMPTY || (idx != null && idx !== -1);
    if (known && messages.length - 1 - idx <= 5) {
      for (const m of messages.slice(idx + 1)) s.fresh.add(m.id);
    }
    s.lastId = last;
  }
  return s.fresh;
}
