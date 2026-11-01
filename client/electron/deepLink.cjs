/**
 * Links resenha:// (convites abertos pelo navegador). Funções puras: testadas em tests/deepLink.test.cjs.
 *
 * No Windows o link chega como argumento de linha de comando: em process.argv na primeira abertura e
 * no commandLine do evento second-instance quando o app já está aberto. O Windows às vezes acrescenta
 * uma barra no fim (resenha://convite/abc/), e o navegador pode deixar ?query ou #hash.
 */
const PROTOCOL = 'resenha';
const INVITE_RE = /^resenha:\/\/(?:convite|invite)\/([A-Za-z0-9_-]{4,32})\/?(?:[?#].*)?$/i;

function parseInviteLink(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().replace(/^"|"$/g, '').match(INVITE_RE);
  return match ? match[1] : null;
}

/** Procura um link de convite na linha de comando. Retorna o código ou null. */
function inviteCodeFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    const code = parseInviteLink(arg);
    if (code) return code;
  }
  return null;
}

module.exports = { PROTOCOL, parseInviteLink, inviteCodeFromArgv };
