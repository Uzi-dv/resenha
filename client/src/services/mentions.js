/**
 * Menções. Na mensagem salva, uma menção é `<@id>` (sobrevive a troca de nick) ou `@everyone`.
 * No campo de texto a pessoa vê e digita `@nick`; a conversão acontece ao enviar/editar.
 */
export const MENTION_SPLIT_RE = /(<@\d+>|@everyone)/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `@Nick` → `<@id>` para os usuários conhecidos (nomes mais longos primeiro, pois nicks podem ter espaço). */
export function encodeMentions(text, users = []) {
  const sorted = [...users].filter((u) => u?.username).sort((a, b) => b.username.length - a.username.length);
  let out = text;
  for (const u of sorted) {
    const re = new RegExp(`(^|[^\\w<])@${escapeRe(u.username)}(?![\\w])`, 'gi');
    out = out.replace(re, (_, before) => `${before}<@${u.id}>`);
  }
  return out;
}

/** `<@id>` → `@Nick` (para editar uma mensagem ou citar numa resposta). */
export function decodeMentions(text, resolveUser) {
  return (text || '').replace(/<@(\d+)>/g, (_, id) => `@${resolveUser(Number(id))?.username || 'desconhecido'}`);
}

/** A mensagem chama a atenção de `userId`? (menção direta, @everyone ou resposta a uma mensagem dele) */
export function mentionsUser(msg, userId) {
  if (!msg || !userId) return false;
  const authorId = msg.user_id ?? msg.sender_id;
  if (authorId === userId) return false;
  const content = msg.content || '';
  return content.includes(`<@${userId}>`) || /(^|\s)@everyone\b/.test(content) || msg.reply_to?.user_id === userId;
}
