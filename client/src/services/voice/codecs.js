/**
 * Codecs de vídeo com aceleração por hardware.
 *
 * - Ordem de preferência: AV1 → H265 → H264, sempre em hardware (nunca por software).
 * - Cada cliente descobre o que a GPU codifica/decodifica e informa ao servidor; o publicador
 *   escolhe o primeiro codec que ele codifica e que todos os espectadores decodificam.
 * - Se as estatísticas mostrarem codificação/decodificação por software, o codec é marcado como
 *   falho nesta sessão e a escolha desce para o próximo da lista.
 */

export const CODEC_CHAIN = ['AV1', 'H265', 'H264'];
export const GPU_ERROR_MESSAGE = 'Não foi possível encontrar uma gpu compatível, atualize os seus drivers de vídeo.';

const MIME = { AV1: 'video/AV1', H265: 'video/H265', H264: 'video/H264' };
// Perfil da sondagem: o máximo que o app transmite (720p30)
const PROBE = { width: 1280, height: 720, bitrate: 2_500_000, framerate: 30 };
const SOFTWARE_IMPL = /openh264|libvpx|libaom|dav1d|ffmpeg|software/i;

export const mimeOf = (codec) => MIME[codec];
export const codecFromMime = (mime) => CODEC_CHAIN.find((c) => MIME[c].toLowerCase() === mime?.toLowerCase()) || null;

let caps = { encode: [], decode: [] };
let encodeVariants = {}; // codec -> sdpFmtpLines das variantes com codificação por hardware
let probing = null;
const listeners = new Set();

/**
 * Variantes do codec que o WebRTC oferece, com os parâmetros do SDP
 * (ex.: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f").
 * Sem os parâmetros, o H264 vale como packetization-mode=0, que só o OpenH264 (software) atende.
 */
function rtpVariants(direction, mime) {
  const cls = direction === 'encode' ? globalThis.RTCRtpSender : globalThis.RTCRtpReceiver;
  const codecs = cls?.getCapabilities?.('video')?.codecs || [];
  const fmtps = codecs.filter((c) => c.mimeType.toLowerCase() === mime.toLowerCase()).map((c) => c.sdpFmtpLine || '');
  return [...new Set(fmtps)];
}

/** sdpFmtpLines das variantes com caminho por hardware (powerEfficient). */
async function hardwareVariants(direction, codec) {
  const mime = MIME[codec];
  const variants = rtpVariants(direction, mime);
  if (!navigator.mediaCapabilities || !variants.length) return [];
  const query =
    direction === 'encode'
      ? (config) => navigator.mediaCapabilities.encodingInfo(config)
      : (config) => navigator.mediaCapabilities.decodingInfo(config);
  const results = await Promise.all(
    variants.map(async (fmtp) => {
      try {
        const contentType = fmtp ? `${mime};${fmtp}` : mime;
        const info = await query({ type: 'webrtc', video: { contentType, ...PROBE } });
        return Boolean(info.supported && info.powerEfficient);
      } catch {
        return false;
      }
    })
  );
  return variants.filter((_, i) => results[i]);
}

/** Descobre (uma vez) os codecs com hardware. Resolve com { encode, decode }. */
export function probeHardwareCodecs() {
  if (!probing) {
    probing = (async () => {
      const [encode, decode] = await Promise.all(
        ['encode', 'decode'].map(async (direction) => {
          const found = await Promise.all(CODEC_CHAIN.map((c) => hardwareVariants(direction, c)));
          if (direction === 'encode') encodeVariants = Object.fromEntries(CODEC_CHAIN.map((c, i) => [c, found[i]]));
          // Basta uma variante com hardware para o codec contar
          return CODEC_CHAIN.filter((_, i) => found[i].length);
        })
      );
      caps = { encode, decode };
      console.info('[Codecs] Hardware disponível:', caps, 'variantes de codificação:', encodeVariants);
      listeners.forEach((fn) => fn(caps));
      return caps;
    })();
  }
  return probing;
}

export const hardwareCodecs = () => caps;

/** sdpFmtpLines das variantes do codec que a GPU codifica (null = sondagem ainda não terminou). */
export const hardwareEncodeVariants = (codec) => encodeVariants[codec] ?? null;

/** O codec caiu para software (ou não foi negociado): fica fora da lista até reiniciar o app. */
export function markCodecFailed(direction, codec) {
  if (!codec || !caps[direction].includes(codec)) return;
  console.warn(`[Codecs] ${codec} sem ${direction === 'encode' ? 'codificação' : 'decodificação'} por hardware; descartado.`);
  caps = { ...caps, [direction]: caps[direction].filter((c) => c !== codec) };
  listeners.forEach((fn) => fn(caps));
}

export function onHardwareCodecsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Primeiro codec da lista que eu codifico e que todos os espectadores decodificam.
 * Se nenhum servir para todos, fica com o que atende mais gente (quem sobra é avisado no próprio app).
 * Retorna null quando não há nenhum codificador por hardware.
 */
export function chooseVideoCodec(encode, viewerDecodes) {
  let best = null;
  let bestCount = -1;
  for (const codec of CODEC_CHAIN) {
    if (!encode.includes(codec)) continue;
    const count = viewerDecodes.filter((d) => d.includes(codec)).length;
    if (count === viewerDecodes.length) return codec;
    if (count > bestCount) {
      best = codec;
      bestCount = count;
    }
  }
  return best;
}

/** true = hardware, false = software, null = ainda não dá para saber (sem quadros). */
export function isHardwareImpl(powerEfficient, implementation) {
  if (typeof powerEfficient === 'boolean') return powerEfficient;
  if (!implementation || implementation === 'unknown') return null;
  return !SOFTWARE_IMPL.test(implementation);
}
