# Gelato

A fast, local-first image wall for seeing a whole folder of references at once.

Upload a folder, get a bird's-eye view, pan and zoom around it, then click any image when you need its original file at full resolution. Gelato renders only small 320px thumbnail bitmaps on the canvas; the original image is opened only on demand.

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
