/**
 * Layout de celular (tela estreita): um painel por vez, como o Discord no celular.
 * - 'nav': servidores + canais (ou DMs) ocupando a tela;
 * - 'content': o chat, a call ou a DM em tela cheia, com um botão de voltar.
 * O "voltar" do celular (gesto ou botão do Android) também volta para a lista.
 */
import { useSyncExternalStore } from 'react';
import { createStore, useStore } from './store';

const QUERY = '(max-width: 767px)';
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null;

export const isMobileScreen = () => Boolean(media?.matches);

export function useIsMobile() {
  return useSyncExternalStore(
    (onChange) => {
      media?.addEventListener('change', onChange);
      return () => media?.removeEventListener('change', onChange);
    },
    isMobileScreen
  );
}

const paneStore = createStore('nav');

export const useMobilePane = () => useStore(paneStore);

/** Abre o conteúdo (canal, call, DM). No computador não faz nada. */
export function showMobileContent() {
  if (!isMobileScreen() || paneStore.getState() === 'content') return;
  paneStore.setState('content');
  // Uma entrada no histórico para o "voltar" do celular fechar o conteúdo em vez de sair do site
  window.history.pushState({ ...window.history.state, resenhaPane: 'content' }, '');
}

/** Volta para a lista de canais/conversas. */
export function showMobileNav() {
  if (paneStore.getState() === 'nav') return;
  if (window.history.state?.resenhaPane === 'content') window.history.back(); // o popstate muda o painel
  else paneStore.setState('nav');
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    paneStore.setState(e.state?.resenhaPane === 'content' ? 'content' : 'nav');
  });
}
