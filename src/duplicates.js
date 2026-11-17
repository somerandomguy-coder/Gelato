// Finds sets of near-identical shots (bursts, re-takes, re-saves) so the person can keep
// the best one. Several weak signals are combined because a perceptual hash alone only
// catches re-saved copies, not two frames of the same pose taken a second apart.

export const LEVELS = {
  strict:   { hash: 8,  hashNear: 14, look: .90, burstMs: 10_000,  meaning: .95 },
  balanced: { hash: 12, hashNear: 20, look: .80, burstMs: 45_000,  meaning: .92 },
  loose:    { hash: 14, hashNear: 24, look: .72, burstMs: 90_000,  meaning: .9 },
};
const MAX_SET = 16;

/** z-score each feature across the library, then unit-normalise, so cosine reflects real differences. */
export function standardize(vectors) {
  const n = vectors.length, d = vectors[0]?.length || 0, mean = new Float64Array(d), sd = new Float64Array(d);
  for (const v of vectors) for (let k = 0; k < d; k++) mean[k] += v[k] / n;
  for (const v of vectors) for (let k = 0; k < d; k++) sd[k] += (v[k] - mean[k]) ** 2 / n;
  for (let k = 0; k < d; k++) sd[k] = Math.sqrt(sd[k]) || 1;
  return vectors.map(v => {
    const z = new Float32Array(d); let norm = 0;
    for (let k = 0; k < d; k++) { z[k] = (v[k] - mean[k]) / sd[k]; norm += z[k] * z[k]; }
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < d; k++) z[k] /= norm;
    return z;
  });
}

const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };
const hamming = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] !== b[k]; return s; };

/** Higher is better: in focus and not blown out. Used to suggest which frame to keep. */
export const frameQuality = (p) => p.sharpness * (1 - .6 * (p.clipped || 0));

/**
 * photos: [{ phash, features, takenAt, embedding?, sharpness, clipped }]
 * returns: [{ members: number[] (time order), best: number }]
 */
export function findSimilarSets(photos, level = 'balanced') {
  const t = LEVELS[level] || LEVELS.balanced, n = photos.length;
  if (n < 2) return [];
  const look = standardize(photos.map(p => p.features));
  const meaning = photos.every(p => p.embedding) ? photos.map(p => p.embedding) : null;
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = photos[i], b = photos[j];
    const h = a.phash && b.phash ? hamming(a.phash, b.phash) : 64;
    const sim = dot(look[i], look[j]);
    const sameBurst = a.takenAt && b.takenAt && Math.abs(a.takenAt - b.takenAt) <= t.burstMs;
    const clip = meaning ? dot(meaning[i], meaning[j]) : 0;
    const match = h <= t.hash
      || (h <= t.hashNear && sim >= t.look)
      || (sameBurst && (sim >= t.look - .12 || h <= t.hashNear + 2))
      || (meaning && clip >= t.meaning && sim >= t.look - .2);
    // Strongest evidence first so union-find builds tight sets before loose links.
    if (match) pairs.push([i, j, h / 64 - sim - clip]);
  }
  pairs.sort((a, b) => a[2] - b[2]);
  // Merge two sets only when most cross pairs match on their own. Plain union-find lets
  // A~B and B~C pull in an unrelated C, which is how a road photo ends up with a beach photo.
  const linked = new Set(pairs.map(([i, j]) => i * n + j));
  const isLinked = (i, j) => linked.has(i < j ? i * n + j : j * n + i);
  const setOf = Array.from({ length: n }, (_, i) => i), members = Array.from({ length: n }, (_, i) => [i]);
  for (const [i, j] of pairs) {
    const a = setOf[i], b = setOf[j];
    if (a === b || members[a].length + members[b].length > MAX_SET) continue;
    let hits = 0;
    for (const x of members[a]) for (const y of members[b]) hits += isLinked(x, y);
    if (hits < .6 * members[a].length * members[b].length) continue;
    for (const x of members[b]) setOf[x] = a;
    members[a].push(...members[b]); members[b] = [];
  }
  return members.filter(m => m.length > 1).map(members => {
    members.sort((a, b) => (photos[a].takenAt || 0) - (photos[b].takenAt || 0) || a - b);
    const best = members.reduce((x, y) => frameQuality(photos[y]) > frameQuality(photos[x]) ? y : x);
    return { members, best };
  }).sort((a, b) => (photos[a.members[0]].takenAt || 0) - (photos[b.members[0]].takenAt || 0));
}
