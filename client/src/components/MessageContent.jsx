import React from 'react';
import { MENTION_SPLIT_RE } from '../services/mentions';
import { useChatUsers } from './MessageExtras';
import { inviteCodeFromUrl, openInvite } from '../services/invites';
import InviteCard from './InviteCard';
import TweetCard from './TweetCard';
import { tweetIdFromUrl } from '../services/tweets';

const URL_RE = /((?:https?|resenha):\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;
const IMAGE_RE = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;

function Mention({ token }) {
  const { resolveUser, me } = useChatUsers();
  const id = token === '@everyone' ? null : Number(token.slice(2, -1));
  const user = id != null ? resolveUser(id) : null;
  const label = id == null ? '@everyone' : `@${user?.username || 'desconhecido'}`;
  const isMe = id != null && id === me?.id;
  return (
    <span
      className={`rounded px-0.5 font-medium cursor-default ${
        isMe ? 'bg-warn/25 text-warn' : 'bg-accent/25 text-accent-soft hover:bg-accent/40'
      }`}
    >
      {label}
    </span>
  );
}

/** Texto da mensagem com links clicáveis, menções, prévia de imagens, cartões de convite e tweets. */
export default function MessageContent({ content }) {
  if (!content) return null;
  const parts = content.split(URL_RE);
  const images = [];
  const invites = [];
  const tweets = [];
  const nodes = parts.map((part, i) => {
    if (i % 2 === 1) {
      const inviteCode = inviteCodeFromUrl(part);
      if (inviteCode) {
        if (!invites.includes(inviteCode) && invites.length < 3) invites.push(inviteCode);
        // Abre o convite dentro do app em vez de ir para o navegador
        return (
          <a
            key={i}
            href={part}
            onClick={(e) => {
              e.preventDefault();
              openInvite(inviteCode);
            }}
            className="text-link hover:underline break-all"
          >
            {part}
          </a>
        );
      }
      if (/^resenha:/i.test(part)) return <React.Fragment key={i}>{part}</React.Fragment>;
      if (IMAGE_RE.test(part) && images.length < 3) images.push(part);
      const tweetId = tweetIdFromUrl(part);
      if (tweetId && !tweets.includes(tweetId) && tweets.length < 3) tweets.push(tweetId);
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="text-link hover:underline break-all">
          {part}
        </a>
      );
    }
    return part.split(MENTION_SPLIT_RE).map((piece, j) =>
      j % 2 === 1 ? <Mention key={`${i}-${j}`} token={piece} /> : <React.Fragment key={`${i}-${j}`}>{piece}</React.Fragment>
    );
  });

  return (
    <>
      <div className="text-sm text-fg leading-relaxed break-words whitespace-pre-wrap">{nodes}</div>
      {images.map((src) => (
        <a key={src} href={src} target="_blank" rel="noreferrer" className="block mt-1.5">
          <img src={src} alt="" loading="lazy" className="max-w-[min(400px,100%)] max-h-[300px] rounded-lg object-contain bg-side" />
        </a>
      ))}
      {invites.map((code) => (
        <InviteCard key={code} code={code} />
      ))}
      {tweets.map((id) => (
        <TweetCard key={id} id={id} />
      ))}
    </>
  );
}

export function formatTimestamp(iso) {
  // O servidor envia UTC sem sufixo; trata como UTC
  const date = new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return { full: `Hoje às ${time}`, time };
  if (diffDays === 1) return { full: `Ontem às ${time}`, time };
  return { full: `${date.toLocaleDateString()} ${time}`, time };
}

export function parseDate(iso) {
  return new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
}
