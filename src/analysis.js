// Per-photo analysis shared by the image worker and the main-thread fallback.
// Everything here runs on a small preview, never on the original file.
import { analyzeRgbaBuffer } from './image-metrics.js';

const makeCanvas = (w, h) => typeof OffscreenCanvas !== 'undefined'
  ? new OffscreenCanvas(w, h)
  : Object.assign(document.createElement('canvas'), { width: w, height: h });

/** 63-bit DCT perceptual hash: survives resizing, re-encoding and small exposure changes. */
export function perceptualHash(source) {
  const canvas = makeCanvas(32, 32), ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, 32, 32);
  const rgba = ctx.getImageData(0, 0, 32, 32).data, gray = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) gray[i] = .299 * rgba[i * 4] + .587 * rgba[i * 4 + 1] + .114 * rgba[i * 4 + 2];
  const cos = new Float32Array(8 * 32);
  for (let u = 0; u < 8; u++) for (let x = 0; x < 32; x++) cos[u * 32 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 64);
  const coeffs = [];
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let sum = 0;
    for (let y = 0; y < 32; y++) { const cy = cos[v * 32 + y]; for (let x = 0; x < 32; x++) sum += gray[y * 32 + x] * cos[u * 32 + x] * cy; }
    coeffs.push(sum);
  }
  const ac = coeffs.slice(1), median = ac.slice().sort((a, b) => a - b)[31];
  return Uint8Array.from(ac, value => value > median ? 1 : 0);
}

/** Laplacian variance of the preview: a cheap "which frame is in focus" signal. */
export function sharpness(rgba, w, h) {
  if (w < 3 || h < 3) return 0;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = .299 * rgba[i * 4] + .587 * rgba[i * 4 + 1] + .114 * rgba[i * 4 + 2];
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
    sum += lap; sumSq += lap * lap; n++;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

/** Capture time from JPEG EXIF (DateTimeOriginal), or null. Reads only the first 256 KB. */
export async function exifTakenAt(file) {
  try {
    if (!/jpe?g/i.test(file.type)) return null;
    const view = new DataView(await file.slice(0, 262144).arrayBuffer());
    if (view.getUint16(0) !== 0xFFD8) return null;
    for (let off = 2; off + 10 < view.byteLength;) {
      const marker = view.getUint16(off), len = view.getUint16(off + 2);
      if ((marker & 0xFF00) !== 0xFF00) return null;
      if (marker === 0xFFE1 && view.getUint32(off + 4) === 0x45786966) return tiffDate(view, off + 10);
      off += 2 + len;
    }
  } catch { /* malformed or truncated EXIF: fall back to file time */ }
  return null;
}

function tiffDate(view, start) {
  const le = view.getUint16(start) === 0x4949;
  const u16 = o => view.getUint16(start + o, le), u32 = o => view.getUint32(start + o, le);
  const ifd = (o) => { const tags = {}; for (let i = 0, n = u16(o); i < n; i++) { const e = o + 2 + i * 12; tags[u16(e)] = { count: u32(e + 4), at: e + 8 }; } return tags; };
  const text = (tag) => { if (!tag) return null; const at = tag.count > 4 ? u32(tag.at) : tag.at; let s = ''; for (let i = 0; i < tag.count - 1; i++) s += String.fromCharCode(view.getUint8(start + at + i)); return s; };
  const ifd0 = ifd(u32(4)), exif = ifd0[0x8769] ? ifd(u32(ifd0[0x8769].at)) : {};
  const value = text(exif[0x9003]) || text(exif[0x9004]) || text(ifd0[0x0132]);
  const m = value && /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(value);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}

/** Decode one photo into a ≤256px preview plus everything the wall needs to sort and compare it. */
export async function analyzeFile(file) {
  const source = await createImageBitmap(file);
  try {
    const width = source.width || 1, height = source.height || 1, scale = Math.min(1, 256 / Math.max(width, height));
    const tw = Math.max(1, Math.round(width * scale)), th = Math.max(1, Math.round(height * scale));
    const preview = makeCanvas(tw, th), pctx = preview.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(source, 0, 0, tw, th);
    const sample = makeCanvas(64, 64), sctx = sample.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(source, 0, 0, 64, 64);
    const analysis = analyzeRgbaBuffer(sctx.getImageData(0, 0, 64, 64).data, 64, 64, width, height);
    const { photo } = analysis;
    return {
      preview, width, height, tw, th,
      features: Array.from(analysis.vector),
      hue: analysis.primaryHsl.h / 360,
      luma: analysis.primaryHsl.l,
      phash: perceptualHash(preview),
      sharpness: sharpness(pctx.getImageData(0, 0, tw, th).data, tw, th),
      clipped: Math.min(1, photo.shadowClip + photo.highlightClip),
      takenAt: (await exifTakenAt(file)) ?? file.lastModified ?? 0,
    };
  } finally { source.close(); }
}
