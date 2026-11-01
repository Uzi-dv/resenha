import { codecFromMime, hardwareEncodeVariants, isHardwareImpl } from '../codecs';
import { enableOpusStereo, onlyVideoCodec, tuneOpus } from '../sdp';
import { CallEngine, keyOf } from './CallEngine';

/**
 * Transporte pela pilha WebRTC do navegador: uma única RTCPeerConnection com o SFU.
 *
 * - Publica tracks locais (mic, tela, áudio da tela) uma vez só; o SFU distribui.
 * - Cada publicação/assinatura vira um transceiver; this.published guarda kind -> transceiver
 *   e cada assinatura guarda { mid, transceiver }.
 */
export class BrowserCallEngine extends CallEngine {
  _resetSession() {
    super._resetSession();
    this.pc = null;
  }

  // ---------------------------------------------------------------- conexão
  async _openTransport(iceServers, gen) {
    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    this.pc = pc;
    pc.onconnectionstatechange = () =>
      this._onTransportState(pc.connectionState, gen, () => pc.connectionState === 'connected');
  }

  _closeTransport() {
    if (!this.pc) return;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }

  async _collectStats() {
    const report = await this.pc.getStats();
    let rtt = null;
    report.forEach((s) => {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded' && s.currentRoundTripTime != null) {
        rtt = Math.round(s.currentRoundTripTime * 1000);
      }
    });
    return { rtt, videoHealth: await this._videoHealth() };
  }

  /** Codec e hardware/software de cada vídeo enviado e recebido. */
  async _videoHealth() {
    const read = async (getStats, rtpType, powerKey, implKey) => {
      const report = await getStats();
      let codec = null;
      let hardware = null;
      report.forEach((s) => {
        if (s.type !== rtpType) return;
        const c = s.codecId && report.get(s.codecId);
        codec = codecFromMime(c?.mimeType) ?? codec;
        hardware = isHardwareImpl(s[powerKey], s[implKey]) ?? hardware;
      });
      return { codec, hardware };
    };
    const outbound = [];
    for (const kind of ['screen', 'camera']) {
      const transceiver = this.published.get(kind);
      if (!transceiver) continue;
      const sender = transceiver.sender;
      outbound.push({ kind, ...(await read(() => sender.getStats(), 'outbound-rtp', 'powerEfficientEncoder', 'encoderImplementation')) });
    }
    const inbound = [];
    for (const [key, sub] of this.subscriptions) {
      if (sub.kind !== 'screen' && sub.kind !== 'camera') continue;
      const receiver = sub.transceiver.receiver;
      inbound.push({
        key,
        userId: sub.userId,
        kind: sub.kind,
        ...(await read(() => receiver.getStats(), 'inbound-rtp', 'powerEfficientDecoder', 'decoderImplementation'))
      });
    }
    return { outbound, inbound };
  }

  // -------------------------------------------------------------- publicação
  /** Ajusta taxa de bits/FPS de um vídeo já publicado sem renegociar. */
  async setSendParameters(kind, { maxBitrate, maxFramerate }) {
    const sender = this.published.get(kind)?.sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.[0]) return;
    if (maxBitrate != null) params.encodings[0].maxBitrate = maxBitrate;
    if (maxFramerate != null) params.encodings[0].maxFramerate = maxFramerate;
    await sender.setParameters(params);
  }

  /**
   * Com replace, publica um transceiver novo (o SFU dá outro trackName) e só depois fecha o
   * antigo: é assim que setVideoCodec troca o codec.
   */
  async _publish(kinds, gen, { replace = false } = {}) {
    const pc = this.pc;
    const items = [];
    const replaced = [];
    for (const kind of kinds) {
      const local = this.localTracks.get(kind);
      if (!local) continue;
      const existing = this.published.get(kind);
      if (existing && !replace) {
        await existing.sender.replaceTrack(local.track);
        continue;
      }
      if (existing) {
        // A mesma track não pode ficar em dois senders: o antigo para de enviar já
        await existing.sender.replaceTrack(null);
        replaced.push({ kind, transceiver: existing });
      }
      const init = { direction: 'sendonly' };
      if (local.options.encodings) init.sendEncodings = local.options.encodings;
      const transceiver = pc.addTransceiver(local.track, init);
      // Só as variantes que a GPU codifica (ex.: o H264 42e01f pode ser só software)
      const codec = local.options.codec && codecFromMime(local.options.codec);
      if (local.options.codec && !onlyVideoCodec(transceiver, local.options.codec, hardwareEncodeVariants(codec))) {
        this.emit('codec-failed', { kind, codec });
      }
      items.push({ kind, transceiver, options: local.options });
    }
    if (!items.length) return;

    await pc.setLocalDescription(await pc.createOffer());
    const res = await this.api.rtcPublish(
      { type: 'offer', sdp: pc.localDescription.sdp },
      items.map((i) => ({ mid: i.transceiver.mid, kind: i.kind }))
    );
    if (gen !== this.generation) return;

    const stereoMids = new Set(items.filter((i) => i.options.stereo).map((i) => i.transceiver.mid));
    const dtxMids = new Set(
      items.filter((i) => i.kind === 'mic' || i.kind === 'screen_audio').map((i) => i.transceiver.mid)
    );
    await pc.setRemoteDescription({ type: 'answer', sdp: tuneOpus(res.answer.sdp, { stereoMids, dtxMids }) });

    for (const item of items) {
      const result = res.tracks.find((t) => t.mid === item.transceiver.mid);
      if (result?.error) {
        console.warn(`[CallEngine] SFU recusou a track ${item.kind}:`, result.error);
        continue;
      }
      this.published.set(item.kind, item.transceiver);
      if (item.options.degradation) {
        try {
          const params = item.transceiver.sender.getParameters();
          params.degradationPreference = item.options.degradation;
          await item.transceiver.sender.setParameters(params);
        } catch {
          /* não suportado: ignora */
        }
      }
    }

    if (!replaced.length) return;
    const toClose = [];
    for (const old of replaced) {
      if (this.published.get(old.kind) === old.transceiver) {
        // O SFU recusou o novo: o antigo volta a enviar
        await old.transceiver.sender.replaceTrack(this.localTracks.get(old.kind)?.track ?? null);
      } else {
        toClose.push({ mid: old.transceiver.mid, kind: old.kind });
        old.transceiver.stop();
      }
    }
    if (!toClose.length) return;
    await pc.setLocalDescription(await pc.createOffer());
    const closed = await this.api.rtcUnpublish({ type: 'offer', sdp: pc.localDescription.sdp }, toClose, true);
    if (gen !== this.generation) return;
    if (closed.answer) await pc.setRemoteDescription(closed.answer);
  }

  async _unpublish(kinds, gen) {
    const pc = this.pc;
    const items = kinds
      .map((kind) => ({ kind, transceiver: this.published.get(kind) }))
      .filter((i) => i.transceiver);
    if (!items.length) return;

    const tracks = items.map((i) => ({ mid: i.transceiver.mid, kind: i.kind }));
    for (const item of items) {
      this.published.delete(item.kind);
      item.transceiver.sender.replaceTrack(null).catch(() => {});
      item.transceiver.stop();
    }
    await pc.setLocalDescription(await pc.createOffer());
    const res = await this.api.rtcUnpublish({ type: 'offer', sdp: pc.localDescription.sdp }, tracks);
    if (gen !== this.generation) return;
    if (res.answer) await pc.setRemoteDescription(res.answer);
  }

  // -------------------------------------------------------------- assinatura
  async _subscribe(items, gen) {
    const pc = this.pc;
    const res = await this.api.rtcSubscribe(items.map((d) => ({ user_id: d.userId, kind: d.kind })));
    if (gen !== this.generation) return;

    const ok = [];
    for (const t of res.tracks) {
      const key = keyOf(t.user_id, t.kind);
      if (t.error || !t.mid) {
        this._markFailure(key, t.track_name || this.desired.get(key)?.trackName);
      } else {
        ok.push({ key, userId: t.user_id, kind: t.kind, trackName: t.track_name, mid: t.mid });
      }
    }

    if (res.requires_renegotiation && res.offer) {
      await pc.setRemoteDescription(res.offer);
      const answer = await pc.createAnswer();
      const stereoMids = new Set(ok.filter((o) => o.kind === 'screen_audio').map((o) => o.mid));
      await pc.setLocalDescription({ type: 'answer', sdp: enableOpusStereo(answer.sdp, stereoMids) });
      await this.api.rtcRenegotiate({ type: 'answer', sdp: pc.localDescription.sdp });
      if (gen !== this.generation) return;
    }

    for (const sub of ok) {
      const transceiver = pc.getTransceivers().find((t) => t.mid === sub.mid);
      if (transceiver) this._addSubscription({ ...sub, transceiver }, transceiver.receiver.track);
    }
  }

  async _unsubscribe(subs, gen) {
    const pc = this.pc;
    for (const sub of subs) sub.transceiver.stop();
    await pc.setLocalDescription(await pc.createOffer());
    const res = await this.api.rtcUnsubscribe({ type: 'offer', sdp: pc.localDescription.sdp }, subs.map((s) => s.mid));
    if (gen !== this.generation) return;
    if (res.answer) await pc.setRemoteDescription(res.answer);
  }
}
