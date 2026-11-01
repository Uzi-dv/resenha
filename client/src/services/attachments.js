import { api } from './api';

/**
 * Imagens anexadas no chat (colar, arrastar ou escolher).
 *
 * Até 8 MB a imagem vai como está (sem perder qualidade). Acima disso, é recomprimida em WebP:
 * primeiro baixando a qualidade, depois reduzindo a resolução, até caber. GIFs não são
 * recomprimidos (perderiam a animação), então acima do limite são recusados.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
const MAX_DIMENSION = 4096; // lado maior, só aplicado quando é preciso comprimir
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const formatBytes = (n) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function loadBitmap(file) {
  return createImageBitmap(file);
}

function encode(bitmap, width, height, quality) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/webp', quality });
}

async function compress(file, bitmap) {
  let scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  for (let round = 0; round < 6; round++) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    for (const quality of [0.9, 0.8, 0.7]) {
      const blob = await encode(bitmap, w, h, quality);
      if (blob.size <= MAX_ATTACHMENT_BYTES) {
        const name = file.name.replace(/\.[^.]+$/, '') + '.webp';
        return { file: new File([blob], name, { type: 'image/webp' }), width: w, height: h, compressed: true };
      }
    }
    scale *= 0.75;
  }
  throw new Error('Não foi possível comprimir a imagem para menos de 8 MB.');
}

/** Valida e, se precisar, comprime. Devolve { file, width, height, compressed, originalSize }. */
export async function prepareImage(file) {
  if (!ACCEPTED.includes(file.type)) {
    throw new Error('Só dá para enviar imagens PNG, JPG, WebP ou GIF.');
  }
  const bitmap = await loadBitmap(file).catch(() => {
    throw new Error('Não foi possível ler esta imagem.');
  });
  try {
    if (file.size <= MAX_ATTACHMENT_BYTES) {
      return { file, width: bitmap.width, height: bitmap.height, compressed: false, originalSize: file.size };
    }
    if (file.type === 'image/gif') {
      throw new Error(`GIFs precisam ter até 8 MB (este tem ${formatBytes(file.size)}).`);
    }
    const result = await compress(file, bitmap);
    return { ...result, originalSize: file.size };
  } finally {
    bitmap.close();
  }
}

/** Nome com a extensão que o servidor aceita (imagens coladas chegam como "image.png"). */
function uploadName(file) {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
  const base = (file.name || 'imagem').replace(/\.[^.]+$/, '') || 'imagem';
  return `${base}.${ext}`;
}

export async function uploadAttachment(prepared) {
  const form = new FormData();
  form.append('file', prepared.file, uploadName(prepared.file));
  const res = await api.uploadAttachment(form);
  return {
    url: res.url,
    name: prepared.file.name || 'imagem',
    size: res.size ?? prepared.file.size,
    width: prepared.width,
    height: prepared.height
  };
}
