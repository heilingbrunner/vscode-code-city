import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hashStr, variantOf, remapBoxUVs, type Cell } from '../src/webview/textures.ts';

test('hashStr: deterministic, unsigned 32-bit, distinct inputs differ', () => {
  assert.equal(hashStr('src/a.ts'), hashStr('src/a.ts'));
  assert.ok(Number.isInteger(hashStr('x')) && hashStr('x') >= 0 && hashStr('x') <= 0xffffffff);
  assert.notEqual(hashStr('a.ts'), hashStr('b.ts'));
});

test('variantOf: deterministic, in range, evenly spread across buckets', () => {
  assert.equal(variantOf('a/b.ts', 4), variantOf('a/b.ts', 4));
  assert.equal(variantOf('x', 1), 0);
  assert.equal(variantOf('x', 0), 0);
  const counts = new Array(4).fill(0);
  for (let i = 0; i < 400; i++) {
    const v = variantOf(`src/file${i}.ts`, 4);
    assert.ok(v >= 0 && v < 4, `bucket out of range: ${v}`);
    counts[v]++;
  }
  assert.ok(counts.every(c => c > 40), `spread too uneven: ${counts}`); // ~100 per bucket expected
});

test('remapBoxUVs: every face lands exactly inside its atlas cell', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const facade: Cell = { u0: 0.25, v0: 0, u1: 0.5, v1: 0.75 };
  const roof: Cell = { u0: 0, v0: 0.75, u1: 0.875, v1: 1 };
  const base: Cell = { u0: 0.875, v0: 0.75, u1: 1, v1: 1 };
  remapBoxUVs(geo, facade, roof, base);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  assert.equal(uv.count, 24); // BoxGeometry: 6 faces x 4 vertices
  // BoxGeometry face order: px, nx, py, ny, pz, nz → groups 0..5; group 2 = top, 3 = bottom
  for (let g = 0; g < 6; g++) {
    const cell = g === 2 ? roof : g === 3 ? base : facade;
    const us: number[] = [], vs: number[] = [];
    for (let i = g * 4; i < g * 4 + 4; i++) { us.push(uv.getX(i)); vs.push(uv.getY(i)); }
    assert.ok(Math.abs(Math.min(...us) - cell.u0) < 1e-6 && Math.abs(Math.max(...us) - cell.u1) < 1e-6,
      `group ${g} u range [${Math.min(...us)}, ${Math.max(...us)}] != cell u [${cell.u0}, ${cell.u1}]`);
    assert.ok(Math.abs(Math.min(...vs) - cell.v0) < 1e-6 && Math.abs(Math.max(...vs) - cell.v1) < 1e-6,
      `group ${g} v range [${Math.min(...vs)}, ${Math.max(...vs)}] != cell v [${cell.v0}, ${cell.v1}]`);
  }
});
