// Aufbau der 3D-Welt aus den Kartendaten: Gebäude, Straßen, Wasser, Parks, Bäume, Laternen, Wahrzeichen.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_TYPES, LANDMARKS, ringArea, pointInRing, mulberry32, EXTENT } from './geo.js';

// ---------------------------------------------------------------- Kollision
export class Colliders {
  constructor(cell = 40) { this.cell = cell; this.grid = new Map(); this.polys = []; this.stamp = 0; }
  key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  add(ring) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const poly = { ring, minX, minZ, maxX, maxZ, s: 0 };
    this.polys.push(poly);
    for (let ix = Math.floor(minX / this.cell); ix <= Math.floor(maxX / this.cell); ix++)
      for (let iz = Math.floor(minZ / this.cell); iz <= Math.floor(maxZ / this.cell); iz++) {
        const k = this.key(ix, iz);
        let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(poly);
      }
  }
  candidates(x, z, r) {
    const out = []; const st = ++this.stamp;
    for (let ix = Math.floor((x - r) / this.cell); ix <= Math.floor((x + r) / this.cell); ix++)
      for (let iz = Math.floor((z - r) / this.cell); iz <= Math.floor((z + r) / this.cell); iz++) {
        const a = this.grid.get(this.key(ix, iz)); if (!a) continue;
        for (const p of a) if (p.s !== st && x + r > p.minX && x - r < p.maxX && z + r > p.minZ && z - r < p.maxZ) { p.s = st; out.push(p); }
      }
    return out;
  }
  inside(x, z) { return this.candidates(x, z, 0.1).some((p) => pointInRing(x, z, p.ring)); }
  /** Schiebt einen Kreis aus allen Polygonen heraus. */
  resolveCircle(x, z, r) {
    let hit = false, nx = 0, nz = 0;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const p of this.candidates(x, z, r)) {
        const ring = p.ring;
        let best = Infinity, bx = 0, bz = 0;
        for (let i = 0, n = ring.length; i < n; i++) {
          const a = ring[i], b = ring[(i + 1) % n];
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const L = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L));
          const cx = a[0] + dx * t, cz = a[1] + dz * t;
          const d = (x - cx) ** 2 + (z - cz) ** 2;
          if (d < best) { best = d; bx = cx; bz = cz; }
        }
        const d = Math.sqrt(best);
        const ins = pointInRing(x, z, ring);
        if (ins || d < r) {
          let ux = x - bx, uz = z - bz; const l = Math.hypot(ux, uz) || 1e-6; ux /= l; uz /= l;
          if (ins) { ux = -ux; uz = -uz; }
          const push = ins ? d + r : r - d;
          x += ux * push; z += uz * push; nx += ux; nz += uz; hit = true; moved = true;
        }
      }
      if (!moved) break;
    }
    const l = Math.hypot(nx, nz) || 1;
    return { x, z, hit, nx: nx / l, nz: nz / l };
  }
}

// ---------------------------------------------------------- Straßen-Index
export class RoadIndex {
  constructor(cell = 30) { this.cell = cell; this.grid = new Map(); }
  add(road) {
    const pts = road.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const seg = { ax, az, bx, bz, road };
      const x0 = Math.floor(Math.min(ax, bx) / this.cell), x1 = Math.floor(Math.max(ax, bx) / this.cell);
      const z0 = Math.floor(Math.min(az, bz) / this.cell), z1 = Math.floor(Math.max(az, bz) / this.cell);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const k = ix + ',' + iz; let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(seg);
      }
    }
  }
  nearest(x, z, maxD = 30, filter) {
    let best = null, bd = maxD * maxD, bt = null;
    const ix = Math.floor(x / this.cell), iz = Math.floor(z / this.cell);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = this.grid.get(ix + dx + ',' + (iz + dz)); if (!a) continue;
      for (const s of a) {
        if (filter && !filter(s.road)) continue;
        const ex = s.bx - s.ax, ez = s.bz - s.az; const L = ex * ex + ez * ez || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / L));
        const d = (x - s.ax - ex * t) ** 2 + (z - s.az - ez * t) ** 2;
        if (d < bd) { bd = d; best = s; bt = t; }
      }
    }
    if (!best) return null;
    return { road: best.road, x: best.ax + (best.bx - best.ax) * bt, z: best.az + (best.bz - best.az) * bt, dirX: best.bx - best.ax, dirZ: best.bz - best.az, dist: Math.sqrt(bd) };
  }
}

// ---------------------------------------------------------------- Texturen
function canvasTex(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function facadeTextures(aniso) {
  const N = 8, S = 1024, cell = S / N;
  const rnd = mulberry32(42);
  const lit = [];
  for (let i = 0; i < N * N; i++) lit.push(rnd() < 0.34 ? 0.5 + rnd() * 0.5 : 0);
  const shopLit = [];
  for (let i = 0; i < N; i++) shopLit.push(rnd() < 0.75);
  const AWN = ['#7a1c1c', '#1f3a5a', '#2f4a2f', '#3a3a3a', '#8a5a1a', '#5a2a4a'];
  // Erdgeschoss (unterste Bildzeile = v 0): Läden mit Schaufenstern
  const shops = (ctx, fn) => {
    const y = (N - 1) * cell;
    for (let fx = 0; fx < N; fx++) fn(ctx, fx * cell, y, fx);
  };
  const win = (ctx, fn) => {
    for (let fy = 0; fy < N - 1; fy++) for (let fx = 0; fx < N; fx++) {
      const x = fx * cell + cell * 0.26, y = fy * cell + cell * 0.2, w = cell * 0.48, h = cell * 0.6;
      fn(ctx, x, y, w, h, fy * N + fx);
    }
  };
  const map = canvasTex(S, S, (ctx) => {
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) { const g = 225 + rnd() * 30; ctx.fillStyle = `rgba(${g},${g - 4},${g - 10},0.35)`; ctx.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 3, 2 + rnd() * 3); }
    for (let fy = 0; fy < N; fy++) { ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(0, fy * cell + cell * 0.86, S, cell * 0.05); }
    win(ctx, (c, x, y, w, h, i) => {
      c.fillStyle = '#dcd6cb'; c.fillRect(x - 6, y - 6, w + 12, h + 14);
      const g = c.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#5d7288'); g.addColorStop(0.55, '#2a3542'); g.addColorStop(1, '#1b232c');
      c.fillStyle = g; c.fillRect(x, y, w, h);
      c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(x + w / 2 - 2, y, 4, h); c.fillRect(x, y + h * 0.33, w, 3);
      if (i % 7 === 3) { c.fillStyle = 'rgba(230,225,210,0.85)'; c.fillRect(x, y, w, h * 0.45); }
    });
    shops(ctx, (c, x, y, i) => {
      c.fillStyle = '#9c968c'; c.fillRect(x, y, cell, cell);
      c.fillStyle = '#2a2724'; c.fillRect(x + 4, y + 8, cell - 8, 18); // Schildband
      c.fillStyle = 'rgba(255,255,255,0.75)'; c.font = 'bold 12px sans-serif'; if (i % 2 === 0) c.fillText(['CAFÉ', 'BÄCKEREI', 'SPÄTI', 'APOTHEKE', 'MODE', 'BAR', 'BUCHLADEN', 'BISTRO'][i], x + 10, y + 21);
      const g = c.createLinearGradient(0, y + 30, 0, y + cell);
      g.addColorStop(0, '#46586a'); g.addColorStop(1, '#141a20');
      c.fillStyle = g; c.fillRect(x + 8, y + 32, cell - 16, cell - 38);
      c.fillStyle = '#1b1b1b'; c.fillRect(x + cell / 2 - 2, y + 32, 4, cell - 38);
      if (i % 3 === 0) { c.fillStyle = AWN[i % AWN.length]; c.fillRect(x + 2, y + 26, cell - 4, 12); c.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 0; k < cell; k += 16) c.fillRect(x + k, y + 26, 8, 12); }
    });
  });
  const emissive = canvasTex(S, S, (ctx) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    win(ctx, (c, x, y, w, h, i) => {
      const v = lit[i]; if (!v) return;
      const warm = rnd() < 0.8;
      c.fillStyle = warm ? `rgba(255,${190 + rnd() * 40},${110 + rnd() * 50},${v})` : `rgba(180,210,255,${v})`;
      c.fillRect(x, y, w, h);
    });
    shops(ctx, (c, x, y, i) => {
      if (!shopLit[i]) return;
      c.fillStyle = `rgba(255,${200 + (i * 7) % 40},${130 + (i * 13) % 60},0.95)`; c.fillRect(x + 8, y + 32, cell - 16, cell - 38);
      c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(x + 4, y + 8, cell - 8, 18);
    });
  });
  // G = Rauheit, B = Metall (Fenster spiegeln)
  const rm = canvasTex(S, S, (ctx) => {
    ctx.fillStyle = 'rgb(0,235,0)'; ctx.fillRect(0, 0, S, S);
    win(ctx, (c, x, y, w, h) => { c.fillStyle = 'rgb(0,28,200)'; c.fillRect(x, y, w, h); });
    shops(ctx, (c, x, y) => { c.fillStyle = 'rgb(0,20,220)'; c.fillRect(x + 8, y + 32, cell - 16, cell - 38); });
  }, { srgb: false });
  for (const t of [map, emissive, rm]) t.anisotropy = aniso;
  return { map, emissive, rm };
}

function roadTexture(major, aniso) {
  const t = canvasTex(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#56575a'; ctx.fillRect(0, 0, w, h);
    const rnd = mulberry32(major ? 7 : 9);
    for (let i = 0; i < 6000; i++) { const g = 55 + rnd() * 50; ctx.fillStyle = `rgba(${g},${g},${g + 3},0.6)`; ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    for (let i = 0; i < 18; i++) { ctx.fillStyle = 'rgba(20,20,22,0.18)'; ctx.fillRect(rnd() * w, 0, 6 + rnd() * 18, h); }
    if (major) {
      ctx.fillStyle = '#e9e9e4';
      ctx.fillRect(w * 0.035, 0, 5, h); ctx.fillRect(w * 0.965 - 5, 0, 5, h);
      ctx.fillRect(w / 2 - 3, 0, 6, h * 0.5);
      ctx.fillStyle = 'rgba(233,233,228,0.8)';
      ctx.fillRect(w * 0.27 - 2, h * 0.1, 4, h * 0.25); ctx.fillRect(w * 0.73 - 2, h * 0.1, 4, h * 0.25);
    }
  });
  t.anisotropy = aniso;
  return t;
}

function groundTexture(aniso) {
  const t = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8b8c86'; ctx.fillRect(0, 0, w, h);
    const rnd = mulberry32(3);
    for (let i = 0; i < 20000; i++) { const g = 120 + rnd() * 40; ctx.fillStyle = `rgba(${g},${g},${g - 6},0.5)`; ctx.fillRect(rnd() * w, rnd() * h, 2, 2); }
    ctx.strokeStyle = 'rgba(60,60,60,0.25)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(w, i * 64); ctx.stroke(); }
  });
  t.anisotropy = aniso;
  return t;
}

// ---------------------------------------------------------------- Gebäude
function buildBuildings(buildings, colliders, mats) {
  const W = { pos: [], nor: [], uv: [], col: [] };
  const Rf = { pos: [], nor: [], col: [] };
  const col = new THREE.Color();
  const roofCol = new THREE.Color();
  for (const b of buildings) {
    let ring = b.ring;
    if (ring.length < 3) continue;
    if (ringArea(ring) < 0) ring = ring.slice().reverse(); // einheitliche Orientierung
    const h = b.h;
    col.setHex(b.color);
    if (h > 40) col.lerp(new THREE.Color(0x9fb3c6), 0.5);
    roofCol.setHex(0x55565a).lerp(col, 0.15);
    let u = 0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % n];
      const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      // Außennormale bei positiver Fläche (x,z-System): (dz, -dx)
      const nx = dz / L, nz = -dx / L;
      const u0 = u / 24, u1 = (u + L) / 24, v1 = h / 24;
      u += L;
      // Dreiecke so anordnen, dass die Vorderseite nach außen zeigt
      const A = [x0, 0, z0], B = [x1, 0, z1], C = [x1, h, z1], D = [x0, h, z0];
      const tris = [[A, D, B, [u0, 0], [u0, v1], [u1, 0]], [B, D, C, [u1, 0], [u0, v1], [u1, v1]]];
      for (const [p, q, r, a, bq, c] of tris) {
        W.pos.push(...p, ...q, ...r);
        W.uv.push(...a, ...bq, ...c);
        for (let k = 0; k < 3; k++) { W.nor.push(nx, 0, nz); W.col.push(col.r, col.g, col.b); }
      }
    }
    // Dachgesims: leicht vorspringendes Band
    if (h > 8) {
      const cc = col.clone().multiplyScalar(0.82);
      for (let i = 0; i < n; i++) {
        const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % n];
        const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
        if (L < 0.3) continue;
        const nx = dz / L, nz = -dx / L, o = 0.35;
        const ax = x0 + nx * o, az = z0 + nz * o, bx = x1 + nx * o, bz = z1 + nz * o;
        const y0 = h - 0.9, y1 = h + 0.25;
        const A = [ax, y0, az], B = [bx, y0, bz], C = [bx, y1, bz], D = [ax, y1, az];
        const A0 = [x0, y0, z0], B0 = [x1, y0, z1];
        const quads = [[A, D, B, [nx, 0, nz]], [B, D, C, [nx, 0, nz]], [A0, A, B0, [0, -1, 0]], [B0, A, B, [0, -1, 0]]];
        for (const [p, q, r, nn] of quads) {
          W.pos.push(...p, ...q, ...r); W.uv.push(0.004, 0.996, 0.004, 0.996, 0.004, 0.996);
          for (let k = 0; k < 3; k++) { W.nor.push(...nn); W.col.push(cc.r, cc.g, cc.b); }
        }
      }
    }
    // Dach
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { tris = []; }
    for (const t of tris) {
      let [a, bb, c] = t.map((i) => ring[i]);
      // y-Normale nach oben erzwingen
      const cy = (bb[1] - a[1]) * (c[0] - a[0]) - (bb[0] - a[0]) * (c[1] - a[1]);
      if (cy < 0) [bb, c] = [c, bb];
      for (const p of [a, bb, c]) { Rf.pos.push(p[0], h, p[1]); Rf.nor.push(0, 1, 0); Rf.col.push(roofCol.r, roofCol.g, roofCol.b); }
    }
    colliders.add(ring);
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(W.pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(W.nor, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(W.uv, 2));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(W.col, 3));
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(Rf.pos, 3));
  rg.setAttribute('normal', new THREE.Float32BufferAttribute(Rf.nor, 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(Rf.col, 3));
  const walls = new THREE.Mesh(wg, mats.wall);
  const roofs = new THREE.Mesh(rg, mats.roof);
  for (const m of [walls, roofs]) { m.castShadow = true; m.receiveShadow = true; }
  return [walls, roofs];
}

// ---------------------------------------------------------------- Straßen
function ribbon(pts, w, y, out, vScale) {
  const n = pts.length; if (n < 2) return;
  const base = out.pos.length / 3;
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    let tx, tz;
    const seg = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1e-6; return [dx / l, dz / l]; };
    let scale = 1;
    if (i === 0) [tx, tz] = seg(pts[0], pts[1]);
    else if (i === n - 1) [tx, tz] = seg(pts[n - 2], pts[n - 1]);
    else {
      const a = seg(pts[i - 1], p), b = seg(p, pts[i + 1]);
      tx = a[0] + b[0]; tz = a[1] + b[1];
      const l = Math.hypot(tx, tz);
      if (l < 1e-3) { tx = a[0]; tz = a[1]; } else { tx /= l; tz /= l; }
      scale = 1 / Math.max(0.35, tx * a[0] + tz * a[1]);
    }
    if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const nx = -tz, nz = tx, hw = (w / 2) * Math.min(scale, 2.5);
    out.pos.push(p[0] + nx * hw, y, p[1] + nz * hw, p[0] - nx * hw, y, p[1] - nz * hw);
    out.uv.push(0, dist / vScale, 1, dist / vScale);
    out.nor.push(0, 1, 0, 0, 1, 0);
    if (i < n - 1) { const a = base + 2 * i; out.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
}
function ribbonGeo(out) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  g.setIndex(out.idx);
  return g;
}

function polygonsGeo(rings, y) {
  const geos = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2); // (x, -z) -> (x, 0, z)
    g.translate(0, y, 0);
    geos.push(g);
  }
  return geos.length ? mergeGeometries(geos) : null;
}

// ---------------------------------------------------------------- Wahrzeichen
function brandenburgerTor(colliders) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xd9ccaa, roughness: 0.85 });
  const copper = new THREE.MeshStandardMaterial({ color: 0x4f7a68, roughness: 0.5, metalness: 0.5 });
  const [tx, tz] = LANDMARKS.tor;
  const W = 62, D = 11;
  // Säulen: 6 Paare quer zur Fahrtrichtung (Tor steht in Nord-Süd-Ausrichtung)
  const colGeo = new THREE.CylinderGeometry(0.85, 0.95, 14, 20);
  const xs = [-1, 1].map((s) => s * (D / 2 - 1));
  const zs = [-27.5, -16.5, -5.5, 5.5, 16.5, 27.5];
  for (const z of zs) {
    for (const x of xs) { const c = new THREE.Mesh(colGeo, stone); c.position.set(x, 7, z); c.castShadow = true; c.receiveShadow = true; g.add(c); }
    const wall = new THREE.Mesh(new THREE.BoxGeometry(D - 4, 13, 1.4), stone); wall.position.set(0, 6.5, z); wall.castShadow = true; g.add(wall);
    colliders.add([[tx - D / 2, tz + z - 1.3], [tx + D / 2, tz + z - 1.3], [tx + D / 2, tz + z + 1.3], [tx - D / 2, tz + z + 1.3]]);
  }
  const ent = new THREE.Mesh(new THREE.BoxGeometry(D + 0.6, 4.2, W), stone); ent.position.y = 16.1; ent.castShadow = true; g.add(ent);
  const att1 = new THREE.Mesh(new THREE.BoxGeometry(D - 1, 3.2, 30), stone); att1.position.y = 19.8; att1.castShadow = true; g.add(att1);
  const att2 = new THREE.Mesh(new THREE.BoxGeometry(D - 3, 1.6, 22), stone); att2.position.y = 22.2; g.add(att2);
  // Quadriga (stilisiert)
  const q = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const horse = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 0.9), copper); horse.position.set(1.2, 24.6, -2.4 + i * 1.6); horse.rotation.z = 0.15; q.add(horse);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.5), copper); neck.position.set(2.5, 25.6, -2.4 + i * 1.6); neck.rotation.z = -0.4; q.add(neck);
  }
  const chariot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 2.4), copper); chariot.position.set(-0.8, 24.6, 0); q.add(chariot);
  const vic = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 8), copper); vic.position.set(-0.8, 26.8, 0); q.add(vic);
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), copper); staff.position.set(-0.4, 28, 0.6); q.add(staff);
  q.rotation.y = Math.PI; // Quadriga blickt nach Osten
  g.add(q);
  g.position.set(tx, 0, tz);
  return g;
}

function fernsehturm() {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xd6d6d2, roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.9, roughness: 0.28, flatShading: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 8.5, 200, 32), concrete); shaft.position.y = 100; g.add(shaft);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(16, 28, 18), steel); ball.position.y = 212; g.add(ball);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(16.2, 16.2, 2.5, 32), new THREE.MeshStandardMaterial({ color: 0x222831, metalness: 0.6, roughness: 0.2 })); band.position.y = 210; g.add(band);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 22, 20), concrete); upper.position.y = 239; g.add(upper);
  const red = new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  for (let i = 0; i < 9; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(1.3 - i * 0.1, 1.4 - i * 0.1, 13, 10), i % 2 ? white : red);
    seg.position.y = 256 + i * 13; g.add(seg);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
  beacon.position.y = 368; g.add(beacon);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(30, 34, 10, 6), concrete); base.position.y = 5; g.add(base);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(LANDMARKS.fernsehturm[0], 0, LANDMARKS.fernsehturm[1]);
  g.userData.beacon = beacon;
  return g;
}

// ---------------------------------------------------------------- Welt bauen
export function buildWorld(scene, data, renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const colliders = new Colliders();
  const roadIndex = new RoadIndex();
  const rnd = mulberry32(99);

  // Gebäude am Tor-Standort entfernen (wird separat modelliert)
  const [tX, tZ] = LANDMARKS.tor;
  const buildings = data.buildings.filter((b) => {
    const cx = b.ring.reduce((s, p) => s + p[0], 0) / b.ring.length, cz = b.ring.reduce((s, p) => s + p[1], 0) / b.ring.length;
    return Math.hypot(cx - tX, cz - tZ) > 30;
  });

  const fac = facadeTextures(aniso);
  const mats = {
    wall: new THREE.MeshStandardMaterial({ map: fac.map, vertexColors: true, roughnessMap: fac.rm, metalnessMap: fac.rm, roughness: 1, metalness: 1, emissiveMap: fac.emissive, emissive: 0xffffff, emissiveIntensity: 0 }),
    roof: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    roadMajor: new THREE.MeshStandardMaterial({ map: roadTexture(true, aniso), roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    roadMinor: new THREE.MeshStandardMaterial({ map: roadTexture(false, aniso), roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    sidewalk: new THREE.MeshStandardMaterial({ color: 0xa7a59f, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    water: new THREE.MeshStandardMaterial({ color: 0x2d5b73, roughness: 0.06, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    park: new THREE.MeshStandardMaterial({ color: 0x4f7d34, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    ground: new THREE.MeshStandardMaterial({ map: groundTexture(aniso), roughness: 0.95 }),
  };
  mats.ground.map.repeat.set(400, 400);
  const base = {
    road: new THREE.Color(0xffffff), roof: null, ground: new THREE.Color(0xffffff), park: new THREE.Color(0x4f7d34), sidewalk: new THREE.Color(0xa7a59f),
  };

  // Boden
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), mats.ground);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // Wasser & Parks
  const waterGeo = polygonsGeo(data.water, 0.02);
  if (waterGeo) { const m = new THREE.Mesh(waterGeo, mats.water); m.receiveShadow = true; scene.add(m); }
  const parkGeo = polygonsGeo(data.parks, 0.03);
  if (parkGeo) { const m = new THREE.Mesh(parkGeo, mats.park); m.receiveShadow = true; scene.add(m); }

  // Straßen
  const major = { pos: [], nor: [], uv: [], idx: [] }, minor = { pos: [], nor: [], uv: [], idx: [] }, walk = { pos: [], nor: [], uv: [], idx: [] };
  data.roads.forEach((r, i) => {
    const def = ROAD_TYPES[r.type];
    roadIndex.add(r);
    const jitter = (i % 9) * 0.008;
    if (r.type === 'pedestrian') { ribbon(r.pts, r.width, 0.05 + jitter, walk, 10); return; }
    if (r.type !== 'service') ribbon(r.pts, r.width + 6, 0.04 + jitter * 0.5, walk, 10);
    ribbon(r.pts, r.width, (def.major ? 0.09 : 0.07) + jitter, def.major ? major : minor, 12);
  });
  for (const [out, mat] of [[walk, mats.sidewalk], [minor, mats.roadMinor], [major, mats.roadMajor]]) {
    if (!out.idx.length) continue;
    const m = new THREE.Mesh(ribbonGeo(out), mat); m.receiveShadow = true; scene.add(m);
  }

  // Gebäude
  const [walls, roofs] = buildBuildings(buildings, colliders, mats);
  scene.add(walls, roofs);

  // Wahrzeichen
  scene.add(brandenburgerTor(colliders));
  const tower = fernsehturm();
  scene.add(tower);

  // Bäume (Parks + Straßenbäume, Linden auf „Unter den Linden“)
  const trees = [];
  const free = (x, z) => !colliders.inside(x, z);
  for (const r of data.roads) {
    const def = ROAD_TYPES[r.type];
    const linden = /Unter den Linden|17\. Juni/.test(r.name);
    if (!def.major && r.type !== 'residential' && !(linden && r.type === 'pedestrian')) continue;
    const ped = r.type === 'pedestrian';
    const offsets = ped ? [r.width / 2 - 1.5, -(r.width / 2 - 1.5)] : [r.width / 2 + 2.2, -(r.width / 2 + 2.2)];
    const step = linden ? 11 : 16;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let s = step / 2; s < L; s += step) {
        for (const off of offsets) {
          if (!linden && rnd() < 0.4) continue;
          const x = ax + ((bx - ax) * s) / L + nx * off, z = az + ((bz - az) * s) / L + nz * off;
          const near = roadIndex.nearest(x, z, 3.5, (rr) => ROAD_TYPES[rr.type].drive && rr !== r);
          if (free(x, z) && !near) trees.push([x, z, linden ? 0.9 : 0.75 + rnd() * 0.4]);
        }
      }
    }
  }
  for (const ring of data.parks) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    minX = Math.max(minX, EXTENT.minX - 900); maxX = Math.min(maxX, EXTENT.maxX + 300); minZ = Math.max(minZ, EXTENT.minZ - 400); maxZ = Math.min(maxZ, EXTENT.maxZ + 400);
    const area = Math.max(0, (maxX - minX) * (maxZ - minZ));
    const count = Math.min(2500, area / 220);
    for (let i = 0; i < count && trees.length < 9000; i++) {
      const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ);
      if (pointInRing(x, z, ring) && free(x, z) && !roadIndex.nearest(x, z, 9)) trees.push([x, z, 0.8 + rnd() * 0.7]);
    }
  }
  if (trees.length) {
    // Krone aus mehreren Blobs mit leichtem Rauschen
    const blobs = [[0, 0, 0, 1], [0.55, -0.15, 0.2, 0.7], [-0.5, -0.1, -0.25, 0.72], [0.1, 0.45, -0.1, 0.65], [-0.15, -0.2, 0.55, 0.62]].map(([x, y, z, r]) => {
      const g = new THREE.IcosahedronGeometry(r, 1); g.translate(x, y, z); return g;
    });
    const crownGeo = mergeGeometries(blobs);
    { const pa = crownGeo.attributes.position; const nr = mulberry32(11); for (let i = 0; i < pa.count; i++) { const f = 0.9 + nr() * 0.2; pa.setXYZ(i, pa.getX(i) * f, pa.getY(i) * f, pa.getZ(i) * f); } crownGeo.computeVertexNormals(); }
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 6); trunkGeo.translate(0, 0.5, 0);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), trees.length);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 }), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    trees.forEach(([x, z, k], i) => {
      const hgt = 9 * k;
      p.set(x, 0, z); s.set(1, hgt * 0.7, 1); m.compose(p, q.identity(), s); trunk.setMatrixAt(i, m);
      p.set(x, hgt * 0.78, z); s.set(2.9 * k, 3.1 * k, 2.9 * k); q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0)); m.compose(p, q, s); crown.setMatrixAt(i, m);
      c.setHSL(0.2 + rnd() * 0.09, 0.35 + rnd() * 0.2, 0.13 + rnd() * 0.08); crown.setColorAt(i, c);
    });
    crown.castShadow = trunk.castShadow = true; crown.receiveShadow = true;
    scene.add(crown, trunk);
    mats.crown = crown.material; base.crownColors = crown.instanceColor.array.slice();
    mats.crownMesh = crown;
  }

  // Straßenlaternen
  const lamps = [];
  for (const r of data.roads) {
    if (!ROAD_TYPES[r.type].major) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let s = 10; s < L; s += 34) for (const sd of [-1, 1]) {
        const off = sd * (r.width / 2 + 0.8);
        const x = ax + ((bx - ax) * s) / L + nx * off, z = az + ((bz - az) * s) / L + nz * off;
        if (free(x, z)) lamps.push([x, z, Math.atan2(-nx * sd, -nz * sd)]);
      }
    }
  }
  let lampHeads = null;
  if (lamps.length) {
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 8, 6); poleGeo.translate(0, 4, 0);
    const headGeo = new THREE.BoxGeometry(0.5, 0.18, 1.2); headGeo.translate(0, 7.9, 0.6);
    const pole = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2f3337, metalness: 0.6, roughness: 0.5 }), lamps.length);
    lampHeads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0x333333, toneMapped: false }), lamps.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    lamps.forEach(([x, z, a], i) => { p.set(x, 0, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a); m.compose(p, q, one); pole.setMatrixAt(i, m); lampHeads.setMatrixAt(i, m); });
    pole.castShadow = true;
    scene.add(pole, lampHeads);
  }
  // Lichtkegel auf dem Boden (billiger als echte Punktlichter)
  let lampPools = null;
  if (lamps.length) {
    const tex = canvasTex(128, 128, (ctx, w) => { const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,200,130,0.9)'); g.addColorStop(1, 'rgba(255,200,130,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, w); }, { repeat: false });
    const poolGeo = new THREE.PlaneGeometry(16, 16); poolGeo.rotateX(-Math.PI / 2);
    lampPools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }), lamps.length);
    const m = new THREE.Matrix4();
    lamps.forEach(([x, z, a], i) => { m.makeTranslation(x + Math.sin(a) * 1.5, 0.15, z + Math.cos(a) * 1.5); lampPools.setMatrixAt(i, m); });
    lampPools.renderOrder = 2;
    scene.add(lampPools);
  }

  // --- Wetter/Tageszeit auf Materialien anwenden
  const dryRoad = 0.92;
  const snowWhite = new THREE.Color(0xf4f6f8);
  function applyEnvironment({ night, wet, snow, t }) {
    mats.wall.emissiveIntensity = night * 1.6;
    if (lampHeads) lampHeads.material.color.setRGB(0.25 + night * 5, 0.25 + night * 4.2, 0.25 + night * 2.6);
    if (lampPools) lampPools.material.opacity = night * 0.55;
    for (const m of [mats.roadMajor, mats.roadMinor]) {
      m.roughness = THREE.MathUtils.lerp(dryRoad, 0.18, wet);
      m.metalness = wet * 0.25;
      m.color.copy(base.road).multiplyScalar(1 - wet * 0.35).lerp(snowWhite, snow * 0.55);
    }
    mats.sidewalk.color.copy(base.sidewalk).multiplyScalar(1 - wet * 0.3).lerp(snowWhite, snow * 0.85);
    mats.sidewalk.roughness = THREE.MathUtils.lerp(0.95, 0.35, wet);
    mats.ground.color.copy(base.ground).lerp(snowWhite, snow * 0.9);
    mats.park.color.copy(base.park).lerp(snowWhite, snow * 0.92);
    mats.roof.color.setRGB(1, 1, 1).lerp(new THREE.Color(3.2, 3.2, 3.3), snow);
    if (mats.crownMesh) {
      const arr = mats.crownMesh.instanceColor.array, src = base.crownColors;
      for (let i = 0; i < arr.length; i++) arr[i] = src[i] + (0.85 - src[i]) * snow * 0.7;
      mats.crownMesh.instanceColor.needsUpdate = true;
    }
    tower.userData.beacon.visible = Math.sin(t * 3) > 0 || night < 0.3;
  }

  return { colliders, roadIndex, mats, applyEnvironment, buildings };
}
