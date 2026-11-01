import React, { useState } from 'react';
import { useDM } from '../context/DMContext';
import { useAuth } from '../context/AuthContext';
import { useServer } from '../context/ServerContext';
import { Plus, Link2, Send } from 'lucide-react';
import ResenhaLogo from './ResenhaLogo';
import MobileBackButton from './MobileBackButton';

/** Tela inicial (Amigos sem conversa aberta): saudação, criar/entrar em servidor e abrir uma DM. */
export default function HomeWelcome({ onOpenCreateServer, onOpenJoinServer }) {
  const { startOrOpenDM } = useDM();
  const { user: currentUser } = useAuth();
  const { servers } = useServer();
  const [targetUsername, setTargetUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStartDM = async (e) => {
    e?.preventDefault();
    if (!targetUsername.trim()) return;
    setError('');
    setLoading(true);
    try {
      await startOrOpenDM({ username: targetUsername.trim() });
      setTargetUsername('');
    } catch (err) {
      setError(err.message || 'Usuário não encontrado.');
    } finally {
      setLoading(false);
    }
  };

  const noServers = servers.length === 0;

  return (
    <div className="flex-1 bg-chat flex flex-col h-full overflow-y-auto overflow-x-hidden select-none p-4 md:p-10">
      <div className="md:hidden -mt-1 -mb-4">
        <MobileBackButton />
      </div>
      <div className="max-w-3xl w-full pt-6 md:pt-10">
        <header className="relative pr-0 sm:pr-48">
          <h1 className="text-[clamp(2.5rem,1.6rem+3vw,4rem)] leading-[0.95] font-extrabold tracking-tight text-fg-strong">
            Oi, {currentUser?.username || 'pessoa'}.
          </h1>
          <p className="mt-4 text-base text-fg-2 max-w-[46ch]">
            {noServers
              ? 'Você ainda não está em nenhum servidor. Crie um para a sua turma ou entre com o link de convite de alguém.'
              : 'Escolha um servidor na barra à esquerda, continue uma conversa ou chame mais alguém.'}
          </p>
          {/* O logo como um adesivo colado no canto: o único elemento "barulhento" da tela */}
          <div className="hidden sm:block absolute right-0 -top-4 w-40 rotate-[8deg] pointer-events-none" aria-hidden="true">
            <ResenhaLogo className="w-full h-auto drop-shadow-[8px_10px_0_var(--c-ink)]" />
          </div>
        </header>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            onClick={() => onOpenCreateServer?.()}
            className="sticker-btn flex items-center gap-2 bg-accent hover:bg-accent-hover text-on-accent text-sm font-bold px-5 py-3 rounded-xl"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} /> Criar um servidor
          </button>
          <button
            onClick={() => onOpenJoinServer?.()}
            className="flex items-center gap-2 border-[2.5px] border-line-strong hover:border-fg-muted text-fg-strong text-sm font-bold px-5 py-3 rounded-xl transition-colors"
          >
            <Link2 className="w-4 h-4" strokeWidth={2.5} /> Entrar com um convite
          </button>
        </div>

        <section className="mt-14 max-w-xl" aria-labelledby="home-dm">
          <h2 id="home-dm" className="text-xl font-extrabold tracking-tight text-fg-strong">
            Conversar com alguém
          </h2>
          <p className="mt-1 text-sm text-fg-muted">Digite o nome de usuário para abrir uma conversa particular.</p>

          {error && (
            <div className="mt-3 p-2.5 rounded-lg bg-danger/20 border border-danger/50 text-xs text-danger">{error}</div>
          )}

          <form onSubmit={handleStartDM} className="mt-4 flex gap-2">
            <input
              type="text"
              value={targetUsername}
              onChange={(e) => setTargetUsername(e.target.value)}
              placeholder="Nome de usuário"
              aria-label="Nome de usuário"
              className="flex-1 min-w-0 bg-well text-sm px-4 py-3 rounded-xl text-fg-strong placeholder-fg-faint outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={loading || !targetUsername.trim()}
              className="sticker-btn flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-on-accent font-bold text-sm px-5 py-3 rounded-xl disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {loading ? 'Abrindo...' : 'Conversar'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
