import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { showMobileContent } from '../services/mobile';
import { useDM } from '../context/DMContext';
import { useAuth } from '../context/AuthContext';
import Avatar from './Avatar';
import { Users, Plus, MessageSquare, Sparkles, X } from 'lucide-react';

export default function DMSidebar() {
  const { conversations, activeConversation, selectConversation, startOrOpenDM, unreadDMs } = useDM();
  const { user: currentUser } = useAuth();
  const [showNewDMModal, setShowNewDMModal] = useState(false);
  const [targetUsername, setTargetUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const getPresenceColor = (presence) => {
    switch (presence) {
      case 'idle':
        return 'bg-warn';
      case 'dnd':
        return 'bg-danger';
      case 'offline':
        return 'bg-fg-faint';
      default:
        return 'bg-ok';
    }
  };

  const handleStartDM = async (e) => {
    e?.preventDefault();
    if (!targetUsername.trim()) return;
    setError('');
    setLoading(true);
    try {
      await startOrOpenDM({ username: targetUsername.trim() });
      setTargetUsername('');
      setShowNewDMModal(false);
    } catch (err) {
      setError(err.message || 'Usuário não encontrado.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDM = async (username) => {
    setError('');
    setLoading(true);
    try {
      await startOrOpenDM({ username });
      setShowNewDMModal(false);
    } catch (err) {
      setError(err.message || 'Erro ao abrir DM.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="w-[var(--sidebar-w)] bg-side flex flex-col shrink-0 select-none border-r border-line z-10">
      <div className="flex flex-col flex-1 min-h-0">
        {/* Top Search Button */}
        <div className="h-12 border-b border-line px-2.5 flex items-center shrink-0">
          <button
            onClick={() => setShowNewDMModal(true)}
            className="w-full h-8 bg-well text-fg-muted hover:text-fg text-[13px] px-2.5 rounded-md flex items-center justify-center transition"
          >
            <span>Encontre ou comece uma conversa</span>
          </button>
        </div>

        {/* Tab Amigos / Início */}
        <div className="p-2 space-y-0.5">
          <button
            onClick={() => {
              selectConversation(null);
              showMobileContent();
            }}
            className={`w-full h-10 flex items-center gap-3 px-3 rounded-md text-[15px] font-medium transition ${
              !activeConversation
                ? 'bg-hover text-fg-strong'
                : 'text-fg-muted hover:bg-hover/50 hover:text-fg'
            }`}
          >
            <Users className="w-5 h-5 text-fg-muted" />
            <span>Amigos</span>
          </button>
        </div>

        {/* Header da lista de DMs com botão (+) */}
        <div className="px-4 pt-4 pb-1 flex items-center justify-between text-fg-muted hover:text-fg">
          <span className="text-[13px] font-semibold">
            Mensagens Diretas
          </span>
          <button
            onClick={() => setShowNewDMModal(true)}
            className="p-1 rounded hover:bg-hover text-fg-2 hover:text-fg-strong transition"
            title="Criar Mensagem Direta"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Lista de Conversas Diretas */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5 no-scrollbar pb-[calc(var(--user-area-h,64px)+16px)]">
          {conversations.length === 0 ? (
            <div className="text-center py-6 px-3 text-xs text-fg-muted">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 text-active" />
              <p>Nenhuma mensagem direta ainda.</p>
              <button
                onClick={() => setShowNewDMModal(true)}
                className="mt-2 text-accent hover:underline font-semibold"
              >
                Comece uma conversa!
              </button>
            </div>
          ) : (
            conversations.map((conv) => {
              const isActive = activeConversation?.id === conv.id;
              const friend = conv.recipient;

              return (
                <button
                  key={conv.id}
                  onClick={() => {
                    selectConversation(conv);
                    showMobileContent();
                  }}
                  className={`w-full flex items-center gap-3 px-2 py-2 rounded-md transition group text-left ${
                    isActive
                      ? 'bg-hover text-fg-strong'
                      : 'text-fg-muted hover:bg-hover/50 hover:text-fg'
                  }`}
                >
                  <div className="relative shrink-0">
                    <Avatar
                      user={friend}
                      alt={friend?.username}
                      className="w-8 h-8 rounded-full object-cover bg-well"
                    />
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-side ${getPresenceColor(
                        friend?.presence
                      )}`}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm truncate text-fg-strong ${unreadDMs[conv.id] ? 'font-bold' : 'font-medium'}`}>
                        {friend?.username}
                      </span>
                      {unreadDMs[conv.id] > 0 && (
                        <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center">
                          {unreadDMs[conv.id]}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-fg-muted truncate">
                      {conv.last_message?.content || friend?.custom_status || 'Clique para conversar'}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Modal de Iniciar Nova Conversa Direta */}
      {showNewDMModal && createPortal(
        <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="sheet w-full max-w-sm bg-chat p-5 text-fg-strong">
            <div className="flex items-center justify-between pb-3 border-b border-line-strong">
              <h3 className="text-base font-bold flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-accent" />
                Nova Mensagem Direta
              </h3>
              <button
                onClick={() => setShowNewDMModal(false)}
                className="text-fg-muted hover:text-fg-strong"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="my-3 p-2 rounded bg-danger/20 border border-danger/50 text-xs text-danger">
                {error}
              </div>
            )}

            <form onSubmit={handleStartDM} className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-semibold text-fg-2 mb-1.5">
                  Nome do Usuário
                </label>
                <input
                  type="text"
                  required
                  value={targetUsername}
                  onChange={(e) => setTargetUsername(e.target.value)}
                  placeholder="ex: CapivaraDev"
                  className="w-full bg-well text-sm px-3 py-2 rounded border border-side focus:border-accent outline-none text-fg-strong"
                />
              </div>

              {/* Atalho rápido com usuários de teste */}
              <div className="pt-2">
                <span className="text-xs font-semibold text-fg-muted block mb-1.5">
                  Contas de Teste Prontas:
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {currentUser?.username !== 'CapivaraDev' && (
                    <button
                      type="button"
                      onClick={() => handleQuickDM('CapivaraDev')}
                      className="flex items-center justify-center gap-1 bg-side hover:bg-hover p-2 rounded text-xs text-fg border border-well transition"
                    >
                      <Sparkles className="w-3 h-3 text-accent" />
                      CapivaraDev
                    </button>
                  )}
                  {currentUser?.username !== 'PixelGamer' && (
                    <button
                      type="button"
                      onClick={() => handleQuickDM('PixelGamer')}
                      className="flex items-center justify-center gap-1 bg-side hover:bg-hover p-2 rounded text-xs text-fg border border-well transition"
                    >
                      <Sparkles className="w-3 h-3 text-ok" />
                      PixelGamer
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-line-strong">
                <button
                  type="button"
                  onClick={() => setShowNewDMModal(false)}
                  className="text-xs text-fg-muted hover:underline px-3 py-1.5"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || !targetUsername.trim()}
                  className="sticker-btn bg-accent hover:bg-accent-hover text-xs font-semibold px-4 py-2 rounded text-on-accent transition disabled:opacity-50"
                >
                  {loading ? 'Abrindo...' : 'Conversar'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

    </aside>
  );
}
