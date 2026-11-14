# Gelato

A fast, local-first image wall for seeing a whole folder of references at once.

Upload a folder, get a bird's-eye view, pan and zoom around it, then click any image when you need its original file at full resolution. Gelato keeps worker-created preview bitmaps to a maximum of 256px and opens the original only on demand. The wall starts with smaller 128px tiles so more of the set fits in view.

Use **Find similar frames** to review near-duplicates and hide the frames you do not want to keep. Nothing is deleted. **Draft 3 carousels** uses local CLIP image and text matching to suggest three editable sequences; Gelato does not choose a winner for you.

## Run

```bash
npm install
npm run dev
```

## Views

- **Tight board** — compact packed wall with no gaps by default.
- **Browse** — simple grid for scanning.
- **Visual map** — PCA projection of thumbnail colour, brightness and saturation.
- **Style neighbourhoods** — a lightweight UMAP-style nearest-neighbour layout.
- **Colour mood** — hue × brightness colour-grade field.

Use the display controls to show filenames only when you need them, turn off tight spacing, change thumbnail size, or fit the entire collection back into view.
