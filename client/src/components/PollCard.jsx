import React, { useState } from 'react';
import { BarChart3, Check, Lock } from 'lucide-react';

/** Enquete dentro do chat: clique para votar; resultado atualiza em tempo real para todos. */
export default function PollCard({ poll, currentUserId, canClose, onVote, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const myVotes = poll.options.filter((o) => o.voters.includes(currentUserId)).map((o) => o.id);
  const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
  const leader = Math.max(0, ...poll.options.map((o) => o.votes));

  const toggle = async (optionId) => {
    if (poll.closed || busy) return;
    let next;
    if (poll.multiple) {
      next = myVotes.includes(optionId) ? myVotes.filter((id) => id !== optionId) : [...myVotes, optionId];
    } else {
      next = myVotes.includes(optionId) ? [] : [optionId];
    }
    setBusy(true);
    setError(null);
    try {
      await onVote(poll.id, next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-sm mt-2 mb-1 max-w-md bg-side p-3.5 select-none">
      <div className="flex items-start gap-2 mb-2.5">
        <BarChart3 className="w-4 h-4 text-accent mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-base leading-snug font-extrabold tracking-tight text-fg-strong break-words">{poll.question}</p>
          <p className="text-[11px] text-fg-muted">
            {poll.closed ? 'Enquete encerrada' : poll.multiple ? 'Escolha uma ou mais opções' : 'Escolha uma opção'}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {poll.options.map((option) => {
          const pct = totalVotes ? Math.round((option.votes / totalVotes) * 100) : 0;
          const mine = myVotes.includes(option.id);
          const winning = poll.closed && option.votes > 0 && option.votes === leader;
          return (
            <button
              key={option.id}
              onClick={() => toggle(option.id)}
              disabled={poll.closed || busy}
              className={`relative w-full overflow-hidden rounded-lg border text-left px-3 py-2 transition ${
                mine ? 'border-accent' : 'border-line-strong hover:border-accent/60'
              } ${poll.closed ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <div
                className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${
                  winning ? 'bg-ok/30' : mine ? 'bg-accent/35' : 'bg-active/40'
                }`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 min-w-0 text-fg">
                  <span
                    className={`w-4 h-4 shrink-0 ${poll.multiple ? 'rounded' : 'rounded-full'} border flex items-center justify-center ${
                      mine ? 'bg-accent border-accent' : 'border-fg-faint'
                    }`}
                  >
                    {mine && <Check className="w-3 h-3 text-on-accent" />}
                  </span>
                  <span className="truncate">{option.text}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-fg-2">
                  {pct}% <span className="font-normal text-fg-muted">({option.votes})</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-fg-muted">
        <span>
          {poll.total_voters} {poll.total_voters === 1 ? 'pessoa votou' : 'pessoas votaram'}
        </span>
        {canClose && !poll.closed && (
          <button onClick={() => onClose(poll.id)} className="flex items-center gap-1 hover:text-fg-strong">
            <Lock className="w-3 h-3" /> Encerrar enquete
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
