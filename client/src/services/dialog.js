import { createStore } from './store';

/**
 * Diálogos do próprio app no lugar de window.confirm/alert. Os nativos do Electron
 * roubam o foco da janela: depois deles, os campos de texto paravam de mostrar o cursor.
 * Renderizados por <DialogHost /> (src/components/DialogHost.jsx).
 */
export const dialogStore = createStore(null);

function open(options) {
  return new Promise((resolve) => {
    dialogStore.getState()?.resolve(false); // só um por vez: o anterior conta como cancelado
    dialogStore.setState({ ...options, resolve });
  });
}

/** Resolve true se a pessoa confirmar. */
export function confirmDialog({ title = 'Tem certeza?', message, confirmLabel = 'Confirmar', danger = false }) {
  return open({ kind: 'confirm', title, message, confirmLabel, danger });
}

export function alertDialog(message, title = 'Algo deu errado') {
  return open({ kind: 'alert', title, message, confirmLabel: 'Ok' });
}

export function closeDialog(result) {
  const current = dialogStore.getState();
  if (!current) return;
  dialogStore.setState(null);
  current.resolve(result);
}
