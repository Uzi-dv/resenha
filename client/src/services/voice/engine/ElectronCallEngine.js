import { BrowserCallEngine } from './BrowserCallEngine';

/**
 * Transporte do app Electron.
 *
 * Por enquanto o Electron ainda traz a pilha WebRTC do Chromium, então herda o transporte do
 * navegador. Quando a pilha própria (nativa, pelo processo principal) entrar, esta classe passa
 * a estender CallEngine direto e implementar o contrato do transporte descrito lá
 * (_openTransport, _publish, _subscribe, ...), entregando MediaStreamTracks no evento 'track'.
 */
export class ElectronCallEngine extends BrowserCallEngine {}
