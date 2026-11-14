import { analyzeRgbaBuffer } from './image-metrics.js';
import { computePCA, computeUMAP } from './projections.js';

function perceptualHash(source) {
  const canvas = new OffscreenCanvas(32, 32), ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, 32, 32);
  const rgba = ctx.getImageData(0, 0, 32, 32).data, gray = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) gray[i] = .299 * rgba[i * 4] + .587 * rgba[i * 4 + 1] + .114 * rgba[i * 4 + 2];
  const coeffs = [];
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let sum = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) sum += gray[y * 32 + x] * Math.cos(((2 * x + 1) * u * Math.PI) / 64) * Math.cos(((2 * y + 1) * v * Math.PI) / 64);
    coeffs.push(sum);
  }
  const sorted = coeffs.slice(1).sort((a, b) => a - b), median = sorted[31];
  return Uint8Array.from(coeffs.slice(1), value => value > median ? 1 : 0);
}

function findDuplicateGroups(hashes, threshold = 8) {
  const parent = hashes.map((_, i) => i);
  const root = i => parent[i] === i ? i : (parent[i] = root(parent[i]));
  for (let i = 0; i < hashes.length; i++) for (let j = i + 1; j < hashes.length; j++) {
    const a = hashes[i], b = hashes[j]; if (!a || !b || a.length !== b.length) continue;
    let distance = 0; for (let k = 0; k < a.length; k++) distance += a[k] !== b[k];
    if (distance <= threshold) parent[root(i)] = root(j);
  }
  const groups = new Map();
  for (let i = 0; i < parent.length; i++) { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  return [...groups.values()].filter(group => group.length > 1);
}

let serial = 0;
self.onmessage = async ({ data }) => {
  if (data.type === 'thumbnail') {
    let source, thumb;
    try {
      source = await createImageBitmap(data.file);
      const width = source.width || 1, height = source.height || 1;
      const scale = Math.min(1, 256 / Math.max(width, height));
      const tw = Math.max(1, Math.round(width * scale)), th = Math.max(1, Math.round(height * scale));
      const thumbCanvas = new OffscreenCanvas(tw, th), thumbCtx = thumbCanvas.getContext('2d');
      thumbCtx.drawImage(source, 0, 0, tw, th);
      const sample = new OffscreenCanvas(64, 64), sampleCtx = sample.getContext('2d', { willReadFrequently: true });
      sampleCtx.drawImage(source, 0, 0, 64, 64);
      const analysis = analyzeRgbaBuffer(sampleCtx.getImageData(0, 0, 64, 64).data, 64, 64, width, height);
      const phash = perceptualHash(source);
      thumb = thumbCanvas.transferToImageBitmap();
      self.postMessage({ type:'thumbnail', id:data.id, width, height, tw, th, analysis, phash, thumb }, [thumb]);
    } catch (error) { thumb?.close();self.postMessage({ type:'error', id:data.id, error:error?.message || 'Could not decode image' }); }
    finally { source?.close(); }
  }
  if (data.type === 'projections') {
    try { self.postMessage({ type:'projections', id:data.id, pca:computePCA(data.vectors), umap:computeUMAP(data.vectors, { nNeighbors:15, minDist:.18 }) }); }
    catch(error) { self.postMessage({ type:'error', id:data.id, error:error?.message || 'Could not compute projections' }); }
  }
  if (data.type === 'duplicates') {
    try { self.postMessage({ type:'duplicates', id:data.id, groups:findDuplicateGroups(data.hashes, data.threshold ?? 8) }); }
    catch(error) { self.postMessage({ type:'error', id:data.id, error:error?.message || 'Could not compare images' }); }
  }
};
