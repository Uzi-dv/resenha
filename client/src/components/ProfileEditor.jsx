import React, { useEffect, useRef, useState } from 'react';
import { confirmDialog } from '../services/dialog';
import { X, Camera, ImagePlus, Link2, Trash2, Loader2, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, formatMediaUrl } from '../services/api';
import Avatar from './Avatar';

const MAX_IMAGE_MB = 10;
const PRESENCES = [
  { id: 'online', label: 'Online', color: '#23a55a', hint: 'Todos veem que você está disponível.' },
  { id: 'idle', label: 'Ausente', color: '#f0b232', hint: 'Você está por perto, mas não no PC.' },
  { id: 'dnd', label: 'Não perturbe', color: '#f23f43', hint: 'Silencia os sons de novas mensagens.' },
  { id: 'invisible', label: 'Invisível', color: '#80848e', hint: 'Você aparece offline, mas usa tudo normalmente.' }
];

const fromUser = (u) => ({
  username: u?.username || '',
  custom_status: u?.custom_status || '',
  bio: u?.bio || '',
  presence: u?.presence || 'online',
  avatar_url: u?.avatar_url || '',
  banner_url: u?.banner_url || ''
});

function Section({ title, hint, children }) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold text-fg-2">{title}</h4>
        {hint && <p className="text-[11px] text-fg-muted mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const inputClass =
  'w-full bg-well text-sm text-fg-strong px-3 py-2 rounded-md border border-well focus:border-accent outline-none placeholder-fg-faint';

/** Controles de imagem: enviar do PC, usar link ou remover. */
function ImagePicker({ label, value, onChange, uploading, onPick }) {
  const [showLink, setShowLink] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPick}
          disabled={uploading}
          className="sticker-btn flex items-center gap-1.5 bg-accent hover:bg-accent-hover disabled:opacity-60 text-on-accent text-xs font-semibold px-3 py-1.5 rounded-md"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          {uploading ? 'Enviando...' : `Enviar ${label}`}
        </button>
        <button
          type="button"
          onClick={() => setShowLink((v) => !v)}
          className="flex items-center gap-1.5 bg-active hover:bg-fg-faint text-fg-strong text-xs font-semibold px-3 py-1.5 rounded-md"
        >
          <Link2 className="w-3.5 h-3.5" /> Usar link
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="flex items-center gap-1.5 text-danger hover:underline text-xs font-semibold px-1"
          >
            <Trash2 className="w-3.5 h-3.5" /> Remover
          </button>
        )}
      </div>
      {showLink && (
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
          className={`${inputClass} font-mono text-xs`}
        />
      )}
    </div>
  );
}

export default function ProfileEditor({ onClose }) {
  const { user, updateProfile } = useAuth();
  const [draft, setDraft] = useState(() => fromUser(user));
  const [saved, setSaved] = useState(() => fromUser(user));
  const [uploading, setUploading] = useState(null); // 'avatar' | 'banner'
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const avatarInput = useRef(null);
  const bannerInput = useRef(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const requestClose = async () => {
    if (
      dirty &&
      !(await confirmDialog({ title: 'Descartar alterações?', message: 'As mudanças no perfil ainda não foram salvas.', confirmLabel: 'Descartar', danger: true }))
    ) {
      return;
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && requestClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const upload = async (kind, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setError(`A imagem passa de ${MAX_IMAGE_MB} MB.`);
      return;
    }
    setUploading(kind);
    setError(null);
    try {
      const { url } = await api.uploadImage(file);
      set(kind === 'avatar' ? 'avatar_url' : 'banner_url')(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...draft,
        username: draft.username.trim(),
        custom_status: draft.custom_status.trim(),
        avatar_url: draft.avatar_url.trim(),
        banner_url: draft.banner_url.trim()
      };
      const updated = await updateProfile(payload);
      const fresh = fromUser(updated);
      setDraft(fresh);
      setSaved(fresh);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const preview = { ...user, ...draft };
  const presence = PRESENCES.find((p) => p.id === draft.presence) || PRESENCES[0];

  return (
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onPointerDown={requestClose}>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="sheet relative w-full max-w-3xl max-h-[92dvh] flex flex-col bg-chat text-fg-strong overflow-hidden"
      >
        <header className="px-6 py-4 border-b border-panel flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">Editar perfil</h3>
            <p className="text-xs text-fg-muted">As mudanças aparecem na prévia ao lado antes de salvar.</p>
          </div>
          <button onClick={requestClose} className="p-1.5 rounded-full hover:bg-hover text-fg-2 hover:text-fg-strong">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="grid md:grid-cols-[1fr_300px] gap-6 p-6">
            {/* Formulário */}
            <div className="space-y-6">
              <Section title="Nome de usuário" hint="De 2 a 32 caracteres. Você continua entrando com o mesmo e-mail.">
                <input value={draft.username} onChange={(e) => set('username')(e.target.value)} maxLength={32} className={inputClass} />
              </Section>

              <Section title="Foto de perfil" hint="PNG, JPG, GIF ou WEBP até 10 MB. Também dá para clicar na foto da prévia.">
                <ImagePicker
                  label="foto"
                  value={draft.avatar_url}
                  onChange={set('avatar_url')}
                  uploading={uploading === 'avatar'}
                  onPick={() => avatarInput.current?.click()}
                />
              </Section>

              <Section title="Banner" hint="Imagem larga que aparece no topo do seu perfil.">
                <ImagePicker
                  label="banner"
                  value={draft.banner_url}
                  onChange={set('banner_url')}
                  uploading={uploading === 'banner'}
                  onPick={() => bannerInput.current?.click()}
                />
              </Section>

              <Section title="Status">
                <div className="grid grid-cols-2 gap-2">
                  {PRESENCES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => set('presence')(p.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm text-left transition ${
                        draft.presence === p.id ? 'border-accent bg-accent/15' : 'border-line-strong hover:bg-hover'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-fg-muted">{presence.hint}</p>
              </Section>

              <Section title="Status personalizado" hint="Uma frase curta que aparece abaixo do seu nome.">
                <input
                  value={draft.custom_status}
                  onChange={(e) => set('custom_status')(e.target.value)}
                  maxLength={100}
                  placeholder="Jogando CS2 🎮"
                  className={inputClass}
                />
              </Section>

              <Section title="Sobre mim">
                <textarea
                  rows={4}
                  value={draft.bio}
                  onChange={(e) => set('bio')(e.target.value)}
                  maxLength={255}
                  placeholder="Conte um pouco sobre você..."
                  className={`${inputClass} resize-none`}
                />
                <p className="text-[10px] text-right text-fg-muted">{draft.bio.length}/255</p>
              </Section>
            </div>

            {/* Prévia ao vivo */}
            <div className="md:sticky md:top-0 self-start">
              <h4 className="text-sm font-semibold text-fg-2 mb-2">Prévia</h4>
              <div className="rounded-xl overflow-hidden bg-panel border border-well shadow-lg">
                <button
                  type="button"
                  onClick={() => bannerInput.current?.click()}
                  className="group relative block w-full h-24 bg-accent bg-cover bg-center"
                  style={draft.banner_url ? { backgroundImage: `url(${formatMediaUrl(draft.banner_url)})` } : undefined}
                  title="Trocar banner"
                >
                  <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1.5 text-xs font-semibold">
                    <ImagePlus className="w-4 h-4" /> Trocar banner
                  </span>
                </button>
                <div className="px-4 pb-4">
                  <button
                    type="button"
                    onClick={() => avatarInput.current?.click()}
                    className="group relative -mt-10 w-20 h-20 rounded-full border-[5px] border-panel bg-well overflow-hidden block"
                    title="Trocar foto"
                  >
                    <Avatar user={preview} className="w-full h-full object-cover" />
                    <span className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                      <Camera className="w-5 h-5" />
                    </span>
                  </button>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-lg font-bold truncate">{draft.username || 'Seu nome'}</span>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: presence.color }} title={presence.label} />
                  </div>
                  {draft.custom_status && <p className="text-xs text-fg truncate">{draft.custom_status}</p>}
                  <div className="h-px bg-active my-3" />
                  <h5 className="text-[11px] font-bold text-fg-2 uppercase mb-1">Sobre mim</h5>
                  <p className="text-xs text-fg whitespace-pre-wrap break-words">
                    {draft.bio || 'Ainda não escreveu nada.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Barra de alterações pendentes */}
        {(dirty || error || justSaved) && (
          <footer
            className={`px-5 py-3 flex items-center justify-between gap-3 border-t ${
              error ? 'bg-danger/10 border-danger/40' : 'bg-float border-panel'
            }`}
          >
            <span className={`text-sm ${error ? 'text-danger' : justSaved && !dirty ? 'text-ok' : 'text-fg'}`}>
              {error || (justSaved && !dirty ? (
                <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> Perfil atualizado!</span>
              ) : 'Cuidado — você tem alterações que não foram salvas.')}
            </span>
            {dirty && (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => { setDraft(saved); setError(null); }} className="text-sm text-fg-strong hover:underline px-3 py-1.5">
                  Desfazer
                </button>
                <button
                  onClick={save}
                  disabled={saving || uploading}
                  className="flex items-center gap-1.5 bg-ok hover:bg-ok-hover disabled:opacity-60 text-white text-sm font-semibold px-4 py-1.5 rounded-md"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </div>
            )}
          </footer>
        )}

        <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => upload('avatar', e)} />
        <input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => upload('banner', e)} />
      </div>
    </div>
  );
}
