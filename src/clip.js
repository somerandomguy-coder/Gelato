// Thin client for the CLIP worker. Embeddings come from the ≤256px previews, not the
// originals: CLIP only looks at 224px anyway, and this keeps it ~3× faster.
let worker = null, serial = 0;
const pending = new Map();
let onDownload = null;

function job(message, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./clip-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'download') return onDownload?.(data.loaded, data.total);
      const p = pending.get(data.id); if (!p) return; pending.delete(data.id);
      data.type === 'error' ? p.reject(new Error(data.error)) : p.resolve(data);
    };
    worker.onerror = (e) => { pending.forEach(p => p.reject(new Error(e.message || 'AI worker stopped'))); pending.clear(); worker = null; };
  }
  const id = ++serial;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ ...message, id }, transfer); });
}

/**
 * Adds `item.embedding` to every item that lacks one.
 * onProgress({ phase: 'download' | 'images', done, total })
 */
export async function embedImages(items, onProgress = () => {}) {
  const todo = items.filter(item => !item.embedding);
  onDownload = (loaded, total) => onProgress({ phase: 'download', done: loaded, total });
  let done = 0;
  for (const item of todo) {
    const bitmap = await createImageBitmap(item.thumb);
    const { vector } = await job({ type: 'image', bitmap }, [bitmap]);
    item.embedding = vector;
    onProgress({ phase: 'images', done: ++done, total: todo.length });
  }
  return todo.length;
}

export async function embedText(prompts, onProgress = () => {}) {
  onDownload = (loaded, total) => onProgress({ phase: 'download', done: loaded, total });
  const { vectors } = await job({ type: 'text', prompts: prompts.map(p => `a photo of ${p}`) });
  return vectors;
}

export async function clearModelCache() {
  worker?.terminate(); worker = null;
  if ('caches' in self) await caches.delete('transformers-cache');
}
