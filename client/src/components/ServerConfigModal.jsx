import React, { useState, useEffect } from 'react';
import { DEFAULT_SERVER_URL, getServerUrl, setServerUrl, testServerConnection, cleanServerUrl } from '../services/api';
import { X, Globe, Radio, CheckCircle, AlertCircle, RefreshCw, Zap, Server, Sparkles } from 'lucide-react';

export default function ServerConfigModal({ isOpen, onClose }) {
  const [urlInput, setUrlInput] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok: bool, latency: number, error: string }

  useEffect(() => {
    if (isOpen) {
      const active = getServerUrl();
      setCurrentUrl(active);
      setUrlInput(active);
      setTestResult(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleTest = async (overrideUrl) => {
    const target = overrideUrl || urlInput;
    if (!target.trim()) return;

    setTesting(true);
    setTestResult(null);

    const res = await testServerConnection(target);
    setTesting(false);
    setTestResult(res);
  };

  const handleSave = async (newUrl) => {
    const target = cleanServerUrl(newUrl || urlInput);
    if (!target) return;
    // Só salva um endereço que responde como servidor do Resenha
    setTesting(true);
    const res = await testServerConnection(target);
    setTesting(false);
    setTestResult(res);
    if (!res.ok) return;

    setServerUrl(target);
    // Recarrega a página para reiniciar todos os sockets e contextos com a nova URL limpa
    window.location.reload();
  };

  const handleQuickSelect = (quickUrl) => {
    setUrlInput(quickUrl);
    handleTest(quickUrl);
  };

  return (
    <div className="anim-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none">
      <div className="sheet w-full max-w-lg bg-chat overflow-hidden text-fg-strong flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-panel flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-fg-strong flex items-center gap-2">
                Conexão do Servidor & Túnel
                <span className="text-[11px] font-bold bg-accent text-on-accent px-2 py-0.5 rounded-full uppercase tracking-wider">
                  F3
                </span>
              </h2>
              <p className="text-xs text-fg-muted">
                Conecte-se ao servidor do seu grupo ou a uma instância local
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-fg-2 hover:text-fg-strong hover:bg-hover transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* Status Atual */}
          <div className="p-3 rounded-xl bg-side border border-well flex items-center justify-between">
            <div className="min-w-0 pr-2">
              <span className="text-[13px] font-semibold text-fg-muted block">
                Servidor Atual em Uso
              </span>
              <span className="text-xs font-mono text-accent truncate block mt-0.5" title={currentUrl}>
                {currentUrl}
              </span>
            </div>
            <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-well border border-panel text-[11px] font-medium text-ok">
              <div className="w-2 h-2 rounded-full bg-ok animate-ping" />
              Ativo
            </div>
          </div>

          {/* Campo de Input */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-fg-2">
              URL do Servidor / Túnel
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-fg-muted">
                <Globe className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  setTestResult(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSave();
                  }
                }}
                placeholder="https://seu-dominio.com ou http://localhost:8000"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-well text-sm text-fg-strong font-mono placeholder-fg-faint border border-side focus:border-accent focus:ring-1 focus:ring-accent outline-none transition"
              />
            </div>
          </div>

          {/* Atalhos Rápidos */}
          <div className="space-y-2">
            <span className="text-[13px] font-semibold text-fg-muted block">
              Atalhos Rápidos:
            </span>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_SERVER_URL && (
                <button
                  type="button"
                  onClick={() => handleQuickSelect(DEFAULT_SERVER_URL)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-side hover:bg-hover text-xs text-fg border border-well transition"
                >
                  <Sparkles className="w-3.5 h-3.5 text-ok" />
                  Padrão ({DEFAULT_SERVER_URL.replace(/^https?:\/\//, '')})
                </button>
              )}
              <button
                type="button"
                onClick={() => handleQuickSelect('http://localhost:8000')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-side hover:bg-hover text-xs text-fg border border-well transition"
              >
                <Server className="w-3.5 h-3.5 text-accent" />
                Localhost (:8000)
              </button>
              <button
                type="button"
                onClick={() => handleQuickSelect('http://127.0.0.1:8000')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-side hover:bg-hover text-xs text-fg border border-well transition"
              >
                <Zap className="w-3.5 h-3.5 text-warn" />
                127.0.0.1
              </button>
            </div>
          </div>

          {/* Resultado do Teste de Conexão */}
          {testing && (
            <div className="p-3 rounded-lg bg-side flex items-center gap-2 text-xs text-fg">
              <RefreshCw className="w-4 h-4 text-accent animate-spin" />
              <span>Testando conexão com {urlInput}...</span>
            </div>
          )}

          {testResult && !testing && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                testResult.ok
                  ? 'bg-ok/10 border-ok/40 text-ok'
                  : 'bg-danger/10 border-danger/40 text-danger'
              }`}
            >
              {testResult.ok ? (
                <>
                  <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Conexão bem-sucedida! ({testResult.latency}ms)</div>
                    <div className="text-[11px] opacity-90 mt-0.5">
                      Backend Resenha respondendo normalmente. Pronto para conectar.
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Falha ao conectar ({testResult.latency}ms)</div>
                    <div className="text-[11px] opacity-90 mt-0.5">{testResult.error}</div>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="rounded-lg bg-well/60 p-3 border border-side/50 text-[11px] text-fg-muted leading-relaxed">
            💡 <strong className="text-fg-strong">Dica:</strong> peça o endereço a quem hospeda o servidor do
            seu grupo (ex.: <span className="text-link">https://seu-dominio.com</span>), cole aqui e salve.
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-side border-t border-panel flex items-center justify-between">
          <button
            type="button"
            onClick={() => handleTest()}
            disabled={testing || !urlInput.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-well hover:bg-hover text-xs font-semibold text-fg-strong border border-panel transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
            Testar Conexão
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-fg hover:underline"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={!urlInput.trim()}
              className="sticker-btn flex items-center gap-1.5 px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-xs font-semibold text-on-accent transition disabled:opacity-50"
            >
              Salvar e Conectar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
