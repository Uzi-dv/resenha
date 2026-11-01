import React, { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, MailCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

const RESEND_SECONDS = 60;
const inputClass =
  'w-full rounded bg-well px-3 py-2.5 text-sm text-fg-strong placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent transition';
const labelClass = 'block text-sm font-semibold text-fg-2 mb-1.5';

function useCountdown(initial) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return [left, setLeft];
}

function CodeInput({ value, onChange }) {
  return (
    <input
      autoFocus
      required
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      placeholder="000000"
      className={`${inputClass} text-center text-2xl font-bold tracking-[0.5em] font-mono`}
    />
  );
}

function Header({ icon: Icon, title, children }) {
  return (
    <div className="mb-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-on-accent border-[2.5px] border-ink mb-4">
        <Icon className="w-6 h-6" />
      </div>
      <h2 className="text-[2rem] leading-[1.05] font-extrabold tracking-tight text-fg-strong">{title}</h2>
      <p className="text-[15px] text-fg-muted mt-2">{children}</p>
    </div>
  );
}

function Feedback({ error, info }) {
  if (error) return <div className="mb-4 rounded bg-danger/20 border border-danger/50 p-3 text-xs text-danger">{error}</div>;
  if (info) return <div className="mb-4 rounded bg-ok/15 border border-ok/40 p-3 text-xs text-ok">{info}</div>;
  return null;
}

function ResendButton({ left, onClick }) {
  return (
    <button type="button" disabled={left > 0} onClick={onClick} className="text-link hover:underline disabled:no-underline disabled:text-fg-faint">
      {left > 0 ? `Reenviar código em ${left}s` : 'Reenviar código'}
    </button>
  );
}

function BackButton({ onClick, children = 'Voltar para o login' }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 text-fg-muted hover:text-fg-strong">
      <ArrowLeft className="w-3.5 h-3.5" /> {children}
    </button>
  );
}

const submitClass =
  'sticker-btn w-full rounded bg-accent py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover transition disabled:opacity-50';

/** Cadastro/login de conta ainda não confirmada: digita o código que chegou por e-mail. */
export function VerifyEmailStep({ email, onBack }) {
  const { verifyEmail } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [left, setLeft] = useCountdown(RESEND_SECONDS);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifyEmail(email, code);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const resend = async () => {
    setError('');
    setInfo('');
    try {
      await api.resendVerification(email);
      setInfo('Código reenviado. Confira também a caixa de spam.');
      setLeft(RESEND_SECONDS);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <Header icon={MailCheck} title="Confirme seu e-mail">
        Enviamos um código de 6 dígitos para <strong className="text-fg-strong">{email}</strong>.
      </Header>
      <Feedback error={error} info={info} />
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Código de confirmação</label>
          <CodeInput value={code} onChange={setCode} />
        </div>
        <button type="submit" disabled={loading || code.length !== 6} className={submitClass}>
          {loading ? 'Confirmando...' : 'Confirmar e entrar'}
        </button>
      </form>
      <div className="mt-4 flex items-center justify-between text-xs">
        <BackButton onClick={onBack} />
        <ResendButton left={left} onClick={resend} />
      </div>
    </>
  );
}

/** Esqueci a senha: pede o código por e-mail e, com ele, define a senha nova (e já entra). */
export function ResetPasswordStep({ initialEmail, onBack }) {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState(initialEmail || '');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [left, setLeft] = useCountdown(0);

  const requestCode = async (e) => {
    e?.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
      setLeft(RESEND_SECONDS);
      if (e === undefined) setInfo('Código reenviado. Confira também a caixa de spam.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('As senhas não são iguais.');
    if (password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.');
    setLoading(true);
    try {
      await resetPassword(email.trim(), code, password);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (!sent) {
    return (
      <>
        <Header icon={KeyRound} title="Esqueceu a senha?">
          Digite o e-mail da sua conta e enviaremos um código para criar uma senha nova.
        </Header>
        <Feedback error={error} info={info} />
        <form onSubmit={requestCode} className="space-y-4">
          <div>
            <label className={labelClass}>E-mail</label>
            <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="seuemail@exemplo.com" />
          </div>
          <button type="submit" disabled={loading} className={submitClass}>
            {loading ? 'Enviando...' : 'Enviar código'}
          </button>
        </form>
        <div className="mt-4 text-xs">
          <BackButton onClick={onBack} />
        </div>
      </>
    );
  }

  return (
    <>
      <Header icon={KeyRound} title="Crie uma senha nova">
        Se houver uma conta com <strong className="text-fg-strong">{email.trim()}</strong>, o código chega em instantes.
      </Header>
      <Feedback error={error} info={info} />
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={labelClass}>Código do e-mail</label>
          <CodeInput value={code} onChange={setCode} />
        </div>
        <div>
          <label className={labelClass}>Senha nova</label>
          <input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="••••••••" />
        </div>
        <div>
          <label className={labelClass}>Repita a senha nova</label>
          <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} placeholder="••••••••" />
        </div>
        <p className="text-[11px] text-fg-muted">Ao trocar a senha, o Resenha sai da sua conta nos outros computadores.</p>
        <button type="submit" disabled={loading || code.length !== 6} className={submitClass}>
          {loading ? 'Salvando...' : 'Trocar senha e entrar'}
        </button>
      </form>
      <div className="mt-4 flex items-center justify-between text-xs">
        <BackButton onClick={() => setSent(false)}>Trocar e-mail</BackButton>
        <ResendButton left={left} onClick={() => requestCode()} />
      </div>
    </>
  );
}
