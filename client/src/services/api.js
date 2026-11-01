/**
 * Endereço do servidor desta instalação, definido na compilação (VITE_SERVER_URL, ver o README).
 * Sem ele, o app pede o endereço na primeira vez que abre (e dá para trocar depois com F3).
 */
export const DEFAULT_SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').trim().replace(/\/+$/, '');
export const OFFICIAL_SERVER_URLS = DEFAULT_SERVER_URL ? [DEFAULT_SERVER_URL] : [];

/** Versão web: o app é servido pelo próprio servidor do Resenha (não é o Electron nem o Vite de desenvolvimento). */
export const IS_WEB = !window.electronAPI?.isElectron && import.meta.env.PROD && /^https?:$/.test(window.location.protocol);

export function getServerUrl() {
  if (IS_WEB) return window.location.origin;
  const stored = localStorage.getItem('resenha_server_url');
  if (stored) return stored;
  if (DEFAULT_SERVER_URL && (window.electronAPI?.isElectron || import.meta.env.PROD)) return DEFAULT_SERVER_URL;
  return 'http://localhost:8000';
}

/** App instalado sem endereço definido na compilação nem escolhido ainda: precisa perguntar. */
export function needsServerSetup() {
  if (IS_WEB || DEFAULT_SERVER_URL || localStorage.getItem('resenha_server_url')) return false;
  return Boolean(window.electronAPI?.isElectron || import.meta.env.PROD);
}

export function cleanServerUrl(url) {
  if (!url) return '';
  let cleaned = url.trim();
  if (!/^https?:\/\//i.test(cleaned)) {
    const isLocal = /^(localhost|127\.0\.0\.1|192\.168\.|10\.)/.test(cleaned);
    cleaned = (isLocal ? 'http://' : 'https://') + cleaned;
  }
  return cleaned.replace(/\/+$/, '');
}

export function setServerUrl(url) {
  if (!url) {
    localStorage.removeItem('resenha_server_url');
    return;
  }
  localStorage.setItem('resenha_server_url', cleanServerUrl(url));
}

/**
 * Se o endereço salvo (via F3) não responde mas o oficial sim, volta para o oficial.
 * Resolve o caso de túneis temporários antigos (ex.: *.trycloudflare.com) que já morreram.
 * Retorna true se trocou de endereço.
 */
export async function recoverServerUrl() {
  const stored = localStorage.getItem('resenha_server_url');
  if (!DEFAULT_SERVER_URL || !stored || cleanServerUrl(stored) === cleanServerUrl(DEFAULT_SERVER_URL)) return false;
  if ((await testServerConnection(stored)).ok) return false;
  if (!(await testServerConnection(DEFAULT_SERVER_URL)).ok) return false;
  console.warn(`[Resenha] Endereço salvo ${stored} inacessível; voltando para ${DEFAULT_SERVER_URL}`);
  setServerUrl(null);
  return true;
}


export async function testServerConnection(url, timeoutMs = 5000) {
  const target = cleanServerUrl(url);
  const start = performance.now();
  try {
    const res = await fetch(`${target}/`, {
      headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const latency = Math.round(performance.now() - start);
    if (res.ok) {
      const json = await res.json().catch(() => null);
      // Só vale se quem respondeu for o Resenha (um domínio estacionado também responde "200 OK")
      if (json?.app !== 'Resenha API') {
        return { ok: false, wrongApp: true, error: 'Esse endereço respondeu, mas não é um servidor do Resenha.', latency };
      }
      return { ok: true, latency, data: json, url: target };
    }
    return { ok: false, error: `Servidor retornou status HTTP ${res.status}`, latency };
  } catch (err) {
    const latency = Math.round(performance.now() - start);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { ok: false, error: `Tempo limite excedido (${Math.round(timeoutMs / 1000)}s). O túnel ou servidor está inacessível.`, latency };
    }
    return { ok: false, error: 'Não foi possível conectar ao servidor. Verifique a URL ou se o backend está ligado.', latency };
  }
}

export function getAuthToken() {
  return localStorage.getItem('resenha_token');
}

export function setAuthToken(token) {
  if (token) localStorage.setItem('resenha_token', token);
  else localStorage.removeItem('resenha_token');
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function errorMessage(data, status) {
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    // Erros de validação do FastAPI
    return detail.map((d) => d.msg?.replace(/^Value error, /, '')).filter(Boolean).join(' ');
  }
  if (!data && [404, 502, 503, 504].includes(status)) {
    // Resposta sem JSON = quem respondeu foi o túnel (ngrok/cloudflared), não o Resenha
    return 'Servidor offline: o host do Resenha não está com o servidor ligado no momento';
  }
  return `Erro na requisição (HTTP ${status})`;
}

// Antes do primeiro pedido a um endereço, confere que quem responde é um servidor do Resenha:
// login, senha e token nunca vão para outro tipo de servidor (nem por um endereço digitado no F3)
const verifiedServers = new Map();

function ensureResenhaServer(base) {
  if (!verifiedServers.has(base)) {
    const check = testServerConnection(base, 8000).then((res) => {
      if (res.wrongApp) throw new ApiError('Esse endereço não é um servidor do Resenha (troque em F3)', 421);
      if (!res.ok) verifiedServers.delete(base); // fora do ar: confere de novo no próximo pedido
    });
    verifiedServers.set(base, check);
    check.catch(() => {});
  }
  return verifiedServers.get(base);
}

async function request(endpoint, { body, method = 'GET', timeout = 20000, raw = false, token: tokenOverride } = {}) {
  await ensureResenhaServer(getServerUrl());
  const headers = { 'ngrok-skip-browser-warning': 'true' };
  const token = tokenOverride || getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${getServerUrl()}/api${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    throw new ApiError(
      err.name === 'TimeoutError' ? 'O servidor demorou demais para responder.' : 'Sem conexão com o servidor.',
      0
    );
  }

  const data = await response.json().catch(() => null);
  if (response.status === 401 && endpoint !== '/auth/login' && !tokenOverride) {
    setAuthToken(null);
    window.dispatchEvent(new CustomEvent('resenha-unauthorized'));
  }
  if (!response.ok) throw new ApiError(errorMessage(data, response.status), response.status);
  return data;
}

export function formatMediaUrl(url) {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${getServerUrl()}${url.startsWith('/') ? url : `/${url}`}`;
}

export function defaultAvatarUrl(user) {
  return `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user?.username || 'resenha')}`;
}

export function avatarUrl(user) {
  return user?.avatar_url ? formatMediaUrl(user.avatar_url) : defaultAvatarUrl(user);
}

function query(params) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return q ? `?${q}` : '';
}

export const api = {
  // Auth
  register: (username, email, password, avatar_url = '', banner_url = '') =>
    request('/auth/register', { method: 'POST', body: { username, email, password, avatar_url, banner_url } }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  verifyEmail: (email, code) => request('/auth/verify-email', { method: 'POST', body: { email, code } }),
  resendVerification: (email) => request('/auth/resend-verification', { method: 'POST', body: { email } }),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (email, code, password) => request('/auth/reset-password', { method: 'POST', body: { email, code, password } }),
  getMe: () => request('/auth/me'),
  updateProfile: (profileData) => request('/auth/profile', { method: 'PUT', body: profileData }),
  getUserProfile: (userId) => request(`/auth/users/${userId}`),

  // Servidores
  getServers: () => request('/servers'),
  getServerDetail: (serverId) => request(`/servers/${serverId}`),
  createServer: (name, icon_url = '') => request('/servers', { method: 'POST', body: { name, icon_url } }),
  joinServer: (invite_code) => request('/servers/join', { method: 'POST', body: { invite_code } }),
  reorderServers: (serverIds) => request('/servers/order', { method: 'PUT', body: { server_ids: serverIds } }),
  updateServer: (serverId, data) => request(`/servers/${serverId}`, { method: 'PATCH', body: data }),
  regenerateInvite: (serverId) => request(`/servers/${serverId}/invite`, { method: 'POST' }),
  // Convites em link (servidor 2.11+)
  createInvite: (serverId, { maxAge = 604800, maxUses = 0 } = {}) =>
    request(`/servers/${serverId}/invites`, { method: 'POST', body: { max_age: maxAge, max_uses: maxUses } }),
  listInvites: (serverId) => request(`/servers/${serverId}/invites`),
  revokeInvite: (code) => request(`/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  getInvite: (code) => request(`/invites/${encodeURIComponent(code)}`),
  acceptInvite: (code) => request(`/invites/${encodeURIComponent(code)}/accept`, { method: 'POST' }),
  deleteServer: (serverId) => request(`/servers/${serverId}`, { method: 'DELETE' }),
  leaveServer: (serverId) => request(`/servers/${serverId}/members/@me`, { method: 'DELETE' }),
  kickMember: (serverId, userId) => request(`/servers/${serverId}/members/${userId}`, { method: 'DELETE' }),
  disconnectMemberVoice: (serverId, userId) =>
    request(`/servers/${serverId}/members/${userId}/disconnect-voice`, { method: 'POST' }),
  // Cargos
  createRole: (serverId, data) => request(`/servers/${serverId}/roles`, { method: 'POST', body: data }),
  updateRole: (serverId, roleId, data) => request(`/servers/${serverId}/roles/${roleId}`, { method: 'PATCH', body: data }),
  deleteRole: (serverId, roleId) => request(`/servers/${serverId}/roles/${roleId}`, { method: 'DELETE' }),
  reorderRoles: (serverId, roleIds) => request(`/servers/${serverId}/roles/order`, { method: 'PUT', body: { role_ids: roleIds } }),
  setMemberRoles: (serverId, userId, roleIds) =>
    request(`/servers/${serverId}/members/${userId}/roles`, { method: 'PUT', body: { role_ids: roleIds } }),
  createChannel: (serverId, name, type = 'text') =>
    request(`/servers/${serverId}/channels`, { method: 'POST', body: { name, type } }),
  renameChannel: (serverId, channelId, name) =>
    request(`/servers/${serverId}/channels/${channelId}`, { method: 'PATCH', body: { name } }),
  deleteChannel: (serverId, channelId) => request(`/servers/${serverId}/channels/${channelId}`, { method: 'DELETE' }),

  // Mensagens
  getMessages: (channelId, { before, after, limit = 50 } = {}) =>
    request(`/channels/${channelId}/messages${query({ before, after, limit })}`),
  // payload: { content, reply_to_id?, attachments? }
  sendMessage: (channelId, payload) => request(`/channels/${channelId}/messages`, { method: 'POST', body: payload }),
  addReaction: (channelId, messageId, emoji) =>
    request(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { method: 'PUT' }),
  removeReaction: (channelId, messageId, emoji) =>
    request(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }),
  editMessage: (channelId, messageId, content) =>
    request(`/channels/${channelId}/messages/${messageId}`, { method: 'PATCH', body: { content } }),
  deleteMessage: (channelId, messageId) => request(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' }),
  createPoll: (channelId, question, options, multiple) =>
    request(`/channels/${channelId}/polls`, { method: 'POST', body: { question, options, multiple } }),
  votePoll: (pollId, optionIds) => request(`/polls/${pollId}/vote`, { method: 'POST', body: { option_ids: optionIds } }),
  closePoll: (pollId) => request(`/polls/${pollId}/close`, { method: 'POST' }),

  // DMs
  getDMConversations: () => request('/dm/conversations'),
  startDMConversation: (targetUserId = null, username = null) =>
    request('/dm/conversations', { method: 'POST', body: { target_user_id: targetUserId, username } }),
  getDMMessages: (conversationId, { before, limit = 50 } = {}) =>
    request(`/dm/conversations/${conversationId}/messages${query({ before, limit })}`),
  sendDMMessage: (conversationId, payload) =>
    request(`/dm/conversations/${conversationId}/messages`, { method: 'POST', body: payload }),
  addDMReaction: (conversationId, messageId, emoji) =>
    request(`/dm/conversations/${conversationId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { method: 'PUT' }),
  removeDMReaction: (conversationId, messageId, emoji) =>
    request(`/dm/conversations/${conversationId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }),

  // Super admin
  adminUsers: () => request('/admin/users'),
  adminServers: () => request('/admin/servers'),
  adminDisconnectVoice: (userId) => request(`/admin/users/${userId}/disconnect-voice`, { method: 'POST' }),
  adminRevokeSessions: (userId) => request(`/admin/users/${userId}/revoke-sessions`, { method: 'POST' }),
  adminSetBan: (userId, banned) => request(`/admin/users/${userId}/ban`, { method: 'POST', body: { banned } }),
  adminRename: (userId, username) => request(`/admin/users/${userId}`, { method: 'PATCH', body: { username } }),
  adminDeleteUser: (userId) => request(`/admin/users/${userId}`, { method: 'DELETE' }),
  adminDeleteServer: (serverId) => request(`/admin/servers/${serverId}`, { method: 'DELETE' }),

  // Upload
  uploadImage: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/upload/image', { method: 'POST', body: form, raw: true, timeout: 60000 });
  },
  uploadAttachment: (form) => request('/upload/attachment', { method: 'POST', body: form, raw: true, timeout: 120000 })
};

/** Cliente do proxy RTC. `token` opcional permite vários usuários na mesma página (testes). */
export function createRtcApi(token) {
  const opts = (extra) => ({ ...extra, token });
  return {
    rtcConfig: () => request('/rtc/config', opts()),
    rtcSession: () => request('/rtc/session', opts({ method: 'POST' })),
    rtcPublish: (offer, tracks) => request('/rtc/publish', opts({ method: 'POST', body: { offer, tracks } })),
    rtcUnpublish: (offer, tracks, replaced = false) =>
      request('/rtc/unpublish', opts({ method: 'POST', body: { offer, tracks, replaced } })),
    rtcSubscribe: (tracks) => request('/rtc/subscribe', opts({ method: 'POST', body: { tracks } })),
    rtcUnsubscribe: (offer, mids) => request('/rtc/unsubscribe', opts({ method: 'POST', body: { offer, mids } })),
    rtcRenegotiate: (answer) => request('/rtc/renegotiate', opts({ method: 'PUT', body: { answer } }))
  };
}
