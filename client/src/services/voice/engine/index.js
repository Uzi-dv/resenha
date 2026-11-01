import { BrowserCallEngine } from './BrowserCallEngine';
import { ElectronCallEngine } from './ElectronCallEngine';

export { CallEngine } from './CallEngine';
export { BrowserCallEngine, ElectronCallEngine };

/** Engine certo para onde o app está rodando: app Electron ou navegador. */
export function createCallEngine(options) {
  return window.electronAPI?.isElectron ? new ElectronCallEngine(options) : new BrowserCallEngine(options);
}
