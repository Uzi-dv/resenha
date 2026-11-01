import { useCallback, useEffect, useState } from 'react';
import { CODE_RE, OPEN_INVITE_EVENT } from './invites';

const PENDING_KEY = 'resenha_pending_invite';

function readPending() {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function writePending(code) {
  try {
    if (code) sessionStorage.setItem(PENDING_KEY, code);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* sem storage: o convite só vale até fechar a tela */
  }
}

/**
 * Convite a abrir no modal "Você foi convidado". Chega por:
 * - resenha://convite/<código> (app desktop aberto pelo navegador, via IPC);
 * - /?convite=<código> (versão web, vinda da página do convite);
 * - clique num cartão/link de convite dentro do app (evento OPEN_INVITE_EVENT).
 * Fica guardado na sessão até a pessoa entrar na conta.
 */
export function useInviteLinks() {
  const [code, setCode] = useState(readPending);

  useEffect(() => {
    const take = (value) => {
      if (!CODE_RE.test(value || '')) return;
      writePending(value);
      setCode(value);
    };

    const params = new URLSearchParams(window.location.search);
    if (params.has('convite')) {
      take(params.get('convite'));
      params.delete('convite');
      const rest = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    }

    const cleanups = [];
    const electron = window.electronAPI;
    if (electron?.onDeepLink) {
      // Escuta antes de pedir o pendente: depois do pedido, o processo principal manda os próximos direto
      cleanups.push(electron.onDeepLink((link) => link?.type === 'invite' && take(link.code)));
      electron.getPendingDeepLink?.().then((link) => link?.type === 'invite' && take(link.code)).catch(() => {});
    }
    const onOpen = (e) => take(e.detail);
    window.addEventListener(OPEN_INVITE_EVENT, onOpen);
    cleanups.push(() => window.removeEventListener(OPEN_INVITE_EVENT, onOpen));
    return () => cleanups.forEach((fn) => fn?.());
  }, []);

  const dismiss = useCallback(() => {
    writePending(null);
    setCode(null);
  }, []);

  return { code, dismiss };
}
