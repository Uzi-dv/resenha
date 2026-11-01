import { createStore } from './store';

/**
 * Temas e cor de destaque. As cores vivem em variáveis CSS (src/index.css);
 * aqui só se troca o atributo data-theme do <html> e a variável --c-accent.
 */
// `accent`: cor de destaque sugerida, aplicada ao escolher o tema (dá para trocar depois)
export const THEMES = [
  { id: 'resenha', label: 'Resenha', hint: 'Azul da madrugada e âmbar.', hintLight: 'Papel e âmbar.', preview: ['#0b0e19', '#121729', '#171d33'], previewLight: ['#e8dcc8', '#f3e8d7', '#fff8ee'], accent: 'resenha' },
  { id: 'dark', label: 'Padrão', hint: 'O escuro clássico.', hintLight: 'O claro clássico.', preview: ['#1e1f22', '#2b2d31', '#313338'], previewLight: ['#e3e5e8', '#f2f3f5', '#ffffff'] },
  { id: 'ash', label: 'Grafite', hint: 'Mais escuro e neutro.', hintLight: 'Cinza neutro e suave.', preview: ['#121214', '#1a1a1e', '#1f1f23'], previewLight: ['#e2e2e4', '#f1f1f1', '#fbfbfb'] },
  { id: 'oled', label: 'OLED', labelLight: 'Branco puro', hint: 'Preto absoluto.', hintLight: 'Branco, só com bordas.', preview: ['#000000', '#000000', '#000000'], previewLight: ['#ffffff', '#ffffff', '#ffffff'] },
  { id: 'nordico', label: 'Nórdico', hint: 'Cinza azulado e calmo.', preview: ['#242933', '#2e3440', '#3b4252'], previewLight: ['#e0e2e6', '#eff0f3', '#fafbfc'], accent: 'teal' },
  { id: 'sakura', label: 'Sakura', hint: 'Rosinha fofo.', preview: ['#1f1419', '#2a1b22', '#301f28'], previewLight: ['#ebdbe2', '#f6ecf0', '#fdf9fb'], accent: 'pink' },
  { id: 'menta', label: 'Menta', hint: 'Verde-água suave.', preview: ['#0f1c1c', '#142626', '#182e2d'], previewLight: ['#dde9e8', '#edf5f4', '#fafdfc'], accent: 'mint' },
  { id: 'floresta', label: 'Floresta', hint: 'Verde da mata.', preview: ['#0f1a14', '#15241b', '#1a2b21'], previewLight: ['#dee8e2', '#eef4f0', '#fafcfb'], accent: 'green' },
  { id: 'oceano', label: 'Oceano', hint: 'Azul profundo.', preview: ['#0b1522', '#111f33', '#15263d'], previewLight: ['#dbe2eb', '#ecf1f6', '#f9fbfd'], accent: 'blue' },
  { id: 'uva', label: 'Uva', hint: 'Roxo noturno.', preview: ['#150f1f', '#1e162c', '#241a35'], previewLight: ['#e2dcea', '#f0edf5', '#fbfafd'], accent: 'purple' },
  { id: 'cafe', label: 'Café', hint: 'Marrom quentinho.', preview: ['#1a1410', '#241c16', '#2b221b'], previewLight: ['#e9e3dd', '#f5f1ed', '#fdfbfa'], accent: 'orange' },
  { id: 'por-do-sol', label: 'Pôr do sol', hint: 'Coral e laranja.', preview: ['#1f1210', '#2a1915', '#321e19'], previewLight: ['#edded9', '#f7eeeb', '#fdfaf9'], accent: 'coral' },
  { id: 'rubi', label: 'Rubi', hint: 'Vermelho intenso.', preview: ['#1c0e10', '#261316', '#2d171a'], previewLight: ['#ebdbdc', '#f6eced', '#fdf9fa'], accent: 'red' }
];

/** Modo de cor: todos os temas têm versão escura e clara; "system" segue o Windows. */
export const MODES = [
  { id: 'dark', label: 'Escuro' },
  { id: 'light', label: 'Claro' },
  { id: 'system', label: 'Automático' }
];

export const ACCENTS = [
  { id: 'resenha', label: 'Âmbar Resenha', color: '#ffb547' },
  { id: 'blurple', label: 'Azul', color: '#5865f2' },
  { id: 'orange', label: 'Laranja queimado', color: '#e8710a' },
  { id: 'green', label: 'Verde', color: '#1f9e57' },
  { id: 'pink', label: 'Rosa', color: '#d6409f' },
  { id: 'red', label: 'Vermelho', color: '#d83c3e' },
  { id: 'teal', label: 'Ciano', color: '#0f8fa8' },
  { id: 'purple', label: 'Roxo', color: '#8a5cf0' },
  { id: 'blue', label: 'Azul-celeste', color: '#2f80d6' },
  { id: 'mint', label: 'Menta', color: '#1aa892' },
  { id: 'coral', label: 'Coral', color: '#e8603c' }
];

const KEY = 'resenha.appearance';

// Padrão: tema Resenha (azul da madrugada) com o âmbar Resenha
const DEFAULT_THEME = 'resenha';
const DEFAULT_ACCENT = 'resenha';

const DEFAULTS = { theme: DEFAULT_THEME, accent: DEFAULT_ACCENT, reduceMotion: false, mode: 'dark' };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const state = {
      theme: THEMES.some((t) => t.id === saved.theme) ? saved.theme : DEFAULT_THEME,
      accent: ACCENTS.some((a) => a.id === saved.accent) ? saved.accent : DEFAULT_ACCENT,
      reduceMotion: saved.reduceMotion === true,
      mode: MODES.some((m) => m.id === saved.mode) ? saved.mode : 'dark'
    };
    return state;
  } catch {
    return { ...DEFAULTS };
  }
}

export const appearance = createStore(load());

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance.getState()));
  } catch {
    /* sem armazenamento: o tema vale só nesta sessão */
  }
}

let switchTimer = null;

/** Texto sobre a cor de destaque: branco, a não ser que a cor seja clara demais (contraste < 3:1, ex.: o laranja Resenha). */
function onAccent(hex) {
  const lum = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return 1.05 / (l + 0.05) >= 3 ? '#ffffff' : '#000000';
}
const systemLight = window.matchMedia?.('(prefers-color-scheme: light)');

/** Modo efetivo ('dark' | 'light'), resolvendo o "Automático" pelo tema do Windows. */
export function resolveMode(mode) {
  if (mode === 'system') return systemLight?.matches ? 'light' : 'dark';
  return mode === 'light' ? 'light' : 'dark';
}

function apply({ theme, accent, reduceMotion, mode }, animate = false) {
  const root = document.documentElement;
  // Na troca (não na abertura do app) as cores deslizam por um instante
  if (animate && !reduceMotion) {
    root.classList.add('theme-switching');
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => root.classList.remove('theme-switching'), 260);
  }
  root.dataset.theme = theme;
  root.dataset.mode = resolveMode(mode);
  root.toggleAttribute('data-reduce-motion', reduceMotion);
  const accentColor = ACCENTS.find((a) => a.id === accent)?.color || ACCENTS[0].color;
  root.style.setProperty('--c-accent', accentColor);
  root.style.setProperty('--c-on-accent', onAccent(accentColor));
  // Botões nativos da janela (minimizar/maximizar/fechar) acompanham a cor da barra de título
  const css = getComputedStyle(root);
  window.electronAPI?.setTitleBarColors?.({
    color: css.getPropertyValue('--c-frame').trim(),
    symbolColor: css.getPropertyValue('--c-fg-2').trim()
  });
}

export function setAppearance(patch) {
  appearance.setState((s) => ({ ...s, ...patch }));
}


apply(appearance.getState());
// No "Automático", acompanha a troca de tema do Windows na hora
systemLight?.addEventListener?.('change', () => {
  if (appearance.getState().mode === 'system') apply(appearance.getState(), true);
});
appearance.subscribe(() => {
  const state = appearance.getState();
  apply(state, true);
  save();
});
