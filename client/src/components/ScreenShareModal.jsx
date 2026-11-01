import React, { useState, useEffect } from 'react';
import { X, Tv, Gamepad2, Volume2, CheckCircle2, Sparkles, Monitor, Repeat } from 'lucide-react';

// Últimas escolhas (resolução, FPS, áudio, aba e fonte): o seletor abre como foi deixado
const PREFS_KEY = 'resenha_share_prefs';
function loadPrefs() {
  try {
    return { resolution: '720', fps: 30, captureAudio: true, tab: 'screens', sourceName: null, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { resolution: '720', fps: 30, captureAudio: true, tab: 'screens', sourceName: null };
  }
}

/** `switching`: já está ao vivo; o botão troca a fonte sem encerrar a transmissão. */
export default function ScreenShareModal({ onClose, onSelectSource, switching = false }) {
  // Versão web: quem lista telas e janelas é o seletor do próprio navegador
  const browserMode = !window.electronAPI?.getSources;
  const [prefs] = useState(loadPrefs);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(prefs.tab === 'applications' ? 'applications' : 'screens');
  const [selectedSource, setSelectedSource] = useState(null);
  const [captureAudio, setCaptureAudio] = useState(prefs.captureAudio !== false);
  const [resolution, setResolution] = useState(prefs.resolution === '480' ? '480' : '720');
  const [fps, setFps] = useState(prefs.fps === 15 ? 15 : 30);

  useEffect(() => {
    async function loadSources() {
      if (window.electronAPI?.getSources) {
        try {
          const list = await window.electronAPI.getSources();
          setSources(list);
          if (list.length > 0) {
            // Reabre na última fonte usada (os ids das janelas mudam; o nome costuma se manter)
            const last = prefs.sourceName && list.find((s) => s.name === prefs.sourceName);
            const firstOfTab = list.find((s) => (prefs.tab === 'applications' ? !s.isScreen : s.isScreen));
            const pick = last || firstOfTab || list.find((s) => s.isScreen) || list[0];
            setSelectedSource(pick);
            setActiveTab(pick.isScreen ? 'screens' : 'applications');
          }
        } catch (err) {
          console.error('Erro ao buscar fontes do desktopCapturer:', err);
        }
      }
      setLoading(false);
    }
    loadSources();
  }, [prefs]);

  const applications = sources.filter((s) => !s.isScreen);
  const screens = sources.filter((s) => s.isScreen);

  const currentList = activeTab === 'screens' ? screens : applications;

  const handleStartShare = (sourceToUse = selectedSource) => {
    const target = browserMode ? { browser: true, name: 'Navegador', isScreen: false } : sourceToUse || selectedSource;
    if (!target) return;
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ resolution, fps, captureAudio, tab: target.isScreen ? 'screens' : 'applications', sourceName: target.name })
      );
    } catch {
      /* sem armazenamento: só não lembra */
    }
    onSelectSource({
      source: target,
      captureAudio,
      resolution,
      fps
    });
    onClose();
  };

  return (
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none">
      <div className="sheet w-full max-w-2xl bg-chat p-6 text-fg-strong flex flex-col max-h-[90dvh]">
        {/* Header Estilo Discord */}
        <div className="flex items-center justify-between pb-3 border-b border-line-strong">
          <div>
            <h3 className="text-xl font-bold text-fg-strong flex items-center gap-2">
              {switching ? 'Trocar o que está sendo transmitido' : 'Compartilhe sua tela'}
            </h3>
            <p className="text-xs text-fg-muted">
              {browserMode
                ? 'Escolha a qualidade; a tela, janela ou aba você escolhe no navegador.'
                : 'Dê um duplo-clique na tela ou aplicativo desejado para iniciar a transmissão imediatamente.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-hover text-fg-muted hover:text-fg-strong transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {browserMode ? (
          <div className="my-4 p-4 rounded-xl bg-side border border-well text-sm text-fg-2 leading-relaxed">
            Ao clicar em <strong className="text-fg-strong">{switching ? 'Trocar transmissão' : 'Entrar ao vivo'}</strong>, o navegador abre a lista de telas, janelas e abas para você escolher.
            <span className="block mt-2 text-[12px] text-fg-muted">
              Para levar o som junto, escolha uma <strong>aba</strong> ou a <strong>tela inteira</strong> e marque &quot;compartilhar áudio&quot;. Para áudio isolado de jogos, use o app para Windows.
            </span>
          </div>
        ) : (
        <>
        {/* Abas: Telas Inteiras vs Aplicativos */}
        <div className="flex gap-6 pt-3 pb-2 border-b border-line-strong text-sm font-semibold">
          <button
            onClick={() => {
              setActiveTab('screens');
              if (screens.length > 0) setSelectedSource(screens[0]);
            }}
            className={`pb-2 transition flex items-center gap-1.5 relative ${
              activeTab === 'screens'
                ? 'text-fg-strong border-b-2 border-accent'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Tv className="w-4 h-4" />
            <span>Telas ({screens.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('applications');
              if (applications.length > 0) setSelectedSource(applications[0]);
            }}
            className={`pb-2 transition flex items-center gap-1.5 relative ${
              activeTab === 'applications'
                ? 'text-fg-strong border-b-2 border-accent'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Gamepad2 className="w-4 h-4" />
            <span>Aplicativos ({applications.length})</span>
          </button>
        </div>

        {/* Grade de Fontes: Telas 16:9 estilo Discord vs Janelas */}
        <div className="flex-1 overflow-y-auto py-3 my-1 no-scrollbar min-h-[220px]">
          {loading ? (
            <div className="h-48 flex items-center justify-center text-fg-muted text-xs">
              Carregando monitores e janelas abertas...
            </div>
          ) : currentList.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-fg-muted text-xs">
              <p>Nenhuma fonte encontrada nesta categoria.</p>
            </div>
          ) : activeTab === 'screens' ? (
            /* Layout Especial da Aba de Telas (Widescreen 16:9 estilo Discord com Monitores Grandes) */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {screens.map((item, index) => {
                const isSelected = selectedSource?.id === item.id;
                const displayName = item.name.includes(':')
                  ? `Tela ${index + 1}`
                  : item.name || `Tela ${index + 1}`;

                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedSource(item)}
                    onDoubleClick={() => handleStartShare(item)}
                    className={`flex flex-col rounded-xl overflow-hidden cursor-pointer transition border-2 group bg-side hover:bg-hover ${
                      isSelected
                        ? 'border-accent shadow-lg ring-2 ring-accent/40 scale-[1.01]'
                        : 'border-well hover:border-line-strong'
                    }`}
                  >
                    {/* Monitor Frame e Thumbnail 16:9 */}
                    <div className="aspect-video bg-well flex items-center justify-center overflow-hidden relative">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt={displayName}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                        />
                      ) : (
                        <Monitor className="w-12 h-12 text-fg-muted" />
                      )}

                      {/* Badge Discreta de Resolução da Tela */}
                      <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-[10px] font-mono text-fg px-2 py-0.5 rounded shadow">
                        Display {index + 1}
                      </div>

                      {isSelected && (
                        <div className="absolute top-2 right-2 bg-accent text-on-accent p-1 rounded-full shadow">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      )}
                    </div>

                    {/* Barra de Nome do Monitor */}
                    <div className="p-3 flex items-center justify-between bg-panel">
                      <div className="flex items-center gap-2">
                        <Monitor className="w-4 h-4 text-accent shrink-0" />
                        <span className="text-xs font-bold text-fg-strong truncate">
                          {displayName}
                        </span>
                      </div>
                      <span className="text-[10px] text-fg-muted">Tela Cheia</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Layout da Aba de Aplicativos (Grade de Janelas 3 colunas com ícones de app) */
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {applications.map((item) => {
                const isSelected = selectedSource?.id === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedSource(item)}
                    onDoubleClick={() => handleStartShare(item)}
                    className={`flex flex-col rounded-xl overflow-hidden cursor-pointer transition border-2 group bg-side hover:bg-hover ${
                      isSelected
                        ? 'border-accent shadow-lg ring-2 ring-accent/40'
                        : 'border-well'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="h-28 bg-well flex items-center justify-center overflow-hidden relative">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt={item.name}
                          className="w-full h-full object-contain group-hover:scale-105 transition duration-200"
                        />
                      ) : (
                        <Tv className="w-8 h-8 text-fg-muted" />
                      )}

                      {/* App Icon no canto */}
                      {item.appIcon && (
                        <img
                          src={item.appIcon}
                          alt=""
                          className="absolute bottom-1.5 left-1.5 w-5 h-5 rounded shadow"
                        />
                      )}
                    </div>

                    {/* Nome da Janela */}
                    <div className="p-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-fg-strong truncate max-w-[85%]">
                        {item.name}
                      </span>
                      {isSelected && (
                        <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        </>
        )}

        {/* Configurações de Transmissão (Resolução, FPS e Áudio - Estilo Discord) */}
        <div className="bg-side p-3.5 rounded-xl border border-well space-y-3 mb-4">
          {/* Seletor de Resolução e Taxa de Quadros */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-xs font-semibold text-fg-2 block mb-1.5">
                Resolução de Transmissão
              </span>
              <div className="flex bg-well p-1 rounded-lg gap-1 border border-side">
                {[
                  { id: '480', label: '480p' },
                  { id: '720', label: '720p' }
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setResolution(opt.id)}
                    className={`flex-1 py-1 text-center rounded font-semibold text-xs transition ${
                      resolution === opt.id
                        ? 'bg-accent text-on-accent shadow'
                        : 'text-fg-muted hover:text-fg-strong hover:bg-side'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="text-xs font-semibold text-fg-2 block mb-1.5">
                Taxa de Quadros
              </span>
              <div className="flex bg-well p-1 rounded-lg gap-1 border border-side">
                {[15, 30].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFps(f)}
                    className={`flex-1 py-1 text-center rounded font-semibold text-xs transition ${
                      fps === f
                        ? 'bg-accent text-on-accent shadow'
                        : 'text-fg-muted hover:text-fg-strong hover:bg-side'
                    }`}
                  >
                    {f} FPS
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Toggle de Áudio Isolado (WASAPI) */}
          <div className="pt-2 border-t border-well flex items-center justify-between">
            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-fg-strong select-none">
              <input
                type="checkbox"
                checked={captureAudio}
                onChange={(e) => setCaptureAudio(e.target.checked)}
                className="accent-accent w-4 h-4 rounded cursor-pointer"
              />
              <div className="flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-ok" />
                <span>Compartilhar áudio da transmissão</span>
                {!browserMode && (
                  <span className="text-[10px] bg-ok/20 text-ok font-bold px-1.5 py-0.5 rounded ml-1">
                    WASAPI Isolado
                  </span>
                )}
              </div>
            </label>

            <span className="text-[11px] text-fg-muted font-medium hidden sm:inline">
              Preset: <strong>{resolution}p @ {fps}fps</strong>
            </span>
          </div>
        </div>

        {/* Botões do Rodapé */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            onClick={onClose}
            className="text-xs text-fg-strong hover:underline px-4 py-2 font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={() => handleStartShare()}
            disabled={!selectedSource && !browserMode}
            className="sticker-btn flex items-center gap-2 rounded bg-accent hover:bg-accent-hover px-6 py-2.5 text-sm font-semibold text-on-accent transition disabled:opacity-50"
          >
            {switching ? <Repeat className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
            {switching ? 'Trocar transmissão' : 'Entrar ao vivo'}
          </button>
        </div>
      </div>
    </div>
  );
}
