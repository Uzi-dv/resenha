import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ServerProvider, useServer } from './context/ServerContext';
import { VoiceProvider } from './context/VoiceContext';
import { DMProvider, useDM } from './context/DMContext';

import ServerRail from './components/ServerRail';
import ChannelSidebar from './components/ChannelSidebar';
import ChatArea from './components/ChatArea';
import VoiceRoom from './components/VoiceRoom';
import MemberList from './components/MemberList';
import DMSidebar from './components/DMSidebar';
import DMChatArea from './components/DMChatArea';
import HomeWelcome from './components/HomeWelcome';
import AuthModal from './components/AuthModal';
import ProfileModal from './components/ProfileModal';
import CreateServerModal from './components/CreateServerModal';
import CreateChannelModal from './components/CreateChannelModal';
import InviteModal from './components/InviteModal';
import AcceptInviteModal from './components/AcceptInviteModal';
import ServerConfigModal from './components/ServerConfigModal';
import UserContextMenu from './components/UserContextMenu';
import ErrorBoundary from './components/ErrorBoundary';
import StreamMiniPlayer from './components/StreamMiniPlayer';
import UpdateBanner from './components/UpdateBanner';
import TitleBar from './components/TitleBar';
import UserArea from './components/UserArea';
import DialogHost from './components/DialogHost';
import { gateway } from './services/gateway';
import { needsServerSetup } from './services/api';
import { useStore } from './services/store';
import { useIsMobile, useMobilePane } from './services/mobile';
import { useInviteLinks } from './services/useInviteLinks';
import { WifiOff, RotateCw, Radio } from 'lucide-react';

function ConnectionBanner() {
  const { state, attempt } = useStore(gateway.status);
  if (state === 'connected' || state === 'disconnected') return null;
  return (
    <div className="absolute top-0 inset-x-0 z-40 flex justify-center pointer-events-none">
      <div className="mt-2 pointer-events-auto bg-warn text-black text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2">
        <WifiOff className="w-3.5 h-3.5" />
        {state === 'connecting' ? 'Conectando ao servidor...' : `Conexão perdida — reconectando${attempt > 1 ? ` (tentativa ${attempt})` : ''}...`}
        <button onClick={() => gateway.reconnectNow()} className="underline ml-1">
          Tentar agora
        </button>
      </div>
    </div>
  );
}

// Telas sem a barra de título (carregando, login): uma faixa invisível para arrastar a janela
const DragStrip = () => <div className="app-drag fixed top-0 left-0 right-[140px] h-8 z-[60]" />;

function BootError({ message, onRetry, onOpenServerConfig }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-well text-fg-strong p-6">
      <div className="max-w-sm text-center flex flex-col items-center gap-3">
        <WifiOff className="w-12 h-12 text-warn" />
        <h2 className="text-lg font-bold">Não foi possível conectar ao servidor</h2>
        <p className="text-sm text-fg-muted">{message}. Verifique se o servidor está ligado ou se o endereço mudou.</p>
        <div className="flex gap-2 mt-2">
          <button onClick={onRetry} className="bg-accent hover:bg-accent-hover px-4 py-2 rounded font-semibold text-sm flex items-center gap-2">
            <RotateCw className="w-4 h-4" /> Tentar novamente
          </button>
          <button onClick={onOpenServerConfig} className="bg-side hover:bg-hover px-4 py-2 rounded font-semibold text-sm flex items-center gap-2">
            <Radio className="w-4 h-4" /> Trocar servidor (F3)
          </button>
        </div>
      </div>
    </div>
  );
}

function MainLayout() {
  const { isAuthenticated, loading, bootError, retryBoot } = useAuth();
  const { currentServer, currentChannel } = useServer();
  const { activeConversation, setHomeVisible } = useDM();
  const viewKey = currentServer ? `s${currentServer.id}:${currentChannel?.id}` : activeConversation ? `dm${activeConversation.id}` : 'home';

  // DMs só contam como lidas quando a tela inicial está realmente visível
  React.useEffect(() => {
    setHomeVisible(!currentServer);
  }, [currentServer, setHomeVisible]);

  // Modals state
  // Instalação sem endereço padrão: pergunta o servidor logo na primeira abertura
  const [showServerConfig, setShowServerConfig] = useState(needsServerSetup);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [createServerMode, setCreateServerMode] = useState('create');
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelModalType, setChannelModalType] = useState('text');
  const [profileUserId, setProfileUserId] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // Convite aberto por link (resenha://, /?convite= ou cartão numa mensagem); espera o login se precisar
  const pendingInvite = useInviteLinks();
  const [showMemberList, setShowMemberList] = useState(true);
  const [showMembersMobile, setShowMembersMobile] = useState(false);
  // Celular: um painel por vez (lista de canais/DMs OU o conteúdo), ver services/mobile.js
  const isMobile = useIsMobile();
  const mobilePane = useMobilePane();
  const mobileContent = isMobile && mobilePane === 'content';
  const mobileNav = isMobile && mobilePane !== 'content';
  const inVoiceView = Boolean(currentServer && currentChannel?.type === 'voice');
  const [contextMenuUser, setContextMenuUser] = useState(null);
  const [contextMenuPos, setContextMenuPos] = useState(null);

  const handleOpenUserContextMenu = (e, user) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuUser(user);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleOpenCreateServer = (mode = 'create') => {
    setCreateServerMode(mode);
    setShowCreateServer(true);
  };

  // Global listener para F3 e evento customizado
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F3') {
        e.preventDefault();
        setShowServerConfig((prev) => !prev);
      }
    };
    const handleOpenModal = () => setShowServerConfig(true);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('open-server-config', handleOpenModal);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-server-config', handleOpenModal);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-frame text-fg-strong">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-fg-muted font-medium">Carregando Resenha...</span>
        </div>
        <ServerConfigModal isOpen={showServerConfig} onClose={() => setShowServerConfig(false)} />
        <DragStrip />
      </div>
    );
  }

  if (!isAuthenticated && bootError) {
    return (
      <>
        <DragStrip />
        <BootError message={bootError} onRetry={retryBoot} onOpenServerConfig={() => setShowServerConfig(true)} />
        <ServerConfigModal isOpen={showServerConfig} onClose={() => setShowServerConfig(false)} />
      </>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <DragStrip />
        {pendingInvite.code && (
          <div role="status" className="fixed top-3 inset-x-0 z-[70] flex justify-center pointer-events-none px-4">
            <p className="pointer-events-auto bg-accent text-on-accent text-sm font-semibold px-4 py-2 rounded-full shadow-lg">
              Entre ou crie sua conta para aceitar o convite.
            </p>
          </div>
        )}
        <AuthModal />
        <ServerConfigModal isOpen={showServerConfig} onClose={() => setShowServerConfig(false)} />
      </>
    );
  }

  return (
    <div className="flex flex-col h-dvh w-full overflow-hidden bg-frame text-fg [--rail-w:72px] [--sidebar-w:272px] max-md:[--sidebar-w:calc(100vw-var(--rail-w))]">
      <TitleBar />
      <div className="relative flex flex-1 min-h-0">
      <ConnectionBanner />
      <UpdateBanner />
      {/* 1. Barra de Servidores (Esquerda) */}
      <div className={mobileContent ? 'hidden' : 'contents'}>
        <ServerRail onOpenCreateServer={() => handleOpenCreateServer('create')} />
      </div>

      {/* Mini player no celular: fica fora do <main> para continuar na lista de canais */}
      {isMobile && (
        <StreamMiniPlayer mobile placement={mobileContent ? 'content' : 'nav'} visible={!(mobileContent && inVoiceView)} />
      )}

      {/* Área com o canto arredondado: barra lateral + conteúdo + membros */}
      <div
        className={`flex flex-1 min-w-0 overflow-hidden bg-chat ${
          mobileContent ? '' : 'rounded-tl-xl border-t border-l border-line'
        }`}
      >

      {/* 2. Barra Lateral (Canais do servidor OU Mensagens Diretas na Home) */}
      <div className={mobileContent ? 'hidden' : 'contents'}>
      {currentServer ? (
        <ChannelSidebar
          onOpenCreateChannel={(type = 'text') => {
            setChannelModalType(type);
            setShowCreateChannel(true);
          }}
          onOpenUserProfile={(userId) => {
            setProfileUserId(userId);
            setShowProfileModal(true);
          }}
          onUserContextMenu={handleOpenUserContextMenu}
          onOpenInvite={() => setShowInvite(true)}
        />
      ) : (
        <DMSidebar />
      )}
      </div>

      {/* 3. Área Central (Servidor: Chat/Voz OU Home: DMChatArea/HomeWelcome) */}
      <main className={`flex-1 flex flex-col min-w-0 relative ${mobileNav ? 'hidden' : ''}`} data-miniplayer-bounds>
        {!isMobile && <StreamMiniPlayer visible={!inVoiceView} />}
        {/* Fade curto ao trocar de canal, DM ou tela */}
        <div key={viewKey} className="anim-fade flex-1 flex flex-col min-h-0">
        {currentServer ? (
          currentChannel?.type === 'voice' ? (
            <VoiceRoom
              onOpenUserProfile={(userId) => {
                setProfileUserId(userId);
                setShowProfileModal(true);
              }}
              onUserContextMenu={handleOpenUserContextMenu}
            />
          ) : (
            <ChatArea
              showMemberList={isMobile ? showMembersMobile : showMemberList}
              onToggleMemberList={() => (isMobile ? setShowMembersMobile((v) => !v) : setShowMemberList(!showMemberList))}
              onOpenUserProfile={(userId) => {
                setProfileUserId(userId);
                setShowProfileModal(true);
              }}
              onUserContextMenu={handleOpenUserContextMenu}
            />
          )
        ) : activeConversation ? (
          <DMChatArea
            onOpenUserProfile={(userId) => {
              setProfileUserId(userId);
              setShowProfileModal(true);
            }}
            onUserContextMenu={handleOpenUserContextMenu}
          />
        ) : (
          <HomeWelcome
            onOpenCreateServer={() => handleOpenCreateServer('create')}
            onOpenJoinServer={() => handleOpenCreateServer('join')}
          />
        )}
        </div>
      </main>

      {/* 4. Lista de Membros do Servidor (Direita - Apenas em canais de texto dentro de servidor) */}
      {!isMobile && currentServer && currentChannel?.type !== 'voice' && showMemberList && (
        <MemberList
          onOpenUserProfile={(userId) => {
            setProfileUserId(userId);
            setShowProfileModal(true);
          }}
          onUserContextMenu={handleOpenUserContextMenu}
        />
      )}
      {/* Celular: a lista de membros abre por cima do chat */}
      {mobileContent && currentServer && currentChannel?.type !== 'voice' && showMembersMobile && (
        <div className="anim-backdrop fixed inset-0 z-40 bg-black/60 flex justify-end" onClick={() => setShowMembersMobile(false)}>
          <div className="h-full flex" onClick={(e) => e.stopPropagation()}>
            <MemberList
              onOpenUserProfile={(userId) => {
                setShowMembersMobile(false);
                setProfileUserId(userId);
                setShowProfileModal(true);
              }}
              onUserContextMenu={handleOpenUserContextMenu}
            />
          </div>
        </div>
      )}

      </div>

      {!mobileContent && (
        <UserArea
          onOpenProfile={() => {
            setProfileUserId(null);
            setShowProfileModal(true);
          }}
        />
      )}
      </div>

      {/* Modais */}
      {showCreateServer && (
        <CreateServerModal
          initialMode={createServerMode}
          onClose={() => setShowCreateServer(false)}
        />
      )}

      {showCreateChannel && (
        <CreateChannelModal
          initialType={channelModalType}
          onClose={() => setShowCreateChannel(false)}
        />
      )}

      {showProfileModal && (
        <ProfileModal
          targetUserId={profileUserId}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {/* Menu de Contexto do Usuário (Botão Direito) */}
      {contextMenuUser && contextMenuPos && (
        <UserContextMenu
          user={contextMenuUser}
          position={contextMenuPos}
          onClose={() => {
            setContextMenuUser(null);
            setContextMenuPos(null);
          }}
          onOpenProfile={(userId) => {
            setProfileUserId(userId);
            setShowProfileModal(true);
          }}
        />
      )}

      {showInvite && currentServer && <InviteModal server={currentServer} onClose={() => setShowInvite(false)} />}

      {pendingInvite.code && <AcceptInviteModal key={pendingInvite.code} code={pendingInvite.code} onClose={pendingInvite.dismiss} />}

      {/* Modal de Conexão com Servidor / Túnel (F3) */}
      <ServerConfigModal
        isOpen={showServerConfig}
        onClose={() => setShowServerConfig(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DMProvider>
          <VoiceProvider>
            <ServerProvider>
              <MainLayout />
              <DialogHost />
            </ServerProvider>
          </VoiceProvider>
        </DMProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
