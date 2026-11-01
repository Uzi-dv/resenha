import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { formatMediaUrl, getServerUrl } from '../services/api';
import { Radio, Globe, Image as ImageIcon } from 'lucide-react';
import ResenhaLogo from './ResenhaLogo';
import { ResetPasswordStep, VerifyEmailStep } from './AuthEmailSteps';

export default function AuthModal() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // form (login/cadastro), verify (código de confirmação) ou forgot (esqueci a senha)
  const [step, setStep] = useState('form');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let result;
      if (isRegister) {
        if (!username.trim()) throw new Error('Nome de usuário é obrigatório.');
        result = await register(username.trim(), email.trim(), password, avatarUrl, bannerUrl);
      } else {
        result = await login(email.trim(), password);
      }
      if (result.verify) {
        setEmail(result.verify);
        setStep('verify');
      }
    } catch (err) {
      setError(err.message || 'Erro ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    // Sempre com a cara do Resenha (cobalto e papel), qualquer que seja o tema escolhido.
    // Rola a página inteira quando a janela é baixa demais para o formulário (cadastro é mais alto)
    <div className="theme-resenha fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-chat">
      {/* O logo grande, cortado pela borda da janela, espiando atrás do cartão */}
      <div className="auth-logo" aria-hidden="true">
        <ResenhaLogo className="w-full h-auto" />
      </div>
      <div className="relative min-h-full flex items-center justify-center px-4 pt-12 pb-6">
      <div className="theme-resenha-paper sheet auth-card w-full max-w-md bg-chat p-8 text-fg-strong">
        {step === 'verify' && <VerifyEmailStep email={email} onBack={() => { setStep('form'); setIsRegister(false); setError(''); }} />}
        {step === 'forgot' && <ResetPasswordStep initialEmail={email} onBack={() => { setStep('form'); setError(''); }} />}
        {step === 'form' && (<>
        <div className="mb-6">
          <h2 className="text-[2rem] leading-[1.05] font-extrabold tracking-tight text-fg-strong">
            {isRegister ? 'Criar uma conta no Resenha' : 'Boas-vindas de volta!'}
          </h2>
          <p className="text-[15px] text-fg-muted mt-2">
            {isRegister
              ? 'Estamos muito animados em ter você por aqui!'
              : 'Estamos muito animados em te ver novamente!'}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded bg-danger/20 border border-danger/50 p-3 text-xs text-danger">
            {error}
          </div>
        )}

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <>
              <div>
                <label className="block text-sm font-semibold text-fg-2 mb-1.5">
                  Nome de usuário <span className="text-danger">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded bg-well px-3 py-2.5 text-sm text-fg-strong placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent transition"
                    placeholder="ex: CapivaraGamer"
                  />
                </div>
              </div>

              {/* Personalização de Avatar e Banner via URL */}
              <div className="space-y-3 pt-1">
                <label className="block text-sm font-semibold text-fg-2">
                  Foto e banner (opcional, por link)
                </label>

                {/* Banner Preview e Input URL */}
                <div className="space-y-1.5">
                  <div
                    className="relative h-16 w-full rounded-lg overflow-hidden border border-well bg-well flex items-center justify-center bg-cover bg-center"
                    style={
                      bannerUrl
                        ? {
                            backgroundImage: `url(${formatMediaUrl(bannerUrl)})`
                          }
                        : {}
                    }
                  >
                    {!bannerUrl && (
                      <span className="text-[11px] text-fg-muted flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5" /> Prévia do Banner
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-fg-muted">
                      <Globe className="w-3.5 h-3.5" />
                    </div>
                    <input
                      type="url"
                      value={bannerUrl}
                      onChange={(e) => setBannerUrl(e.target.value)}
                      placeholder="URL do Banner (ex: https://...)"
                      className="w-full pl-8 pr-3 py-1.5 rounded bg-well text-xs text-fg-strong placeholder-fg-faint border border-side focus:border-accent outline-none"
                    />
                  </div>
                </div>

                {/* Avatar Preview e Input URL */}
                <div className="flex items-center gap-3 bg-side/60 p-2.5 rounded-lg border border-well">
                  <img
                    src={
                      avatarUrl
                        ? formatMediaUrl(avatarUrl)
                        : `https://api.dicebear.com/7.x/bottts/svg?seed=${username || 'resenha'}`
                    }
                    alt="Avatar Preview"
                    className="w-12 h-12 rounded-full object-cover border-2 border-accent bg-well shrink-0"
                    onError={(e) => {
                      e.target.src = `https://api.dicebear.com/7.x/bottts/svg?seed=${username || 'resenha'}`;
                    }}
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="text-xs font-semibold text-fg-strong">URL da Foto de Perfil</div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none text-fg-muted">
                        <Globe className="w-3 h-3" />
                      </div>
                      <input
                        type="url"
                        value={avatarUrl}
                        onChange={(e) => setAvatarUrl(e.target.value)}
                        placeholder="https://.../avatar.png"
                        className="w-full pl-7 pr-2.5 py-1.5 rounded bg-well text-xs text-fg-strong placeholder-fg-faint border border-side focus:border-accent outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-semibold text-fg-2 mb-1.5">
              E-mail <span className="text-danger">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded bg-well px-3 py-2.5 text-sm text-fg-strong placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent transition"
              placeholder="seuemail@exemplo.com"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-fg-2 mb-1.5">
              Senha <span className="text-danger">*</span>
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded bg-well px-3 py-2.5 text-sm text-fg-strong placeholder-neutral-500 outline-none focus:ring-2 focus:ring-accent transition"
              placeholder="••••••••"
            />
            {!isRegister && (
              <button
                type="button"
                onClick={() => {
                  setStep('forgot');
                  setError('');
                }}
                className="mt-1.5 text-xs text-link hover:underline font-medium"
              >
                Esqueceu sua senha?
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="sticker-btn w-full rounded bg-accent py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover transition disabled:opacity-50 mt-2"
          >
            {loading ? 'Carregando...' : isRegister ? 'Cadastrar' : 'Entrar'}
          </button>
        </form>

        {/* Alternar Registro / Login */}
        <div className="mt-4 text-xs text-fg-muted">
          {isRegister ? (
            <span>
              Já tem uma conta?{' '}
              <button
                type="button"
                onClick={() => {
                  setIsRegister(false);
                  setError('');
                }}
                className="text-link hover:underline font-medium"
              >
                Entrar
              </button>
            </span>
          ) : (
            <span>
              Precisando de uma conta?{' '}
              <button
                type="button"
                onClick={() => {
                  setIsRegister(true);
                  setError('');
                }}
                className="text-link hover:underline font-medium"
              >
                Registre-se
              </button>
            </span>
          )}
        </div>
        </>)}

        {/* Configuração de Servidor & Túnel F3 */}
        <div className="mt-6 pt-4 border-t border-line-strong flex items-center justify-between text-xs text-fg-muted">
          <span className="truncate max-w-[210px] text-[11px]" title={getServerUrl()}>
            Servidor: <strong className="text-fg-strong font-mono">{getServerUrl()}</strong>
          </span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('open-server-config'))}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-side hover:bg-hover text-fg-2 hover:text-fg-strong font-semibold transition border border-line-strong"
          >
            <Radio className="w-3.5 h-3.5" />
            Túnel (F3)
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
