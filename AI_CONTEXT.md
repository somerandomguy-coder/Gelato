# Gelato — product and engineering context

## One-line purpose

Gelato is a local-first, non-technical image-space for photographers, designers, and creative people to drop in a large image folder, see it all at once, explore visual relationships, and curate it without having to understand datasets or machine learning.

It borrows the performance and spatial-analysis strength of the sibling reference project `../VizThatThing`, but deliberately avoids its technical dataset/ML-workbench framing.

## Product principles

1. **Show, don't configure.** Use plain-language controls such as “Visual map” rather than “PCA,” while retaining a quiet technical subtitle where helpful.
2. **Local first.** Images and AI inference stay in the browser. Original files are never uploaded by Gelato.
3. **Fast at photographer scale.** A folder of hundreds or a thousand images must feel responsive. The stage renders small worker-created thumbnails; originals only open when requested.
4. **The canvas is the product.** The interface should prioritise direct manipulation, spatial thinking, and immediate feedback rather than panels of settings.
5. **AI is opt-in and understandable.** Nothing large downloads until the user starts an AI action. Explain model size and retain local control over cache/labels.
6. **Do not overclaim.** Face detection is not person recognition. A suggestion is editable; it is never presented as fact.

## Intended audience and jobs

- **Photographer:** dump a shoot folder, spot repetitions/outliers, find lookalikes, cluster colour/light moods, select frames, and name people manually.
- **Designer/art director:** browse visual references, pull similar directions together, make a local composition, and identify a coherent visual territory.
- **Personal-brand strategist:** get a bird's-eye visual read without needing image-analysis terminology.

## Current stack

- Vanilla HTML/CSS/ES modules, Vite only as a development/build tool.
- A single HTML canvas is the wall. It avoids hundreds of expensive DOM image cards.
- `src/image-worker.js` decodes an image, creates a maximum-256px `ImageBitmap`, calculates a perceptual hash, and extracts visual features off the main thread.
- Original browser `File` objects remain in memory only for the on-demand full-resolution dialog and opt-in AI scans.
- Production build: `npm run build`.

## Important files

| File | Responsibility |
| --- | --- |
| `index.html` | Minimal visible UI: upload, layouts, display, AI Lab, stage. |
| `src/main.js` | Canvas renderer, interaction state, upload flow, layouts, KNN pull, selection, AI Lab. |
| `src/image-worker.js` | Worker thumbnail decode/feature extraction and projection jobs. |
| `src/image-metrics.js` | VizThatThing's 64-dimensional visual feature extraction. |
| `src/projections.js` | VizThatThing's deterministic PCA and PCA-initialised UMAP algorithms. |
| `src/viz-packer.js` | VizThatThing's growing bin-packer. |
| `public/gelato-mark.svg` | Product mark. |

## Interaction contract — do not casually change this

| Gesture | Result |
| --- | --- |
| Left-click image | Open its original file in the full-resolution viewer. |
| Left-drag blank canvas | Pan the stage. |
| Mouse wheel | Cursor-centred zoom. |
| Right-click image | Pull the five highest-similarity unseen images toward it; repeat for the next five. |
| Shift + left-drag blank canvas | Marquee-select images. |
| Tidy selection | Locally pack only the selection near its current position. |
| Reset layout | Return all images to the active layout's canonical positions. |

Avoid assigning two outcomes to the same gesture. This was a past UX failure.

## What works now

### Import and performance

- Upload image files or an image folder (`webkitdirectory`).
- Streaming import: decoded images appear during import rather than after the full folder completes.
- Worker-side thumbnail generation, dimensions, perceptual hashes, and feature analysis.
- Preview bitmaps capped at 256px; the wall starts with smaller 128px tiles. Originals are loaded only for detail view or AI work.
- Page caps: 250, 500, 1,000, or All rendered images per page.
- Worker-side projection calculations so PCA/UMAP don't freeze the canvas.

### Views

- **Tight board:** VizThatThing growing-bin packer.
- **Browse:** scanning grid.
- **Visual map:** VizThatThing PCA over 64-d visual features, or CLIP vectors after CLIP runs.
- **Style neighbourhoods:** VizThatThing PCA-initialised UMAP over those vectors.
- **Colour mood:** hue × brightness field.
- PCA and UMAP display human-readable axes.

### Curation

- Pan, zoom, fit view, caption toggle, spacing toggle, thumbnail-size control.
- KNN pulls with easing animation.
- Local marquee selection and tidy pack.
- Reset back to canonical layout positions.
- Review near-duplicate frames using perceptual hashes; chosen rejects are hidden from the wall and can be restored.
- Draft three editable carousel directions with local CLIP text/image matching and a diversity pass. The user chooses the final images.

### AI Lab (all on demand)

- **Face scan:** MediaPipe BlazeFace (~230 KB) reports per-image face count.
- **People scan:** MediaPipe person detector (~4.6 MB) reports per-image person count.
- **Understand images:** CLIP ViT-B/32 image and text components create semantic image embeddings for KNN, maps, and carousel drafts; the first run is a large browser-cached download.
- AI model cache: face/person assets use `gelato-ai-models-v1`; CLIP uses Transformers.js browser cache. A clear-cache control exists.
- Filter chips after scans: All / none / one / 2+ faces or people.
- Manual people workflow: Shift-select photos then use **Name people**. This is a local editable label displayed as an image badge.

## Deliberate exclusions

Do not add these unless the product brief changes:

- CSV export/import and technical annotations.
- ZIP/YOLO import, detection datasets, confidence charts, model-evaluation dashboards.
- Split viewport comparisons.
- K-Means cluster-island UI.
- Technical “dataset”, “prediction”, or “accuracy” terminology.

## Honest implementation limits / next important work

1. **Validate the large-folder path in a real browser.** The worker pipeline is implemented, but performance testing should use 1,000 real JPEGs and memory/timeline profiling.
2. **Page-aware layout.** Pagination caps rendering, but pack/grid still calculate canonical positions across the complete library. Improve the active-page fit and paging UX if it feels sparse.
3. **KNN placement parity.** Gelato has animated ring pulls, but VizThatThing's collision-aware repeated-ring placement should be ported fully if dense boards overlap.
4. **AI inference quality.** Face/person detectors use a temporary 640px canvas decoded from the original `File`, matching the reference workbench's approach.
5. **People suggestions.** Face detection alone cannot identify people. A proper same-person suggestion feature needs a face-embedding model, local clustering, a review screen, merge/split controls, and named local groups. Follow the Google Photos pattern: suggestions are editable; names are private/local; people can be removed or reassigned.
6. **CLIP themes.** Add editable, plain-language theme chips (for example portrait, street, nature) using zero-shot CLIP text prompts, like VizThatThing, but keep the UX simple.
7. **Tests.** Add browser-level tests for import, selection, pointer precedence, worker fallback, paging, and full-resolution open/close URL cleanup.

## Known technical cautions

- Image imports must stay responsive: do not decode a full folder on the main thread.
- Preserve `File` objects, but never render originals to the stage.
- Worker support must retain a main-thread fallback for browsers without `OffscreenCanvas`.
- `ImageBitmap.close()` should be called when clearing/replacing thumbnails.
- Cache Storage is browser/profile local and can be evicted; never promise permanent storage.
- Remote AI model downloads require network access only after an explicit user click.
- Face/person labels and models are sensitive local information; never transmit them without explicit permission.

## Reference relationship

`../VizThatThing` is the behavioral/performance source of truth for retained canvas features. Gelato should reuse or port its proven computation and interaction patterns, then simplify wording and presentation. Do not copy its technical dashboard wholesale.

## Definition of done for a new feature

Before calling a feature complete, verify:

1. It works with the gesture contract above.
2. It has a non-technical visible label and understandable empty/error state.
3. It does not block the main thread during large imports or analysis.
4. It is local-first by default.
5. The production Vite build passes.
