import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Send, Smile, X } from 'lucide-react';
import Avatar from './Avatar';
import EmojiPicker from './EmojiPicker';
import { useChatUsers } from './MessageExtras';
import { MAX_ATTACHMENTS, formatBytes, prepareImage, uploadAttachment } from '../services/attachments';
import { encodeMentions } from '../services/mentions';

let nextKey = 1;

/**
 * Campo de mensagem compartilhado por canais e DMs: texto, imagens (colar, arrastar ou escolher;
 * o envio começa na hora), resposta, autocompletar de @menções e emojis.
 *
 * Ref: focus(), addFiles(files), insertMention(username).
 */
const Composer = forwardRef(function Composer(
  { placeholder, onSend, onTyping, replyTo, onCancelReply, onEditLast, extraActions, allowEveryone = false },
  ref
) {
  const { users, me } = useChatUsers();
  const [text, setText] = useState('');
  const [items, setItems] = useState([]); // anexos: { key, preview, status, error, result, compressed, originalSize }
  const [suggest, setSuggest] = useState(null); // { start, query, index }
  const [emojiAnchor, setEmojiAnchor] = useState(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Libera as prévias locais ao desmontar
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.preview)), []);

  const update = (key, patch) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const addFiles = (fileList) => {
    const images = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    const room = MAX_ATTACHMENTS - itemsRef.current.length;
    const accepted = images.slice(0, Math.max(0, room));
    const fresh = accepted.map((file) => ({ key: nextKey++, file, preview: URL.createObjectURL(file), status: 'preparing' }));
    if (images.length > accepted.length) {
      fresh.push({ key: nextKey++, preview: '', status: 'error', error: `Máximo de ${MAX_ATTACHMENTS} imagens por mensagem.` });
    }
    setItems((prev) => [...prev, ...fresh]);
    fresh.filter((i) => i.file).forEach(async (item) => {
      try {
        const prepared = await prepareImage(item.file);
        update(item.key, { status: 'uploading', compressed: prepared.compressed, originalSize: prepared.originalSize, size: prepared.file.size });
        const result = await uploadAttachment(prepared);
        update(item.key, { status: 'done', result });
      } catch (err) {
        update(item.key, { status: 'error', error: err.message || 'Falha ao enviar a imagem.' });
      }
    });
    inputRef.current?.focus();
  };

  const removeItem = (key) =>
    setItems((prev) => {
      const item = prev.find((i) => i.key === key);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((i) => i.key !== key);
    });

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    addFiles,
    insertMention: (username) => {
      setText((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}@${username} `);
      inputRef.current?.focus();
    }
  }));

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // ------------------------------------------------------------- @menções
  const candidates = (() => {
    if (!suggest) return [];
    const q = suggest.query.toLowerCase();
    const list = users
      .filter((u) => u.id !== me?.id && u.username.toLowerCase().includes(q))
      .sort((a, b) => a.username.toLowerCase().indexOf(q) - b.username.toLowerCase().indexOf(q))
      .slice(0, 8)
      .map((u) => ({ key: u.id, label: u.username, user: u }));
    if (allowEveryone && 'everyone'.startsWith(q)) list.push({ key: 'everyone', label: 'everyone', hint: 'Notifica todo mundo do servidor' });
    return list;
  })();

  const detectMention = (value, caret) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,32})$/.exec(before);
    setSuggest(m ? { start: caret - m[2].length - 1, query: m[2], index: 0 } : null);
  };

  const applyMention = (c) => {
    const caret = inputRef.current.selectionStart;
    const next = `${text.slice(0, suggest.start)}@${c.label} ${text.slice(caret)}`;
    const pos = suggest.start + c.label.length + 2;
    setText(next);
    setSuggest(null);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));
  };

  // ------------------------------------------------------------- envio
  const uploading = items.some((i) => i.status === 'preparing' || i.status === 'uploading');
  const failed = items.some((i) => i.status === 'error');
  const ready = items.filter((i) => i.status === 'done');
  const canSend = !uploading && !failed && (text.trim() || ready.length);

  const send = () => {
    if (!canSend) return;
    onSend({
      content: encodeMentions(text.trim(), users),
      attachments: ready.map((i) => i.result),
      replyTo
    });
    items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
    setItems([]);
    setText('');
    setSuggest(null);
    onCancelReply?.();
  };

  const handleKeyDown = (e) => {
    if (suggest && candidates.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setSuggest((s) => ({ ...s, index: (s.index + delta + candidates.length) % candidates.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyMention(candidates[suggest.index] || candidates[0]);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (suggest) setSuggest(null);
      else if (replyTo) onCancelReply?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'ArrowUp' && !text && !items.length) {
      if (onEditLast?.()) e.preventDefault();
    }
  };

  const handleChange = (e) => {
    setText(e.target.value);
    detectMention(e.target.value, e.target.selectionStart);
    if (e.target.value) onTyping?.();
  };

  const handlePaste = (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const insertEmoji = (emoji) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const replyName = replyTo ? (replyTo.author || replyTo.sender)?.username : null;

  return (
    <div className="px-4 pb-5 shrink-0 relative">
      {suggest && candidates.length > 0 && (
        <div className="anim-rise absolute bottom-full left-4 right-4 mb-1 bg-float border border-line rounded-lg shadow-2xl p-1.5 z-30">
          <div className="text-[13px] font-semibold text-fg-muted px-2 pb-1">Membros</div>
          {candidates.map((c, i) => (
            <button
              key={c.key}
              onMouseDown={(e) => {
                e.preventDefault();
                applyMention(c);
              }}
              onMouseEnter={() => setSuggest((s) => ({ ...s, index: i }))}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left ${
                i === suggest.index ? 'bg-hover text-fg-strong' : 'text-fg-2'
              }`}
            >
              {c.user ? (
                <Avatar user={c.user} alt="" className="w-6 h-6 rounded-full object-cover" />
              ) : (
                <span className="w-6 h-6 rounded-full bg-accent/30 text-accent-soft flex items-center justify-center font-bold">@</span>
              )}
              <span className="font-medium">{c.label}</span>
              {c.hint && <span className="text-xs text-fg-muted ml-auto">{c.hint}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="bg-hover rounded-lg overflow-hidden">
        {replyTo && (
          <div className="anim-drop flex items-center justify-between px-4 py-2 bg-panel/70 border-b border-line text-[13px] text-fg-muted">
            <span className="truncate">
              Respondendo a <span className="font-semibold text-fg-2">{replyName}</span>
            </span>
            <button onClick={onCancelReply} className="p-0.5 rounded-full hover:text-fg" title="Cancelar resposta (Esc)">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {items.length > 0 && (
          <div className="flex gap-3 px-4 pt-3 pb-1 overflow-x-auto">
            {items.map((i) => (
              <div key={i.key} className="anim-zoom relative w-36 shrink-0 bg-panel rounded-lg p-2">
                <div className="relative w-full h-24 rounded-md overflow-hidden bg-well flex items-center justify-center">
                  {i.preview ? (
                    <img src={i.preview} alt="" className={`w-full h-full object-cover ${i.status === 'done' ? '' : 'opacity-50'}`} />
                  ) : (
                    <AlertTriangle className="w-6 h-6 text-danger" />
                  )}
                  {(i.status === 'preparing' || i.status === 'uploading') && (
                    <Loader2 className="absolute w-6 h-6 text-white animate-spin" />
                  )}
                </div>
                <div className="mt-1.5 text-[11px] leading-tight truncate" title={i.error || i.file?.name}>
                  {i.status === 'error' ? (
                    <span className="text-danger">{i.error}</span>
                  ) : i.compressed ? (
                    <span className="text-fg-muted">
                      Comprimida: {formatBytes(i.originalSize)} → {formatBytes(i.size)}
                    </span>
                  ) : (
                    <span className="text-fg-muted">{i.file?.name || 'imagem'}</span>
                  )}
                </div>
                <button
                  onClick={() => removeItem(i.key)}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-danger text-white flex items-center justify-center shadow hover:bg-danger-hover"
                  title="Remover"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end px-4 py-2.5 gap-3">
          <button onClick={() => fileRef.current?.click()} className="text-fg-2 hover:text-fg-strong shrink-0" title="Enviar imagem (ou cole / arraste aqui)">
            <Plus className="w-5 h-5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {extraActions}
          <textarea
            ref={inputRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onClick={(e) => detectMention(text, e.target.selectionStart)}
            onBlur={() => setTimeout(() => setSuggest(null), 100)}
            rows={Math.min(8, text.split('\n').length)}
            maxLength={4000}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-fg-strong placeholder-fg-faint outline-none resize-none max-h-48 leading-5"
          />
          <button onClick={(e) => setEmojiAnchor(e.currentTarget.getBoundingClientRect())} className="text-fg-2 hover:text-fg-strong shrink-0" title="Emoji">
            <Smile className="w-5 h-5" />
          </button>
          {(text.trim() || items.length > 0) && (
            <button
              onClick={send}
              disabled={!canSend}
              className="text-accent hover:text-accent-hover disabled:opacity-40 shrink-0"
              title={uploading ? 'Aguardando o envio das imagens...' : failed ? 'Remova as imagens com erro' : 'Enviar'}
            >
              {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>
      {emojiAnchor && <EmojiPicker anchor={emojiAnchor} onPick={insertEmoji} onClose={() => setEmojiAnchor(null)} />}
    </div>
  );
});

export default Composer;
