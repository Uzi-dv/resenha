/** Taxa do áudio das transmissões (Opus estéreo): 64 kbps soa quase igual a 128 e economiza o SFU. */
export const SCREEN_AUDIO_BITRATE = 64000;

/**
 * Ajusta os parâmetros Opus por seção de áudio:
 * - stereoMids: estéreo + SCREEN_AUDIO_BITRATE (áudio das transmissões)
 * - dtxMids: DTX (quase nada é enviado durante o silêncio — voz e áudio das transmissões)
 */
export function tuneOpus(sdp, { stereoMids = new Set(), dtxMids = new Set() } = {}) {
  if (!stereoMids.size && !dtxMids.size) return sdp;
  return sdp
    .split(/(?=^m=)/m)
    .map((section) => {
      if (!section.startsWith('m=audio')) return section;
      const mid = /^a=mid:([^\r\n]+)/m.exec(section)?.[1];
      const stereo = stereoMids.has(mid);
      const dtx = dtxMids.has(mid);
      if (!stereo && !dtx) return section;
      const pt = /^a=rtpmap:(\d+) opus\/48000\/2/im.exec(section)?.[1];
      if (!pt) return section;
      return section.replace(new RegExp(`^a=fmtp:${pt} ([^\\r\\n]*)`, 'm'), (_line, params) => {
        const extra = [];
        if (stereo) extra.push('stereo=1', 'sprop-stereo=1', `maxaveragebitrate=${SCREEN_AUDIO_BITRATE}`);
        if (dtx) extra.push('usedtx=1');
        const keys = new Set(extra.map((e) => e.split('=')[0]));
        const kept = params
          .split(';')
          .map((p) => p.trim())
          .filter((p) => p && !keys.has(p.split('=')[0]));
        return `a=fmtp:${pt} ${[...kept, ...extra].join(';')}`;
      });
    })
    .join('');
}

/** Atalho: só estéreo. */
export function enableOpusStereo(sdp, mids) {
  return tuneOpus(sdp, { stereoMids: mids });
}

const REPAIR_CODECS = /^video\/(rtx|red|ulpfec|flexfec)/i;

// Perfis H264 (primeiro byte do profile-level-id), do mais eficiente ao menos: High > Main > Baseline
const H264_PROFILE_RANK = { 64: 0, '4d': 1, 42: 2 };

function h264Rank(fmtp = '') {
  const profile = /profile-level-id=([0-9a-f]{2})/i.exec(fmtp)?.[1]?.toLowerCase();
  const byProfile = H264_PROFILE_RANK[profile] ?? 3;
  // packetization-mode=1 é exigido pela maioria dos SFUs
  return byProfile * 2 + (/packetization-mode=1/.test(fmtp) ? 0 : 1);
}

/**
 * Restringe o transceiver a um único codec de vídeo (mais os de recuperação: RTX/RED/FEC),
 * para o navegador não negociar outro por conta própria. Com `fmtps`, só oferece essas
 * variantes (as que a GPU codifica). Retorna false se não deu.
 */
export function onlyVideoCodec(transceiver, mime, fmtps = null) {
  const caps = RTCRtpSender.getCapabilities?.('video')?.codecs;
  if (!caps || typeof transceiver.setCodecPreferences !== 'function') return false;
  const allowed = fmtps && new Set(fmtps);
  const wanted = caps.filter(
    (c) => c.mimeType.toLowerCase() === mime.toLowerCase() && (!allowed || allowed.has(c.sdpFmtpLine || ''))
  );
  if (!wanted.length) return false;
  if (/h264/i.test(mime)) wanted.sort((a, b) => h264Rank(a.sdpFmtpLine) - h264Rank(b.sdpFmtpLine));
  try {
    transceiver.setCodecPreferences([...wanted, ...caps.filter((c) => REPAIR_CODECS.test(c.mimeType))]);
    return true;
  } catch (err) {
    console.warn('[SDP] setCodecPreferences falhou:', err);
    return false;
  }
}
