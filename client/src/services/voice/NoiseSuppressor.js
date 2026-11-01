/**
 * Supressão de ruído por IA (RNNoise em WebAssembly, rodando numa AudioWorklet).
 *
 * Tudo é carregado sob demanda (só quem ativa a opção baixa os ~300 KB) e embutido
 * no bundle: o worklet vira um Blob URL e o wasm vem em base64 (plugin no vite.config).
 * Assim funciona igual no Vite dev e no Electron empacotado (sem fetch de file://).
 */
let assetsPromise = null;
const loadedContexts = new WeakSet();

// Mesmo teste de SIMD usado pela biblioteca
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function loadAssets() {
  assetsPromise ||= (async () => {
    const simd = WebAssembly.validate(SIMD_PROBE);
    const [lib, worklet, wasm] = await Promise.all([
      import('@sapphi-red/web-noise-suppressor'),
      import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?raw'),
      simd
        ? import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?b64')
        : import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?b64')
    ]);
    return {
      RnnoiseWorkletNode: lib.RnnoiseWorkletNode,
      wasmBinary: base64ToArrayBuffer(wasm.default),
      workletUrl: URL.createObjectURL(new Blob([worklet.default], { type: 'text/javascript' }))
    };
  })().catch((err) => {
    assetsPromise = null;
    throw err;
  });
  return assetsPromise;
}

/** Cria um nó RNNoise mono. O AudioContext precisa estar a 48 kHz. */
export async function createRnnoiseNode(ctx) {
  if (ctx.sampleRate !== 48000) throw new Error('RNNoise requer AudioContext a 48 kHz');
  const { RnnoiseWorkletNode, wasmBinary, workletUrl } = await loadAssets();
  if (!loadedContexts.has(ctx)) {
    await ctx.audioWorklet.addModule(workletUrl);
    loadedContexts.add(ctx);
  }
  return new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
}
