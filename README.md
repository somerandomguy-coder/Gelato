# Gelato

An infinite-canvas brand direction board for personal brand strategists, photographers, designers, and independent creatives.

Build a visual territory by dropping in references or uploading a whole image folder, adding notes, arranging a story, and exporting a shareable project snapshot. Folder uploads automatically open in a bird's-eye grid. Everything stays in the browser; image files are never uploaded.

## Run locally

```bash
npm install
npm run dev
```

This is a self-contained Vite site with no backend or external data dependency. The main build surface is `src/main.js`; image assets are user-supplied at runtime.

## Canvas controls

- Upload Folder opens every supported image in a folder, then fits the canvas to show the entire collection.
- Drag items to compose.
- Drag empty canvas or hold Space to pan.
- Scroll to zoom toward the cursor.
- Click to select; Shift-click to extend selection.
- Drag from empty space to marquee-select.
- Double click an image to inspect it.

## Intent

The first version is a flexible base rather than a tool locked to one job: a strategist can map brand worlds, a photographer can construct a treatment, and a designer can collect visual directions. The project brief and territory vocabulary can be changed freely.
