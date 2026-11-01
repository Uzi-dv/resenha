/**
 * Tweets nas mensagens: links do X/Twitter (e dos espelhos fixupx, fxtwitter, vxtwitter...)
 * viram um cartão com texto, fotos e vídeos, sem abrir a rede social.
 *
 * Os dados vêm da API pública do FxTwitter (a mesma do fixupx.com), que libera CORS: o app
 * busca direto, sem passar pelo servidor do Resenha. As prévias ficam em cache por tweet.
 */
const API = 'https://api.fxtwitter.com/status/';

const HOSTS = new Set([
  'x.com',
  'twitter.com',
  'mobile.twitter.com',
  'mobile.x.com',
  'fixupx.com',
  'fxtwitter.com',
  'fixvx.com',
  'vxtwitter.com',
  'twittpr.com'
]);

/** Id do tweet de um link, ou null se não for um tweet. Aceita /usuario/status/123 e /i/status/123. */
export function tweetIdFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  // d.fixupx.com, g.fxtwitter.com etc. (variantes só de mídia/galeria)
  const base = host.split('.').slice(-2).join('.');
  if (!/^https?:$/.test(parsed.protocol) || !(HOSTS.has(host) || HOSTS.has(base))) return null;
  const match = parsed.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{5,25})(?:\/|$)/);
  return match ? match[1] : null;
}

// Cache por id: o mesmo tweet aparece em várias mensagens e o cartão re-renderiza muito
const cache = new Map();

/** Prévia do tweet (o objeto `tweet` da API), ou null se não existe/é privado. */
export function fetchTweet(id) {
  if (!cache.has(id)) {
    const promise = fetch(API + id)
      .then(async (res) => {
        if (res.status === 404 || res.status === 401) return null;
        if (!res.ok) throw new Error(`FxTwitter HTTP ${res.status}`);
        const data = await res.json();
        return data?.tweet || null;
      })
      .catch((err) => {
        cache.delete(id); // erro de rede: tenta de novo da próxima vez
        throw err;
      });
    cache.set(id, promise);
  }
  return cache.get(id);
}

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** 113200 → "113,2 mil" (como o X mostra em português). */
export const formatCount = (n) => (typeof n === 'number' ? compact.format(n) : null);

/** Fotos e vídeos do tweet, na ordem em que aparecem. */
export function tweetMedia(tweet) {
  const media = tweet?.media;
  if (!media) return [];
  if (media.all?.length) return media.all;
  return [...(media.photos || []), ...(media.videos || [])];
}
