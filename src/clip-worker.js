// CLIP runs here so the wall stays responsive while photos are being understood.
// Nothing is downloaded until the main thread sends the first job.
const MODEL = 'Xenova/clip-vit-base-patch32';
const RUNTIME = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js';
let T, processor, vision, tokenizer, text;
const loaded = {}, total = {};

function progress(event) {
  if (event.status !== 'progress' || !event.total) return;
  loaded[event.file] = event.loaded; total[event.file] = event.total;
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  self.postMessage({ type: 'download', loaded: sum(loaded), total: sum(total) });
}

async function load(needText) {
  if (!T) {
    T = await import(/* @vite-ignore */ RUNTIME);
    T.env.allowLocalModels = false; T.env.useBrowserCache = true;
  }
  const opts = { progress_callback: progress };
  if (!vision) [processor, vision] = await Promise.all([T.AutoProcessor.from_pretrained(MODEL, opts), T.CLIPVisionModelWithProjection.from_pretrained(MODEL, opts)]);
  if (needText && !text) [tokenizer, text] = await Promise.all([T.AutoTokenizer.from_pretrained(MODEL, opts), T.CLIPTextModelWithProjection.from_pretrained(MODEL, opts)]);
}

const unit = (data) => { const v = Array.from(data), n = Math.hypot(...v) || 1; return v.map(x => x / n); };

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'image') {
      await load(false);
      const { bitmap } = data, canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const image = new T.RawImage(new Uint8ClampedArray(pixels), canvas.width, canvas.height, 4).rgb();
      const { image_embeds } = await vision(await processor(image));
      self.postMessage({ type: 'result', id: data.id, vector: unit(image_embeds.data) });
    } else if (data.type === 'text') {
      await load(true);
      const tokens = tokenizer(data.prompts, { padding: true, truncation: true });
      const { text_embeds } = await text(tokens), [rows, dim] = text_embeds.dims;
      const vectors = Array.from({ length: rows }, (_, r) => unit(text_embeds.data.slice(r * dim, (r + 1) * dim)));
      self.postMessage({ type: 'result', id: data.id, vectors });
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, error: error?.message || 'AI model failed' });
  }
};
