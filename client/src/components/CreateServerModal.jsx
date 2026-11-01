import React, { useState } from 'react';
import { useServer } from '../context/ServerContext';
import { X, Plus, LogIn } from 'lucide-react';

export default function CreateServerModal({ initialMode = 'create', onClose }) {
  const { createServer, joinServer } = useServer();
  const [mode, setMode] = useState(initialMode); // 'create' | 'join'
  const [name, setName] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'create') {
        if (!name.trim()) throw new Error('O nome do servidor é obrigatório.');
        await createServer(name.trim(), iconUrl.trim());
      } else {
        if (!inviteCode.trim()) throw new Error('Cole o link ou o código do convite.');
        await joinServer(inviteCode.trim());
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao processar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
      <div className="sheet w-full max-w-md bg-chat p-6 text-fg-strong relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-fg-muted hover:text-fg-strong transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <h3 className="text-2xl font-bold text-fg-strong">
            {mode === 'create' ? 'Crie seu servidor' : 'Entre em um servidor'}
          </h3>
          <p className="text-sm text-fg-muted mt-1">
            {mode === 'create'
              ? 'Seu servidor é onde você e seus amigos se reúnem para conversar por texto, voz e compartilhar tela.'
              : 'Cole o link de convite que te mandaram para entrar num servidor.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded bg-danger/20 border border-danger/50 p-2.5 text-xs text-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'create' ? (
            <>
              <div>
                <label className="block text-sm font-semibold text-fg-2 mb-2">
                  Nome do Servidor <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex: QG dos Amigos"
                  className="w-full rounded bg-well px-3 py-2 text-sm text-fg-strong placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-fg-2 mb-2">
                  URL do Ícone (Opcional)
                </label>
                <input
                  type="text"
                  value={iconUrl}
                  onChange={(e) => setIconUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded bg-well px-3 py-2 text-sm text-fg-strong placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-semibold text-fg-2 mb-2">
                Link ou código do convite <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="ex: seu-dominio.com/convite/aB3dE9xZ"
                className="w-full rounded bg-well px-3 py-2 text-sm text-fg-strong placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="text-[11px] text-fg-muted mt-1">
                Os links se parecem com <code>seu-dominio.com/convite/aB3dE9xZ</code>. Os códigos antigos também funcionam.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-line-strong">
            <button
              type="button"
              onClick={() => {
                setError('');
                setMode(mode === 'create' ? 'join' : 'create');
              }}
              className="text-xs text-link hover:underline font-medium"
            >
              {mode === 'create' ? 'Já tem um convite? Entre aqui' : 'Quer criar seu próprio servidor?'}
            </button>

            <button
              type="submit"
              disabled={loading}
              className="sticker-btn rounded bg-accent px-5 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover transition disabled:opacity-50"
            >
              {loading ? 'Carregando...' : mode === 'create' ? 'Criar' : 'Entrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
