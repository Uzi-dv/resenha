import React, { useState } from 'react';
import { useServer } from '../context/ServerContext';
import { X, Hash, Volume2 } from 'lucide-react';

export default function CreateChannelModal({ initialType = 'text', onClose }) {
  const { createChannel } = useServer();
  const [type, setType] = useState(initialType);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('O nome do canal é obrigatório.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await createChannel(name.trim(), type);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao criar canal.');
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

        <h3 className="text-xl font-bold text-fg-strong mb-4">Criar Canal</h3>

        {error && (
          <div className="mb-4 rounded bg-danger/20 border border-danger/50 p-2.5 text-xs text-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Seleção do Tipo de Canal */}
          <div>
            <label className="block text-sm font-semibold text-fg-2 mb-2">
              Tipo de Canal
            </label>
            <div className="space-y-2">
              {/* Opção Texto */}
              <label
                onClick={() => setType('text')}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                  type === 'text'
                    ? 'bg-side border-accent'
                    : 'bg-side/50 border-transparent hover:bg-side'
                }`}
              >
                <Hash className="w-6 h-6 text-fg-muted" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-fg-strong">Texto</div>
                  <div className="text-xs text-fg-muted">
                    Poste mensagens, imagens e conversas em tempo real
                  </div>
                </div>
                <input
                  type="radio"
                  name="channel_type"
                  checked={type === 'text'}
                  onChange={() => setType('text')}
                  className="accent-accent w-4 h-4"
                />
              </label>

              {/* Opção Voz */}
              <label
                onClick={() => setType('voice')}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                  type === 'voice'
                    ? 'bg-side border-accent'
                    : 'bg-side/50 border-transparent hover:bg-side'
                }`}
              >
                <Volume2 className="w-6 h-6 text-fg-muted" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-fg-strong">Voz</div>
                  <div className="text-xs text-fg-muted">
                    Converse por voz com baixa latência e compartilhe tela
                  </div>
                </div>
                <input
                  type="radio"
                  name="channel_type"
                  checked={type === 'voice'}
                  onChange={() => setType('voice')}
                  className="accent-accent w-4 h-4"
                />
              </label>
            </div>
          </div>

          {/* Nome do Canal */}
          <div>
            <label className="block text-sm font-semibold text-fg-2 mb-2">
              Nome do Canal <span className="text-danger">*</span>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-fg-muted">
                {type === 'text' ? '#' : <Volume2 className="w-4 h-4" />}
              </span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === 'text' ? 'novo-canal' : 'Sala de Voz'}
                className="w-full rounded bg-well pl-8 pr-3 py-2 text-sm text-fg-strong placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {/* Botões */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-line-strong">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-fg-strong hover:underline px-3 py-2 font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="sticker-btn rounded bg-accent px-5 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover transition disabled:opacity-50"
            >
              {loading ? 'Criando...' : 'Criar Canal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
