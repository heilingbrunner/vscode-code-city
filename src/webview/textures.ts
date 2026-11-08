import * as THREE from 'three';

/** FNV-1a string hash → uint32. Deterministic across runs and platforms. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Facade variant bucket for a file path: deterministic, always in [0, count). */
export function variantOf(path: string, count: number): number {
  return count <= 1 ? 0 : hashStr(path) % count;
}

/** Axis-aligned rectangle in UV space. */
export interface Cell { u0: number; v0: number; u1: number; v1: number }

/**
 * Remap a BoxGeometry's UVs into atlas cells: the four side faces → `facade`,
 * the top face (+y) → `roof`, the bottom face → `base`. BoxGeometry emits six
 * groups of four vertices in the order px, nx, py, ny, pz, nz, each spanning
 * the full 0–1 UV square.
 */
export function remapBoxUVs(geo: THREE.BoxGeometry, facade: Cell, roof: Cell, base: Cell): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const cellFor = (group: number): Cell => (group === 2 ? roof : group === 3 ? base : facade);
  for (let i = 0; i < uv.count; i++) {
    const c = cellFor(Math.floor(i / 4));
    uv.setXY(i, c.u0 + uv.getX(i) * (c.u1 - c.u0), c.v0 + uv.getY(i) * (c.v1 - c.v0));
  }
  uv.needsUpdate = true;
}

export type FacadeStyle = 'windows' | 'panels' | 'neon';

export interface FacadeAtlas {
  texture: THREE.CanvasTexture;
  facadeCells: Cell[]; // one per variant
  roofCell: Cell;
  baseCell: Cell;
}

/** Small deterministic PRNG so the atlas looks the same on every load. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function drawFacade(ctx: CanvasRenderingContext2D, style: FacadeStyle, x: number, y: number, w: number, h: number, variant: number, rnd: () => number): void {
  // near-white base so the per-instance color tint multiplies through
  ctx.fillStyle = '#ececec';
  ctx.fillRect(x, y, w, h);
  if (style === 'windows') {
    const cols = [3, 4, 6, 9][variant % 4];
    const rowH = 14;
    const rows = Math.floor(h / rowH);
    const cw = w / cols;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = rnd() < 0.18 ? '#ffd98a' : '#4a4f55'; // some windows lit
        ctx.fillRect(x + c * cw + cw * 0.18, y + r * rowH + 3, cw * 0.64, rowH - 6);
      }
    }
  } else if (style === 'panels') {
    const band = 16; // horizontal floor bands with seams
    for (let yy = y; yy < y + h; yy += band) {
      ctx.fillStyle = rnd() < 0.5 ? '#dcdcdc' : '#e4e4e4';
      ctx.fillRect(x, yy, w, band - 3);
      ctx.fillStyle = '#9a9a9a';
      ctx.fillRect(x, yy + band - 3, w, 3);
    }
    ctx.fillStyle = '#c8c8c8';
    for (let xx = x + w / 3; xx < x + w; xx += w / 3) ctx.fillRect(xx, y, 2, h);
  } else { // neon: bright vertical strips over a muted base
    ctx.fillStyle = '#b9bfca';
    ctx.fillRect(x, y, w, h);
    const cols = [4, 6, 8, 10][variant % 4];
    const cw = w / cols;
    const colors = ['#59f7ff', '#ff7df0', '#fffb7a'];
    ctx.globalAlpha = 0.9;
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = colors[c % 3];
      ctx.fillRect(x + c * cw + cw * 0.25, y + 8, cw * 0.5, h - 16);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#3a3f4a';
    for (let yy = y + 20; yy < y + h; yy += 24) ctx.fillRect(x, yy, w, 2);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/**
 * Generate the building texture atlas on a canvas (no image assets, so the
 * strict webview CSP stays intact). Layout of the 512×512 canvas — canvas
 * y=0 is texture v=1 (CanvasTexture flipY):
 *
 *   ┌────────────────────────────┬────────┐  v 1 ─┐
 *   │ roof (gravel + HVAC box)   │ base   │       roofH px
 *   ├────┬────┬────┬─────────────┴────────┤  v 1-roofH/H
 *   │ v0 │ v1 │ v2 │ v3  facade cells     │
 *   └────┴────┴────┴──────────────────────┘  v 0
 */
export function createFacadeAtlas(style: FacadeStyle, variants: number, aniso = 1): FacadeAtlas {
  const W = 512, H = 512, roofH = 128, baseW = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // roof strip: light gravel with noise and an HVAC box
  const roofW = W - baseW;
  const rnd = prng(987654321);
  ctx.fillStyle = '#b9b9b9';
  ctx.fillRect(0, 0, roofW, roofH);
  ctx.fillStyle = '#a5a5a5';
  ctx.fillRect(0, 0, roofW, 6);
  ctx.fillStyle = '#8f8f8f';
  for (let i = 0; i < 500; i++) ctx.fillRect(rnd() * roofW, rnd() * roofH, 2, 2);
  ctx.fillStyle = '#d6d6d6';
  ctx.fillRect(roofW * 0.3, roofH * 0.3, 60, 40);
  ctx.strokeStyle = '#7c7c7c';
  ctx.strokeRect(roofW * 0.3, roofH * 0.3, 60, 40);
  // base (bottom face): grey, matching the root slab underside so it never reads as black
  ctx.fillStyle = '#6a6e76';
  ctx.fillRect(roofW, 0, baseW, roofH);

  // facade cells side by side below the roof strip
  const cellW = W / variants;
  for (let v = 0; v < variants; v++) {
    drawFacade(ctx, style, v * cellW, roofH, cellW, H - roofH, v, prng(1234567 + v * 7919));
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = aniso;
  return {
    texture,
    roofCell: { u0: 0, v0: 1 - roofH / H, u1: roofW / W, v1: 1 },
    baseCell: { u0: roofW / W, v0: 1 - roofH / H, u1: 1, v1: 1 },
    facadeCells: Array.from({ length: variants }, (_, v) => ({
      u0: (v * cellW) / W, v0: 0, u1: ((v + 1) * cellW) / W, v1: 1 - roofH / H,
    })),
  };
}
