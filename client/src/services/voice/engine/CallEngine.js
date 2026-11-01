import { createRtcApi } from '../../api';
import { Emitter } from '../../store';

const DISCONNECTED_GRACE_MS = 5000;
const MAX_RESTART_DELAY_MS = 15000;

export const keyOf = (userId, kind) => `${userId}:${kind}`;

/**
 * Base de uma sessão com o Cloudflare Realtime SFU, independente da pilha WebRTC.
 *
 * Aqui fica só a política: ciclo de vida (conectar, cair, reconectar com backoff), a fila
 * serial de operações (o SFU exige uma negociação por vez), o registro das tracks locais
 * (sobrevive a reconexões) e a reconciliação declarativa do que assinar (setDesired).
 *
 * O transporte fica nas subclasses (BrowserCallEngine, ElectronCallEngine), que implementam:
 *   _openTransport(iceServers, gen)   cria a conexão; avisa mudanças via _onTransportState(state, gen)
 *   _closeTransport()                 fecha tudo o que _openTransport criou
 *   _publish(kinds, gen, { replace }) envia this.localTracks[kind]; registra em this.published
 *   _unpublish(kinds, gen)            para de enviar; remove de this.published
 *   _subscribe(items, gen)            assina; chama _addSubscription / _markFailure
 *   _unsubscribe(subs, gen)           encerra assinaturas já removidas de this.subscriptions
 *   _collectStats()                   -> { rtt, videoHealth: { outbound, inbound } }
 *   setSendParameters(kind, params)   { maxBitrate, maxFramerate } de um vídeo publicado
 *
 * Eventos: 'state' ('connecting'|'connected'|'reconnecting'|'failed'|'idle'), 'track',
 * 'track-ended', 'session', 'stats', 'video-health', 'codec-failed', 'error'.
 * 'track' entrega uma MediaStreamTrack: é o que a UI e o AudioEngine consomem.
 */
export class CallEngine extends Emitter {
  constructor({ rtcApi } = {}) {
    super();
    this.api = rtcApi || createRtcApi();
    this.state = 'idle';
    this.active = false;
    this.generation = 0;
    this.localTracks = new Map(); // kind -> { track, options } (sobrevive a reconexões)
    this.desired = new Map(); // key -> { userId, kind, trackName }
    this.restartAttempts = 0;
    this._resetSession();
  }

  _resetSession() {
    this.connected = false; // transporte aberto (as subclasses põem o resto do estado aqui)
    this.sessionId = null;
    this.queue = Promise.resolve();
    this.published = new Map(); // kind -> handle do transporte
    this.subscriptions = new Map(); // key -> { userId, kind, trackName, ...handle do transporte }
    this.failures = new Map(); // key -> { trackName, count, until }
    this.syncQueued = false;
  }

  _setState(state) {
    if (this.state !== state) {
      this.state = state;
      this.emit('state', state);
    }
  }

  // ------------------------------------------------------------ ciclo de vida
  async start() {
    this.active = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const gen = ++this.generation;
    this._teardown();
    this._setState(this.everConnected ? 'reconnecting' : 'connecting');
    this.starting = true;

    try {
      const { ice_servers: iceServers } = await this.api.rtcConfig();
      if (gen !== this.generation) return;
      await this._openTransport(iceServers, gen);
      if (gen !== this.generation) return;
      this.connected = true;

      const { session_id: sessionId } = await this.api.rtcSession();
      if (gen !== this.generation) return;
      this.sessionId = sessionId;
      this.starting = false;
      this.emit('session', sessionId);

      const kinds = [...this.localTracks.keys()];
      if (kinds.length) await this._enqueue((g) => this._publish(kinds, g));
      this.requestSync();
      this._startStats(gen);
    } catch (err) {
      if (gen !== this.generation) return;
      this.starting = false;
      console.warn('[CallEngine] Falha ao iniciar sessão:', err);
      this.emit('error', err);
      if (err.status === 409) return; // não está mais na call
      if (err.status === 503) {
        // Servidor sem Cloudflare configurado: tentar de novo não adianta
        this._setState('failed');
        return;
      }
      this._scheduleRestart();
    }
  }

  stop() {
    this.active = false;
    this.starting = false;
    this.generation += 1;
    clearTimeout(this.restartTimer);
    this._teardown();
    this.localTracks.clear();
    this.desired.clear();
    this.everConnected = false;
    this.restartAttempts = 0;
    this._setState('idle');
  }

  _teardown() {
    clearTimeout(this.disconnectTimer);
    clearInterval(this.statsTimer);
    for (const sub of this.subscriptions.values()) {
      this.emit('track-ended', { key: keyOf(sub.userId, sub.kind), userId: sub.userId, kind: sub.kind });
    }
    try {
      this._closeTransport();
    } catch {
      /* ok */
    }
    this._resetSession();
  }

  _scheduleRestart(delay) {
    if (!this.active || this.restartTimer) return;
    this.restartAttempts += 1;
    const wait = delay ?? Math.min(MAX_RESTART_DELAY_MS, 1000 * 2 ** Math.min(this.restartAttempts - 1, 4));
    this._setState('reconnecting');
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.active) this.start();
    }, wait);
  }

  /** Recria a mídia do zero (ex.: o servidor perdeu nossa sessão após uma queda longa). */
  restart() {
    if (this.active) this.start();
  }

  /** Chamado pelo transporte: 'connected' | 'disconnected' | 'failed'. isConnected() confirma após a carência. */
  _onTransportState(state, gen, isConnected) {
    if (gen !== this.generation) return;
    if (state === 'connected') {
      clearTimeout(this.disconnectTimer);
      this.everConnected = true;
      this.restartAttempts = 0;
      this._setState('connected');
    } else if (state === 'disconnected') {
      this._setState('reconnecting');
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = setTimeout(() => {
        if (gen === this.generation && !isConnected?.()) this._scheduleRestart(0);
      }, DISCONNECTED_GRACE_MS);
    } else if (state === 'failed') {
      this._scheduleRestart(300);
    }
  }

  _startStats(gen) {
    clearInterval(this.statsTimer);
    this.statsTimer = setInterval(async () => {
      if (gen !== this.generation || !this.connected) return;
      try {
        const { rtt, videoHealth } = await this._collectStats();
        if (gen !== this.generation) return;
        this.emit('stats', { rtt });
        this.emit('video-health', videoHealth);
      } catch {
        /* transporte fechado */
      }
    }, 2000);
  }

  // ------------------------------------------------------------------- fila
  _enqueue(fn) {
    const gen = this.generation;
    const run = async () => {
      if (gen !== this.generation || !this.connected) return;
      try {
        await fn(gen);
      } catch (err) {
        if (gen !== this.generation) return;
        console.warn('[CallEngine] Operação de mídia falhou; reconectando:', err);
        this.emit('error', err);
        if (err.status === 409) return;
        // Estado da negociação pode ter ficado inconsistente com o SFU: recomeça limpo
        this._scheduleRestart(500);
      }
    };
    this.queue = this.queue.then(run);
    return this.queue;
  }

  // -------------------------------------------------------------- publicação
  /** Publica (ou atualiza) tracks locais. options: { encodings, codec (mime), stereo, degradation } */
  publish(entries) {
    const kinds = [];
    for (const { kind, track, options } of entries) {
      this.localTracks.set(kind, { track, options: options || {} });
      kinds.push(kind);
    }
    if (!this.sessionId) return Promise.resolve();
    return this._enqueue((gen) => this._publish(kinds, gen));
  }

  /**
   * Troca o codec de um vídeo já publicado: publica de novo (o SFU dá outro trackName e
   * quem assiste reassina sozinho) e só depois fecha o antigo.
   */
  setVideoCodec(kind, mime) {
    const local = this.localTracks.get(kind);
    if (!local || local.options.codec === mime) return Promise.resolve();
    local.options = { ...local.options, codec: mime };
    if (!this.sessionId || !this.published.has(kind)) return Promise.resolve();
    return this._enqueue((gen) => this._publish([kind], gen, { replace: true }));
  }

  unpublish(kinds) {
    kinds.forEach((k) => this.localTracks.delete(k));
    if (!this.sessionId) return Promise.resolve();
    return this._enqueue((gen) => this._unpublish(kinds, gen));
  }

  // -------------------------------------------------------------- assinatura
  /** Lista do que queremos receber: [{ userId, kind, trackName }] */
  setDesired(list) {
    this.desired = new Map(list.map((d) => [keyOf(d.userId, d.kind), d]));
    this.requestSync();
  }

  requestSync() {
    if (this.syncQueued || !this.sessionId) return;
    this.syncQueued = true;
    this._enqueue(async (gen) => {
      this.syncQueued = false;
      await this._sync(gen);
    });
  }

  async _sync(gen) {
    const now = Date.now();
    const toRemove = [];
    for (const [key, sub] of this.subscriptions) {
      const want = this.desired.get(key);
      if (!want || want.trackName !== sub.trackName) toRemove.push(key);
    }
    if (toRemove.length) {
      const subs = toRemove.map((key) => this.subscriptions.get(key));
      for (const sub of subs) {
        this.subscriptions.delete(keyOf(sub.userId, sub.kind));
        this.emit('track-ended', { key: keyOf(sub.userId, sub.kind), userId: sub.userId, kind: sub.kind });
      }
      await this._unsubscribe(subs, gen);
    }
    if (gen !== this.generation) return;

    const toAdd = [];
    for (const [key, want] of this.desired) {
      if (this.subscriptions.has(key)) continue;
      const failure = this.failures.get(key);
      if (failure && failure.trackName === want.trackName && failure.until > now) continue;
      toAdd.push(want);
    }
    for (let i = 0; i < toAdd.length; i += 8) {
      await this._subscribe(toAdd.slice(i, i + 8), gen);
      if (gen !== this.generation) return;
    }
  }

  /** Assinatura aceita pelo transporte: sub = { key, userId, kind, trackName, ...handle } */
  _addSubscription(sub, track) {
    this.failures.delete(sub.key);
    this.subscriptions.set(sub.key, sub);
    this.emit('track', { key: sub.key, userId: sub.userId, kind: sub.kind, trackName: sub.trackName, track });
    // Algo pode ter mudado enquanto negociávamos (ex.: alguém parou a tela)
    if (this.desired.get(sub.key)?.trackName !== sub.trackName) this.requestSync();
  }

  _markFailure(key, trackName) {
    const prev = this.failures.get(key);
    const count = prev && prev.trackName === trackName ? prev.count + 1 : 1;
    const delay = Math.min(10000, 500 * 2 ** count);
    this.failures.set(key, { trackName, count, until: Date.now() + delay });
    setTimeout(() => this.requestSync(), delay + 50);
  }

  // ------------------------------------------------------ contrato do transporte
  async _openTransport() {
    throw new Error(`${this.constructor.name} não implementa _openTransport`);
  }

  _closeTransport() {}

  async _publish() {
    throw new Error(`${this.constructor.name} não implementa _publish`);
  }

  async _unpublish() {
    throw new Error(`${this.constructor.name} não implementa _unpublish`);
  }

  async _subscribe() {
    throw new Error(`${this.constructor.name} não implementa _subscribe`);
  }

  async _unsubscribe() {
    throw new Error(`${this.constructor.name} não implementa _unsubscribe`);
  }

  async _collectStats() {
    return { rtt: null, videoHealth: { outbound: [], inbound: [] } };
  }

  async setSendParameters() {}
}
