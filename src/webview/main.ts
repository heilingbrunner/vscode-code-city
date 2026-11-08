import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { extOf, layoutTree } from '../layout';
import type { Box, DirNode } from '../types';
import { createFacadeAtlas, remapBoxUVs, variantOf, type FacadeAtlas, type FacadeStyle } from './textures';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): any; setState(s: unknown): void };
const vscode = acquireVsCodeApi();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tip = $('tip');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const stage = document.getElementById('stage') as HTMLElement;
stage.insertBefore(renderer.domElement, stage.firstChild);

const scene = new THREE.Scene();

/** Editor background of the current VS Code theme, as a three.js color. */
function themeBackground(): { color: THREE.Color; isDark: boolean } {
  const css = getComputedStyle(document.body).backgroundColor; // resolved rgb()/rgba()
  const m = css.match(/[\d.]+/g)?.map(Number);
  const [r, g, b, a] = m ?? [30, 30, 30, 1];
  if (m && m.length === 4 && a === 0) return { color: new THREE.Color(0x1e1e1e), isDark: true };
  return { color: new THREE.Color(`rgb(${r}, ${g}, ${b})`), isDark: (r + g + b) / 3 < 128 };
}

let darkTheme = true;
function applyTheme(): boolean {
  const t = themeBackground();
  const changed = t.isDark !== darkTheme;
  darkTheme = t.isDark;
  return changed;
}
applyTheme();
const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
camera.position.set(1100, 900, 1500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(500, 0, 500);
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
const SUN_OFFSET = new THREE.Vector3(600, 1500, 400);
const SUN_AZIMUTH = Math.PI + 0.4; // sun's angle relative to the camera: behind the city (slightly to the side), so shadows fall toward the viewer
let sunDistance = SUN_OFFSET.length();
/** Keep the sun at a fixed angle to the camera, so shadows stay put on screen while the city is rotated. */
function aimSun() {
  const az = controls.getAzimuthalAngle() + SUN_AZIMUTH;
  const flat = Math.hypot(SUN_OFFSET.x, SUN_OFFSET.z);
  sun.position.set(Math.sin(az) * flat, SUN_OFFSET.y, Math.cos(az) * flat).normalize().multiplyScalar(sunDistance).add(sun.target.position);
}
sun.position.copy(SUN_OFFSET);
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.intensity = 1; // full-strength shadows: depth without hiding anything
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

const shadowsInput = $<HTMLInputElement>('shadows');
shadowsInput.checked = vscode.getState()?.shadows ?? true;
function applyShadows() {
  renderer.shadowMap.enabled = sun.castShadow = shadowsInput.checked;
  group.traverse(o => { const m = o as THREE.Mesh; if (m.material) (m.material as THREE.Material).needsUpdate = true; });
}
shadowsInput.addEventListener('change', () => {
  vscode.setState({ ...vscode.getState(), shadows: shadowsInput.checked });
  applyShadows();
});

// ---- procedural building textures (facade variants + roof, one atlas) ----
const VARIANTS = 4;
const FACADE_STYLES: FacadeStyle[] = ['windows', 'panels', 'neon'];
let atlas: FacadeAtlas | null = null; // created lazily on first build; regenerated on style change
let facadeStyle: FacadeStyle = FACADE_STYLES.includes(vscode.getState()?.facade) ? vscode.getState().facade : 'windows';
const texturesInput = $<HTMLInputElement>('textures');
texturesInput.checked = vscode.getState()?.textures ?? true;
function applyTextures() {
  for (const im of meshes) {
    (im.material as THREE.MeshLambertMaterial).map = texturesInput.checked ? atlas?.texture ?? null : null;
    (im.material as THREE.Material).needsUpdate = true;
  }
}
texturesInput.addEventListener('change', () => {
  vscode.setState({ ...vscode.getState(), textures: texturesInput.checked });
  applyTextures();
});
const facadeSelect = $<HTMLSelectElement>('facade');
facadeSelect.replaceChildren(...FACADE_STYLES.map(s => new Option(s, s)));
facadeSelect.value = facadeStyle;
facadeSelect.addEventListener('change', () => {
  facadeStyle = facadeSelect.value as FacadeStyle;
  vscode.setState({ ...vscode.getState(), facade: facadeStyle });
  atlas?.texture.dispose(); // release the old GPU texture
  atlas = null;
  relayout(); // rebuilds the meshes with a fresh atlas
});

let tree: DirNode | null = null;
let boxes: Box[] = [];
const streetInput = $<HTMLInputElement>('street');
streetInput.value = String(vscode.getState()?.street ?? streetInput.value);

function relayout() {
  if (!tree) return;
  boxes = layoutTree(tree, 1000, +streetInput.value);
  build();
}
let relayoutQueued = false;
streetInput.addEventListener('input', () => {
  vscode.setState({ ...vscode.getState(), street: +streetInput.value });
  if (relayoutQueued) return;
  relayoutQueued = true;
  requestAnimationFrame(() => { relayoutQueued = false; relayout(); });
});
let files: Box[] = [];
let group = new THREE.Group();
let meshes: THREE.InstancedMesh[] = []; // one per facade variant; userData.files maps instanceId -> Box
let heightScale = 'sqrt';
const heightOf = (loc: number) => {
  const k = 1.2;
  return Math.max(1, heightScale === 'linear' ? loc * 0.4 : heightScale === 'log' ? Math.log2(loc + 1) * 18 : Math.sqrt(loc) * 6) * k;
};

// ---- color schemes ----
interface Palette {
  bg: string;                             // scene background ("sky")
  street: string;                         // ground slab: shows through the streets (dark gray in every scheme, light and dark themes)
  district: [string, string];             // district slabs, from top-level folders to the deepest ones
  ramp: [string, string, string];         // buildings in "LOC" mode: few -> some -> many lines
  extHue: number; extSpan: number;        // buildings in "Extension" mode: hues used, in degrees
  extSat: number; extLight: number;
  sky: string; ground: string; sun: string; // light colors
}
const SCHEMES: Record<string, { dark: Palette; light: Palette }> = {
  // cool steel and glass; ice blue buildings with a signal-orange peak
  Berlin: {
    dark:  { bg: '#000000', street: '#464a51', district: ['#3b4a5c', '#6b7f96'], ramp: ['#8fb3d9', '#4f86d6', '#ff5a36'],
             extHue: 190, extSpan: 170, extSat: 0.5, extLight: 0.58, sky: '#dfe9f5', ground: '#2a3340', sun: '#ffffff' },
    light: { bg: '#ffffff', street: '#464a51', district: ['#d5dde7', '#9eb0c4'], ramp: ['#7ea3cf', '#2f6bc2', '#e0431c'],
             extHue: 190, extSpan: 170, extSat: 0.55, extLight: 0.5, sky: '#ffffff', ground: '#8794a5', sun: '#ffffff' },
  },
  // warm brick and fog; cream buildings burning down to crimson
  London: {
    dark:  { bg: '#000000', street: '#4b4541', district: ['#6a3b2d', '#a97a57'], ramp: ['#efe0bd', '#dd7b34', '#8d1425'],
             extHue: 5, extSpan: 55, extSat: 0.55, extLight: 0.55, sky: '#f2dcc4', ground: '#3a2a22', sun: '#ffe9cf' },
    light: { bg: '#ffffff', street: '#4b4541', district: ['#e1b59d', '#b98866'], ramp: ['#c9ad6a', '#cf6a22', '#7d1020'],
             extHue: 5, extSpan: 55, extSat: 0.5, extLight: 0.46, sky: '#fff3e3', ground: '#9c8372', sun: '#fff1dd' },
  },
  // night city: black streets, violet districts, neon buildings
  Tokyo: {
    dark:  { bg: '#000000', street: '#413d53', district: ['#5a3bd6', '#d56bff'], ramp: ['#7dfff6', '#ff7df0', '#fffb7a'],
             extHue: 0, extSpan: 360, extSat: 1, extLight: 0.7, sky: '#d2c4ff', ground: '#3a1f8a', sun: '#ff9bf0' },
    light: { bg: '#ffffff', street: '#413d53', district: ['#cdb8ff', '#a05cff'], ramp: ['#00c2d6', '#e600c0', '#f0c800'],
             extHue: 0, extSpan: 360, extSat: 1, extLight: 0.5, sky: '#ffffff', ground: '#8f84c8', sun: '#ffd6fb' },
  },
  // desert sun: dark earth streets, bright sand districts, turquoise to terracotta buildings
  Cairo: {
    dark:  { bg: '#000000', street: '#4e4639', district: ['#c19a5b', '#e6c88e'], ramp: ['#16c4b0', '#f3c34b', '#b3381a'],
             extHue: 20, extSpan: 170, extSat: 0.6, extLight: 0.55, sky: '#ffe2b0', ground: '#5a4326', sun: '#ffd28a' },
    light: { bg: '#ffffff', street: '#4e4639', district: ['#ecd7a4', '#d1ad6c'], ramp: ['#0e9e8c', '#e0a820', '#a22f12'],
             extHue: 20, extSpan: 170, extSat: 0.6, extLight: 0.48, sky: '#fff5dc', ground: '#bfa06a', sun: '#ffe1a8' },
  },
};
let scheme = ((n) => (n in SCHEMES ? n : 'Berlin'))(String(vscode.getState()?.scheme ?? 'Berlin'));

interface ParsedPalette {
  bg: THREE.Color; street: THREE.Color; district: [THREE.Color, THREE.Color]; ramp: [THREE.Color, THREE.Color, THREE.Color];
  extHue: number; extSpan: number; extSat: number; extLight: number; sky: THREE.Color; ground: THREE.Color; sun: THREE.Color;
}
const parsedPalettes = new Map<string, ParsedPalette>();
function palette(): ParsedPalette {
  const key = `${scheme}|${darkTheme}`;
  let p = parsedPalettes.get(key);
  if (!p) {
    const src = SCHEMES[scheme][darkTheme ? 'dark' : 'light'];
    const c = (h: string) => new THREE.Color(h);
    p = { bg: c(src.bg), street: c(src.street), district: [c(src.district[0]), c(src.district[1])],
          ramp: [c(src.ramp[0]), c(src.ramp[1]), c(src.ramp[2])],
          extHue: src.extHue, extSpan: src.extSpan, extSat: src.extSat, extLight: src.extLight,
          sky: c(src.sky), ground: c(src.ground), sun: c(src.sun) };
    parsedPalettes.set(key, p);
  }
  return p;
}

/** Apply the scheme's background and light colors to the scene. */
function applyScene() {
  const p = palette();
  scene.background = p.bg;
  hemi.color.copy(p.sky);
  hemi.groundColor.copy(p.ground);
  sun.color.copy(p.sun);
}
applyScene();

function locColor(loc: number): THREE.Color {
  const t = Math.min(1, Math.log10(loc + 1) / 3.5); // ~3000 lines = top of the ramp
  const [lo, mid, hi] = palette().ramp;
  return t < 0.5 ? lo.clone().lerp(mid, t * 2) : mid.clone().lerp(hi, (t - 0.5) * 2);
}
const extColors = new Map<string, THREE.Color>();
function extColor(ext: string): THREE.Color {
  const key = `${ext}|${scheme}|${darkTheme}`;
  let c = extColors.get(key);
  if (!c) {
    let h = 0; for (const ch of ext) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const p = palette();
    c = new THREE.Color().setHSL((((p.extHue + (h / 360) * p.extSpan) % 360) + 360) % 360 / 360, p.extSat, p.extLight);
    extColors.set(key, c);
  }
  return c;
}

function build() {
  scene.remove(group);
  group.traverse(o => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(x => x.dispose());
    else mat?.dispose();
  });
  group = new THREE.Group();
  applyTheme();
  applyScene();

  // ground and districts: flat slabs; the root slab is the street color, districts blend by nesting depth
  const pal = palette();
  const maxDepth = Math.max(1, ...boxes.map(b => b.depth));
  const dirs = boxes.filter(b => b.kind === 'dir' && b.w > 0.5 && b.d > 0.5);
  for (const d of dirs) {
    const color = d.depth === 0
      ? pal.street
      : pal.district[0].clone().lerp(pal.district[1], maxDepth > 1 ? (d.depth - 1) / (maxDepth - 1) : 0);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(d.w, 1, d.d), new THREE.MeshLambertMaterial({ color }));
    slab.castShadow = slab.receiveShadow = true;
    slab.position.set(d.x + d.w / 2, d.depth * 1 + 0.5 - 1, d.z + d.d / 2);
    group.add(slab);
  }

  files = boxes.filter(b => b.kind === 'file' && b.w > 0.2 && b.d > 0.2);
  if (!atlas) atlas = createFacadeAtlas(facadeStyle, VARIANTS, renderer.capabilities.getMaxAnisotropy());
  meshes = [];
  const buckets: Box[][] = Array.from({ length: VARIANTS }, () => []);
  for (const f of files) buckets[variantOf(f.path, VARIANTS)].push(f);
  buckets.forEach((bucket, v) => {
    if (!bucket.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    remapBoxUVs(geo, atlas!.facadeCells[v], atlas!.roofCell, atlas!.baseCell);
    const mat = new THREE.MeshLambertMaterial({ map: texturesInput.checked ? atlas!.texture : null });
    const im = new THREE.InstancedMesh(geo, mat, bucket.length);
    im.castShadow = im.receiveShadow = true;
    im.userData.files = bucket;
    meshes.push(im);
    group.add(im);
  });
  recolorAndScale();
  scene.add(group);
  fitShadow();
  applyShadows();

  const total = files.reduce((s, f) => s + f.loc, 0);
  $('stats').textContent = `${files.length} files · ${total.toLocaleString()} LOC`;
}

/** Size the sun's shadow frustum to the layout plus the tallest building, and aim the sun at the city's center. */
function fitShadow() {
  if (!boxes.length) return;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of boxes) { x0 = Math.min(x0, b.x); z0 = Math.min(z0, b.z); x1 = Math.max(x1, b.x + b.w); z1 = Math.max(z1, b.z + b.d); }
  const center = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const tallest = Math.max(1, ...files.map(f => heightOf(f.loc) + f.depth));
  const radius = Math.hypot(x1 - x0, z1 - z0) / 2 + tallest; // generous: covers shadows cast off the edge
  sun.target.position.copy(center);
  sunDistance = radius * 2 + tallest;
  aimSun();
  const cam = sun.shadow.camera;
  cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
  cam.near = 1; cam.far = radius * 4 + tallest * 2;
  cam.updateProjectionMatrix();
  sun.shadow.map?.dispose(); sun.shadow.map = null; // frustum changed: rebuild lazily
}

function recolorAndScale() {
  const mode = $<HTMLSelectElement>('colorMode').value;
  const m = new THREE.Matrix4();
  for (const im of meshes) {
    const bucket = im.userData.files as Box[];
    bucket.forEach((f, i) => {
      const h = heightOf(f.loc);
      const sx = f.w * 0.85, sz = f.d * 0.85;
      m.compose(new THREE.Vector3(f.x + f.w / 2, f.depth + h / 2, f.z + f.d / 2), new THREE.Quaternion(), new THREE.Vector3(sx, h, sz));
      im.setMatrixAt(i, m);
      im.setColorAt(i, mode === 'ext' ? extColor(f.ext) : locColor(f.loc));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }
}

// Follow VS Code theme changes (it swaps CSS variables and body classes).
let themeQueued = false;
const onThemeMutation = () => {
  if (themeQueued) return;
  themeQueued = true;
  requestAnimationFrame(() => {
    themeQueued = false;
    const flipped = applyTheme(); // always refreshes the background
    if (flipped) refreshPalette(); // palettes have a dark and a light variant
  });
};
const themeObserver = new MutationObserver(onThemeMutation);
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });

// ---- fit the whole city into view ----
let pendingFit = false; // the stage is still resizing (sidebar animation): refit until it settles
controls.addEventListener('start', () => { pendingFit = false; }); // user took over the camera

function fitCamera() {
  const root = boxes[0];
  if (!root) return;
  let maxH = 1;
  for (const f of files) maxH = Math.max(maxH, f.depth + heightOf(f.loc));
  const center = new THREE.Vector3(root.x + root.w / 2, maxH / 2, root.z + root.d / 2);
  const radius = Math.hypot(root.w, maxH, root.d) / 2; // bounding sphere of the whole city
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.05;
  const dir = camera.position.clone().sub(controls.target).normalize(); // keep the current viewing angle
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.far = Math.max(20000, dist * 4);
  camera.updateProjectionMatrix();
  controls.update();
}

// interaction
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoverFile: Box | undefined;
renderer.domElement.addEventListener('pointermove', e => {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = meshes.length ? ray.intersectObjects(meshes)[0] : undefined;
  hoverFile = hit?.instanceId !== undefined ? (hit.object.userData.files as Box[])[hit.instanceId] : undefined;
  if (hoverFile) {
    tip.style.display = 'block';
    tip.style.left = e.clientX + 12 + 'px';
    tip.style.top = e.clientY + 12 + 'px';
    tip.textContent = `${hoverFile.path}\n${hoverFile.loc.toLocaleString()} lines`;
  } else tip.style.display = 'none';
});
let downAt = [0, 0];
renderer.domElement.addEventListener('pointerdown', e => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('click', e => {
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return; // was a drag
  if (hoverFile) vscode.postMessage({ type: 'openFile', path: hoverFile.path });
});

// scheme picker
const schemeSelect = $<HTMLSelectElement>('scheme');
schemeSelect.replaceChildren(...Object.keys(SCHEMES).map(n => new Option(n, n)));
schemeSelect.value = scheme;
function refreshPalette() { // scheme or light/dark variant changed: recolor everything, including the sidebar pills
  applyScene();
  if (boxes.length) build();
  renderTypes(lastCounts, lastStatus);
}
schemeSelect.addEventListener('change', () => {
  scheme = schemeSelect.value;
  vscode.setState({ ...vscode.getState(), scheme });
  refreshPalette();
});

$('colorMode').addEventListener('change', recolorAndScale);
$<HTMLSelectElement>('scaleMode').addEventListener('change', e => { heightScale = (e.target as HTMLSelectElement).value; recolorAndScale(); });

$<HTMLSelectElement>('projectMode').addEventListener('change', e =>
  vscode.postMessage({ type: 'setProject', name: (e.target as HTMLSelectElement).value }));

// ---- file type counters (left panel) ----
// The sidebar starts open so the live counts are visible, and collapses when a scan
// finishes -- unless the user toggled it by hand while that scan was running.
let sideTouched = false;
const setSideOpen = (open: boolean) => document.body.classList.toggle('side-collapsed', !open);
setSideOpen(true);
$('typesToggle').addEventListener('click', () => {
  sideTouched = true;
  setSideOpen(document.body.classList.contains('side-collapsed'));
});

let lastCounts: Record<string, number> = {};
let lastStatus = '';
function renderTypes(counts: Record<string, number>, status: string) {
  lastCounts = counts; lastStatus = status;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const max = rows.length ? rows[0][1] : 1;
  const total = rows.reduce((s, r) => s + r[1], 0);
  $('typesTitle').textContent = `File types (${rows.length})${status ? ' · ' + status : ''}`;
  $('typeList').replaceChildren(...rows.map(([ext, n]) => {
    const row = document.createElement('div');
    row.className = 'trow';
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = ext || '(none)';
    pill.style.background = '#' + extColor(ext).getHexString();
    pill.style.width = `${Math.max(36, Math.round((n / max) * 100))}px`; // bar length ~ share of the largest type
    pill.title = `${n.toLocaleString()} of ${total.toLocaleString()} files`;
    const count = document.createElement('span');
    count.className = 'tcount';
    count.textContent = n.toLocaleString();
    row.append(pill, count);
    return row;
  }));
}

let lastFitKey = '';
const busy = $('busy');
function setBusy(on: boolean, text = 'Scanning …') {
  busy.classList.toggle('hidden', !on);
  busy.classList.remove('failed');
  $('busyText').textContent = text;
}

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'scanning') { sideTouched = false; setBusy(true); return; }
  if (msg.type === 'progress') {
    setBusy(true, `Scanning … ${msg.done.toLocaleString()} / ${msg.total.toLocaleString()}`);
    renderTypes(msg.counts, 'scanning');
    return;
  }
  if (msg.type === 'error') { setBusy(true, `Scan failed: ${msg.message}`); busy.classList.add('failed'); return; }
  if (msg.type !== 'city') return;
  setBusy(false);
  tree = msg.tree;
  const sel = $<HTMLSelectElement>('projectMode');
  sel.replaceChildren(...(msg.projects as string[]).map(n => new Option(n === 'Auto' ? `Auto (${msg.detected})` : n, n)));
  sel.value = msg.activeProject;
  heightScale = msg.heightScale;
  $<HTMLSelectElement>('scaleMode').value = heightScale;
  relayout();
  const fitKey = `${msg.rootKey}|${msg.activeProject}`;
  if (fitKey !== lastFitKey) { // new root or project type: frame the whole city (not on plain refreshes)
    lastFitKey = fitKey;
    pendingFit = true;
    fitCamera();
    setTimeout(() => { pendingFit = false; }, 600);
  }
  const counts: Record<string, number> = {};
  for (const b of boxes) if (b.kind === 'file') counts[b.ext] = (counts[b.ext] ?? 0) + 1;
  renderTypes(counts, '');
  if (!sideTouched) setSideOpen(false);
});

function resize() {
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (pendingFit) fitCamera();
}
new ResizeObserver(resize).observe(stage); // also fires while the sidebar animates open/closed
resize();

(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  aimSun();
  renderer.render(scene, camera);
})();

vscode.postMessage({ type: 'ready' });
