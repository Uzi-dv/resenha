/** Aplica (otimista) a reação de `userId` na lista agregada [{emoji, count, users}]. */
export function toggleReactionLocal(reactions = [], emoji, userId, add) {
  const list = reactions.map((r) => ({ ...r, users: [...r.users] }));
  const entry = list.find((r) => r.emoji === emoji);
  if (add) {
    if (entry) {
      if (!entry.users.includes(userId)) entry.users.push(userId);
    } else {
      list.push({ emoji, users: [userId] });
    }
  } else if (entry) {
    entry.users = entry.users.filter((id) => id !== userId);
  }
  return list.filter((r) => r.users.length > 0).map((r) => ({ ...r, count: r.users.length }));
}

/** Resumo da mensagem respondida no formato que o servidor devolve (para a mensagem otimista). */
export function replyPreviewOf(msg) {
  if (!msg) return null;
  return {
    id: msg.id,
    user_id: msg.user_id ?? msg.sender_id,
    author: msg.author || msg.sender,
    content: (msg.content || '').slice(0, 200),
    has_attachments: Boolean(msg.attachments?.length)
  };
}
