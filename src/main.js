import { packLayout } from './viz-packer.js';
import { computePCA, computeUMAP, projectPCA } from './projections.js';
import { analyzeFile } from './analysis.js';
import { findSimilarSets } from './duplicates.js';
import { embedImages, embedText } from './clip.js';
import { SHOT_PROMPTS, SHOT_LABELS, APPEAL_PROMPTS, classifyShots, scoreAppeal, prepare, draftCarousel, swapSlide, addSlide, dayKey } from './carousel.js';

// ───────────────────────────── state ─────────────────────────────
const $ = (s) => document.querySelector(s);
const canvas = $('#wall'), ctx = canvas.getContext('2d');
const WORLD = 1600, GAP = 6;
const VIEWS = {
  pack: 'Every photo, packed tight',
  grid: 'In the order they were taken',
  pca: 'Photos with a similar look sit close together',
  umap: 'Lookalikes gather into neighbourhoods',
  color: 'Hue from left to right · brighter towards the top',
};
const readTheme = () => { const css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim(); return { canvas: v('--canvas'), accent: v('--accent'), soft: v('--accent-soft'), frame: v('--frame'), axis: v('--axis'), muted: v('--muted') }; };
let theme = readTheme();

const state = {
  items: [], layout: 'pack', size: 128, scale: 1, x: 0, y: 0,
  selected: new Set(), hovered: null, gesture: null, marquee: null,
  draft: null,      // { ids, order, saved } while a carousel is laid out on the wall
  meaning: false,   // "By content": similarity, maps and pulls use AI (CLIP) embeddings
  importing: false, library: '',
};

const toastEl = $('#toast');
function toast(message, ms = 2600) {
  toastEl.textContent = message;
  try { toastEl.hidePopover(); toastEl.showPopover(); } catch { /* popover unsupported: still visible via CSS */ }
  toastEl.classList.add('show'); clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.classList.remove('show'); try { toastEl.hidePopover(); } catch {} }, ms);
}

// ───────────────────────────── worker ─────────────────────────────
const worker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
  ? new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module' }) : null;
let workerBroken = !worker, serial = 0;
const pending = new Map();
if (worker) {
  worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); data.type === 'error' ? p.reject(new Error(data.error)) : p.resolve(data); };
  worker.onerror = (e) => { workerBroken = true; pending.forEach(p => p.reject(new Error(e.message || 'worker stopped'))); pending.clear(); };
}
function workerJob(type, payload) {
  if (workerBroken) return Promise.reject(new Error('worker unavailable'));
  const id = ++serial;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ type, id, ...payload }); });
}
async function analyze(file) {
  if (!workerBroken) { try { return await workerJob('analyze', { file }); } catch (error) { if (!workerBroken) throw error; } }
  const { preview, ...result } = await analyzeFile(file);
  return { ...result, thumb: preview };
}

// ───────────────────────────── import ─────────────────────────────
const SUPPORTED = /^image\/(jpeg|png|webp|gif|avif|bmp)$/;
async function addFiles(fileList, label) {
  const all = [...fileList], files = all.filter(f => SUPPORTED.test(f.type));
  const heic = all.filter(f => /hei[cf]$/i.test(f.name)).length;
  if (!files.length) return toast(heic ? 'HEIC photos can’t be opened by browsers yet. Export them as JPEG first.' : 'No photos found there.');
  if (state.draft) leaveDraft();
  if (!state.items.length) state.library = label || 'Photos';
  state.importing = true;
  const bar = $('#import-progress');
  bar.hidden = false; $('#empty').hidden = true;
  let added = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const r = await analyze(file);
      state.items.push({
        id: crypto.randomUUID(), file, name: file.name.replace(/\.[^.]+$/, ''),
        thumb: r.thumb, w: r.tw, h: r.th, width: r.width, height: r.height,
        features: r.features, hue: r.hue, luma: r.luma, phash: r.phash,
        sharpness: r.sharpness, clipped: r.clipped, takenAt: r.takenAt,
      });
      added++;
    } catch { /* unreadable file: skip it, keep going */ }
    bar.style.setProperty('--p', (i + 1) / files.length);
    if (added === 1 || i % 8 === 7) { relayout({ fit: added === 1 || i < 40 }); updateChrome(`Reading ${i + 1} of ${files.length}…`); }
  }
  // In "By content" mode new photos need their AI embedding before they can join the maps.
  if (state.meaning && !(await understandAll())) { state.meaning = false; syncSortBy(); toast('Couldn’t load the AI model, so Gelato switched back to sorting by look.'); }
  state.importing = false; bar.hidden = true;
  relayout({ fit: true }); updateChrome();
  const skipped = files.length - added;
  toast(`${added} photos ready${skipped ? ` · ${skipped} couldn’t be read` : ''}${heic ? ` · ${heic} HEIC skipped` : ''}`);
  maybeCoach();
}
const folderName = (files) => files[0]?.webkitRelativePath?.split('/')[0];

// ───────────────────────────── layouts ─────────────────────────────
const libraryItems = () => state.items.filter(i => !i.hidden);
const visibleItems = () => state.draft ? state.draft.order : libraryItems();
function tileSize(item) { const s = state.size, r = item.w / item.h; return r >= 1 ? { w: s, h: s / r } : { w: s * r, h: s }; }
function place(item, x, y, w, h) { Object.assign(item, { x, y, dw: w, dh: h }); }

function layoutPack(items) { packLayout(items, state.size, GAP).items.forEach(p => place(p.item, p.x, p.y, p.w, p.h)); }
function layoutGrid(items) {
  const rect = canvas.getBoundingClientRect(), cols = Math.max(3, Math.round(Math.sqrt(items.length * (rect.width / Math.max(1, rect.height)))));
  const cell = state.size + GAP;
  items.slice().sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0)).forEach((item, i) => {
    const d = tileSize(item), col = i % cols, row = Math.floor(i / cols);
    place(item, col * cell + (state.size - d.w) / 2, row * cell + (state.size - d.h) / 2, d.w, d.h);
  });
}
function layoutScatter(items, key) {
  ensureProjections();
  items.forEach((item, i) => {
    const c = item[key] || [Math.cos(i) * .05, Math.sin(i) * .05], d = tileSize(item);
    place(item, (c[0] + 1) / 2 * WORLD, (1 - (c[1] + 1) / 2) * WORLD, d.w, d.h);
  });
}
function layoutColour(items) { items.forEach(item => { const d = tileSize(item); place(item, item.hue * WORLD * 1.15, (1 - item.luma) * WORLD, d.w, d.h); }); }

function relayout({ fit: doFit = false } = {}) {
  const items = libraryItems();
  if (state.layout === 'pack') layoutPack(items);
  else if (state.layout === 'grid') layoutGrid(items);
  else if (state.layout === 'color') layoutColour(items);
  else layoutScatter(items, state.layout);
  for (const item of items) { item.base = { x: item.x, y: item.y, w: item.dw, h: item.dh }; item.manual = false; }
  if (doFit) requestAnimationFrame(fit);
  requestDraw();
}

// ── By look / By content ──
async function understandAll() {
  const todo = state.items.filter(i => !i.embedding);
  if (!todo.length) return true;
  const bar = $('#import-progress'); bar.hidden = false;
  try {
    await embedImages(todo, (p) => {
      bar.style.setProperty('--p', p.done / p.total);
      updateChrome(p.phase === 'download' ? `Loading AI model · ${Math.round(p.done / 1e6)} of ${Math.round(p.total / 1e6)} MB` : `Understanding ${p.done} of ${p.total}…`);
    });
    return true;
  } catch (error) { console.error(error); return false; }
  finally { if (!state.importing) bar.hidden = true; updateChrome(); }
}
function syncSortBy() { document.querySelectorAll('#sort-by [data-v]').forEach(b => b.classList.toggle('active', (b.dataset.v === 'content') === state.meaning)); }
async function setSortBy(content) {
  if (content === state.meaning || state.importing) return;
  const seg = $('#sort-by');
  if (content) {
    seg.classList.add('busy');
    const ok = await understandAll();
    seg.classList.remove('busy');
    if (!ok) { syncSortBy(); return toast('Couldn’t load the AI model. It needs an internet connection the first time.'); }
  }
  state.meaning = content; syncSortBy();
  state.items.forEach(i => i.pulled?.clear());
  relayout({ fit: true }); updateChrome();
  toast(content ? 'Sorting by what’s in the photo' : 'Sorting by colour, light and composition');
}

const vectorFor = (item) => state.meaning && item.embedding ? item.embedding : item.features;
// Vibe map (PCA) is fitted once and new photos are projected onto the same axes, so the
// map never reshuffles under you. Clusters (UMAP) can't be extended like that: new photos
// are dropped next to their closest lookalikes until you press "Re-run clusters".
const projection = { space: '', basis: null, run: 0, stale: 0, busy: false };
const UMAP_OPTS = { nNeighbors: 15, minDist: .18 };
function ensureProjections() {
  const items = state.items, space = state.meaning ? 'meaning' : 'look';
  if (state.importing || items.length < 2 || projection.busy) return;
  const fresh = items.filter(i => !i.pca);
  if (projection.space === space && projection.basis && !fresh.length) return;
  if (projection.space === space && projection.basis) return placeNewPhotos(fresh);
  // First time, or the vectors changed (AI understanding switched on): fit both from scratch.
  projection.space = space; projection.busy = true; const run = ++projection.run, vectors = items.map(vectorFor);
  $('#view-note').textContent = 'Arranging by vibe…';
  const apply = ({ pca, umap }) => {
    projection.busy = false;
    if (run !== projection.run) return;
    projection.basis = pca.basis || null; projection.stale = 0;
    items.forEach((item, i) => { item.pca = pca.coords[i]; item.umap = umap.coords[i]; });
    if (['pca', 'umap'].includes(state.layout) && !state.draft) relayout({ fit: true });
    updateChrome();
  };
  workerJob('projections', { vectors }).then(apply).catch(() => { try { apply({ pca: computePCA(vectors), umap: computeUMAP(vectors, UMAP_OPTS) }); } catch { projection.busy = false; } });
}
function placeNewPhotos(fresh) {
  const placed = state.items.filter(i => i.umap && i.pca), coords = projectPCA(fresh.map(vectorFor), projection.basis);
  fresh.forEach((item, n) => {
    item.pca = coords[n];
    const v = vectorFor(item);
    const near = placed.map(o => { const w = vectorFor(o); let d = 0; for (let k = 0; k < v.length; k++) d += (v[k] - w[k]) ** 2; return [d, o]; })
      .sort((a, b) => a[0] - b[0]).slice(0, 5).map(r => r[1]);
    const avg = (k) => near.reduce((sum, o) => sum + o.umap[k], 0) / Math.max(1, near.length);
    item.umap = near.length ? [avg(0) + (Math.random() - .5) * .04, avg(1) + (Math.random() - .5) * .04] : [0, 0];
  });
  projection.stale += fresh.length;
  updateChrome();
}
async function rerunClusters() {
  const items = state.items; if (items.length < 2 || projection.busy) return;
  projection.busy = true; const run = ++projection.run, vectors = items.map(vectorFor);
  $('#btn-recluster').disabled = true; $('#view-note').textContent = 'Re-running clusters…';
  try {
    let umap;
    try { ({ umap } = await workerJob('umap', { vectors })); } catch { umap = computeUMAP(vectors, UMAP_OPTS); }
    if (run !== projection.run) return;
    items.forEach((item, i) => { item.umap = umap.coords[i]; });
    projection.stale = 0;
    if (state.layout === 'umap' && !state.draft) relayout({ fit: true });
    toast('Clusters re-run with every photo');
  } finally { projection.busy = false; $('#btn-recluster').disabled = false; updateChrome(); }
}

function setLayout(layout) {
  if (!VIEWS[layout]) return;
  if (state.draft) leaveDraft();
  state.layout = layout;
  document.querySelectorAll('#views [data-layout]').forEach(b => b.classList.toggle('active', b.dataset.layout === layout));
  relayout({ fit: true }); updateChrome();
}

// ───────────────────────────── camera + drawing ─────────────────────────────
function bounds(items) {
  return items.reduce((b, i) => ({ minX: Math.min(b.minX, i.x), minY: Math.min(b.minY, i.y), maxX: Math.max(b.maxX, i.x + i.dw), maxY: Math.max(b.maxY, i.y + i.dh) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}
function frame(b, maxScale = 1.6) {
  const rect = canvas.getBoundingClientRect(), padX = 64, padTop = 72, padBottom = 96;
  state.scale = Math.max(.03, Math.min(maxScale, (rect.width - padX * 2) / Math.max(1, b.maxX - b.minX), (rect.height - padTop - padBottom) / Math.max(1, b.maxY - b.minY)));
  state.x = (rect.width - (b.minX + b.maxX) * state.scale) / 2;
  state.y = padTop + (rect.height - padTop - padBottom - (b.maxY - b.minY) * state.scale) / 2 - b.minY * state.scale;
  requestDraw();
}
function fit() {
  const items = visibleItems(); if (!items.length) return;
  const b = bounds(items);
  // Keep the map frame and its labels in view too.
  if (['pca', 'umap'].includes(state.layout) && !state.draft) { const m = mapBounds(); Object.assign(b, { minX: m.minX - 40, minY: m.minY - 10, maxX: m.maxX + 10, maxY: m.maxY + 40 }); }
  frame(b);
}
function zoomBy(factor, cx, cy) {
  const rect = canvas.getBoundingClientRect(); cx ??= rect.width / 2; cy ??= rect.height / 2;
  const next = Math.max(.03, Math.min(4, state.scale * factor));
  state.x = cx - (cx - state.x) * next / state.scale; state.y = cy - (cy - state.y) * next / state.scale; state.scale = next; requestDraw();
}

let drawQueued = false;
function requestDraw() { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; draw(); }); }
function resize() { const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1; canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); }
new ResizeObserver(resize).observe(canvas);

function draw() {
  const r = canvas.getBoundingClientRect(), s = state.scale;
  ctx.fillStyle = theme.canvas; ctx.fillRect(0, 0, r.width, r.height);
  const items = visibleItems().slice().sort((a, b) => Number(!!a.manual) - Number(!!b.manual));
  ctx.save(); ctx.translate(state.x, state.y); ctx.scale(s, s);
  if (state.layout === 'color' && !state.draft && items.length) {
    const g = ctx.createLinearGradient(0, 0, WORLD * 1.15, 0);
    ['#e8756a', '#e9c46a', '#7fb77e', '#5fa8c4', '#8f7cc8', '#d870a0', '#e8756a'].forEach((c, i) => g.addColorStop(i / 6, c));
    ctx.globalAlpha = .1; ctx.fillStyle = g; ctx.fillRect(-120, -120, WORLD * 1.15 + 360, WORLD + 360); ctx.globalAlpha = 1;
  }
  ctx.imageSmoothingQuality = 'high';
  const vx0 = -state.x / s, vy0 = -state.y / s, vx1 = (r.width - state.x) / s, vy1 = (r.height - state.y) / s;
  for (const item of items) {
    if (item.x + item.dw < vx0 || item.y + item.dh < vy0 || item.x > vx1 || item.y > vy1) continue;
    ctx.drawImage(item.thumb, item.x, item.y, item.dw, item.dh);
  }
  ctx.restore();
  if (['pca', 'umap'].includes(state.layout) && !state.draft && items.length) drawAxes();

  const box = (item, pad) => [state.x + item.x * s - pad, state.y + item.y * s - pad, item.dw * s + pad * 2, item.dh * s + pad * 2];
  if (state.selected.size) {
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 2;
    for (const item of items) if (state.selected.has(item.id)) ctx.strokeRect(...box(item, 2));
  }
  if (state.hovered && items.includes(state.hovered) && !state.gesture) {
    ctx.strokeStyle = theme.frame; ctx.lineWidth = 1.5; ctx.strokeRect(...box(state.hovered, 1.5));
  }
  if (state.draft) {
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    state.draft.order.forEach((item, i) => {
      const x = state.x + item.x * s + 16, y = state.y + item.y * s + 16;
      ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), x, y + .5);
    });
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  if (state.marquee) {
    const m = state.marquee, x = Math.min(m.x, m.nowX), y = Math.min(m.y, m.nowY), w = Math.abs(m.nowX - m.x), h = Math.abs(m.nowY - m.y);
    ctx.fillStyle = theme.soft; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
  }
  $('#zoom-label').textContent = `${Math.round(s * 100)}%`;
}

// The map axes have no fixed meaning (they are the strongest directions of variation),
// but a bounded frame makes the layout read as a map rather than a random scatter.
const AXES = {
  pca: ['Biggest difference →', 'Next biggest difference →'],
  umap: ['Neighbourhood direction →', 'Style separation →'],
};
// The frame hugs where the view placed the photos (not where you dragged them), so it stays put.
function mapBounds() { const b = bounds(libraryItems().map(i => i.base ? { x: i.base.x, y: i.base.y, dw: i.base.w, dh: i.base.h } : i)), pad = state.size * .5 + 24; return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }; }
function drawAxes() {
  const s = state.scale, b = mapBounds();
  const left = state.x + b.minX * s, right = state.x + b.maxX * s, top = state.y + b.minY * s, bottom = state.y + b.maxY * s;
  ctx.save();
  ctx.strokeStyle = theme.axis; ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(right, top); ctx.lineTo(right, bottom); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = theme.muted; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
  const arrow = (x, y, dx, dy) => { ctx.beginPath(); ctx.moveTo(x - dx * 7 - dy * 4, y - dy * 7 + dx * 4); ctx.lineTo(x, y); ctx.lineTo(x - dx * 7 + dy * 4, y - dy * 7 - dx * 4); ctx.stroke(); };
  arrow(right, bottom, 1, 0); arrow(left, top, 0, -1);
  for (let k = 1; k < 4; k++) {
    const tx = left + (right - left) * k / 4, ty = bottom - (bottom - top) * k / 4;
    ctx.beginPath(); ctx.moveTo(tx, bottom); ctx.lineTo(tx, bottom + 5); ctx.moveTo(left, ty); ctx.lineTo(left - 5, ty); ctx.stroke();
  }
  const [xLabel, yLabel] = AXES[state.layout].map(l => state.layout === 'pca' && l.startsWith('Biggest') ? l.replace(' →', state.meaning ? ' in subject →' : ' in look →') : l);
  ctx.fillStyle = theme.muted; ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'right'; ctx.fillText(xLabel, right, bottom + 20);
  ctx.save(); ctx.translate(left - 12, top); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(yLabel, 0, 0); ctx.restore();
  ctx.restore();
}

// ───────────────────────────── chrome ─────────────────────────────
function updateChrome(status) {
  const total = state.items.length, hidden = state.items.filter(i => i.hidden).length;
  $('#empty').hidden = total > 0 || state.importing;
  $('#library').hidden = !total;
  $('#library-name').textContent = state.library;
  $('#library-count').textContent = status || `${total - hidden} photos`;
  document.body.classList.toggle('has-photos', total > 0);
  $('#hidden-pill').hidden = !hidden || !!state.draft;
  $('#hidden-count').textContent = `${hidden} similar shot${hidden === 1 ? '' : 's'} hidden`;
  const contentNote = { pca: 'Photos of similar things sit close together', umap: 'Photos of similar things gather into neighbourhoods' };
  $('#view-note').textContent = state.draft ? '' : (state.meaning && contentNote[state.layout]) || VIEWS[state.layout];
  const clusters = state.layout === 'umap' && !state.draft && total > 1;
  $('#btn-recluster').hidden = !clusters;
  $('#btn-recluster').classList.toggle('accent', projection.stale > 0);
  $('#btn-recluster').textContent = projection.stale ? `Re-run clusters · ${projection.stale} new` : 'Re-run clusters';
  if (clusters && projection.stale) $('#view-note').textContent = `${projection.stale} new photo${projection.stale === 1 ? '' : 's'} placed next to their lookalikes`;
  const n = state.selected.size;
  $('#selection-bar').hidden = !n;
  $('#selection-count').textContent = `${n} selected`;
  $('#source-selected').textContent = `${n} selected`;
  $('#source-selected').disabled = n < 2;
}
function select(ids) { state.selected = new Set(ids); updateChrome(); requestDraw(); }

// ───────────────────────────── viewer ─────────────────────────────
let fullUrl = null;
function openViewer(item) {
  if (fullUrl) URL.revokeObjectURL(fullUrl);
  fullUrl = URL.createObjectURL(item.file);
  $('#full-image').src = fullUrl;
  const when = item.takenAt ? new Date(item.takenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  $('#full-caption').textContent = [item.name, `${item.width} × ${item.height}`, when].filter(Boolean).join('  ·  ');
  $('#viewer').showModal();
}
$('#viewer').addEventListener('close', () => { if (fullUrl) { URL.revokeObjectURL(fullUrl); fullUrl = null; $('#full-image').removeAttribute('src'); } });
$('#viewer').addEventListener('click', (e) => { if (e.target.id !== 'full-image') $('#viewer').close(); });

// ───────────────────────────── pull similar (right-click) ─────────────────────────────
const cosine = (a, b) => { let d = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return aa && bb ? d / Math.sqrt(aa * bb) : -1; };
function arrangePulled(anchor, items) {
  const stepX = Math.max(anchor.dw, state.size) + GAP * 1.5, stepY = Math.max(anchor.dh, state.size) + GAP * 1.5, acx = anchor.x + anchor.dw / 2, acy = anchor.y + anchor.dh / 2;
  const picked = new Set(items.map(i => i.id));
  const blockers = visibleItems().filter(i => i !== anchor && !picked.has(i.id) && i.manual).map(i => ({ x: i.x, y: i.y, w: i.dw, h: i.dh }));
  blockers.push({ x: anchor.x, y: anchor.y, w: anchor.dw, h: anchor.dh });
  const offsets = [];
  for (let ring = 1; ring <= 40; ring++) {
    for (let y = -ring + 1; y <= ring; y++) offsets.push([ring, y]);
    for (let x = ring - 1; x >= -ring; x--) offsets.push([x, ring]);
    for (let y = ring - 1; y >= -ring; y--) offsets.push([-ring, y]);
    for (let x = -ring + 1; x <= ring; x++) offsets.push([x, -ring]);
  }
  offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
  const overlaps = (a) => blockers.some(b => a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y);
  return items.map((item, n) => {
    const d = tileSize(item);
    let spot = null;
    for (const [gx, gy] of offsets) { const box = { x: acx + gx * stepX - d.w / 2, y: acy + gy * stepY - d.h / 2, w: d.w, h: d.h }; if (!overlaps(box)) { spot = box; break; } }
    spot ||= { x: anchor.x + anchor.dw + GAP + n * (d.w + GAP), y: anchor.y, w: d.w, h: d.h };
    blockers.push(spot);
    return { item, ...spot };
  });
}
function pullSimilar(anchor) {
  anchor.pulled ||= new Set();
  const v = vectorFor(anchor);
  const picks = visibleItems().filter(i => i !== anchor && !anchor.pulled.has(i.id))
    .map(item => ({ item, score: cosine(v, vectorFor(item)) })).sort((a, b) => b.score - a.score).slice(0, 5).map(r => r.item);
  if (!picks.length) return toast('No more lookalikes left for this photo');
  picks.forEach(i => anchor.pulled.add(i.id));
  const moves = arrangePulled(anchor, picks);
  const all = [{ x: anchor.x, y: anchor.y, w: anchor.dw, h: anchor.dh }, ...moves];
  const b = { minX: Math.min(...all.map(m => m.x)), minY: Math.min(...all.map(m => m.y)), maxX: Math.max(...all.map(m => m.x + m.w)), maxY: Math.max(...all.map(m => m.y + m.h)) };
  frame(b, state.scale); animateMoves(moves);
  anchor.manual = true;
  dismissCoach();
  toast(`Pulled ${picks.length} lookalikes · right-click again for 5 more`);
}

const activeMoves = new Map(); let moveFrame = 0;
function animateMoves(moves, duration = 380) {
  const start = performance.now();
  for (const m of moves) activeMoves.set(m.item.id, { m, start, x: m.item.x, y: m.item.y, w: m.item.dw, h: m.item.dh });
  if (moveFrame) return;
  const step = (now) => {
    moveFrame = 0;
    for (const [id, e] of activeMoves) {
      const t = Math.min(1, (now - e.start) / duration), k = 1 - (1 - t) ** 3, { m } = e;
      place(m.item, e.x + (m.x - e.x) * k, e.y + (m.y - e.y) * k, e.w + (m.w - e.w) * k, e.h + (m.h - e.h) * k);
      m.item.manual = true;
      if (t >= 1) activeMoves.delete(id);
    }
    draw();
    if (activeMoves.size) moveFrame = requestAnimationFrame(step);
  };
  moveFrame = requestAnimationFrame(step);
}
function stopMoves() { activeMoves.clear(); if (moveFrame) cancelAnimationFrame(moveFrame); moveFrame = 0; }

function tidySelection() {
  const items = visibleItems().filter(i => state.selected.has(i.id)); if (!items.length) return;
  const b = bounds(items), packed = packLayout(items, state.size, GAP);
  const ox = (b.minX + b.maxX - packed.width) / 2, oy = (b.minY + b.maxY - packed.height) / 2;
  animateMoves(packed.items.map(p => ({ item: p.item, x: p.x + ox, y: p.y + oy, w: p.w, h: p.h })));
}
function resetArrangement() {
  if (state.draft) leaveDraft();
  stopMoves();
  for (const item of state.items) { if (item.base) place(item, item.base.x, item.base.y, item.base.w, item.base.h); item.manual = false; item.pulled?.clear(); }
  select([]); fit(); toast('Back to the original arrangement');
}

// ───────────────────────────── pointer + keyboard ─────────────────────────────
const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function hit(e) {
  const p = local(e), wx = (p.x - state.x) / state.scale, wy = (p.y - state.y) / state.scale;
  // Same order as draw(): moved photos sit on top, so the last match is the one you see.
  const items = visibleItems().slice().sort((a, b) => Number(!!a.manual) - Number(!!b.manual));
  let found = null;
  for (const i of items) if (wx >= i.x && wx <= i.x + i.dw && wy >= i.y && wy <= i.y + i.dh) found = i;
  return found;
}
let spaceDown = false;
canvas.addEventListener('pointerdown', (e) => {
  const point = local(e), item = hit(e);
  if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown)) {
    state.gesture = { kind: 'pan', button: e.button, item, start: point, x: state.x, y: state.y, moved: false }; canvas.classList.add('panning');
  } else if (e.button === 0 && !item) {
    state.gesture = { kind: 'marquee', start: point, moved: false, base: e.shiftKey ? new Set(state.selected) : new Set() };
    state.marquee = { x: point.x, y: point.y, nowX: point.x, nowY: point.y };
  } else if (e.button === 0 && e.shiftKey) {
    const next = new Set(state.selected); next.has(item.id) ? next.delete(item.id) : next.add(item.id); select(next); return;
  } else if (e.button === 0) {
    if (!state.selected.has(item.id)) select([item.id]);
    const items = visibleItems().filter(i => state.selected.has(i.id));
    items.forEach(i => activeMoves.delete(i.id));
    state.gesture = { kind: 'move', item, start: point, from: items.map(i => ({ i, x: i.x, y: i.y })), moved: false };
  } else return;
  canvas.setPointerCapture(e.pointerId); requestDraw();
});
canvas.addEventListener('pointermove', (e) => {
  const g = state.gesture;
  if (!g) { const next = hit(e); if (next !== state.hovered) { state.hovered = next; canvas.style.cursor = next ? 'pointer' : ''; requestDraw(); } return; }
  const p = local(e), dx = p.x - g.start.x, dy = p.y - g.start.y;
  if (Math.hypot(dx, dy) > 4) g.moved = true;
  if (g.kind === 'pan') { state.x = g.x + dx; state.y = g.y + dy; }
  if (g.kind === 'move' && g.moved) g.from.forEach(({ i, x, y }) => { i.x = x + dx / state.scale; i.y = y + dy / state.scale; i.manual = true; });
  if (g.kind === 'marquee') {
    Object.assign(state.marquee, { nowX: p.x, nowY: p.y });
    const l = Math.min(g.start.x, p.x), rr = Math.max(g.start.x, p.x), t = Math.min(g.start.y, p.y), b = Math.max(g.start.y, p.y);
    const inside = visibleItems().filter(i => { const x = state.x + i.x * state.scale, y = state.y + i.y * state.scale; return x < rr && x + i.dw * state.scale > l && y < b && y + i.dh * state.scale > t; }).map(i => i.id);
    state.selected = new Set([...g.base, ...inside]); updateChrome();
  }
  requestDraw();
});
canvas.addEventListener('pointerup', () => {
  const g = state.gesture; if (!g) return;
  state.gesture = null; canvas.classList.remove('panning');
  if (g.kind === 'pan' && g.button === 2 && !g.moved && g.item) pullSimilar(g.item);
  if (g.kind === 'move' && !g.moved) openViewer(g.item);
  // A moved photo starts a fresh pull history, so right-clicking it again brings back its closest lookalikes.
  if (g.kind === 'move' && g.moved) g.from.forEach(({ i }) => i.pulled?.clear());
  if (g.kind === 'marquee') { if (!g.moved && !g.base.size) select([]); state.marquee = null; }
  requestDraw();
});
canvas.addEventListener('pointercancel', () => { state.gesture = null; state.marquee = null; canvas.classList.remove('panning'); requestDraw(); });
canvas.addEventListener('pointerleave', () => { if (!state.gesture && state.hovered) { state.hovered = null; requestDraw(); } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? .05 : .0015)), p.x, p.y); }, { passive: false });

const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.querySelector('dialog[open]');
window.addEventListener('keydown', (e) => {
  if (typing()) return;
  if (e.code === 'Space') { spaceDown = true; canvas.classList.add('can-pan'); e.preventDefault(); return; }
  if (!state.items.length) return;
  const views = Object.keys(VIEWS);
  if (/^Digit[1-5]$/.test(e.code)) setLayout(views[+e.code.slice(5) - 1]);
  else if (e.key === 'f' || e.key === 'F') fit();
  else if (e.key === 'Escape') { select([]); $('#help').hidden = true; }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); select(visibleItems().map(i => i.id)); }
  else if (e.key === '+' || e.key === '=') zoomBy(1.25);
  else if (e.key === '-') zoomBy(.8);
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; canvas.classList.remove('can-pan'); } });
window.addEventListener('blur', () => { spaceDown = false; canvas.classList.remove('can-pan'); });

// ───────────────────────────── copy to folder ─────────────────────────────
function safeName(name) { let s = String(name || 'photo').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'photo'; if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)) s = `_${s}`; return s; }
async function freeName(dir, wanted) {
  const safe = safeName(wanted), dot = safe.lastIndexOf('.'), stem = dot > 0 ? safe.slice(0, dot) : safe, ext = dot > 0 ? safe.slice(dot) : '';
  for (let n = 1; ; n++) {
    const name = n === 1 ? safe : `${stem} (${n})${ext}`;
    try { await dir.getFileHandle(name); } catch (e) { if (e.name === 'NotFoundError') return name; if (e.name !== 'TypeMismatchError') throw e; }
  }
}
async function copyToFolder(items, { numbered = false } = {}) {
  if (!items.length) return;
  if (typeof window.showDirectoryPicker !== 'function') return toast('Saving to a folder needs Chrome or Edge on desktop.');
  let dir;
  try { dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'gelato-export' }); } catch (e) { if (e.name !== 'AbortError') toast('Couldn’t open that folder.'); return; }
  let copied = 0;
  for (const [i, item] of items.entries()) {
    try {
      const original = item.file.name || `${item.name}.jpg`;
      const handle = await dir.getFileHandle(await freeName(dir, numbered ? `${String(i + 1).padStart(2, '0')} - ${original}` : original), { create: true });
      const out = await handle.createWritable(); await out.write(item.file); await out.close(); copied++;
    } catch { /* keep going */ }
  }
  toast(copied === items.length ? `Saved ${copied} photo${copied === 1 ? '' : 's'} to “${dir.name}” · originals untouched` : `Saved ${copied} of ${items.length} to “${dir.name}”`, 3600);
}

// ───────────────────────────── similar shots ─────────────────────────────
const dupes = { sets: [], index: 0, level: 'balanced', keep: new Set(), hiddenNow: 0, changed: false };
const clock = (t) => t ? new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
function thumbCanvas(item, w, h, cover = false) {
  const c = document.createElement('canvas'), dpr = Math.min(2, devicePixelRatio || 1); c.width = w * dpr; c.height = h * dpr;
  const x = c.getContext('2d'), iw = item.thumb.width, ih = item.thumb.height;
  const k = cover ? Math.max(c.width / iw, c.height / ih) : Math.min(c.width / iw, c.height / ih);
  x.imageSmoothingQuality = 'high'; x.drawImage(item.thumb, (c.width - iw * k) / 2, (c.height - ih * k) / 2, iw * k, ih * k);
  return c;
}
async function findDupes() {
  const items = libraryItems();
  if (items.length < 2) return toast('Add a few photos first.');
  $('#dupes-cards').innerHTML = '<p class="muted pad">Comparing photos…</p>';
  if (!$('#dupes-dialog').open) $('#dupes-dialog').showModal();
  const photos = items.map(i => ({ phash: i.phash, features: i.features, takenAt: i.takenAt, sharpness: i.sharpness, clipped: i.clipped, embedding: state.meaning ? i.embedding : undefined }));
  let groups;
  try { ({ groups } = await workerJob('similar-sets', { photos, level: dupes.level })); } catch { groups = findSimilarSets(photos, dupes.level); }
  dupes.sets = groups.map(g => ({ items: g.members.map(i => items[i]), best: items[g.best] }));
  dupes.index = 0; dupes.hiddenNow = 0;
  renderDupes();
}
function renderDupes() {
  const host = $('#dupes-cards'), set = dupes.sets[dupes.index], remaining = dupes.sets.length - dupes.index;
  host.innerHTML = '';
  $('#dupes-actions').hidden = !set;
  if (!dupes.sets.length) {
    $('#dupes-title').textContent = 'No similar shots found';
    $('#dupes-sub').textContent = dupes.level === 'loose' ? 'Every photo here looks distinct.' : 'Try “Loose” to catch frames that differ a little more.';
    $('#dupes-progress').textContent = ''; return;
  }
  if (!set) {
    $('#dupes-title').textContent = 'All sets reviewed';
    $('#dupes-sub').textContent = dupes.hiddenNow ? `${dupes.hiddenNow} shots hidden from the wall. Nothing was deleted — bring them back any time.` : 'Nothing was hidden.';
    $('#dupes-progress').textContent = ''; return;
  }
  dupes.keep = new Set([set.best.id]);
  $('#dupes-title').textContent = `${set.items.length} similar shots`;
  $('#dupes-sub').textContent = 'Keep the one you like. The rest are hidden from the wall, not deleted.';
  $('#dupes-progress').textContent = `Set ${dupes.index + 1} of ${dupes.sets.length}`;
  $('#dupes-auto').textContent = `Keep sharpest in all ${remaining} set${remaining === 1 ? '' : 's'}`;
  const size = set.items.length > 6 ? 150 : set.items.length > 3 ? 196 : 260;
  for (const item of set.items) {
    const card = document.createElement('button');
    card.type = 'button'; card.className = 'shot'; card.style.width = `${size}px`;
    const img = thumbCanvas(item, size, Math.round(size * .75));
    const meta = document.createElement('span'); meta.className = 'shot-meta';
    meta.innerHTML = `<span>${clock(item.takenAt) || item.name}</span>${item === set.best ? '<b class="tag">Sharpest</b>' : ''}`;
    const zoom = document.createElement('span'); zoom.className = 'shot-zoom'; zoom.title = 'View full size'; zoom.textContent = '⤢';
    zoom.onclick = (e) => { e.stopPropagation(); openViewer(item); };
    const mark = document.createElement('span'); mark.className = 'shot-mark';
    card.append(img, meta, zoom, mark);
    const sync = () => { const kept = dupes.keep.has(item.id); card.classList.toggle('kept', kept); mark.textContent = kept ? 'Keep' : 'Hide'; updateApply(); };
    card.onclick = () => { dupes.keep.has(item.id) ? dupes.keep.delete(item.id) : dupes.keep.add(item.id); if (!dupes.keep.size) dupes.keep.add(item.id); sync(); };
    sync(); host.append(card);
  }
}
function updateApply() {
  const set = dupes.sets[dupes.index]; if (!set) return;
  const hide = set.items.length - dupes.keep.size;
  $('#dupes-apply').textContent = hide ? `Keep ${dupes.keep.size}, hide ${hide}` : 'Keep all';
}
function applySet(set, keep) {
  if (!set) return;
  for (const item of set.items) if (!keep.has(item.id)) { item.hidden = true; dupes.hiddenNow++; dupes.changed = true; state.selected.delete(item.id); }
}
$('#btn-duplicates').onclick = findDupes;
$('#dupes-apply').onclick = () => { applySet(dupes.sets[dupes.index], dupes.keep); dupes.index++; renderDupes(); updateChrome(); };
$('#dupes-skip').onclick = () => { dupes.index++; renderDupes(); };
$('#dupes-auto').onclick = () => {
  applySet(dupes.sets[dupes.index], dupes.keep);
  for (let i = dupes.index + 1; i < dupes.sets.length; i++) applySet(dupes.sets[i], new Set([dupes.sets[i].best.id]));
  dupes.index = dupes.sets.length; renderDupes(); updateChrome();
};
$('#dupes-level').onclick = (e) => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  dupes.level = b.dataset.v; segActivate(b); findDupes();
};
$('#dupes-dialog').addEventListener('close', () => { if (dupes.changed) { dupes.changed = false; relayout({ fit: true }); } updateChrome(); });
$('#btn-restore').onclick = () => { state.items.forEach(i => { i.hidden = false; }); relayout({ fit: true }); updateChrome(); toast('All shots are back on the wall'); };

// ───────────────────────────── carousel ─────────────────────────────
const car = { ctx: null, slides: [], opts: null, shotVectors: null, appealVectors: null, source: 'all', count: 7 };
function progress(text, fraction) {
  const el = $('#carousel-progress'); el.hidden = text == null;
  if (text != null) { el.querySelector('span').textContent = text; el.style.setProperty('--p', fraction ?? 0); el.classList.toggle('indeterminate', fraction == null); }
}
const mb = (n) => `${Math.round(n / 1e6)} MB`;
async function draftIt() {
  const pool = car.source === 'selected' ? libraryItems().filter(i => state.selected.has(i.id)) : libraryItems();
  const count = car.count;
  if (pool.length < 2) return toast('Add a few photos first.');
  const musts = $('#carousel-musts').value.split(/[,\n;]/).map(s => s.trim()).filter(Boolean);
  const mixRaw = { solo: +$('#mix-solo').value || 0, group: +$('#mix-group').value || 0, place: +$('#mix-place').value || 0 };
  const mix = mixRaw.solo + mixRaw.group + mixRaw.place ? mixRaw : null;
  const spreadDays = $('#spread-days').checked;
  const button = $('#btn-draft'); button.disabled = true;
  let mustVectors = [];
  try {
    const onProgress = (p) => p.phase === 'download'
      ? progress(`Loading the on-device AI model · ${mb(p.done)} of ${mb(p.total)}`, p.done / p.total)
      : progress(`Looking at your photos · ${p.done} of ${p.total}`, p.done / p.total);
    progress('Starting the on-device AI model…');
    await embedImages(pool, onProgress);
    car.appealVectors ||= await embedText(APPEAL_PROMPTS, onProgress);
    const feel = $('#carousel-feel').value.trim();
    const [feelVector] = feel ? await embedText([feel], onProgress) : [null];
    scoreAppeal(pool, car.appealVectors, feelVector);
    if (mix) { car.shotVectors ||= await embedText(Object.values(SHOT_PROMPTS), onProgress); classifyShots(pool, car.shotVectors); }
    if (musts.length) mustVectors = await embedText(musts, onProgress);
    car.opts = { spreadDays };
    car.ctx = prepare(pool);
    car.slides = draftCarousel(car.ctx, { count, musts: musts.map((label, i) => ({ label, vector: mustVectors[i] })), mix, spreadDays });
    const days = [...new Set(pool.map(i => i.takenAt).filter(Boolean).sort((a, b) => a - b).map(dayKey))];
    car.dayIndex = new Map(days.map((d, i) => [d, i + 1]));
    progress(null); renderSlides();
  } catch (error) {
    console.error(error);
    progress(null);
    $('#slides').innerHTML = `<li class="slides-error">Couldn’t reach the AI model (${error.message}). The first draft needs an internet connection to download it; after that it works offline.</li>`;
  } finally { button.disabled = false; }
}
function roleLabel(slide) {
  if (slide.role.type === 'must') return `“${slide.role.label}”`;
  if (slide.role.type === 'shot') return SHOT_LABELS[slide.role.shot];
  return '';
}
let dragFrom = -1;
function renderSlides() {
  const host = $('#slides'); host.innerHTML = '';
  $('#carousel-foot').hidden = !car.slides.length;
  car.slides.forEach((slide, i) => {
    const li = document.createElement('li'); li.className = 'slide'; li.draggable = true;
    const day = car.ctx.multiDay && car.dayIndex.get(dayKey(slide.item.takenAt));
    const tags = [roleLabel(slide), day ? `Day ${day}` : ''].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
    li.innerHTML = `<span class="slide-n">${i + 1}${i === 0 ? ' · cover' : ''}</span><div class="slide-tools"><button class="mini" data-act="swap" title="Swap for another photo">↻ Swap</button><button class="mini" data-act="view" title="View full size">⤢</button><button class="mini" data-act="remove" title="Remove slide">×</button></div><div class="slide-tags">${tags}</div>`;
    li.prepend(thumbCanvas(slide.item, 140, 175, true));
    li.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'swap') { if (!swapSlide(car.ctx, car.slides, i, car.opts)) toast('No other good match for this slide'); renderSlides(); }
      if (act === 'view') openViewer(slide.item);
      if (act === 'remove') { car.slides.splice(i, 1); renderSlides(); }
    };
    li.ondragstart = (e) => { dragFrom = i; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    li.ondragend = () => li.classList.remove('dragging');
    li.ondragover = (e) => { e.preventDefault(); li.classList.add('drop-target'); };
    li.ondragleave = () => li.classList.remove('drop-target');
    li.ondrop = (e) => { e.preventDefault(); if (dragFrom < 0 || dragFrom === i) return renderSlides(); const [moved] = car.slides.splice(dragFrom, 1); car.slides.splice(i, 0, moved); dragFrom = -1; renderSlides(); };
    host.append(li);
  });
  if (car.slides.length && car.slides.length < 20) {
    const add = document.createElement('li'); add.className = 'slide add'; add.innerHTML = '<button type="button">＋<span>Add a slide</span></button>';
    add.onclick = () => { if (!addSlide(car.ctx, car.slides, car.opts)) toast('No more distinct photos to add'); renderSlides(); };
    host.append(add);
  }
}
function showDraftOnWall() {
  const items = car.slides.map(s => s.item); if (!items.length) return;
  if (state.draft) leaveDraft();
  state.draft = { order: items, saved: new Map(items.map(i => [i.id, { x: i.x, y: i.y, w: i.dw, h: i.dh }])) };
  const size = state.size * 1.6; let x = 0;
  for (const item of items) { const r = item.w / item.h, h = size * 1.25, w = Math.min(size * 1.6, h * r); place(item, x, 0, w, h); x += w + GAP * 3; }
  select([]); $('#carousel-dialog').close();
  $('#draft-banner').hidden = false; $('#draft-name').textContent = `Carousel draft · ${items.length} slides`;
  updateChrome(); fit();
}
function leaveDraft() {
  if (!state.draft) return;
  for (const item of state.draft.order) { const p = state.draft.saved.get(item.id); if (p) place(item, p.x, p.y, p.w, p.h); }
  state.draft = null; $('#draft-banner').hidden = true; updateChrome(); fit();
}
function openCarousel(source) {
  if (!libraryItems().length) return toast('Add some photos first.');
  car.source = source || (state.selected.size >= 2 ? 'selected' : 'all');
  segActivate($(`#carousel-source [data-v="${car.source}"]`));
  updateChrome(); $('#carousel-dialog').showModal();
}
$('#btn-carousel').onclick = () => openCarousel();
$('#carousel-form').onsubmit = (e) => { e.preventDefault(); draftIt(); };
$('#slide-count').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) { car.count = +b.dataset.v; segActivate(b); } };
$('#carousel-source').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) { car.source = b.dataset.v; segActivate(b); } };
$('#btn-show-carousel').onclick = showDraftOnWall;
$('#btn-export-carousel').onclick = () => copyToFolder(car.slides.map(s => s.item), { numbered: true });
$('#btn-leave-draft').onclick = leaveDraft;
$('#btn-edit-draft').onclick = () => $('#carousel-dialog').showModal();

// ───────────────────────────── controls ─────────────────────────────
function segActivate(button) { if (!button) return; button.parentElement.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('active', b === button)); }
$('#views').onclick = (e) => { const b = e.target.closest('[data-layout]'); if (b && state.items.length) setLayout(b.dataset.layout); };
$('#btn-fit').onclick = fit;
$('#btn-zoom-in').onclick = () => zoomBy(1.25);
$('#btn-zoom-out').onclick = () => zoomBy(.8);
$('#btn-reset').onclick = resetArrangement;
$('#size-range').oninput = (e) => { state.size = +e.target.value; relayout({ fit: true }); };
$('#btn-tidy').onclick = tidySelection;
$('#btn-copy').onclick = () => copyToFolder(visibleItems().filter(i => state.selected.has(i.id)));
$('#btn-carousel-from-selection').onclick = () => openCarousel('selected');
$('#btn-deselect').onclick = () => select([]);
$('#btn-theme').onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('gelato-theme', dark ? 'dark' : 'light'); } catch {}
  theme = readTheme(); requestDraw();
};
$('#btn-recluster').onclick = rerunClusters;
// One how-to, shown in the ? card and behind "How does this work?" in the carousel dialog.
document.querySelectorAll('.howto-slot').forEach(slot => slot.append($('#carousel-howto').content.cloneNode(true)));
$('#btn-howto').onclick = () => { const p = $('#howto-panel'); p.hidden = !p.hidden; $('#btn-howto').textContent = p.hidden ? 'How does this work?' : 'Hide tips'; };
// Example chips add their phrase to the field (comma-separated for moments, replacing for feel).
document.querySelectorAll('.chips').forEach(group => group.onclick = (e) => {
  const chip = e.target.closest('button'); if (!chip) return;
  const input = $('#' + group.dataset.for), word = chip.textContent;
  if (group.dataset.for === 'carousel-feel') input.value = word;
  else { const parts = input.value.split(',').map(x => x.trim()).filter(Boolean); if (!parts.includes(word)) parts.push(word); input.value = parts.join(', '); }
  input.focus();
});
$('#sort-by').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b && state.items.length) setSortBy(b.dataset.v === 'content'); };
$('#btn-help').onclick = () => { $('#help').hidden = !$('#help').hidden; };
document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
document.querySelectorAll('dialog.sheet').forEach(d => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

const pickFolder = () => $('#folder-input').click();
$('#btn-empty-folder').onclick = pickFolder;
$('#btn-add').onclick = pickFolder;
$('#btn-empty-files').onclick = () => $('#image-input').click();
$('#folder-input').onchange = (e) => { const f = [...e.target.files]; addFiles(f, folderName(f)); e.target.value = ''; };
$('#image-input').onchange = (e) => { addFiles(e.target.files, 'Photos'); e.target.value = ''; };
$('#btn-clear').onclick = () => {
  if (!confirm('Close this library? Your photo files are not affected.')) return;
  stopMoves(); state.items.forEach(i => i.thumb.close?.());
  Object.assign(state, { items: [], selected: new Set(), hovered: null, draft: null, meaning: false, library: '' }); syncSortBy();
  Object.assign(projection, { space: '', basis: null, stale: 0, busy: false }); projection.run++; car.slides = []; car.ctx = null; $('#slides').innerHTML = ''; $('#carousel-foot').hidden = true; $('#draft-banner').hidden = true;
  updateChrome(); requestDraw();
};

// Drag a folder or photos anywhere onto the window.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; dragDepth++; document.body.classList.add('dropping'); });
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
  const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  const files = [];
  const walk = async (entry) => {
    if (entry.isFile) files.push(await new Promise((res, rej) => entry.file(res, rej)));
    else if (entry.isDirectory) { const reader = entry.createReader(); let batch; do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const child of batch) await walk(child); } while (batch.length); }
  };
  if (entries.length) for (const entry of entries) await walk(entry); else files.push(...e.dataTransfer.files);
  addFiles(files, entries.length === 1 && entries[0].isDirectory ? entries[0].name : 'Photos');
});

// First-run tip for the one gesture people can't discover on their own.
function maybeCoach() { try { if (localStorage.getItem('gelato-coached')) return; } catch {} $('#coach').hidden = false; }
function dismissCoach() { $('#coach').hidden = true; try { localStorage.setItem('gelato-coached', '1'); } catch {} }
$('#coach-close').onclick = dismissCoach;

// ───────────────────────────── sample photos ─────────────────────────────
// Procedural "trip" photos over three days, including a couple of bursts,
// so every feature has something to show without a real folder.
async function samplePhotos() {
  const scenes = [
    ['Harbour dawn', ['#f6c8a0', '#e98f6f', '#2f4f6b'], 0], ['Harbour dawn', ['#f6c8a0', '#e98f6f', '#2f4f6b'], 0], ['Harbour dawn', ['#f7caa2', '#e88d6c', '#2f4f6b'], 0],
    ['Coast walk', ['#bfe0ef', '#6fb0cc', '#d9c19a'], 0], ['Lighthouse', ['#cfe6f2', '#ffffff', '#3f6e8c'], 0], ['Café table', ['#e9d8c4', '#8a5a3c', '#3b2a22'], 0],
    ['Rainforest', ['#9fc38f', '#3d6b45', '#1f3524'], 1], ['Rainforest', ['#a2c592', '#3c6a44', '#1f3524'], 1], ['Waterfall', ['#c9e2dc', '#6d9f95', '#263b37'], 1],
    ['Market', ['#f2c46d', '#d0623f', '#5a2e2a'], 1], ['Night street', ['#1a1d33', '#f0b04a', '#c23b6b'], 1], ['Night street', ['#1b1e35', '#efae48', '#c13a69'], 1],
    ['Beach noon', ['#8fd0ea', '#f3e2b6', '#e8c98f'], 2], ['Beach noon', ['#90d1eb', '#f3e1b4', '#e7c88d'], 2], ['Cliffs', ['#a8c8d8', '#8c7a63', '#4a3f35'], 2],
    ['Sunset', ['#ffb36b', '#e0566a', '#3a2349'], 2], ['Sunset', ['#ffb56d', '#df5469', '#3a2349'], 2], ['Blue hour', ['#4a5f8f', '#9fb3d9', '#1c2238'], 2],
  ];
  const day0 = new Date(2026, 9, 3, 7, 0).getTime();
  // Repeated names are bursts: a couple of seconds after the previous frame.
  const times = []; scenes.forEach(([name, , day], i) => { times.push(scenes[i - 1]?.[0] === name ? times[i - 1] + 2000 : day0 + day * 864e5 + i * 1.9e6); });
  return Promise.all(scenes.map(async ([name, [sky, mid, ground]], i) => {
    const w = i % 5 === 2 ? 900 : 1200, h = i % 5 === 2 ? 1200 : 800, c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    const jitter = (i % 3) * 7, g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, sky); g.addColorStop(.62, mid); g.addColorStop(1, ground); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.arc(w * (.25 + (name.length % 5) * .12) + jitter, h * .3, h * .09, 0, Math.PI * 2); x.fill();
    x.fillStyle = ground; x.beginPath(); x.moveTo(0, h * .72);
    for (let k = 0; k <= 12; k++) x.lineTo(k * w / 12, h * (.68 + .08 * Math.sin(k * (1 + name.length % 4) + jitter * .01)));
    x.lineTo(w, h); x.lineTo(0, h); x.fill();
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: .85 });
    return new File([blob], `${name} ${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg', lastModified: times[i] });
  }));
}
$('#btn-sample').onclick = async () => addFiles(await samplePhotos(), 'Sample trip');

updateChrome(); resize();
if (import.meta.env.DEV) window.__gelato = { state, addFiles };
