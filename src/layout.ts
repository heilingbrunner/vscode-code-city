import type { Box, DirNode, TreeNode } from './types.ts';

interface Rect { x: number; z: number; w: number; d: number }

/** Weight of a node for area allocation (min 1 so empty files stay visible). */
export function weight(n: TreeNode): number {
  if (n.kind === 'file') return Math.max(n.loc, 1);
  return n.children.reduce((s, c) => s + weight(c), 0) || 1;
}

function totals(n: TreeNode): { loc: number; files: number } {
  if (n.kind === 'file') return { loc: n.loc, files: 1 };
  let loc = 0, files = 0;
  for (const c of n.children) { const t = totals(c); loc += t.loc; files += t.files; }
  return { loc, files };
}

/** Squarified treemap (Bruls et al.). Returns one rect per item, in input order. */
export function squarify(items: { weight: number }[], bounds: Rect): Rect[] {
  const out: Rect[] = new Array(items.length);
  const order = items.map((_, i) => i).sort((a, b) => items[b].weight - items[a].weight);
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (total <= 0 || bounds.w <= 0 || bounds.d <= 0) {
    items.forEach((_, i) => (out[i] = { ...bounds, w: 0, d: 0 }));
    return out;
  }
  const scale = (bounds.w * bounds.d) / total;
  let rest: Rect = { ...bounds };
  let row: number[] = [];

  const worst = (r: number[], side: number): number => {
    const areas = r.map(i => items[i].weight * scale);
    const sum = areas.reduce((a, b) => a + b, 0);
    const max = Math.max(...areas), min = Math.min(...areas);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const layoutRow = (r: number[]) => {
    const sum = r.reduce((s, i) => s + items[i].weight * scale, 0);
    if (rest.w >= rest.d) {
      // lay out a column on the left, side = rest.d
      const colW = sum / rest.d;
      let z = rest.z;
      for (const i of r) {
        const h = (items[i].weight * scale) / colW;
        out[i] = { x: rest.x, z, w: colW, d: h };
        z += h;
      }
      rest = { x: rest.x + colW, z: rest.z, w: rest.w - colW, d: rest.d };
    } else {
      const rowD = sum / rest.w;
      let x = rest.x;
      for (const i of r) {
        const w = (items[i].weight * scale) / rowD;
        out[i] = { x, z: rest.z, w, d: rowD };
        x += w;
      }
      rest = { x: rest.x, z: rest.z + rowD, w: rest.w, d: rest.d - rowD };
    }
  };

  for (const i of order) {
    const side = Math.min(rest.w, rest.d);
    if (row.length === 0 || worst([...row, i], side) <= worst(row, side)) {
      row.push(i);
    } else {
      layoutRow(row);
      row = [i];
    }
  }
  if (row.length) layoutRow(row);
  return out;
}

function shrink(r: Rect, pad: number): Rect {
  const p = Math.min(pad, r.w / 4, r.d / 4);
  return { x: r.x + p, z: r.z + p, w: r.w - 2 * p, d: r.d - 2 * p };
}

/** Lower-case extension without the dot; ".gitignore" -> "gitignore", "Makefile" -> "". */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Lay out a directory tree into flat boxes. Dirs become districts, files
 * become buildings. `padding` is the street width: sibling districts end up
 * `padding` apart, and a district's contents sit `padding` inside its border.
 */
export function layoutTree(root: DirNode, size = 1000, padding = 4): Box[] {
  const boxes: Box[] = [];

  const visit = (n: TreeNode, cell: Rect, depth: number) => {
    const t = totals(n);
    const r = n.kind === 'dir' && depth > 0 ? shrink(cell, padding / 2) : cell;
    if (n.kind === 'file') {
      boxes.push({ kind: 'file', name: n.name, path: n.path, ...r, depth, loc: n.loc, fileCount: 1, ext: extOf(n.name) });
      return;
    }
    boxes.push({ kind: 'dir', name: n.name, path: n.path, ...r, depth, loc: t.loc, fileCount: t.files, ext: '' });
    if (n.children.length === 0) return;
    const inner = shrink(r, padding);
    const rects = squarify(n.children.map(c => ({ weight: weight(c) })), inner);
    n.children.forEach((c, i) => visit(c, rects[i], depth + 1));
  };

  visit(root, { x: 0, z: 0, w: size, d: size }, 0);
  return boxes;
}
