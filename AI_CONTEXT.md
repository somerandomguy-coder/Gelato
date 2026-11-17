# Gelato — product and engineering context

## One-line purpose

Gelato helps people who build a personal brand (LinkedIn, Instagram) go from a trip or event folder to the handful of photos worth posting: see everything, sort by vibe, clear near-duplicates, and draft a carousel. It runs locally in the browser.

## Who it is for and the jobs

From user interviews: people currently scroll their camera roll, then describe the post out loud ("seven photos, three group and four solo, one at the Golden Gate Bridge, spread across each day") to an AI chat and review what it picks.

| Need | Feature |
| --- | --- |
| See everything at once | Infinite canvas wall (pan, zoom, drag, select) |
| Sort by vibe | Views: Board, Timeline, Vibe map (PCA), Clusters (UMAP), Colour |
| Find more like this | Right-click a photo: pull in the 5 closest lookalikes, repeat for 5 more |
| Too many near-duplicates | **Clear similar shots**: grouped bursts, keep the sharpest, hide the rest |
| Save time choosing | **Draft a carousel**: slide count, must-include moments, solo/group/place mix, spread across days |

## Product principles

1. **The canvas is the product.** Direct manipulation over settings panels.
2. **Plain language.** "Vibe map", not "PCA" (technical names live only in tooltips).
3. **Local first.** Photos never leave the device. Originals are only read for the full-size viewer and folder export.
4. **Suggestions, not decisions.** Hidden shots are restorable; every carousel slide can be swapped, removed or reordered.
5. **Do not overclaim.** The AI picks are suggestions; say what downloads and how big it is.

## Stack and files

Vanilla ES modules + canvas; Vite for dev/build only.

| File | Responsibility |
| --- | --- |
| `index.html` | Top bar (views, actions), stage, docks, dialogs. |
| `src/main.js` | State, import (picker + drag-drop), layouts, canvas drawing, pointer/keyboard, similar-shots review UI, carousel UI, folder export. |
| `src/analysis.js` | Per-photo analysis on a ≤256px preview: 64-d look vector, pHash, sharpness, EXIF capture time. Shared by worker and fallback. |
| `src/image-worker.js` | Off-thread analysis, PCA/UMAP projections, similar-set search. |
| `src/duplicates.js` | Similar-shot grouping (pHash + standardised look + capture time + CLIP when present), best-frame suggestion. |
| `src/carousel.js` | Carousel drafting: appeal scoring, shot classification, must-include matching, diversity, day spread, ordering, swap/add. |
| `src/clip.js`, `src/clip-worker.js` | CLIP ViT-B/32 via Transformers.js in a worker. Lazy: nothing downloads until the first carousel draft. |
| `src/image-metrics.js`, `src/projections.js`, `src/viz-packer.js` | Feature extraction, PCA/UMAP and the bin packer adapted from VizThatThing. |

## Interaction contract

| Gesture | Result |
| --- | --- |
| Click photo | Open full size |
| Drag photo | Move it (and the rest of the selection) |
| Drag empty space | Marquee select (Shift adds) |
| Click empty space | Clear selection |
| Right-click photo | Pull 5 lookalikes; again for 5 more |
| Right-drag, middle-drag, Space-drag | Pan |
| Wheel / pinch | Cursor-centred zoom |
| 1–5, F, Esc, Ctrl/Cmd+A | Switch view, fit, clear selection, select all |

Never give one gesture two outcomes.

## How the smart features work

- **Similar shots.** Pairs match on any of: near-identical pHash; moderately close pHash + similar standardised look; same burst (capture times within seconds) + similar look; CLIP similarity once embeddings exist. Sets merge only when ≥60% of cross pairs match (prevents A~B~C chaining), capped at 16. The suggested keep is the sharpest, least-clipped frame. Strict / Balanced / Loose scale the thresholds. On a 233-photo real trip: old pHash-only found 9 pairs; Balanced finds ~48 sets.
- **Carousel.** Always uses CLIP (about 156 MB, cached by the browser after first use; ~35 s for 233 photos once cached). Each photo gets an appeal score (two contrasting text prompts) and, if a mix is requested, a solo/group/place/other label. An optional "overall feel" phrase adds 1.5× its CLIP similarity to every photo's appeal. Slots are filled moments-to-include first, then the mix, then free picks, scoring appeal + novelty + new-day bonus and skipping near-duplicates. The best photo leads as the cover; the rest are in capture order. The **By look / By content** switch in the top bar decides whether maps, pulls and similar-shot detection use the 64-d look vector or CLIP embeddings; switching to content embeds any photos that lack one, and photos added while in content mode are embedded before they join the maps.

## Map stability

- **Vibe map (PCA)** is fitted once per vector space; photos added later are projected onto the stored mean/axes/scale (`projectPCA`), so existing positions never move. It refits only when the vectors change (AI understanding switches on) or the library is cleared.
- **Clusters (UMAP)** can't be extended, so new photos are placed at the average position of their 5 nearest neighbours. The **Re-run clusters** button (top of the Clusters view, highlighted with a count when there are new photos) recomputes UMAP over everything.
- A moved photo's pull history resets, so right-clicking it again brings back its closest lookalikes.

## Deliberately removed

Face scan, people scan, AI Lab panel, manual people names, pagination, caption and spacing toggles. Don't add back dataset/ML-workbench features (CSV, YOLO, confidence charts, K-means islands).

## Cautions

- Keep imports off the main thread; never draw originals to the canvas.
- HEIC can't be decoded by browsers: tell people to export JPEG.
- Folder export needs the File System Access API (Chromium desktop).
- Cache Storage can be evicted; never promise permanent model storage.
- `npm run build` must pass before calling a change done.
