// Growing bin-packer for the Board view (adapted from VizThatThing).
function getSafeDimensions(item, baseSize) {
  const iw = item.width > 0 ? item.width : 200;
  const ih = item.height > 0 ? item.height : 200;
  const aspect = iw / ih;
  const snap = (v) => Math.max(12, Math.round(v / 4) * 4);
  let w;
  let h;
  if (iw >= ih) {
    w = snap(baseSize);
    h = snap(baseSize / aspect);
  } else {
    h = snap(baseSize);
    w = snap(baseSize * aspect);
  }
  return { w, h, aspect };
}

export class GrowingPacker {
  constructor() {
    this.root = null;
  }

  fit(blocks) {
    const len = blocks.length;
    const w = len > 0 ? blocks[0].w : 0;
    const h = len > 0 ? blocks[0].h : 0;
    this.root = { x: 0, y: 0, w, h };

    for (let n = 0; n < len; n++) {
      const block = blocks[n];
      const node = this.findNode(this.root, block.w, block.h);
      if (node) {
        block.fit = this.splitNode(node, block.w, block.h);
      } else {
        block.fit = this.growNode(block.w, block.h);
      }
    }
  }

  findNode(root, w, h) {
    if (root.used) {
      return this.findNode(root.right, w, h) || this.findNode(root.down, w, h);
    } else if (w <= root.w && h <= root.h) {
      return root;
    }
    return null;
  }

  splitNode(node, w, h) {
    node.used = true;
    node.down = { x: node.x, y: node.y + h, w: node.w, h: node.h - h };
    node.right = { x: node.x + w, y: node.y, w: node.w - w, h };
    return node;
  }

  growNode(w, h) {
    const canGrowDown = w <= this.root.w;
    const canGrowRight = h <= this.root.h;

    const shouldGrowRight = canGrowRight && this.root.h >= this.root.w;
    const shouldGrowDown = canGrowDown && this.root.w >= this.root.h;

    if (shouldGrowRight) return this.growRight(w, h);
    if (shouldGrowDown) return this.growDown(w, h);
    if (canGrowRight) return this.growRight(w, h);
    if (canGrowDown) return this.growDown(w, h);
    return null;
  }

  growRight(w, h) {
    this.root = {
      used: true,
      x: 0,
      y: 0,
      w: this.root.w + w,
      h: this.root.h,
      down: this.root,
      right: { x: this.root.w, y: 0, w, h: this.root.h }
    };
    const node = this.findNode(this.root, w, h);
    return node ? this.splitNode(node, w, h) : null;
  }

  growDown(w, h) {
    this.root = {
      used: true,
      x: 0,
      y: 0,
      w: this.root.w,
      h: this.root.h + h,
      down: { x: 0, y: this.root.h, w: this.root.w, h },
      right: this.root
    };
    const node = this.findNode(this.root, w, h);
    return node ? this.splitNode(node, w, h) : null;
  }
}

/**
 * Computes 2D Bin Packing layout.
 */
export function packLayout(items, baseSize, gap) {
  if (items.length === 0) return { mode: 'pack', items: [], width: 0, height: 0 };

  const blocks = items.map((item, idx) => {
    const { w, h } = getSafeDimensions(item, baseSize);
    return {
      index: idx,
      item,
      w: w + gap,
      h: h + gap,
      origW: w,
      origH: h
    };
  });

  blocks.sort(
    (a, b) =>
      Math.max(b.w, b.h) - Math.max(a.w, a.h) ||
      b.w * b.h - a.w * a.h ||
      b.h - a.h ||
      b.w - a.w
  );

  const packer = new GrowingPacker();
  packer.fit(blocks);

  const layoutItems = [];
  for (const block of blocks) {
    if (block.fit) {
      const x = block.fit.x;
      const y = block.fit.y;
      layoutItems.push({
        item: block.item,
        x,
        y,
        w: block.origW,
        h: block.origH,
        pointX: x + block.origW / 2,
        pointY: y + block.origH / 2
      });
    }
  }

  return {
    mode: 'pack',
    items: layoutItems,
    width: packer.root ? Math.max(0, packer.root.w - gap) : 0,
    height: packer.root ? Math.max(0, packer.root.h - gap) : 0
  };
}
