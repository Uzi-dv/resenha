import React, { useEffect, useState } from 'react';
import { confirmDialog } from '../services/dialog';
import { Download, RefreshCw, X, Loader2, CheckCircle2, WifiOff } from 'lucide-react';
import { useVoice } from '../context/VoiceContext';

// Resultados de uma verificação pedida (Ctrl+R) que somem sozinhos
const AUTO_HIDE_MS = { 'up-to-date': 3500, 'check-error': 5000, unavailable: 3500 };

/**
 * Aviso de atualização (como o do Discord): a versão nova é baixada em segundo plano
 * e o usuário escolhe quando reiniciar. Se não reiniciar, instala ao fechar o app.
 * Ctrl+R (ou "Procurar atualizações" no menu) procura na hora e mostra o resultado.
 */
export default function UpdateBanner() {
  const { activeVoiceChannel } = useVoice();
  const [update, setUpdate] = useState({ state: 'idle' });
  const [dismissed, setDismissed] = useState(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onUpdateStatus) return undefined;
    api.getUpdateState?.().then((s) => s && setUpdate(s)).catch(() => {});
    return api.onUpdateStatus(setUpdate);
  }, []);

  const key = `${update.state}:${update.version}`;

  useEffect(() => {
    const ms = AUTO_HIDE_MS[update.state];
    if (!ms) return undefined;
    const timer = setTimeout(() => setDismissed(key), ms);
    return () => clearTimeout(timer);
  }, [update, key]);

  if (dismissed === key) return null;

  const restart = async () => {
    if (
      activeVoiceChannel &&
      !(await confirmDialog({
        title: 'Reiniciar agora?',
        message: 'Você está numa call. Reiniciar para atualizar desconecta por alguns segundos.',
        confirmLabel: 'Reiniciar'
      }))
    ) {
      return;
    }
    window.electronAPI.installUpdate();
  };

  const pill = 'sheet-sm flex items-center gap-2 bg-float text-fg text-xs font-semibold px-3 py-1.5 rounded-full';
  let content = null;
  if (update.state === 'checking') {
    content = (
      <div className={pill} role="status">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-fg-muted" />
        Procurando atualizações…
      </div>
    );
  } else if (update.state === 'up-to-date') {
    content = (
      <div className={pill} role="status">
        <CheckCircle2 className="w-3.5 h-3.5 text-ok" />
        Você está na versão mais recente ({update.version})
      </div>
    );
  } else if (update.state === 'unavailable') {
    content = (
      <div className={pill} role="status">
        <CheckCircle2 className="w-3.5 h-3.5 text-fg-muted" />
        Versão {update.version} (de desenvolvimento: sem atualização automática)
      </div>
    );
  } else if (update.state === 'check-error') {
    content = (
      <div className={pill} role="status">
        <WifiOff className="w-3.5 h-3.5 text-danger" />
        Não foi possível procurar atualizações agora. Confira a internet e tente de novo (Ctrl+R).
      </div>
    );
  } else if (update.state === 'downloading') {
    content = (
      <div className="flex items-center gap-2 bg-side border border-line-strong text-fg text-xs font-medium px-3 py-1.5 rounded-full shadow-lg">
        <Download className="w-3.5 h-3.5 text-ok" />
        Baixando a versão {update.version}… {update.percent ? `${update.percent}%` : ''}
      </div>
    );
  } else if (update.state === 'ready') {
    content = (
      <div className="flex items-center gap-3 bg-ok text-white text-xs font-semibold pl-3 pr-1.5 py-1.5 rounded-full shadow-lg">
        <RefreshCw className="w-3.5 h-3.5" />
        Resenha {update.version} está pronto
        <button onClick={restart} className="bg-white text-ok-hover hover:bg-[#e8f5ed] px-3 py-1 rounded-full font-bold">
          Reiniciar agora
        </button>
        <button onClick={() => setDismissed(key)} className="p-1 rounded-full hover:bg-black/15" title="Depois (instala ao fechar o app)">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  } else if (update.state === 'available-portable') {
    content = (
      <div className="flex items-center gap-3 bg-accent text-on-accent text-xs font-semibold pl-3 pr-1.5 py-1.5 rounded-full shadow-lg">
        <Download className="w-3.5 h-3.5" />
        Versão {update.version} disponível
        <a href={update.url} target="_blank" rel="noreferrer" className="bg-white text-accent-hover hover:bg-[#eef0ff] px-3 py-1 rounded-full font-bold">
          Baixar
        </a>
        <button onClick={() => setDismissed(key)} className="p-1 rounded-full hover:bg-black/15" title="Fechar">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (!content) return null;
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 anim-drop">
      {content}
    </div>
  );
}
