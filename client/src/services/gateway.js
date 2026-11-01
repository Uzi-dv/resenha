import { getServerUrl } from './api';
import { Emitter, createStore } from './store';

const MAX_BACKOFF_MS = 15000;

/**
 * Conexão em tempo real com o servidor.
 * - Heartbeat com detecção de conexão "meio aberta" (comum em túneis ngrok/cloudflare).
 * - Reconexão automática com backoff exponencial + jitter.
 * - Eventos do servidor são reemitidos pelo nome (READY, MESSAGE_CREATE, ...).
 */
class Gateway extends Emitter {
  constructor() {
    super();
    this.status = createStore({ state: 'disconnected', latency: null, attempt: 0 });
    this.ws = null;
    this.token = null;
    this.attempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.lastAck = 0;
    this.connectionId = null;

    window.addEventListener('online', () => {
      if (this.token && this.status.getState().state !== 'connected') this.reconnectNow();
    });
  }

  connect(token) {
    this.token = token;
    this.attempt = 0;
    this._open();
  }

  disconnect() {
    this.token = null;
    clearTimeout(this.reconnectTimer);
    this._teardown();
    this._setStatus({ state: 'disconnected', latency: null });
  }

  reconnectNow() {
    clearTimeout(this.reconnectTimer);
    this.attempt = 0;
    this._open();
  }

  get connected() {
    return this.status.getState().state === 'connected';
  }

  send(op, data = {}) {
    if (this.ws?.readyState === WebSocket.OPEN && this.connected) {
      this.ws.send(JSON.stringify({ op, ...data }));
      return true;
    }
    return false;
  }

  _setStatus(patch) {
    this.status.setState((s) => ({ ...s, ...patch }));
  }

  _teardown() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        /* já fechado */
      }
      this.ws = null;
    }
  }

  _open() {
    if (!this.token) return;
    this._teardown();
    this._setStatus({ state: this.attempt > 0 ? 'reconnecting' : 'connecting', attempt: this.attempt });

    const base = getServerUrl().replace(/^http/i, 'ws');
    const ws = new WebSocket(`${base}/ws?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!msg?.t) return;
      if (msg.t === 'READY') this._onReady(msg.d);
      else if (msg.t === 'HEARTBEAT_ACK') this._onAck(msg.d);
      this.emit(msg.t, msg.d);
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this._teardown();
      if (event.code === 4001) {
        this.token = null;
        this._setStatus({ state: 'disconnected' });
        this.emit('INVALID_SESSION');
        return;
      }
      this.emit('DISCONNECTED');
      this._scheduleReconnect();
    };

    ws.onerror = () => {
      /* onclose cuida da reconexão */
    };
  }

  _onReady(data) {
    this.attempt = 0;
    this.connectionId = data.connection_id;
    this.lastAck = Date.now();
    this._setStatus({ state: 'connected', attempt: 0 });
    const interval = data.heartbeat_interval || 15000;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      // Sem ACK por 2 intervalos = conexão morta (túnel caiu sem fechar o socket)
      if (Date.now() - this.lastAck > interval * 2 + 2000) {
        console.warn('[Gateway] Heartbeat sem resposta; reconectando.');
        this.ws?.onclose?.({ code: 4000 }); // fecha o socket e agenda reconexão
        return;
      }
      this.ws?.send(JSON.stringify({ op: 'heartbeat', t: Date.now() }));
    }, interval);
  }

  _onAck(data) {
    this.lastAck = Date.now();
    if (data?.t) this._setStatus({ latency: Date.now() - data.t });
  }

  _scheduleReconnect() {
    if (!this.token) return;
    this.attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(this.attempt, 5)) + Math.random() * 500;
    this._setStatus({ state: 'reconnecting', attempt: this.attempt });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._open(), delay);
  }
}

export const gateway = new Gateway();
