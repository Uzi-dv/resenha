import React, { useRef, useState } from 'react';
import { BarChart3, Plus, Trash2, X } from 'lucide-react';

const MAX_OPTIONS = 10;

export default function CreatePollModal({ onClose, onCreate }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const optionRefs = useRef([]);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit = question.trim() && filled.length >= 2 && !saving;

  const setOption = (i, value) => {
    setOptions((prev) => {
      const next = prev.map((o, idx) => (idx === i ? value : o));
      // Abre um campo novo automaticamente ao preencher o último
      if (i === next.length - 1 && value && next.length < MAX_OPTIONS) next.push('');
      return next;
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(question.trim(), filled, multiple);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onPointerDown={onClose}>
      <form
        onSubmit={submit}
        onPointerDown={(e) => e.stopPropagation()}
        className="sheet w-full max-w-md bg-chat text-fg-strong flex flex-col max-h-[90dvh]"
      >
        <div className="px-5 py-4 border-b border-panel flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-accent" /> Criar enquete
          </h3>
          <button type="button" onClick={onClose} className="text-fg-muted hover:text-fg-strong">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-fg-2 uppercase">Pergunta</label>
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={300}
              placeholder="Qual jogo hoje à noite?"
              className="w-full bg-well rounded-lg px-3 py-2.5 text-sm outline-none border border-well focus:border-accent"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-fg-2 uppercase">Opções</label>
            {options.map((option, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  ref={(el) => (optionRefs.current[i] = el)}
                  value={option}
                  onChange={(e) => setOption(i, e.target.value)}
                  onKeyDown={(e) => {
                    // Enter pula para a próxima opção em vez de enviar o formulário
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      optionRefs.current[i + 1]?.focus();
                    }
                  }}
                  maxLength={100}
                  placeholder={`Opção ${i + 1}`}
                  className="flex-1 bg-well rounded-lg px-3 py-2 text-sm outline-none border border-well focus:border-accent"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setOptions((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-fg-muted hover:text-danger p-1"
                    title="Remover opção"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {options.length < MAX_OPTIONS && options[options.length - 1] !== '' && (
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, ''])}
                className="text-xs text-accent-soft hover:underline flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar opção
              </button>
            )}
          </div>

          <label className="flex items-center justify-between gap-3 cursor-pointer bg-side rounded-lg px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Permitir várias respostas</div>
              <div className="text-[11px] text-fg-muted">Cada pessoa pode marcar mais de uma opção.</div>
            </div>
            <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="accent-accent w-4 h-4" />
          </label>

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <div className="px-5 py-3 bg-side border-t border-panel flex justify-end gap-2 rounded-b-xl">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm hover:underline">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 text-sm font-semibold"
          >
            {saving ? 'Criando...' : 'Criar enquete'}
          </button>
        </div>
      </form>
    </div>
  );
}
