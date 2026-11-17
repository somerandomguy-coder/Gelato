import { defineConfig } from 'vite';

// Module workers: the image worker imports shared modules, and the AI worker
// lazy-loads its runtime from a CDN with a dynamic import().
export default defineConfig({ worker: { format: 'es' } });
