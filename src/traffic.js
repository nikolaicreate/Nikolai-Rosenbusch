// KI-Verkehr auf dem echten Straßengraphen + Live-Verkehrslage (TomTom) bzw. Tageszeit-Modell.
import * as THREE from 'three';
import { ROAD_TYPES, mulberry32, hashStr, project } from './geo.js';
import { buildCarGeometry, makeCarMaterials, PAINTS, TAXI_COLOR, BVG_YELLOW, CITY_PAINTS, VISION_PAINTS } from './cars.js';

// ---------------------------------------------------------------- Graph
function buildGraph(roads) {
  const drivable = roads.filter((r) => ROAD_TYPES[r.type].drive);
  const key = (p) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
  const count = new Map();
  for (const r of drivable) {
    r.pts.forEach((p, i) => { const k = key(p); count.set(k, (count.get(k) || 0) + (i === 0 || i === r.pts.length - 1 ? 2 : 1)); });
  }
  const links = [];
  for (const r of drivable) {
    let start = 0;
    for (let i = 1; i < r.pts.length; i++) {
      if (count.get(key(r.pts[i])) > 1 || i === r.pts.length - 1) {
        const pts = r.pts.slice(start, i + 1);
        const cum = [0];
        for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
        const len = cum[cum.length - 1];
        if (len > 0.5) {
          const mid = pts[Math.floor(pts.length / 2)];
          links.push({ pts, cum, len, road: r, a: key(pts[0]), b: key(pts[pts.length - 1]), oneway: r.oneway, speed: ROAD_TYPES[r.type].speed, major: ROAD_TYPES[r.type].major, mx: mid[0], mz: mid[1], flow: 1, id: links.length });
        }
        start = i;
      }
    }
  }
  const nodes = new Map();
  const addOut = (k, o) => { let a = nodes.get(k); if (!a) nodes.set(k, (a = [])); a.push(o); };
  for (const l of links) {
    if (l.oneway >= 0) addOut(l.a, { link: l, dir: 1 });
    if (l.oneway <= 0) addOut(l.b, { link: l, dir: -1 });
  }
  return { links, nodes };
}

function sampleLink(link, s, out) {
  // s = Distanz entlang der Polyline (0..len)
  const { pts, cum } = link;
  let i = 0, lo = 0, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m + 1] < s) lo = m + 1; else hi = m; }
  i = Math.min(lo, pts.length - 2);
  const seg = cum[i + 1] - cum[i] || 1e-6;
  const t = Math.max(0, Math.min(1, (s - cum[i]) / seg));
  const a = pts[i], b = pts[i + 1];
  out.x = a[0] + (b[0] - a[0]) * t; out.z = a[1] + (b[1] - a[1]) * t;
  out.tx = (b[0] - a[0]) / seg; out.tz = (b[1] - a[1]) / seg;
  return out;
}

// ---------------------------------------------------------------- Live-Verkehr
// Wochentags-Stauprofil Berlin (0 = frei, 1 = sehr dicht), stündlich. Modellannahme, kein Messwert.
const WEEKDAY = [0.05, 0.03, 0.02, 0.02, 0.05, 0.15, 0.42, 0.78, 0.86, 0.62, 0.5, 0.52, 0.56, 0.56, 0.62, 0.72, 0.86, 0.9, 0.72, 0.5, 0.36, 0.26, 0.16, 0.08];
const WEEKEND = [0.12, 0.1, 0.06, 0.04, 0.03, 0.04, 0.08, 0.14, 0.22, 0.32, 0.42, 0.5, 0.54, 0.54, 0.52, 0.5, 0.5, 0.48, 0.42, 0.36, 0.3, 0.26, 0.2, 0.15];
const PROBES = [
  [52.5172, 13.3889, 'Unter den Linden'], [52.5131, 13.3893, 'Friedrichstraße'], [52.5101, 13.3905, 'Leipziger Straße'],
  [52.5145, 13.3811, 'Wilhelmstraße'], [52.5200, 13.4045, 'Karl-Liebknecht-Straße'], [52.5143, 13.3768, 'Ebertstraße'],
  [52.5126, 13.4042, 'Gertraudenstraße'], [52.5206, 13.3870, 'Friedrichstraße Nord'],
];

export class LiveTraffic {
  constructor(links) {
    this.links = links;
    this.key = '';
    this.source = 'model';
    this.level = 0.5;
    this.samples = [];
    this.updated = null;
    this.status = '';
  }
  berlinHour(now = new Date()) {
    const f = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false });
    const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
    return { h: (parseInt(parts.hour, 10) % 24) + parseInt(parts.minute, 10) / 60, weekend: ['Sa', 'So'].includes(parts.weekday?.replace('.', '')) };
  }
  modelLevel(weatherKind) {
    const { h, weekend } = this.berlinHour();
    const prof = weekend ? WEEKEND : WEEKDAY;
    const i = Math.floor(h), f = h - i;
    let lvl = prof[i % 24] * (1 - f) + prof[(i + 1) % 24] * f;
    if (['rain', 'storm', 'drizzle'].includes(weatherKind)) lvl *= 1.15;
    if (weatherKind === 'snow') lvl *= 1.3;
    return Math.min(1, lvl);
  }
  async refresh(weatherKind) {
    const model = this.modelLevel(weatherKind);
    if (this.key) {
      try {
        const res = await Promise.all(PROBES.map(async ([lat, lon, name]) => {
          const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&unit=KMPH&key=${encodeURIComponent(this.key)}`;
          const r = await fetch(url);
          if (!r.ok) throw new Error('TomTom HTTP ' + r.status);
          const j = await r.json();
          const d = j.flowSegmentData;
          const coords = (d.coordinates?.coordinate || []).map((c) => project(c.latitude, c.longitude));
          return { name, ratio: Math.max(0.05, Math.min(1, d.currentSpeed / d.freeFlowSpeed)), current: d.currentSpeed, free: d.freeFlowSpeed, closed: d.roadClosure, coords };
        }));
        this.samples = res;
        this.source = 'tomtom';
        const avg = res.reduce((s, r) => s + r.ratio, 0) / res.length;
        this.level = Math.min(1, Math.max(0, (1 - avg) * 1.6 + model * 0.3));
        this.applySamples(avg);
        this.updated = new Date();
        this.status = `${res.length} Messpunkte`;
        return;
      } catch (e) {
        console.warn('[TomTom]', e);
        this.status = 'TomTom-Fehler – Modell aktiv';
      }
    } else this.status = 'Tageszeit-Modell';
    this.source = 'model';
    this.level = model;
    for (const l of this.links) {
      const rnd = mulberry32(hashStr(l.road.name || String(l.id)) + Math.floor(Date.now() / 600000));
      const sens = l.major ? 0.7 + rnd() * 0.7 : 0.25 + rnd() * 0.3;
      l.flow = Math.max(0.12, Math.min(1, 1 - model * 0.75 * sens - (rnd() < 0.05 * model ? 0.4 : 0)));
    }
    this.updated = new Date();
  }
  applySamples(avg) {
    const pts = [];
    for (const s of this.samples) for (const c of s.coords) pts.push([c[0], c[1], s.ratio]);
    for (const l of this.links) {
      let best = 70 * 70, ratio = null;
      for (const p of pts) { const d = (p[0] - l.mx) ** 2 + (p[1] - l.mz) ** 2; if (d < best) { best = d; ratio = p[2]; } }
      l.flow = ratio ?? (l.major ? avg : Math.min(1, avg + 0.25));
    }
  }
}

// ---------------------------------------------------------------- Fahrzeuge
const TYPE_MIX = [['city', 0.24], ['vision', 0.14], ['sedan', 0.18], ['hatch', 0.12], ['suv', 0.1], ['van', 0.07], ['taxi', 0.1], ['bus', 0.05]];

export class Traffic {
  constructor(scene, roads, maxCars = 170) {
    const { links, nodes } = buildGraph(roads);
    this.links = links; this.nodes = nodes;
    this.live = new LiveTraffic(links);
    this.maxCars = maxCars;
    this.density = 0.6;
    this.cars = [];
    this.rnd = mulberry32(2024);
    this.tmp = { x: 0, z: 0, tx: 0, tz: 0 };
    this.majorLinks = links.filter((l) => l.major || l.road.type === 'residential');

    // Instanzen pro Typ
    this.meshes = {};
    const counts = {};
    for (let i = 0; i < maxCars; i++) {
      const type = this.pickType(i);
      counts[type] = (counts[type] || 0) + 1;
      this.cars.push({ type, idx: counts[type] - 1, link: null, dir: 1, s: 0, v: 0, x: 0, z: 0, hx: 0, hz: 1, lane: 0, wish: 1, active: false, stop: 0 });
    }
    const mats = makeCarMaterials(0xffffff);
    mats.body = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.3 });
    this.lightMat = mats.lights;
    for (const [type, n] of Object.entries(counts)) {
      const g = buildCarGeometry(type);
      const set = {};
      for (const part of ['body', 'glass', 'detail', 'lights']) {
        const im = new THREE.InstancedMesh(g[part], mats[part], n);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.castShadow = part !== 'lights';
        im.frustumCulled = false;
        scene.add(im);
        set[part] = im;
      }
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const pick = (a) => a[Math.floor(this.rnd() * a.length)];
        const hex = type === 'taxi' ? TAXI_COLOR : type === 'bus' ? BVG_YELLOW : type === 'city' ? pick(CITY_PAINTS) : type === 'vision' ? pick(VISION_PAINTS) : pick(PAINTS);
        set.body.setColorAt(i, c.setHex(hex));
      }
      this.meshes[type] = set;
    }
    this.length = { sedan: 4.7, hatch: 4.1, suv: 4.8, van: 5.3, taxi: 4.7, bus: 12, city: 3.8, vision: 5.15, sport: 4.5 };
    this.grid = new Map();
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1); this.zero = new THREE.Vector3(0, 0, 0); this.up = new THREE.Vector3(0, 1, 0);
  }
  pickType() {
    let r = this.rnd();
    for (const [t, p] of TYPE_MIX) { if ((r -= p) <= 0) return t; }
    return 'sedan';
  }
  spawn(car, px, pz, minR = 90, maxR = 380) {
    const pool = car.type === 'bus' ? this.links.filter((l) => l.major) : this.majorLinks;
    if (!pool.length) return false;
    for (let tries = 0; tries < 40; tries++) {
      const l = pool[Math.floor(this.rnd() * pool.length)];
      const d = Math.hypot(l.mx - px, l.mz - pz);
      if (d < minR || d > maxR) continue;
      const dirs = []; if (l.oneway >= 0) dirs.push(1); if (l.oneway <= 0) dirs.push(-1);
      car.link = l; car.dir = dirs[Math.floor(this.rnd() * dirs.length)];
      car.s = this.rnd() * l.len;
      car.v = l.speed * l.flow * 0.8;
      car.wish = 0.85 + this.rnd() * 0.3;
      this.setLane(car);
      car.active = true;
      this.place(car);
      return true;
    }
    return false;
  }
  setLane(car) {
    const w = car.link.road.width;
    if (car.link.oneway) car.lane = (this.rnd() - 0.5) * Math.max(0, w / 2 - 2);
    else car.lane = w >= 13 ? (this.rnd() < 0.5 ? w * 0.15 + 0.6 : w * 0.33) : Math.max(1.6, w / 4);
  }
  place(car) {
    const l = car.link;
    const along = car.dir > 0 ? car.s : l.len - car.s;
    const t = sampleLink(l, along, this.tmp);
    let fx = t.tx * car.dir, fz = t.tz * car.dir;
    const rx = -fz, rz = fx;
    car.x = t.x + rx * car.lane; car.z = t.z + rz * car.lane;
    // Richtung glätten (Kurven)
    const k = 0.25;
    car.hx += (fx - car.hx) * k; car.hz += (fz - car.hz) * k;
    const hl = Math.hypot(car.hx, car.hz) || 1; car.hx /= hl; car.hz /= hl;
  }
  nextLink(car) {
    const l = car.link;
    const nodeKey = car.dir > 0 ? l.b : l.a;
    const outs = (this.nodes.get(nodeKey) || []).filter((o) => o.link !== l && (car.type !== 'bus' || o.link.major));
    if (!outs.length) {
      if (!l.oneway) { car.dir = -car.dir; car.s = 0; return; }
      car.active = false; return;
    }
    // bevorzugt geradeaus / gleiche Straße
    const fx = car.hx, fz = car.hz;
    let best = null, bw = -Infinity;
    for (const o of outs) {
      const ol = o.link; const p0 = o.dir > 0 ? ol.pts[0] : ol.pts[ol.pts.length - 1]; const p1 = o.dir > 0 ? ol.pts[1] : ol.pts[ol.pts.length - 2];
      let dx = p1[0] - p0[0], dz = p1[1] - p0[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const w = (dx * fx + dz * fz) * 1.2 + (ol.road.name && ol.road.name === l.road.name ? 0.8 : 0) + (ol.major ? 0.3 : 0) + this.rnd() * 1.4;
      if (w > bw) { bw = w; best = o; }
    }
    car.link = best.link; car.dir = best.dir; car.s = 0;
    this.setLane(car);
  }
  update(dt, player) {
    const px = player.x, pz = player.z;
    const active = Math.round(this.maxCars * this.density);
    // Spatial hash
    this.grid.clear();
    const cellOf = (x, z) => Math.floor(x / 20) * 100003 + Math.floor(z / 20);
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (!c.active) continue;
      const k = cellOf(c.x, c.z); let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(c);
    }
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (i >= active) { c.active = false; continue; }
      if (!c.active || Math.hypot(c.x - px, c.z - pz) > 460) { if (!this.spawn(c, px, pz, c.active ? 200 : 40, 420)) c.active = false; continue; }
      const l = c.link;
      let target = l.speed * l.flow * c.wish;
      // Abbremsen vor Kreuzungen
      const remain = l.len - c.s;
      const nodeKey = c.dir > 0 ? l.b : l.a;
      const deg = (this.nodes.get(nodeKey) || []).length;
      if (deg > 2 && remain < 18) target = Math.min(target, 4 + remain * 0.45);
      // Folgeverhalten
      const fx = c.hx, fz = c.hz;
      let gap = 40;
      const cx = Math.floor(c.x / 20), cz = Math.floor(c.z / 20);
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
        const a = this.grid.get((cx + ix) * 100003 + cz + iz); if (!a) continue;
        for (const o of a) {
          if (o === c) continue;
          const dx = o.x - c.x, dz = o.z - c.z;
          const along = dx * fx + dz * fz; if (along <= 0 || along > 40) continue;
          const lat = Math.abs(dx * -fz + dz * fx); if (lat > 1.9) continue;
          if (o.hx * fx + o.hz * fz < 0.3) continue;
          gap = Math.min(gap, along - (this.length[o.type] + this.length[c.type]) / 2);
        }
      }
      { const dx = px - c.x, dz = pz - c.z; const along = dx * fx + dz * fz; const lat = Math.abs(dx * -fz + dz * fx);
        if (along > 0 && along < 40 && lat < 2.2) gap = Math.min(gap, along - this.length[c.type] / 2 - 2.4); }
      if (c.stop > 0) { c.stop -= dt; target = 0; }
      target = Math.min(target, Math.max(0, (gap - 2.5) * 0.9));
      const acc = target > c.v ? 2.2 : -7.5;
      c.v = Math.max(0, c.v + Math.sign(target - c.v) * Math.min(Math.abs(target - c.v), Math.abs(acc) * dt));
      c.s += c.v * dt;
      let guard = 0;
      while (c.active && c.s > c.link.len && guard++ < 4) { const over = c.s - c.link.len; this.nextLink(c); c.s += over; }
      if (c.active) this.place(c);
    }
    // Matrizen
    for (const c of this.cars) {
      const set = this.meshes[c.type];
      if (c.active) {
        this.p.set(c.x, 0, c.z);
        this.q.setFromAxisAngle(this.up, Math.atan2(c.hx, c.hz));
        this.m4.compose(this.p, this.q, this.one);
      } else this.m4.compose(this.zero, this.q.identity(), this.zero);
      for (const part in set) set[part].setMatrixAt(c.idx, this.m4);
    }
    for (const t in this.meshes) for (const part in this.meshes[t]) this.meshes[t][part].instanceMatrix.needsUpdate = true;
  }
  /** Kollision mit dem Spieler: liefert Push-Vektor. */
  collidePlayer(x, z, r = 2.2) {
    let px = 0, pz = 0, hit = null;
    const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      const a = this.grid.get((cx + ix) * 100003 + cz + iz); if (!a) continue;
      for (const o of a) {
        // Auto als Kapsel entlang der Fahrtrichtung
        const half = this.length[o.type] / 2 - 0.9;
        const dx = x - o.x, dz = z - o.z;
        const t = Math.max(-half, Math.min(half, dx * o.hx + dz * o.hz));
        const qx = o.x + o.hx * t, qz = o.z + o.hz * t;
        const ex = x - qx, ez = z - qz; const d = Math.hypot(ex, ez);
        const rr = r + (o.type === 'bus' ? 1.3 : 0.95);
        if (d < rr && d > 1e-4) { px += (ex / d) * (rr - d); pz += (ez / d) * (rr - d); hit = o; o.stop = 2.5; o.v *= 0.3; }
      }
    }
    return { px, pz, hit };
  }
  setNight(night, brake = 0) {
    this.lightMat.color.setScalar(0.8 + night * 3.5 + brake);
  }
}
