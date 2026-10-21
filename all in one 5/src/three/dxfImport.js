import * as THREE from 'three';
import { NURBSCurve } from 'three/examples/jsm/curves/NURBSCurve.js';

// ASCII-DXF importer.
//
// What becomes a SOLID part (selectable, explodable, simulated):
//   3DFACE and polyface meshes (POLYLINE flag 64) -> one Mesh per layer.
// What becomes a WIREFRAME (display + section only, NOT selectable):
//   LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, ELLIPSE, SPLINE -> LineSegments.
// Block references (INSERT) are expanded recursively with their
// position / rotation(Z) / scale, for both of the above.
// NOT converted (counted and reported): 3DSOLID/BODY (ACIS), MESH, HATCH, TEXT,
// DIMENSION, MINSERT arrays, and anything else. LWPOLYLINE bulges (arc
// segments) are drawn straight; extrusion directions other than +Z are ignored.

const UNIT_TO_METRES = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000 };
const MAX_DEPTH = 24;
const MAX_FLOATS = 12_000_000; // ~2M line segments; stops runaway block expansion

function readPairs(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  return pairs;
}
const first = (e, code) => { const h = e.data.find(([c]) => c === code); return h ? h[1] : undefined; };
const num = (e, code, d = 0) => { const v = first(e, code); return v === undefined ? d : parseFloat(v); };
const all = (e, code) => e.data.filter(([c]) => c === code).map(([, v]) => parseFloat(v));

// ---- curve tessellation (local coordinates, returns [x,y,z][]) ----------

function arcPoints(cx, cy, cz, r, a0, a1, segs = 48) {
  let span = a1 - a0;
  if (span <= 0) span += Math.PI * 2;
  const n = Math.max(4, Math.ceil((segs * span) / (Math.PI * 2)));
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (span * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), cz]); }
  return pts;
}

function splinePoints(e) {
  const flags = parseInt(first(e, 70) || '0', 10);
  const degree = parseInt(first(e, 71) || '3', 10);
  const knots = all(e, 40);
  const xs = all(e, 10), ys = all(e, 20), zs = all(e, 30);
  const weights = all(e, 41);
  const ctrl = xs.map((x, i) => [x, ys[i] ?? 0, zs[i] ?? 0]);
  const fx = all(e, 11), fy = all(e, 21), fz = all(e, 31);
  const fit = fx.map((x, i) => new THREE.Vector3(x, fy[i] ?? 0, fz[i] ?? 0));

  if (ctrl.length >= degree + 1 && knots.length === ctrl.length + degree + 1) {
    try {
      const cps = ctrl.map((p, i) => new THREE.Vector4(p[0], p[1], p[2], weights[i] ?? 1));
      const curve = new NURBSCurve(degree, knots, cps, degree, knots.length - 1 - degree);
      const divisions = Math.min(200, Math.max(16, ctrl.length * 8));
      const pts = [];
      for (let i = 0; i <= divisions; i++) {
        const p = curve.getPoint(Math.min(i / divisions, 1 - 1e-9));
        if (Number.isFinite(p.x + p.y + p.z)) pts.push([p.x, p.y, p.z]);
      }
      if (pts.length > 1) return pts;
    } catch { /* fall through */ }
  }
  if (fit.length >= 2) {
    const c = new THREE.CatmullRomCurve3(fit, !!(flags & 1));
    return c.getPoints(Math.min(200, fit.length * 8)).map((p) => [p.x, p.y, p.z]);
  }
  return ctrl.length >= 2 ? ctrl : []; // last resort: the control polygon
}

function curvePoints(list, i) {
  const e = list[i];
  switch (e.type) {
    case 'LINE': return { pts: [[num(e, 10), num(e, 20), num(e, 30)], [num(e, 11), num(e, 21), num(e, 31)]], next: i };
    case 'CIRCLE': return { pts: arcPoints(num(e, 10), num(e, 20), num(e, 30), num(e, 40), 0, Math.PI * 2 - 1e-9, 64), next: i };
    case 'ARC': return { pts: arcPoints(num(e, 10), num(e, 20), num(e, 30), num(e, 40), (num(e, 50) * Math.PI) / 180, (num(e, 51) * Math.PI) / 180), next: i };
    case 'ELLIPSE': {
      const [cx, cy, cz] = [num(e, 10), num(e, 20), num(e, 30)];
      const [mx, my, mz] = [num(e, 11), num(e, 21), num(e, 31)];
      const ratio = num(e, 40, 1), t0 = num(e, 41, 0), t1 = num(e, 42, Math.PI * 2);
      const major = new THREE.Vector3(mx, my, mz);
      const minor = new THREE.Vector3(-my, mx, 0).normalize().multiplyScalar(major.length() * ratio);
      const pts = [];
      const n = 64;
      for (let k = 0; k <= n; k++) {
        const t = t0 + ((t1 > t0 ? t1 - t0 : t1 - t0 + Math.PI * 2) * k) / n;
        pts.push([cx + major.x * Math.cos(t) + minor.x * Math.sin(t), cy + major.y * Math.cos(t) + minor.y * Math.sin(t), cz + major.z * Math.cos(t) + minor.z * Math.sin(t)]);
      }
      return { pts, next: i };
    }
    case 'SPLINE': return { pts: splinePoints(e), next: i };
    case 'LWPOLYLINE': {
      const xs = all(e, 10), ys = all(e, 20), z = num(e, 38, 0);
      const pts = xs.map((x, k) => [x, ys[k] ?? 0, z]);
      if ((parseInt(first(e, 70) || '0', 10) & 1) && pts.length > 2) pts.push(pts[0]);
      return { pts, next: i };
    }
    case 'POLYLINE': {
      const flags = parseInt(first(e, 70) || '0', 10);
      if (flags & (16 | 64)) return null; // polygon mesh / polyface: handled elsewhere
      const pts = [];
      let j = i + 1;
      for (; j < list.length && list[j].type !== 'SEQEND'; j++) {
        if (list[j].type === 'VERTEX') pts.push([num(list[j], 10), num(list[j], 20), num(list[j], 30)]);
      }
      if ((flags & 1) && pts.length > 2) pts.push(pts[0]);
      return { pts, next: j };
    }
    default: return null;
  }
}

// Move each part's geometry so its own bounding-box centre is the object's
// origin; otherwise rotate/scale would pivot around the world origin and
// fling the part away. Visually nothing changes at load.
function recentre(obj) {
  obj.geometry.computeBoundingBox();
  const c = obj.geometry.boundingBox.getCenter(new THREE.Vector3());
  obj.geometry.translate(-c.x, -c.y, -c.z);
  obj.position.copy(c);
}

// ---- main ---------------------------------------------------------------

export function parseDxf(text, fileName = 'dxf-model') {
  if (/^AC10\d\d/.test(text)) {
    throw new Error('This looks like a binary DWG. Convert it to DXF first (AutoCAD: SAVEAS → DXF, or the free ODA File Converter).');
  }
  const pairs = readPairs(text);
  if (!pairs.some(([c, v]) => c === 0 && v === 'SECTION')) {
    throw new Error('Not a valid ASCII DXF file (binary DXF and DWG are not supported).');
  }

  let insUnits = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') { insUnits = parseInt(pairs[i + 1][1], 10); break; }
  }
  const us = UNIT_TO_METRES[insUnits] ?? 1;

  // Split into BLOCKS (name -> {base, entities}) and top-level ENTITIES.
  const blocks = new Map();
  const top = [];
  let section = null, curEntity = null, curBlock = null, expectName = false;
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0 && value === 'SECTION') { expectName = true; section = null; curEntity = null; continue; }
    if (expectName && code === 2) { section = value; expectName = false; continue; }
    if (code === 0 && value === 'ENDSEC') { section = null; curEntity = null; curBlock = null; continue; }
    if (section !== 'BLOCKS' && section !== 'ENTITIES') continue;
    if (code === 0) {
      curEntity = { type: value, data: [] };
      if (section === 'ENTITIES') top.push(curEntity);
      else if (value === 'BLOCK') curBlock = { name: null, base: [0, 0, 0], entities: [], header: curEntity };
      else if (value === 'ENDBLK') { if (curBlock) { blocks.set(curBlock.name, curBlock); } curBlock = null; curEntity = null; }
      else if (curBlock) curBlock.entities.push(curEntity);
      continue;
    }
    curEntity?.data.push([code, value]);
    if (curBlock && curEntity === curBlock.header) {
      if (code === 2 && curBlock.name === null) curBlock.name = value;
      if (code === 10) curBlock.base[0] = parseFloat(value);
      if (code === 20) curBlock.base[1] = parseFloat(value);
      if (code === 30) curBlock.base[2] = parseFloat(value);
    }
  }

  const triLayers = new Map();   // layer -> floats (Y-up, metres)
  const lineBuckets = new Map(); // bucket name -> floats
  const skipped = {};
  let floats = 0;
  let truncated = false;
  const v = new THREE.Vector3();
  const cadToScene = (m, p, out) => { // p local -> CAD world via m -> scene (Y-up, metres)
    v.set(p[0], p[1], p[2]).applyMatrix4(m);
    out.push(v.x * us, v.z * us, -v.y * us);
  };

  const skip = (t) => { skipped[t] = (skipped[t] || 0) + 1; };
  const bucketUsed = new Map();
  const uniqueBucket = (name) => {
    const n = (bucketUsed.get(name) || 0) + 1; bucketUsed.set(name, n);
    return n === 1 ? name : `${name}_${n}`;
  };

  function walk(list, matrix, bucket, depth) {
    for (let i = 0; i < list.length; i++) {
      if (floats > MAX_FLOATS) { truncated = true; return; }
      const e = list[i];
      const layer = first(e, 8) || '0';

      if (e.type === 'INSERT') {
        const block = blocks.get(first(e, 2));
        if (!block || depth >= MAX_DEPTH) { skip('INSERT (unresolved)'); continue; }
        if (parseInt(first(e, 70) || '1', 10) > 1 || parseInt(first(e, 71) || '1', 10) > 1) { skip('MINSERT'); continue; }
        const m = new THREE.Matrix4()
          .makeTranslation(num(e, 10), num(e, 20), num(e, 30))
          .multiply(new THREE.Matrix4().makeRotationZ((num(e, 50) * Math.PI) / 180))
          .multiply(new THREE.Matrix4().makeScale(num(e, 41, 1), num(e, 42, 1), num(e, 43, 1)))
          .multiply(new THREE.Matrix4().makeTranslation(-block.base[0], -block.base[1], -block.base[2]));
        const childMatrix = matrix.clone().multiply(m);
        walk(block.entities, childMatrix, depth === 0 ? uniqueBucket(block.name) : bucket, depth + 1);
        continue;
      }

      if (e.type === '3DFACE') {
        const p = [0, 1, 2, 3].map((k) => [num(e, 10 + k), num(e, 20 + k), num(e, 30 + k)]);
        const arr = triLayers.get(layer) || triLayers.set(layer, []).get(layer);
        const same = p[2][0] === p[3][0] && p[2][1] === p[3][1] && p[2][2] === p[3][2];
        for (const tri of same ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]]) for (const k of tri) cadToScene(matrix, p[k], arr);
        floats += 18;
        continue;
      }

      if (e.type === 'POLYLINE' && (parseInt(first(e, 70) || '0', 10) & 64)) {
        const verts = [], faces = [];
        let j = i + 1;
        for (; j < list.length && list[j].type !== 'SEQEND'; j++) {
          const vt = list[j];
          if (vt.type !== 'VERTEX') continue;
          const flags = parseInt(first(vt, 70) || '0', 10);
          if (flags & 64) verts.push([num(vt, 10), num(vt, 20), num(vt, 30)]);
          else if (flags & 128) faces.push([71, 72, 73, 74].map((c) => Math.abs(num(vt, c, 0))).filter((n) => n > 0));
        }
        const arr = triLayers.get(layer) || triLayers.set(layer, []).get(layer);
        for (const f of faces) for (let k = 1; k + 1 < f.length; k++) {
          const a = verts[f[0] - 1], b = verts[f[k] - 1], c = verts[f[k + 1] - 1];
          if (a && b && c) { cadToScene(matrix, a, arr); cadToScene(matrix, b, arr); cadToScene(matrix, c, arr); floats += 9; }
        }
        i = j;
        continue;
      }

      const curve = curvePoints(list, i);
      if (curve) {
        i = curve.next;
        if (curve.pts.length < 2) { skip(`${e.type} (empty)`); continue; }
        const arr = lineBuckets.get(bucket) || lineBuckets.set(bucket, []).get(bucket);
        for (let k = 0; k + 1 < curve.pts.length; k++) {
          cadToScene(matrix, curve.pts[k], arr);
          cadToScene(matrix, curve.pts[k + 1], arr);
          floats += 6;
        }
        continue;
      }
      if (e.type !== 'VERTEX' && e.type !== 'SEQEND') skip(e.type);
    }
  }

  walk(top, new THREE.Matrix4(), 'Model_Space', 0);

  if (triLayers.size === 0 && lineBuckets.size === 0) {
    const summary = Object.entries(skipped).map(([t, n]) => `${n}× ${t}`).join(', ') || 'no entities';
    throw new Error(`Nothing drawable in this DXF (found: ${summary}). Supported: 3DFACE, polyface meshes, and curves (LINE, POLYLINE, LWPOLYLINE, CIRCLE, ARC, ELLIPSE, SPLINE) incl. block references.`);
  }

  const group = new THREE.Group();
  group.name = fileName.replace(/\.[^/.]+$/, '');
  for (const [layer, arr] of triLayers) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide }));
    mesh.name = layer;
    recentre(mesh);
    group.add(mesh);
  }
  for (const [name, arr] of lineBuckets) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xd5d9de }));
    lines.name = name;
    recentre(lines);
    group.add(lines);
  }
  group.userData.dxfSkipped = skipped;
  group.userData.wireframeOnly = triLayers.size === 0;
  group.userData.dxfTruncated = truncated;
  return group;
}
