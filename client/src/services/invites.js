/**
 * Convites em link: https://<servidor>/convite/<código> (ou resenha://convite/<código>).
 * Reconhece os links nas mensagens, guarda as prévias em cache e abre o modal "Você foi convidado".
 */
import { OFFICIAL_SERVER_URLS, api, getServerUrl } from './api';

export const CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;
export const OPEN_INVITE_EVENT = 'resenha-open-invite';

export const MAX_AGE_OPTIONS = [
  { value: 1800, label: '30 minutos' },
  { value: 3600, label: '1 hora' },
  { value: 21600, label: '6 horas' },
  { value: 43200, label: '12 horas' },
  { value: 86400, label: '1 dia' },
  { value: 604800, label: '7 dias' },
  { value: 0, label: 'Nunca' }
];
export const MAX_USES_OPTIONS = [0, 1, 5, 10, 25, 50, 100];

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Domínios cujos links /convite/<código> viram cartão: os oficiais e o servidor em uso. */
function inviteHosts() {
  return new Set([...OFFICIAL_SERVER_URLS, getServerUrl()].map(hostOf).filter(Boolean));
}

/** Código do convite de um link, ou null se não for um convite do Resenha. */
export function inviteCodeFromUrl(url) {
  if (typeof url !== 'string') return null;
  const deep = url.match(/^resenha:\/\/(?:convite|invite)\/([A-Za-z0-9_-]{4,32})\/?$/i);
  if (deep) return deep[1];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol) || !inviteHosts().has(parsed.host.toLowerCase())) return null;
  const match = parsed.pathname.match(/^\/convite\/([A-Za-z0-9_-]{4,32})\/?$/);
  return match ? match[1] : null;
}

/** Link sem o "https://", para mostrar na tela. */
export const displayLink = (url) => url.replace(/^https?:\/\//, '');

// Prévia por código: o cartão aparece em várias mensagens e re-renderiza muito
const previews = new Map();

export function fetchInvitePreview(code, { fresh = false } = {}) {
  if (fresh || !previews.has(code)) {
    const promise = api.getInvite(code).catch((err) => {
      previews.delete(code); // erro de rede: tenta de novo da próxima vez
      if (err.status === 404) {
        previews.set(code, Promise.resolve(null));
        return null;
      }
      throw err;
    });
    previews.set(code, promise);
  }
  return previews.get(code);
}

export function forgetInvitePreview(code) {
  previews.delete(code);
}

/** Abre o modal de aceitar convite (o useInviteLinks escuta). */
export function openInvite(code) {
  if (CODE_RE.test(code || '')) window.dispatchEvent(new CustomEvent(OPEN_INVITE_EVENT, { detail: code }));
}

/** "O link vale por 7 dias", "O link não expira" etc. */
export function describeInvite(invite) {
  if (!invite) return '';
  const age = MAX_AGE_OPTIONS.find((o) => o.value === invite.max_age);
  const parts = [invite.max_age ? `O link vale por ${age ? age.label : 'um tempo'}` : 'O link não expira'];
  if (invite.max_uses) parts.push(invite.max_uses === 1 ? '1 uso' : `até ${invite.max_uses} usos`);
  return parts.join(', ');
}

/** "expira em 3 dias", "expira em 5 horas"... (para a lista de convites nas configurações) */
export function expiresIn(iso) {
  if (!iso) return 'Nunca';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Expirado';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} dias`;
}

export function serverInitials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
