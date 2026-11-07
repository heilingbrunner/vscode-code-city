import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extOf, layoutTree, squarify } from '../src/layout.ts';
import type { DirNode } from '../src/types.ts';

const tree: DirNode = {
  kind: 'dir', name: 'root', path: '', children: [
    { kind: 'file', name: 'a.ts', path: 'a.ts', loc: 400 },
    { kind: 'file', name: 'b.ts', path: 'b.ts', loc: 100 },
    { kind: 'dir', name: 'sub', path: 'sub', children: [
      { kind: 'file', name: 'c.ts', path: 'sub/c.ts', loc: 300 },
      { kind: 'file', name: 'd.ts', path: 'sub/d.ts', loc: 200 },
    ] },
  ],
};

test('squarify: areas proportional to weight and fill bounds', () => {
  const rects = squarify([{ weight: 6 }, { weight: 3 }, { weight: 1 }], { x: 0, z: 0, w: 100, d: 50 });
  const areas = rects.map(r => r.w * r.d);
  assert.ok(Math.abs(areas.reduce((a, b) => a + b) - 5000) < 1e-6);
  assert.ok(Math.abs(areas[0] / areas[2] - 6) < 1e-6);
});

test('layoutTree: nested boxes are contained in parent', () => {
  const boxes = layoutTree(tree, 1000, 4);
  const sub = boxes.find(b => b.path === 'sub')!;
  for (const b of boxes.filter(b => b.path.startsWith('sub/'))) {
    assert.ok(b.x >= sub.x - 1e-6 && b.z >= sub.z - 1e-6);
    assert.ok(b.x + b.w <= sub.x + sub.w + 1e-6 && b.z + b.d <= sub.z + sub.d + 1e-6);
  }
});

test('layoutTree: sibling files do not overlap', () => {
  const files = layoutTree(tree).filter(b => b.kind === 'file');
  for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
    const a = files[i], b = files[j];
    const overlap = a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.z < b.z + b.d - 1e-6 && b.z < a.z + a.d - 1e-6;
    assert.ok(!overlap, `${a.path} overlaps ${b.path}`);
  }
});

test('layoutTree: dir totals', () => {
  const sub = layoutTree(tree).find(b => b.path === 'sub')!;
  assert.equal(sub.loc, 500);
  assert.equal(sub.fileCount, 2);
});

test('layoutTree: street width separates sibling districts', () => {
  const t: DirNode = { kind: 'dir', name: 'root', path: '', children: [
    { kind: 'dir', name: 'a', path: 'a', children: [{ kind: 'file', name: 'x', path: 'a/x', loc: 500 }] },
    { kind: 'dir', name: 'b', path: 'b', children: [{ kind: 'file', name: 'y', path: 'b/y', loc: 500 }] },
  ] };
  const gap = (street: number) => {
    const [a, b] = ['a', 'b'].map(p => layoutTree(t, 1000, street).find(x => x.path === p)!);
    return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.z - (a.z + a.d), a.z - (b.z + b.d));
  };
  assert.ok(Math.abs(gap(0)) < 1e-6);
  assert.ok(Math.abs(gap(20) - 20) < 1e-6);
});

test('extOf: extension without dot, lower-cased, dotfiles included', () => {
  assert.equal(extOf('Main.GO'), 'go');
  assert.equal(extOf('a.xaml.cs'), 'cs');
  assert.equal(extOf('.gitignore'), 'gitignore');
  assert.equal(extOf('Makefile'), '');
});
