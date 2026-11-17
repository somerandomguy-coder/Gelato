import { analyzeFile } from './analysis.js';
import { computePCA, computeUMAP } from './projections.js';
import { findSimilarSets } from './duplicates.js';

self.onmessage = async ({ data }) => {
  const reply = (payload, transfer) => self.postMessage({ id: data.id, ...payload }, transfer);
  try {
    if (data.type === 'analyze') {
      const { preview, ...result } = await analyzeFile(data.file);
      const thumb = preview.transferToImageBitmap();
      reply({ type: 'analyze', ...result, thumb }, [thumb]);
    } else if (data.type === 'projections') {
      reply({ type: 'projections', pca: computePCA(data.vectors), umap: computeUMAP(data.vectors, { nNeighbors: 15, minDist: .18 }) });
    } else if (data.type === 'umap') {
      reply({ type: 'umap', umap: computeUMAP(data.vectors, { nNeighbors: 15, minDist: .18 }) });
    } else if (data.type === 'similar-sets') {
      reply({ type: 'similar-sets', groups: findSimilarSets(data.photos, data.level) });
    }
  } catch (error) {
    reply({ type: 'error', error: error?.message || 'Worker job failed' });
  }
};
