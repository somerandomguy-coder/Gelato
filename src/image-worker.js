import { analyzeRgbaBuffer } from './image-metrics.js';
import { computePCA, computeUMAP } from './projections.js';

let serial = 0;
self.onmessage = async ({ data }) => {
  if (data.type === 'thumbnail') {
    try {
      const source = await createImageBitmap(data.file);
      const width = source.width || 1, height = source.height || 1;
      const scale = Math.min(1, 320 / Math.max(width, height));
      const tw = Math.max(1, Math.round(width * scale)), th = Math.max(1, Math.round(height * scale));
      const thumbCanvas = new OffscreenCanvas(tw, th), thumbCtx = thumbCanvas.getContext('2d');
      thumbCtx.drawImage(source, 0, 0, tw, th);
      const sample = new OffscreenCanvas(64, 64), sampleCtx = sample.getContext('2d', { willReadFrequently: true });
      sampleCtx.drawImage(source, 0, 0, 64, 64); source.close();
      const analysis = analyzeRgbaBuffer(sampleCtx.getImageData(0, 0, 64, 64).data, 64, 64, width, height);
      const thumb = thumbCanvas.transferToImageBitmap();
      self.postMessage({ type:'thumbnail', id:data.id, width, height, tw, th, analysis, thumb }, [thumb]);
    } catch (error) { self.postMessage({ type:'error', id:data.id, error:error?.message || 'Could not decode image' }); }
  }
  if (data.type === 'projections') {
    try { self.postMessage({ type:'projections', id:data.id, pca:computePCA(data.vectors), umap:computeUMAP(data.vectors, { nNeighbors:15, minDist:.18 }) }); }
    catch(error) { self.postMessage({ type:'error', id:data.id, error:error?.message || 'Could not compute projections' }); }
  }
};
