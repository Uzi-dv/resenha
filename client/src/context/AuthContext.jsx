import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getAuthToken, setAuthToken, recoverServerUrl } from '../services/api';
import { gateway } from '../services/gateway';
import { alertDialog } from '../services/dialog';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  const logout = useCallback(() => {
    setBootError(null);
    setAuthToken(null);
    setUser(null);
    gateway.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      const token = getAuthToken();
      setBootError(null);
      if (token) {
        try {
          let me;
          try {
            me = await api.getMe();
          } catch (err) {
            // Sem rede até o servidor: talvez o endereço salvo seja um túnel antigo que morreu
            if (err.status !== 0 || !(await recoverServerUrl())) throw err;
            me = await api.getMe();
          }
          if (cancelled) return;
          setUser(me);
          gateway.connect(token);
        } catch (err) {
          if (cancelled) return;
          console.warn('Não foi possível restaurar a sessão:', err);
          // Só descarta o token se ele for realmente inválido (não por falta de rede)
          if (err.status === 401) setAuthToken(null);
          else setBootError(err.message);
        }
      }
      if (!cancelled) setLoading(false);
    }
    loadUser();
    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  const retryBoot = useCallback(() => {
    setLoading(true);
    setBootAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    // Sessão encerrada por um administrador: o servidor avisa o motivo antes de fechar a conexão
    let revokedReason = null;
    const offRevoked = gateway.on('SESSION_REVOKED', (d) => {
      revokedReason = d?.reason || 'Sua sessão foi encerrada.';
    });
    const offInvalid = gateway.on('INVALID_SESSION', () => {
      logout();
      if (revokedReason) alertDialog(revokedReason, 'Você foi desconectado');
      revokedReason = null;
    });
    const onUnauthorized = () => logout();
    window.addEventListener('resenha-unauthorized', onUnauthorized);
    const offUserUpdate = gateway.on('USER_UPDATE', (u) => {
      setUser((prev) => (prev && prev.id === u.id ? { ...prev, ...u, presence: prev.presence } : prev));
    });
    return () => {
      offRevoked();
      offInvalid();
      offUserUpdate();
      window.removeEventListener('resenha-unauthorized', onUnauthorized);
    };
  }, [logout]);

  const withServerRecovery = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 0 && (await recoverServerUrl())) return fn();
      throw err;
    }
  };

  /** Entra com a resposta do servidor. Se falta confirmar o e-mail, devolve { verify: email } (o servidor já mandou o código). */
  const startSession = (data) => {
    if (data.verification_required) return { verify: data.email };
    setAuthToken(data.access_token);
    setUser(data.user);
    gateway.connect(data.access_token);
    return { user: data.user };
  };

  const login = async (email, password) => startSession(await withServerRecovery(() => api.login(email, password)));

  const register = async (username, email, password, avatarUrl = '', bannerUrl = '') =>
    startSession(await withServerRecovery(() => api.register(username, email, password, avatarUrl, bannerUrl)));

  const verifyEmail = async (email, code) => startSession(await api.verifyEmail(email, code));

  const resetPassword = async (email, code, password) => startSession(await api.resetPassword(email, code, password));

  const updateProfile = async (profileData) => {
    const updated = await api.updateProfile(profileData);
    setUser(updated);
    return updated;
  };

  return (
    <AuthContext.Provider
      value={{
        user, loading, bootError, retryBoot, login, register, verifyEmail, resetPassword, logout, updateProfile,
        isAuthenticated: !!user
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  return context;
}
