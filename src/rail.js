// Schienenverkehr: Straßenbahn (BVG-Gelb, Gelenkzug) und S-Bahn auf dem Stadtbahn-Viadukt.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, ROAD_TYPES } from './geo.js';

export const DECK_Y = 8.4;

function prep(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / L) * d, p[1] + (dx / L) * d];
  });
}
function ribbon(pts, w, y, out, vScale = 1) {
  const n = pts.length; if (n < 2) return;
  const base = out.pos.length / 3; let dist = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    if (i > 0) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const nx = -tz, nz = tx, p = pts[i];
    out.pos.push(p[0] + nx * w / 2, y, p[1] + nz * w / 2, p[0] - nx * w / 2, y, p[1] - nz * w / 2);
    out.nor.push(0, 1, 0, 0, 1, 0); out.uv.push(0, dist / vScale, 1, dist / vScale);
    if (i < n - 1) { const k = base + 2 * i; out.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
}
function toGeo(out) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  g.setIndex(out.idx);
  return g;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

function buildGraph(rails) {
  const key = (p) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
  const count = new Map();
  for (const r of rails) r.pts.forEach((p, i) => { const k = key(p); count.set(k, (count.get(k) || 0) + (i === 0 || i === r.pts.length - 1 ? 2 : 1)); });
  const links = [];
  for (const r of rails) {
    let start = 0;
    for (let i = 1; i < r.pts.length; i++) {
      if (count.get(key(r.pts[i])) > 1 || i === r.pts.length - 1) {
        const pts = r.pts.slice(start, i + 1);
        const cum = [0];
        for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
        if (cum[cum.length - 1] > 0.3) links.push({ pts, cum, len: cum[cum.length - 1], kind: r.kind, y: r.elevated ? DECK_Y + 0.25 : 0.12, a: key(pts[0]), b: key(pts[pts.length - 1]) });
        start = i;
      }
    }
  }
  const nodes = new Map();
  const add = (k, o) => { let a = nodes.get(k); if (!a) nodes.set(k, (a = [])); a.push(o); };
  for (const l of links) { add(l.a, { link: l, dir: 1 }); add(l.b, { link: l, dir: -1 }); }
  return { links, nodes };
}
function sample(link, s, out) {
  const { pts, cum } = link;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m + 1] < s) lo = m + 1; else hi = m; }
  const i = Math.min(lo, pts.length - 2);
  const seg = cum[i + 1] - cum[i] || 1e-6, t = Math.max(0, Math.min(1, (s - cum[i]) / seg));
  out.x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t; out.z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
  return out;
}

// ---------------------------------------------------------------- Fahrzeugmodelle
function tramSegment(len, front, rear, panto) {
  const Y = 0xf2c400, W = 0xf3f1ea, G = 0x141a21, D = 0x2a2d31;
  const parts = [];
  parts.push(prep(new RoundedBoxGeometry(2.4, 2.75, len, 3, 0.22).translate(0, 0.4 + 1.375, 0), Y));
  parts.push(prep(box(2.42, 0.32, len - 0.4, 0, 0.5, 0), D));
  parts.push(prep(box(2.44, 1.15, len - 1.0, 0, 2.05, 0), G));
  parts.push(prep(box(2.43, 0.12, len - 0.6, 0, 1.4, 0), W));
  parts.push(prep(box(1.9, 0.32, len - 1.6, 0, 3.25, 0), 0xb9bcc0));
  // Türen
  for (const z of [-len * 0.25, len * 0.25]) for (const sx of [-1, 1]) parts.push(prep(box(0.03, 2.1, 1.3, sx * 1.215, 1.55, z), 0x23282e));
  if (front) parts.push(prep(new RoundedBoxGeometry(2.3, 1.5, 0.5, 2, 0.2).translate(0, 2.15, len / 2 - 0.05), G));
  if (rear) parts.push(prep(new RoundedBoxGeometry(2.3, 1.5, 0.5, 2, 0.2).translate(0, 2.15, -len / 2 + 0.05), G));
  if (panto) {
    const arm1 = new THREE.BoxGeometry(0.06, 0.06, 1.8); arm1.rotateX(0.6); arm1.translate(0, 3.85, 0.3);
    const arm2 = new THREE.BoxGeometry(0.06, 0.06, 1.8); arm2.rotateX(-0.6); arm2.translate(0, 4.6, 0.3);
    parts.push(prep(arm1, 0x333333), prep(arm2, 0x333333), prep(box(1.4, 0.05, 0.25, 0, 5.15, 0.0), 0x444444));
  }
  const lights = [];
  if (front) for (const sx of [-0.8, 0.8]) lights.push(prep(box(0.3, 0.14, 0.05, sx, 0.95, len / 2 + 0.02), 0xfff4dc));
  if (rear) for (const sx of [-0.8, 0.8]) lights.push(prep(box(0.3, 0.14, 0.05, sx, 0.95, -len / 2 - 0.02), 0xff2010));
  lights.push(prep(box(1.2, 0.2, 0.04, 0, 2.95, front ? len / 2 + 0.06 : -len / 2 - 0.06), 0xffa000)); // Zielanzeige
  return { body: mergeGeometries(parts), lights: lights.length ? mergeGeometries(lights) : null };
}
function sbahnCar(len, front, rear) {
  const RED = 0x8e1b1b, OCH = 0xd29a2e, G = 0x141a21, D = 0x2a2d31;
  const parts = [];
  parts.push(prep(new RoundedBoxGeometry(3.0, 1.55, len, 3, 0.2).translate(0, 0.5 + 0.78, 0), RED));
  parts.push(prep(new RoundedBoxGeometry(3.0, 1.85, len, 3, 0.35).translate(0, 2.05 + 0.92, 0), OCH));
  parts.push(prep(box(3.02, 0.95, len - 1.2, 0, 2.6, 0), G));
  parts.push(prep(box(2.4, 0.45, len - 1, 0, 0.35, 0), D));
  for (const z of [-len / 3, 0, len / 3]) for (const sx of [-1, 1]) parts.push(prep(box(0.03, 2.2, 1.4, sx * 1.51, 1.75, z), 0x6d1414));
  if (front) parts.push(prep(new RoundedBoxGeometry(2.6, 1.1, 0.4, 2, 0.15).translate(0, 2.65, len / 2 - 0.05), G));
  if (rear) parts.push(prep(new RoundedBoxGeometry(2.6, 1.1, 0.4, 2, 0.15).translate(0, 2.65, -len / 2 + 0.05), G));
  const lights = [];
  if (front) for (const sx of [-0.9, 0.9]) lights.push(prep(box(0.3, 0.16, 0.05, sx, 1.2, len / 2 + 0.02), 0xfff4dc));
  if (rear) for (const sx of [-0.9, 0.9]) lights.push(prep(box(0.3, 0.16, 0.05, sx, 1.2, -len / 2 - 0.02), 0xff2010));
  return { body: mergeGeometries(parts), lights: lights.length ? mergeGeometries(lights) : null };
}

// ---------------------------------------------------------------- Netz
export class RailNetwork {
  constructor(scene, rails, colliders, roadIndex) {
    this.scene = scene;
    this.rnd = mulberry32(31);
    this.tmp = { x: 0, z: 0 };
    rails = rails || [];
    this.graphs = {};
    for (const kind of ['tram', 'sbahn']) this.graphs[kind] = buildGraph(rails.filter((r) => r.kind === kind));

    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.38 });
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.buildTracks(rails, colliders, roadIndex);

    this.vehicles = [];
    const tramLinks = this.graphs.tram.links.reduce((s, l) => s + l.len, 0);
    const sLinks = this.graphs.sbahn.links.reduce((s, l) => s + l.len, 0);
    const nTram = Math.min(10, Math.floor(tramLinks / 450));
    const nS = Math.min(4, Math.floor(sLinks / 1200));
    for (let i = 0; i < nTram; i++) this.addVehicle('tram');
    for (let i = 0; i < nS; i++) this.addVehicle('sbahn');
  }

  buildTracks(rails, colliders, roadIndex) {
    const steel = { pos: [], nor: [], uv: [], idx: [] }, ballast = { pos: [], nor: [], uv: [], idx: [] };
    const deck = { pos: [], nor: [], uv: [], idx: [] }, walls = { pos: [], nor: [], uv: [], idx: [] };
    const wire = [], masts = [], pillars = [];
    for (const r of rails) {
      const y = r.elevated ? DECK_Y : 0;
      if (r.elevated) {
        ribbon(r.pts, 3.4, y + 0.06, ballast, 3);
        ribbon(r.pts, 7.2, y, deck, 10);
        // Brüstungen & Viaduktseiten (Klinker)
        for (const side of [-3.6, 3.6]) {
          const e = offsetLine(r.pts, side);
          for (let i = 0; i < e.length - 1; i++) {
            const [x0, z0] = e[i], [x1, z1] = e[i + 1];
            const L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.01) continue;
            const base = walls.pos.length / 3;
            const nx = (side > 0 ? -1 : 1) * -(z1 - z0) / L, nz = (side > 0 ? -1 : 1) * (x1 - x0) / L;
            walls.pos.push(x0, y - 1.6, z0, x1, y - 1.6, z1, x1, y + 1.0, z1, x0, y + 1.0, z0);
            for (let k = 0; k < 4; k++) walls.nor.push(nx, 0, nz);
            walls.uv.push(0, 0, L / 4, 0, L / 4, 2.6 / 4, 0, 2.6 / 4);
            walls.idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
          }
        }
        // Pfeiler (nicht mitten auf Straßen)
        for (let i = 0; i < r.pts.length - 1; i++) {
          const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
          const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
          for (let s = 6; s < L; s += 16) {
            const x = ax + ((bx - ax) * s) / L, z = az + ((bz - az) * s) / L;
            const rd = roadIndex.nearest(x, z, 12, (rr) => ROAD_TYPES[rr.type].drive);
            if (rd && rd.dist < rd.road.width / 2 + 2) continue;
            pillars.push([x, z, Math.atan2(bx - ax, bz - az)]);
          }
        }
      } else {
        ribbon(r.pts, 2.0, 0.1, ballast, 3);
      }
      for (const off of [-0.72, 0.72]) ribbon(offsetLine(r.pts, off), 0.09, y + (r.elevated ? 0.24 : 0.115), steel, 1);
      // Oberleitung + Masten
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        wire.push(ax, y + 6.0, az, bx, y + 6.0, bz);
        const L = Math.hypot(bx - ax, bz - az);
        for (let s = 20; s < L; s += 45) masts.push([ax + ((bx - ax) * s) / L - ((bz - az) / L) * 2.4, y, az + ((bz - az) * s) / L + ((bx - ax) / L) * 2.4]);
      }
    }
    const brick = canvasTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#5a2f22'; ctx.fillRect(0, 0, w, h);
      const r = mulberry32(4);
      for (let y = 0; y < h; y += 16) for (let x = -((y / 16) % 2) * 16; x < w; x += 32) {
        const t = 120 + r() * 50; ctx.fillStyle = `rgb(${t},${t * 0.48},${t * 0.36})`; ctx.fillRect(x + 1, y + 1, 30, 14);
      }
    });
    const gravel = canvasTex(128, 256, (ctx, w, h) => {
      ctx.fillStyle = '#6b6560'; ctx.fillRect(0, 0, w, h);
      const r = mulberry32(8);
      for (let i = 0; i < 3000; i++) { const t = 70 + r() * 80; ctx.fillStyle = `rgb(${t},${t - 4},${t - 8})`; ctx.fillRect(r() * w, r() * h, 3, 3); }
      for (let y = 0; y < h; y += 43) { ctx.fillStyle = '#4b4038'; ctx.fillRect(w * 0.08, y, w * 0.84, 16); }
    });
    const add = (out, mat, shadow = true) => { if (!out.idx.length) return; const m = new THREE.Mesh(toGeo(out), mat); m.receiveShadow = true; m.castShadow = shadow; this.scene.add(m); };
    add(ballast, new THREE.MeshStandardMaterial({ map: gravel, roughness: 1, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }), false);
    add(steel, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }), false);
    add(deck, new THREE.MeshStandardMaterial({ map: brick, color: 0x9a8a80, roughness: 0.95, side: THREE.DoubleSide }));
    add(walls, new THREE.MeshStandardMaterial({ map: brick, roughness: 0.9 }));
    if (wire.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
      this.scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x222222 })));
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    if (masts.length) {
      const mg = new THREE.CylinderGeometry(0.1, 0.13, 6.4, 6); mg.translate(0, 3.2, 0);
      const im = new THREE.InstancedMesh(mg, new THREE.MeshStandardMaterial({ color: 0x4d5257, metalness: 0.6, roughness: 0.5 }), masts.length);
      masts.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); im.setMatrixAt(i, m4); });
      im.castShadow = true; this.scene.add(im);
    }
    if (pillars.length) {
      const pg = new THREE.BoxGeometry(7.4, DECK_Y - 0.4, 2.2); pg.translate(0, (DECK_Y - 0.4) / 2, 0);
      const im = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ map: brick, roughness: 0.9 }), pillars.length);
      pillars.forEach(([x, z, a], i) => {
        p.set(x, 0, z); q.setFromAxisAngle(up, a); m4.compose(p, q, one); im.setMatrixAt(i, m4);
        const c = Math.cos(a), s = Math.sin(a);
        const corner = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
        colliders.add([corner(-3.7, -1.1), corner(3.7, -1.1), corner(3.7, 1.1), corner(-3.7, 1.1)]);
      });
      im.castShadow = true; im.receiveShadow = true; this.scene.add(im);
    }
  }

  addVehicle(kind) {
    const g = this.graphs[kind];
    if (!g.links.length) return;
    const segs = kind === 'tram' ? 5 : 6;
    const segLen = kind === 'tram' ? 5.9 : 18;
    const gap = kind === 'tram' ? 0.35 : 0.8;
    const meshes = [];
    for (let i = 0; i < segs; i++) {
      const geo = kind === 'tram' ? tramSegment(segLen, i === 0, i === segs - 1, i === 1) : sbahnCar(segLen, i === 0, i === segs - 1);
      const grp = new THREE.Group();
      const body = new THREE.Mesh(geo.body, this.bodyMat); body.castShadow = true; body.receiveShadow = true; grp.add(body);
      if (geo.lights) grp.add(new THREE.Mesh(geo.lights, this.lightMat));
      this.scene.add(grp); meshes.push(grp);
    }
    const v = { kind, segs, segLen, gap, meshes, trail: [], link: null, dir: 1, s: 0, v: 0, vmax: kind === 'tram' ? 13 : 17, nextStop: 0, dwell: 0, blocked: 0, length: segs * (segLen + gap) };
    this.spawn(v);
    this.vehicles.push(v);
  }
  spawn(v) {
    const g = this.graphs[v.kind];
    const total = g.links.reduce((s, l) => s + l.len, 0);
    let r = this.rnd() * total, l = g.links[0];
    for (const k of g.links) { r -= k.len; if (r <= 0) { l = k; break; } }
    v.link = l; v.dir = this.rnd() < 0.5 ? 1 : -1; v.s = this.rnd() * l.len; v.trail.length = 0; v.v = 0;
    v.nextStop = 80 + this.rnd() * 300;
    // Vorlauf, damit der Zug seine volle Länge hat
    for (let i = 0; i < v.length * 2 + 4; i++) this.advance(v, 0.5);
    v.v = v.vmax * 0.6;
  }
  next(v) {
    const l = v.link;
    const key = v.dir > 0 ? l.b : l.a;
    const outs = (this.graphs[v.kind].nodes.get(key) || []).filter((o) => o.link !== l);
    if (!outs.length) { v.dir = -v.dir; v.s = 0; v.trail.length = 0; for (let i = 0; i < v.length * 2 + 4; i++) this.advance(v, 0.5, true); return; }
    // möglichst geradeaus weiterfahren (Weichen)
    const tr = v.trail, n = tr.length;
    let hx = 0, hz = 1;
    if (n > 2) { hx = tr[n - 1].x - tr[n - 3].x; hz = tr[n - 1].z - tr[n - 3].z; const L = Math.hypot(hx, hz) || 1; hx /= L; hz /= L; }
    let best = outs[0], bw = -Infinity;
    for (const o of outs) {
      const pts = o.link.pts; const p0 = o.dir > 0 ? pts[0] : pts[pts.length - 1], p1 = o.dir > 0 ? pts[1] : pts[pts.length - 2];
      let dx = p1[0] - p0[0], dz = p1[1] - p0[1]; const L = Math.hypot(dx, dz) || 1;
      const w = (dx * hx + dz * hz) / L + this.rnd() * 0.2;
      if (w > bw) { bw = w; best = o; }
    }
    if (bw < 0.2) { v.dir = -v.dir; v.s = 0; v.trail.length = 0; for (let i = 0; i < v.length * 2 + 4; i++) this.advance(v, 0.5, true); return; }
    v.link = best.link; v.dir = best.dir; v.s = 0;
  }
  advance(v, ds, noTurn = false) {
    v.s += ds;
    let guard = 0;
    while (v.s > v.link.len && guard++ < 5) { const over = v.s - v.link.len; if (noTurn) { v.s = v.link.len; break; } this.next(v); v.s += over; }
    const along = v.dir > 0 ? v.s : v.link.len - v.s;
    sample(v.link, along, this.tmp);
    const last = v.trail[v.trail.length - 1];
    if (!last || Math.hypot(this.tmp.x - last.x, this.tmp.z - last.z) > 0.4) {
      v.trail.push({ x: this.tmp.x, y: v.link.y, z: this.tmp.z });
      if (v.trail.length > v.length * 3 + 20) v.trail.splice(0, v.trail.length - (v.length * 3 + 20));
    }
  }
  head(v) { const t = v.trail[v.trail.length - 1]; const u = v.trail[Math.max(0, v.trail.length - 4)]; const L = Math.hypot(t.x - u.x, t.z - u.z) || 1; return { x: t.x, z: t.z, hx: (t.x - u.x) / L, hz: (t.z - u.z) / L, y: t.y }; }

  update(dt, player) {
    for (const v of this.vehicles) {
      const h = this.head(v);
      let target = v.vmax;
      // Haltestellen
      v.nextStop -= v.v * dt;
      if (v.dwell > 0) { v.dwell -= dt; target = 0; if (v.dwell <= 0) v.nextStop = (v.kind === 'tram' ? 320 : 850) * (0.7 + this.rnd() * 0.6); }
      else if (v.nextStop <= 0) { v.dwell = v.kind === 'tram' ? 14 : 22; target = 0; }
      else target = Math.min(target, Math.sqrt(2 * 1.1 * Math.max(0, v.nextStop)) + 0.3);
      // Hindernisse: Spieler (nur Tram) und andere Züge
      let gap = 60;
      if (v.kind === 'tram') {
        const dx = player.x - h.x, dz = player.z - h.z; const al = dx * h.hx + dz * h.hz, lat = Math.abs(dx * -h.hz + dz * h.hx);
        if (al > 0 && al < 40 && lat < 2.6) gap = Math.min(gap, al - 3);
      }
      let headOn = false;
      for (const o of this.vehicles) {
        if (o === v || o.kind !== v.kind) continue;
        for (let i = o.trail.length - 1; i >= 0; i -= 6) {
          const p = o.trail[i]; const dx = p.x - h.x, dz = p.z - h.z;
          if (Math.abs(dx) > 120 || Math.abs(dz) > 120) continue;
          const al = dx * h.hx + dz * h.hz, lat = Math.abs(dx * -h.hz + dz * h.hx);
          if (al > 0.5 && al < 60 && lat < 1.4) { gap = Math.min(gap, al - 4); if (i === o.trail.length - 1 || i >= o.trail.length - 7) { const oh = this.head(o); if (oh.hx * h.hx + oh.hz * h.hz < -0.5) headOn = true; } }
        }
      }
      target = Math.min(target, Math.max(0, (gap - 4) * 0.6));
      if (target < 0.1 && v.dwell <= 0) v.blocked += dt; else v.blocked = 0;
      if (headOn && v.blocked > 6) {
        // Gegenverkehr auf demselben Gleis: der fernere Zug wird umgesetzt
        if (Math.hypot(h.x - player.x, h.z - player.z) > 160) this.spawn(v);
        v.blocked = 0;
      }
      const acc = target > v.v ? 1.1 : -2.4;
      v.v = Math.max(0, v.v + Math.sign(target - v.v) * Math.min(Math.abs(target - v.v), Math.abs(acc) * dt));
      if (v.v > 0) this.advance(v, v.v * dt);
      this.place(v);
    }
  }
  place(v) {
    const tr = v.trail;
    let idx = tr.length - 1, acc = 0;
    const pointAt = (d) => {
      // Punkt im Abstand d hinter dem Kopf entlang der Spur
      while (idx > 0) {
        const a = tr[idx], b = tr[idx - 1];
        const L = Math.hypot(a.x - b.x, a.z - b.z);
        if (acc + L >= d) { const t = (d - acc) / (L || 1); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; }
        acc += L; idx--;
      }
      return { ...tr[0] };
    };
    for (let i = 0; i < v.segs; i++) {
      const f = pointAt(i * (v.segLen + v.gap));
      const b = pointAt(i * (v.segLen + v.gap) + v.segLen);
      const m = v.meshes[i];
      m.position.set((f.x + b.x) / 2, (f.y + b.y) / 2, (f.z + b.z) / 2);
      m.rotation.y = Math.atan2(f.x - b.x, f.z - b.z);
    }
  }
  collidePlayer(x, z, r = 1.25) {
    let px = 0, pz = 0, hit = false;
    for (const v of this.vehicles) {
      if (v.kind !== 'tram') continue;
      for (const m of v.meshes) {
        const dx = x - m.position.x, dz = z - m.position.z;
        if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
        const hx = Math.sin(m.rotation.y), hz = Math.cos(m.rotation.y);
        const t = Math.max(-v.segLen / 2 + 1.2, Math.min(v.segLen / 2 - 1.2, dx * hx + dz * hz));
        const ex = x - (m.position.x + hx * t), ez = z - (m.position.z + hz * t);
        const d = Math.hypot(ex, ez), rr = r + 1.25;
        if (d < rr && d > 1e-4) { px += (ex / d) * (rr - d); pz += (ez / d) * (rr - d); hit = true; }
      }
    }
    return { px, pz, hit };
  }
  setNight(n) { this.lightMat.color.setScalar(0.9 + n * 3); }
}
