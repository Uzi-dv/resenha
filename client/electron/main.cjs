const { app, BrowserWindow, ipcMain, desktopCapturer, session, powerSaveBlocker, shell, Tray, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { PROTOCOL, inviteCodeFromArgv, parseInviteLink } = require('./deepLink.cjs');

let loopback = null;
let koffi = null;
try {
  loopback = require('loopback-capture');
  koffi = require('koffi');
} catch (e) {
  console.warn('[Resenha] Módulos nativos de áudio indisponíveis:', e.message);
}

let mainWindow = null;
let activeLoopbackCapture = null;
let powerSaveId = null;

// --- Atualização automática (lê as releases do GitHub) ---
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (e) {
  console.warn('[Resenha] electron-updater indisponível:', e.message);
}
// A versão portátil não consegue se substituir: só avisamos que existe versão nova
const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
// Repositório das releases desta instalação: build.publish do package.json (o CI preenche, ver o README)
const PUBLISH = (require('../package.json').build?.publish || [])[0] || {};
const RELEASES_REPO = PUBLISH.owner && PUBLISH.repo ? `${PUBLISH.owner}/${PUBLISH.repo}` : null;
const RELEASES_URL = RELEASES_REPO ? `https://github.com/${RELEASES_REPO}/releases/latest` : null;
// "latest/download/<arquivo>" redireciona na hora para a release mais nova. O provedor "github"
// lia o feed releases.atom, que o GitHub guarda em cache por minutos: a versão nova demorava a aparecer.
const LATEST_DOWNLOAD_URL = RELEASES_URL ? `${RELEASES_URL}/download` : null;
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
let manualCheck = null; // verificação pedida pela pessoa (Ctrl+R): mostra o resultado mesmo sem novidade
let updateState = { state: 'idle' };

function sendUpdateState(next) {
  updateState = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', updateState);
}

function setupAutoUpdater() {
  const testMode = !app.isPackaged && process.env.RESENHA_UPDATE_TEST;
  // Sem repositório de releases configurado, não há de onde atualizar
  if (!autoUpdater || !LATEST_DOWNLOAD_URL || (!app.isPackaged && !testMode)) return;
  if (testMode) autoUpdater.forceDevUpdateConfig = true;

  autoUpdater.setFeedURL({ provider: 'generic', url: LATEST_DOWNLOAD_URL });
  // O download diferencial precisaria do .blockmap da versão instalada, que não fica em "latest/download"
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.autoDownload = !isPortable;
  autoUpdater.autoInstallOnAppQuit = true; // se a pessoa não reiniciar, instala ao fechar o app
  autoUpdater.logger = { info: () => {}, warn: console.warn, error: console.error, debug: () => {} };

  autoUpdater.on('update-available', (info) => {
    sendUpdateState(
      isPortable
        ? { state: 'available-portable', version: info.version, url: RELEASES_URL }
        : { state: 'downloading', version: info.version, percent: 0 }
    );
  });
  autoUpdater.on('download-progress', (p) => {
    sendUpdateState({ state: 'downloading', version: updateState.version, percent: Math.round(p.percent || 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateState({ state: 'ready', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) sendUpdateState({ state: 'up-to-date', version: app.getVersion() });
  });
  autoUpdater.on('error', (err) => {
    console.warn('[Resenha] Falha na atualização:', err?.message || err);
    if (manualCheck && updateState.state === 'checking') sendUpdateState({ state: 'check-error' });
    // Sem internet ou GitHub fora do ar: tenta de novo no próximo ciclo, sem incomodar
    if (updateState.state === 'downloading') sendUpdateState({ state: 'error', version: updateState.version });
  });

  const check = () => {
    // Já baixando ou pronta para instalar: não há o que procurar
    if (['downloading', 'ready'].includes(updateState.state)) return;
    autoUpdater.checkForUpdates().catch((e) => console.warn('[Resenha] checkForUpdates:', e?.message));
  };
  setTimeout(check, 5000);
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

/** Verificação pedida pela pessoa (Ctrl+R ou menu): mostra "procurando" e o resultado. */
async function checkForUpdatesNow() {
  if (!autoUpdater || !LATEST_DOWNLOAD_URL || (!app.isPackaged && !process.env.RESENHA_UPDATE_TEST)) {
    sendUpdateState({ state: 'unavailable', version: app.getVersion() });
    return updateState;
  }
  // Uma versão já está baixando ou pronta: só mostra o aviso de novo
  if (['downloading', 'ready', 'available-portable'].includes(updateState.state)) {
    sendUpdateState({ ...updateState });
    return updateState;
  }
  if (manualCheck) return manualCheck;
  sendUpdateState({ state: 'checking' });
  manualCheck = autoUpdater
    .checkForUpdates()
    .catch(() => {
      if (updateState.state === 'checking') sendUpdateState({ state: 'check-error' });
    })
    .then(() => {
      manualCheck = null;
      return updateState;
    });
  return manualCheck;
}

// --- Resolução HWND -> PID (para capturar só o áudio do jogo escolhido) ---
let GetWindowThreadProcessId = null;
let IsWindow = null;
try {
  if (koffi) {
    const user32 = koffi.load('user32.dll');
    GetWindowThreadProcessId = user32.func(
      'uint32 __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)'
    );
    IsWindow = user32.func('bool __stdcall IsWindow(intptr_t hWnd)');
  }
} catch (e) {
  console.warn('[Resenha] user32.dll indisponível:', e.message);
}

function getPidFromHwnd(hwnd) {
  if (!GetWindowThreadProcessId || !hwnd) return 0;
  try {
    const out = [0];
    GetWindowThreadProcessId(BigInt(hwnd), out);
    return out[0] || 0;
  } catch {
    return 0;
  }
}

// --- Fim da transmissão quando a janela compartilhada fecha (ex.: fechou o jogo) ---
// O Chromium não encerra a captura de uma janela que deixou de existir: a imagem só congela.
let shareWatch = null;

function stopShareWatch() {
  if (shareWatch) clearInterval(shareWatch.timer);
  shareWatch = null;
}

async function windowStillExists(sourceId, hwnd) {
  if (IsWindow && hwnd) {
    try {
      return Boolean(IsWindow(BigInt(hwnd)));
    } catch {
      /* cai no plano B */
    }
  }
  // Plano B (sem user32): a janela ainda aparece na lista de fontes? (miniaturas desligadas = barato)
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
  return sources.some((s) => s.id === sourceId);
}

function startShareWatch(sourceId) {
  stopShareWatch();
  if (!sourceId?.startsWith('window:')) return; // tela inteira não "fecha"
  const hwnd = parseInt(sourceId.split(':')[1], 10);
  const watch = { sourceId, misses: 0 };
  watch.timer = setInterval(async () => {
    const alive = await windowStillExists(sourceId, hwnd).catch(() => true);
    if (shareWatch !== watch) return;
    watch.misses = alive ? 0 : watch.misses + 1;
    if (watch.misses >= 2) {
      stopShareWatch();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('share-source-closed', sourceId);
    }
  }, IsWindow ? 1000 : 2500);
  shareWatch = watch;
}

// Desenvolvimento/testes: permite rodar uma segunda cópia com outra pasta de dados
if (!app.isPackaged && process.env.RESENHA_USER_DATA) {
  app.setPath('userData', process.env.RESENHA_USER_DATA);
}

// Testes: câmera e microfone falsos do Chromium (vídeo sintético), sem tocar nos dispositivos reais
if (!app.isPackaged && process.env.RESENHA_FAKE_MEDIA) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

// --- Instância única: duas janelas na mesma conta brigariam pela mesma call ---
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Abrir o Resenha de novo (atalho, menu Iniciar ou um link resenha://) traz de volta a janela que está na bandeja
  app.on('second-instance', (_event, commandLine) => {
    showMainWindow();
    handleInviteCode(inviteCodeFromArgv(commandLine));
  });
}

// --- Links resenha://convite/<código> (página de convite no navegador) ---
// O instalador registra o protocolo (package.json → build.protocols); isto cobre o portátil e o desenvolvimento.
function registerProtocol() {
  if (process.defaultApp) {
    // Desenvolvimento (electron .): o Windows precisa chamar o electron.exe com o caminho do app
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] || '.')]);
  } else if (process.env.PORTABLE_EXECUTABLE_FILE) {
    // Portátil: process.execPath é uma pasta temporária que muda a cada abertura
    app.setAsDefaultProtocolClient(PROTOCOL, process.env.PORTABLE_EXECUTABLE_FILE, []);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

// O convite fica guardado até a tela pedir: na primeira abertura ela ainda nem carregou.
let pendingInvite = null;
let rendererWantsLinks = false;

function handleInviteCode(code) {
  if (!code) return;
  if (rendererWantsLinks && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deep-link', { type: 'invite', code });
  } else {
    pendingInvite = code;
  }
}

ipcMain.handle('deep-link-pending', () => {
  rendererWantsLinks = true;
  const code = pendingInvite;
  pendingInvite = null;
  return code ? { type: 'invite', code } : null;
});

// macOS entrega o link por evento (o Windows usa a linha de comando)
app.on('open-url', (event, url) => {
  event.preventDefault();
  showMainWindow();
  handleInviteCode(parseInviteLink(url));
});

// Mídia em tempo real não pode ser estrangulada quando a janela perde o foco (jogo em tela cheia)
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch(
  'enable-features',
  // WebRtcAV1HWEncode: no Chromium 146 o AV1 por hardware no WebRTC vem desligado só no Windows
  // (a GPU codifica, mas o WebRTC não oferece). Se der problema, a checagem por estatísticas desce para H265/H264.
  // H265 no WebRTC (só existe por hardware): já é padrão no Chromium 146, fica explícito por garantia.
  'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer,MediaFoundationVideoEncodeAccelerator,' +
    'WebRtcAV1HWEncode,WebRtcAllowH265Send,WebRtcAllowH265Receive'
);

function stopLoopback() {
  if (activeLoopbackCapture) {
    try {
      activeLoopbackCapture.stop();
    } catch {
      /* já parado */
    }
    activeLoopbackCapture = null;
  }
}

// --- Bandeja do sistema (system tray) e preferências da janela ---
// Fechar a janela só a esconde: o Resenha continua na call e recebendo mensagens, com ícone perto do relógio.
const DESKTOP_DEFAULTS = { closeToTray: true, openAtLogin: false, startHidden: true, trayHintShown: false };
let desktopSettings = { ...DESKTOP_DEFAULTS };
let tray = null;
let isQuitting = false;
let trayState = { muted: false, deafened: false, inCall: false };
const launchedHidden = process.argv.includes('--hidden');

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function loadDesktopSettings() {
  try {
    desktopSettings = { ...DESKTOP_DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    desktopSettings = { ...DESKTOP_DEFAULTS };
  }
}

function saveDesktopSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(desktopSettings, null, 2));
  } catch (err) {
    console.warn('[Resenha] Não foi possível salvar as preferências:', err.message);
  }
}

function applyLoginItem() {
  // Em desenvolvimento registraria o electron.exe puro: só vale no app instalado
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: desktopSettings.openAtLogin,
    args: desktopSettings.startHidden ? ['--hidden'] : []
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendTrayAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tray-action', action);
}

function buildTrayMenu() {
  if (!tray) return;
  const { muted, deafened, inCall } = trayState;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir o Resenha', click: showMainWindow },
      { type: 'separator' },
      { label: 'Silenciar microfone', type: 'checkbox', checked: muted, click: () => sendTrayAction('toggle-mute') },
      { label: 'Ensurdecer', type: 'checkbox', checked: deafened, click: () => sendTrayAction('toggle-deafen') },
      { label: 'Sair da call', enabled: inCall, click: () => sendTrayAction('leave-voice') },
      { type: 'separator' },
      {
        label: 'Sair do Resenha',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.setToolTip(inCall ? `Resenha — em call${muted ? ' (mudo)' : ''}` : 'Resenha');
}

function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
  tray.on('click', showMainWindow);
  buildTrayMenu();
}

ipcMain.handle('desktop-settings-get', () => ({ ...desktopSettings, loginItemAvailable: app.isPackaged }));
ipcMain.handle('desktop-settings-set', (_event, patch = {}) => {
  for (const key of ['closeToTray', 'openAtLogin', 'startHidden']) {
    if (typeof patch[key] === 'boolean') desktopSettings[key] = patch[key];
  }
  saveDesktopSettings();
  if ('openAtLogin' in patch || 'startHidden' in patch) applyLoginItem();
  return { ...desktopSettings, loginItemAvailable: app.isPackaged };
});
ipcMain.on('tray-state', (_event, state = {}) => {
  trayState = { muted: Boolean(state.muted), deafened: Boolean(state.deafened), inCall: Boolean(state.inCall) };
  buildTrayMenu();
});

// Qualquer saída de verdade (menu da bandeja, atualização automática, desligar o PC) fecha sem esconder
app.on('before-quit', () => {
  isQuitting = true;
});

const TITLE_BAR_HEIGHT = 32;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#1e1f22',
    title: 'Resenha',
    icon: path.join(__dirname, 'icon.png'),
    // Iniciado junto com o Windows em modo "minimizado": já nasce escondido na bandeja
    show: !(launchedHidden && desktopSettings.closeToTray),
    autoHideMenuBar: true,
    // Barra de título desenhada pelo app (src/components/TitleBar.jsx); os botões
    // minimizar/maximizar/fechar continuam nativos (com Snap Layouts do Windows 11)
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1e1f22', symbolColor: '#b5bac1', height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  mainWindow.on('close', (event) => {
    if (isQuitting || !desktopSettings.closeToTray) return;
    event.preventDefault();
    mainWindow.hide();
    // Na primeira vez, avisa onde o Resenha foi parar
    if (!desktopSettings.trayHintShown && tray) {
      desktopSettings.trayHintShown = true;
      saveDesktopSettings();
      tray.displayBalloon({
        iconType: 'info',
        title: 'O Resenha continua aberto',
        content: 'Ele fica aqui na bandeja, perto do relógio. Clique no ícone para voltar ou com o botão direito para sair.'
      });
    }
  });

  // Recarregou (F5, atualização): a tela nova precisa pedir os links de novo
  mainWindow.webContents.on('did-start-loading', () => {
    rendererWantsLinks = false;
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
    // Ctrl+R procura atualizações (em vez de recarregar a tela; para recarregar, F5 ou Ctrl+Shift+R)
    if (input.type === 'keyDown' && input.key === 'F5') {
      event.preventDefault();
      mainWindow.webContents.reload();
    }
    if (input.type === 'keyDown' && input.control && !input.shift && !input.alt && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      checkForUpdatesNow();
    }
  });

  // Links externos abrem no navegador, não dentro do app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      console.log(`[Renderer ${event.level}] ${event.message}`);
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  }

  mainWindow.on('closed', () => {
    stopLoopback();
    stopShareWatch();
    mainWindow = null;
  });
}

// --- IPC ---

ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      fetchWindowIcons: true,
      thumbnailSize: { width: 320, height: 180 }
    });
    return sources
      .filter((s) => s.name !== 'Resenha')
      .map((s) => {
        const isWindow = s.id.startsWith('window:');
        const hwnd = isWindow ? parseInt(s.id.split(':')[1], 10) : 0;
        return {
          id: s.id,
          name: s.name,
          isScreen: s.id.startsWith('screen:'),
          pid: isWindow && !Number.isNaN(hwnd) ? getPidFromHwnd(hwnd) : 0,
          thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
          appIcon: s.appIcon ? s.appIcon.toDataURL() : null
        };
      });
  } catch (err) {
    console.error('[Resenha] Erro ao listar fontes:', err);
    return [];
  }
});

ipcMain.handle('start-audio-loopback', async (_event, { pid }) => {
  if (!loopback) return { success: false, error: 'Captura de áudio nativa indisponível neste sistema.' };
  stopLoopback();
  try {
    const capture = new loopback.LoopbackCapture();
    activeLoopbackCapture = capture;
    const onData = (chunk) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('audio-pcm-chunk', chunk);
    };
    if (pid && pid > 0) {
      // Janela/jogo: captura só a árvore de processos do jogo
      capture.start(pid, true, onData);
    } else {
      // Tela inteira: tudo MENOS o próprio Resenha (senão a call volta como eco para quem assiste)
      capture.start(process.pid, false, onData);
    }
    return { success: true };
  } catch (err) {
    console.error('[Resenha] Erro ao iniciar captura de áudio:', err);
    activeLoopbackCapture = null;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-audio-loopback', async () => {
  stopLoopback();
  return { success: true };
});

ipcMain.handle('watch-share-source', (_event, sourceId) => {
  if (sourceId) startShareWatch(String(sourceId));
  else stopShareWatch();
  return true;
});

// Impede o Windows de suspender o app durante uma call
ipcMain.handle('set-in-call', async (_event, inCall) => {
  if (inCall && powerSaveId === null) {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!inCall && powerSaveId !== null) {
    powerSaveBlocker.stop(powerSaveId);
    powerSaveId = null;
  }
  return true;
});

ipcMain.handle('get-app-version', () => app.getVersion());

// O tema do app muda a cor da barra de título; os botões nativos acompanham
ipcMain.handle('set-title-bar-colors', (_event, { color, symbolColor } = {}) => {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!mainWindow || mainWindow.isDestroyed() || !hex.test(color) || !hex.test(symbolColor)) return false;
  try {
    mainWindow.setTitleBarOverlay({ color, symbolColor, height: TITLE_BAR_HEIGHT });
    mainWindow.setBackgroundColor(color);
  } catch {
    return false;
  }
  return true;
});

ipcMain.handle('update-get-state', () => updateState);
ipcMain.handle('update-check', () => checkForUpdatesNow());
ipcMain.handle('update-install', () => {
  if (updateState.state !== 'ready' || !autoUpdater) return false;
  // isSilent: instala sem mostrar o assistente; isForceRunAfter: reabre o app em seguida
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
});

app.whenReady().then(() => {
  // O ngrok gratuito mostra uma página de aviso para "navegadores"; este header a pula
  // em TODAS as requisições (inclusive <img> de avatares servidos pelo túnel).
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['ngrok-skip-browser-warning'] = '1';
    callback({ requestHeaders: details.requestHeaders });
  });

  loadDesktopSettings();
  applyLoginItem();
  registerProtocol();
  createTray();
  createWindow();
  handleInviteCode(inviteCodeFromArgv(process.argv));
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopLoopback();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  tray?.destroy();
  tray = null;
});
