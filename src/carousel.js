// Drafts an ordered carousel the way people describe one out loud:
// "seven photos, three group and four solo, one at the Golden Gate Bridge, spread across the days".
// Every slide is a suggestion — the person can swap, remove or reorder any of them.
import { standardize, frameQuality } from './duplicates.js';

// Prompts are prefixed with "a photo of". `other` absorbs animals, food and close-ups
// so they are not miscounted as solo shots; it is never requested in a mix.
export const SHOT_PROMPTS = {
  solo: 'a single person, a portrait of one person',
  group: 'a group of people posing together',
  place: 'a landscape or scenery with no people in it',
  other: 'an animal, food, a sign or an object up close',
};
export const SHOT_LABELS = { solo: 'Solo', group: 'Group', place: 'Place' };
// Zero-shot "would you post this?" signal: closer to the first prompt than the second.
export const APPEAL_PROMPTS = ['a beautiful, eye-catching, well composed moment', 'a boring, blurry, cluttered and badly framed picture'];

const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };
export const dayKey = (time) => { if (!time) return ''; const d = new Date(time); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** Tag each item solo / group / place from its CLIP embedding. */
export function classifyShots(items, shotVectors) {
  const kinds = Object.keys(SHOT_PROMPTS);
  for (const item of items) {
    if (!item.embedding) continue;
    const scores = kinds.map((_, i) => dot(item.embedding, shotVectors[i]));
    item.shot = kinds[scores.indexOf(Math.max(...scores))];
  }
}

/** Score how post-worthy each photo looks, from its CLIP embedding. */
// An optional "overall feel" (e.g. "golden hour") tilts every pick towards that look.
export function scoreAppeal(items, [good, bad], feel = null) {
  for (const item of items) if (item.embedding) item.appeal = dot(item.embedding, good) - dot(item.embedding, bad) + (feel ? 1.5 * dot(item.embedding, feel) : 0);
}

const percentiles = (values) => {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), out = new Array(values.length);
  order.forEach(([, i], rank) => { out[i] = values.length > 1 ? rank / (values.length - 1) : 1; });
  return out;
};

/** Precompute what scoring needs once per draft. */
export function prepare(pool) {
  const look = standardize(pool.map(item => item.features));
  // Appeal leads; sharpness mostly just keeps blurry frames out (on its own it favours foliage and gravel).
  const sharp = percentiles(pool.map(frameQuality)), appeal = percentiles(pool.map(item => item.appeal ?? 0));
  const quality = pool.map((item, i) => item.appeal === undefined ? sharp[i] : .8 * appeal[i] + .2 * Math.min(1, sharp[i] * 2.5));
  const index = new Map(pool.map((item, i) => [item.id, i]));
  const vec = (item) => item.embedding || look[index.get(item.id)];
  const days = new Set(pool.map(item => dayKey(item.takenAt)).filter(Boolean));
  return { pool, quality, index, vec, multiDay: days.size > 1 };
}

function similarity(ctx, a, b) {
  return a.embedding && b.embedding ? dot(a.embedding, b.embedding) : dot(ctx.vec(a), ctx.vec(b));
}

/** Best candidate for one slot, given what is already on the carousel. */
function pickFor(ctx, role, chosen, excluded, opts) {
  const usedDays = new Set(chosen.map(item => dayKey(item.takenAt)));
  const chosenIds = new Set(chosen.map(item => item.id));
  let best = null, bestScore = -Infinity;
  for (const item of ctx.pool) {
    if (chosenIds.has(item.id) || excluded.has(item.id)) continue;
    if (role.type === 'shot' && item.shot !== role.shot) continue;
    const closest = chosen.length ? Math.max(...chosen.map(other => similarity(ctx, item, other))) : 0;
    const nearDuplicate = item.embedding ? closest > .94 : closest > .9;
    if (nearDuplicate) continue;
    const quality = ctx.quality[ctx.index.get(item.id)];
    const novelty = 1 - Math.max(0, closest);
    const freshDay = opts.spreadDays && ctx.multiDay && !usedDays.has(dayKey(item.takenAt)) ? 1 : 0;
    let score = .4 * quality + .45 * novelty + .15 * freshDay;
    if (role.type === 'must') score = 3 * dot(item.embedding, role.vector) + .15 * quality;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return best;
}

/** Fill the slide roles: must-haves first, then the requested shot mix, then free picks. */
export function draftCarousel(ctx, { count, musts = [], mix = null, spreadDays = true }) {
  const roles = musts.slice(0, count).map(m => ({ type: 'must', label: m.label, vector: m.vector }));
  if (mix) for (const shot of Object.keys(SHOT_LABELS)) for (let i = 0; i < (mix[shot] || 0) && roles.length < count; i++) roles.push({ type: 'shot', shot });
  while (roles.length < count) roles.push({ type: 'free' });

  const slides = [], chosen = [];
  for (const role of roles) {
    const item = pickFor(ctx, role, chosen, new Set(), { spreadDays })
      ?? (role.type === 'shot' ? pickFor(ctx, { type: 'free' }, chosen, new Set(), { spreadDays }) : null);
    if (!item) continue;
    chosen.push(item); slides.push({ item, role, rejected: new Set() });
  }
  return orderSlides(ctx, slides);
}

/** Strongest frame leads as the cover; the rest tell the story in the order it happened. */
function orderSlides(ctx, slides) {
  if (slides.length < 3) return slides;
  const cover = slides.reduce((a, b) => ctx.quality[ctx.index.get(b.item.id)] > ctx.quality[ctx.index.get(a.item.id)] ? b : a);
  const rest = slides.filter(s => s !== cover).sort((a, b) => (a.item.takenAt || 0) - (b.item.takenAt || 0));
  return [cover, ...rest];
}

/** Append one more free pick that adds variety. */
export function addSlide(ctx, slides, { spreadDays = true } = {}) {
  const item = pickFor(ctx, { type: 'free' }, slides.map(s => s.item), new Set(), { spreadDays });
  if (item) slides.push({ item, role: { type: 'free' }, rejected: new Set() });
  return Boolean(item);
}

/** Replace one slide with the next-best photo for the same role. */
export function swapSlide(ctx, slides, index, { spreadDays = true } = {}) {
  const slide = slides[index];
  slide.rejected.add(slide.item.id);
  const others = slides.filter((_, i) => i !== index).map(s => s.item);
  const next = pickFor(ctx, slide.role, others, slide.rejected, { spreadDays })
    ?? pickFor(ctx, { type: 'free' }, others, slide.rejected, { spreadDays });
  if (next) slide.item = next;
  return Boolean(next);
}
