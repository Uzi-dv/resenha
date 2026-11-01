import React, { useEffect, useState } from 'react';
import { Eye, Heart, Loader2, MessageCircle, Repeat2 } from 'lucide-react';
import { fetchTweet, formatCount, tweetMedia } from '../services/tweets';
import { ImageViewer } from './MessageExtras';

const LINK_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

function TweetText({ text, className = '' }) {
  if (!text) return null;
  return (
    <p className={`text-sm text-fg leading-relaxed whitespace-pre-wrap break-words ${className}`}>
      {text.split(LINK_RE).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="text-link hover:underline break-all">
            {part.replace(/^https?:\/\//, '')}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </p>
  );
}

function Author({ author, small = false }) {
  if (!author) return null;
  return (
    <a
      href={author.url || `https://x.com/${author.screen_name}`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 min-w-0 group/author"
    >
      {author.avatar_url && (
        <img
          src={author.avatar_url}
          alt=""
          draggable={false}
          className={`${small ? 'w-5 h-5' : 'w-8 h-8'} rounded-full bg-well shrink-0`}
        />
      )}
      <span className="min-w-0 flex items-baseline gap-1.5">
        <span className={`${small ? 'text-[13px]' : 'text-sm'} font-bold text-fg-strong truncate group-hover/author:underline`}>
          {author.name}
        </span>
        <span className="text-xs text-fg-muted truncate">@{author.screen_name}</span>
      </span>
    </a>
  );
}

/** Uma foto/vídeo. Vídeo só carrega ao dar play (preload="none"), com a capa do próprio X. */
function MediaItem({ item, fill, onOpen }) {
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : '16 / 9';
  const box = fill ? 'w-full h-full' : 'w-full max-h-[340px]';
  if (item.type === 'video' || item.type === 'gif') {
    const gif = item.type === 'gif';
    return (
      <video
        src={item.url}
        poster={item.thumbnail_url}
        controls={!gif}
        autoPlay={gif}
        loop={gif}
        muted={gif}
        playsInline
        preload={gif ? 'auto' : 'none'}
        className={`${box} bg-black object-contain`}
        style={fill ? undefined : { aspectRatio: ratio }}
      />
    );
  }
  return (
    <button onClick={() => onOpen(item)} className={`block ${box} bg-well overflow-hidden`} style={fill ? undefined : { aspectRatio: ratio }}>
      <img src={item.url} alt="" loading="lazy" draggable={false} className="w-full h-full object-cover" />
    </button>
  );
}

/** Grade como a do X: 1 item inteiro; 2 lado a lado; 3 e 4 em grade. */
function MediaGrid({ items, sensitive }) {
  const [viewing, setViewing] = useState(null);
  const [revealed, setRevealed] = useState(!sensitive);
  if (!items.length) return null;
  const shown = items.slice(0, 4);
  const single = shown.length === 1;

  return (
    <div className="relative mt-2.5 rounded-xl overflow-hidden border border-line">
      <div
        className={`${single ? '' : 'grid grid-cols-2 gap-0.5 aspect-[16/10]'} ${shown.length > 2 ? 'grid-rows-2' : ''} ${
          revealed ? '' : 'blur-2xl pointer-events-none'
        }`}
      >
        {shown.map((item, i) => (
          <div key={item.url} className={!single && shown.length === 3 && i === 0 ? 'row-span-2' : ''}>
            <MediaItem item={item} fill={!single} onOpen={setViewing} />
          </div>
        ))}
      </div>
      {!revealed && (
        <button
          onClick={() => setRevealed(true)}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-white text-sm font-bold"
        >
          <Eye className="w-5 h-5" />
          Conteúdo sensível: clique para ver
        </button>
      )}
      {viewing && <ImageViewer attachment={{ url: viewing.url, name: '' }} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Stat({ icon: Icon, value, label }) {
  const text = formatCount(value);
  if (!text) return null;
  return (
    <span className="flex items-center gap-1" title={`${value.toLocaleString('pt-BR')} ${label}`}>
      <Icon className="w-3.5 h-3.5" strokeWidth={2.25} /> {text}
    </span>
  );
}

function formatDate(tweet) {
  const date = tweet.created_timestamp ? new Date(tweet.created_timestamp * 1000) : new Date(tweet.created_at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Cartão abaixo de uma mensagem com link de tweet (x.com, twitter.com, fixupx.com...). */
export default function TweetCard({ id }) {
  const [tweet, setTweet] = useState(undefined); // undefined = carregando, null = indisponível

  useEffect(() => {
    let cancelled = false;
    fetchTweet(id)
      .then((t) => !cancelled && setTweet(t))
      .catch(() => !cancelled && setTweet(null));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Sem prévia (apagado, privado, API fora): fica só o link na mensagem
  if (tweet === null) return null;
  if (tweet === undefined) {
    return (
      <div className="sheet-sm mt-2 mb-1 w-full max-w-[440px] bg-side p-3.5 h-[72px] flex items-center text-fg-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  const quote = tweet.quote;
  const media = tweetMedia(tweet);
  const quoteMedia = tweetMedia(quote);

  return (
    <article className="sheet-sm mt-2 mb-1 w-full max-w-[440px] bg-side p-3.5">
      <Author author={tweet.author} />
      {tweet.replying_to && <p className="mt-1.5 text-xs text-fg-muted">Respondendo a @{tweet.replying_to}</p>}
      <TweetText text={tweet.text} className="mt-2" />
      <MediaGrid items={media} sensitive={tweet.possibly_sensitive} />

      {quote && (
        <div className="mt-2.5 rounded-xl border border-line p-2.5">
          <Author author={quote.author} small />
          <TweetText text={quote.text} className="mt-1.5 line-clamp-6" />
          <MediaGrid items={quoteMedia} sensitive={quote.possibly_sensitive} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted tabular-nums">
        <Stat icon={MessageCircle} value={tweet.replies} label="respostas" />
        <Stat icon={Repeat2} value={tweet.retweets} label="reposts" />
        <Stat icon={Heart} value={tweet.likes} label="curtidas" />
        <Stat icon={Eye} value={tweet.views} label="visualizações" />
        <a href={tweet.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 hover:text-fg hover:underline">
          X · {formatDate(tweet)}
        </a>
      </div>
    </article>
  );
}
