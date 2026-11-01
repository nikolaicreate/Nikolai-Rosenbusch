// Ersatz-Stadt, falls OpenStreetMap nicht erreichbar ist: grobes Modell von
// Berlin-Mitte (Straßennamen, Spree, Tiergarten, Blockrandbebauung mit 22 m Traufhöhe).
import { mulberry32, LANDMARKS, clipData, clipPolyline, tileBounds, project } from './geo.js';

export function makeFallbackCity() {
  const rnd = mulberry32(1871);
  const data = { buildings: [], roads: [], water: [], parks: [], rails: [], source: 'model' };
  const zL = LANDMARKS.tor[1];

  const ew = [
    { z: zL - 470, name: 'Oranienburger Straße', type: 'secondary', w: 18 },
    { z: zL - 300, name: 'Reinhardtstraße', type: 'secondary' },
    { z: zL - 150, name: 'Dorotheenstraße', type: 'tertiary' },
    { z: zL, name: 'Unter den Linden', type: 'primary', w: 44 },
    { z: zL + 140, name: 'Behrenstraße', type: 'tertiary' },
    { z: zL + 270, name: 'Französische Straße', type: 'residential' },
    { z: zL + 410, name: 'Leipziger Straße', type: 'primary', w: 30 },
    { z: zL + 560, name: 'Krausenstraße', type: 'residential' },
  ];
  const ns = [
    { x: -860, name: 'Ebertstraße', type: 'secondary', w: 18 },
    { x: -660, name: 'Wilhelmstraße', type: 'secondary' },
    { x: -500, name: 'Glinkastraße', type: 'residential' },
    { x: -340, name: 'Friedrichstraße', type: 'secondary' },
    { x: -190, name: 'Charlottenstraße', type: 'residential' },
    { x: -40, name: 'Markgrafenstraße', type: 'residential' },
    { x: 120, name: 'Oberwallstraße', type: 'residential' },
    { x: 300, name: 'Breite Straße', type: 'tertiary' },
    { x: 520, name: 'Spandauer Straße', type: 'secondary' },
    { x: 760, name: 'Rathausstraße', type: 'tertiary' },
    { x: 980, name: 'Alexanderstraße', type: 'primary', w: 24 },
  ];
  const X0 = -1150, X1 = 1180, Z0 = zL - 640, Z1 = zL + 640;
  const widthOf = (r) => r.w || { primary: 17, secondary: 14, tertiary: 11, residential: 9 }[r.type];

  // Kreuzungspunkte als gemeinsame Stützpunkte einfügen (für den Straßengraphen)
  for (const r of ew) {
    const xs = [-860, ...ns.filter((n) => n.x > -860).map((n) => n.x), X1];
    if (r.name === 'Unter den Linden') {
      // zwei Richtungsfahrbahnen + Mittelpromenade mit Linden (wie im Original)
      data.roads.push({ pts: xs.map((x) => [x, r.z + 14]), type: 'primary', width: 12, name: r.name, oneway: 1 });
      data.roads.push({ pts: xs.slice().reverse().map((x) => [x, r.z - 14]), type: 'primary', width: 12, name: r.name, oneway: 1 });
      data.roads.push({ pts: [[-860, r.z], [X1, r.z]], type: 'pedestrian', width: 14, name: 'Unter den Linden', oneway: 0 });
    } else data.roads.push({ pts: xs.map((x) => [x, r.z]), type: r.type, width: widthOf(r), name: r.name, oneway: 0 });
  }
  // Straße des 17. Juni durch den Tiergarten
  data.roads.push({ pts: [[-2600, zL], [-860, zL]], type: 'primary', width: 40, name: 'Straße des 17. Juni', oneway: 0 });
  for (const r of ns) data.roads.push({ pts: [[r.x, Z0], ...ew.flatMap((e) => (e.name === 'Unter den Linden' ? [[r.x, e.z - 14], [r.x, e.z + 14]] : [[r.x, e.z]])), [r.x, Z1]], type: r.type, width: widthOf(r), name: r.name, oneway: 0 });

  // Spree
  const spree = [[-1150, zL - 545], [-850, zL - 455], [-500, zL - 385], [-200, zL - 355], [150, zL - 325], [420, zL - 205], [600, zL - 5], [800, zL + 195], [1180, zL + 395]];
  const half = 28;
  const left = [], right = [];
  for (let i = 0; i < spree.length; i++) {
    const a = spree[Math.max(0, i - 1)], b = spree[Math.min(spree.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    const nx = -dz / l, nz = dx / l;
    left.push([spree[i][0] + nx * half, spree[i][1] + nz * half]);
    right.push([spree[i][0] - nx * half, spree[i][1] - nz * half]);
  }
  data.water.push(left.concat(right.reverse()));
  const distToSpree = (x, z) => {
    let best = 1e9;
    for (let i = 0; i < spree.length - 1; i++) {
      const [ax, az] = spree[i], [bx, bz] = spree[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  };

  // Tiergarten + Plätze
  data.parks.push([[-2600, Z0 - 300], [-880, Z0 - 300], [-880, Z1 + 300], [-2600, Z1 + 300]]);
  const plazas = [];
  const gendarmenmarkt = { x0: -190, x1: -40, z0: zL + 140, z1: zL + 270 };
  plazas.push(gendarmenmarkt);
  data.parks.push([[gendarmenmarkt.x0 + 8, gendarmenmarkt.z0 + 8], [gendarmenmarkt.x1 - 8, gendarmenmarkt.z0 + 8], [gendarmenmarkt.x1 - 8, gendarmenmarkt.z1 - 8], [gendarmenmarkt.x0 + 8, gendarmenmarkt.z1 - 8]]);

  // Stadtbahn-Viadukt (S-Bahn) entlang der Spree über den Bahnhof Friedrichstraße
  const viaduct = [[-1150, zL - 520], [-860, zL - 470], [-500, zL - 425], [-210, zL - 410], [150, zL - 400], [450, zL - 420], [826, zL - 560], [1180, zL - 610]];
  const offsetLine = (pts, d) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / L) * d, p[1] + (dx / L) * d];
  });
  for (const d of [-2.1, 2.1]) data.rails.push({ pts: offsetLine(viaduct, d), kind: 'sbahn', elevated: true });
  // Straßenbahn: Spandauer Straße (Nord-Süd) und Dorotheenstraße -> Oranienburger Straße (Ost-West)
  const tramA = [[520, Z0], ...ew.map((e) => [520, e.z]).filter((p) => p[1] > Z0 && p[1] < Z1), [520, Z1]];
  const tramB = [[-340, zL - 470], ...ns.filter((n) => n.x > -340).map((n) => [n.x, zL - 470])];
  for (const line of [tramA, tramB]) for (const d of [-1.6, 1.6]) data.rails.push({ pts: offsetLine(line, d), kind: 'tram', elevated: false });
  const distToLine = (x, z, line) => {
    let best = 1e9;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  };

  const palette = [0xeae2d4, 0xdcd0bb, 0xd2c8b8, 0xc4baa9, 0xe7dfd2, 0xcdbb9f, 0xb2ada4, 0xd9d3c9, 0xf0ebe1, 0xbfa98d];
  const addB = (x0, z0, x1, z1, h) => {
    if (distToSpree((x0 + x1) / 2, (z0 + z1) / 2) < half + 14) return;
    if (distToLine((x0 + x1) / 2, (z0 + z1) / 2, viaduct) < 18 + Math.max(x1 - x0, z1 - z0) / 2) return;
    data.buildings.push({ ring: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], h, color: palette[Math.floor(rnd() * palette.length)], name: '' });
  };
  for (let i = 0; i < ns.length; i++) {
    const xa = ns[i].x + widthOf(ns[i]) / 2 + 4;
    const xb = (i + 1 < ns.length ? ns[i + 1].x - widthOf(ns[i + 1]) / 2 : X1) - 4;
    for (let j = -1; j < ew.length; j++) {
      const za = (j >= 0 ? ew[j].z + widthOf(ew[j]) / 2 : Z0) + 4;
      const zb = (j + 1 < ew.length ? ew[j + 1].z - widthOf(ew[j + 1]) / 2 : Z1) - 4;
      if (xb - xa < 30 || zb - za < 30) continue;
      if (plazas.some((p) => xa < p.x1 && xb > p.x0 && za < p.z1 && zb > p.z0)) continue;
      const tall = xa > 700 ? 1.7 : 1;
      if (rnd() < 0.14) { addB(xa, za, xb, zb, (20 + rnd() * 8) * tall); continue; }
      const depth = 13 + rnd() * 4;
      // Nord- und Südseite durchgehend, Ost/West dazwischen -> Innenhof (Berliner Block)
      for (const side of [0, 1]) {
        let x = xa;
        while (x < xb - 6) {
          const w = Math.min(xb - x, 14 + rnd() * 16);
          const h = (17 + rnd() * 7) * (rnd() < 0.08 ? 1.5 : 1) * tall;
          if (side === 0) addB(x, za, x + w, za + depth, h); else addB(x, zb - depth, x + w, zb, h);
          x += w;
        }
      }
      for (const side of [0, 1]) {
        let z = za + depth;
        while (z < zb - depth - 6) {
          const w = Math.min(zb - depth - z, 14 + rnd() * 16);
          const h = (17 + rnd() * 7) * tall;
          if (side === 0) addB(xa, z, xa + depth, z + w, h); else addB(xb - depth, z, xb, z + w, h);
          z += w;
        }
      }
    }
  }
  return data;
}

// ---------------------------------------------------------------- Modell für ganz Berlin (kachelweise)

let core = null, coreRect = null;
function getCore() {
  if (!core) {
    core = makeFallbackCity();
    const zL = LANDMARKS.tor[1];
    coreRect = { minX: -2600, maxX: 1180, minZ: zL - 940, maxZ: zL + 940 };
  }
  return core;
}
function h3(a, b, c = 0) {
  let x = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  x = Math.imul(x ^ (x >>> 13), 1274126177); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const STREETS = ['Bergmannstraße', 'Kastanienallee', 'Oranienstraße', 'Sonnenallee', 'Kantstraße', 'Schönhauser Allee', 'Boxhagener Straße', 'Weserstraße', 'Hermannstraße', 'Danziger Straße',
  'Greifswalder Straße', 'Prenzlauer Allee', 'Warschauer Straße', 'Frankfurter Allee', 'Karl-Marx-Straße', 'Hauptstraße', 'Bundesallee', 'Schloßstraße', 'Müllerstraße', 'Seestraße',
  'Turmstraße', 'Gneisenaustraße', 'Yorckstraße', 'Potsdamer Straße', 'Kurfürstendamm', 'Wilmersdorfer Straße', 'Brunnenstraße', 'Invalidenstraße', 'Landsberger Allee', 'Storkower Straße',
  'Wisbyer Straße', 'Bornholmer Straße', 'Osloer Straße', 'Residenzstraße', 'Badstraße', 'Kottbusser Damm', 'Urbanstraße', 'Böckhstraße', 'Simon-Dach-Straße', 'Revaler Straße',
  'Pappelallee', 'Stargarder Straße', 'Lychener Straße', 'Dunckerstraße', 'Gleimstraße', 'Hufelandstraße', 'Bötzowstraße', 'Grünberger Straße', 'Kopernikusstraße', 'Wühlischstraße',
  'Akazienstraße', 'Goltzstraße', 'Crellestraße', 'Leberstraße', 'Rheinstraße', 'Schildhornstraße', 'Albrechtstraße', 'Rathausstraße', 'Bahnhofstraße', 'Dorfstraße',
  'Lindenstraße', 'Birkenweg', 'Ahornstraße', 'Eichenallee', 'Am Park', 'Gartenstraße', 'Mühlenstraße', 'Wiesenweg', 'Florastraße', 'Breite Straße'];
const SP = 175;
const lineX = (k) => k * SP + (h3(k, 1) - 0.5) * 50;
const lineZ = (m) => m * SP + (h3(m, 2) - 0.5) * 50;
function lineType(k, axis) {
  if (k % 8 === 0) return ['primary', 20];
  if (k % 4 === 0) return ['secondary', 15];
  if (h3(k, axis, 9) < 0.2) return ['tertiary', 11];
  return ['residential', 9];
}
const PALETTE = [0xeae2d4, 0xdcd0bb, 0xd2c8b8, 0xc4baa9, 0xe7dfd2, 0xcdbb9f, 0xb2ada4, 0xd9d3c9, 0xf0ebe1, 0xbfa98d, 0xc9c2b8, 0xe2d6c0];
const PLATTE = [0xd9d4c4, 0xc8cdd0, 0xe3dccb, 0xb9c4c9, 0xd6c7a8];
const inRect = (x, z, r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

// grobe Stadtstruktur: Innenstadt (Altbau), Großsiedlungen, Stadtrand
let PLATTE_AREAS = null;
const rectLL = (s, w, n, e) => { const a = project(n, w), b = project(s, e); return { minX: a[0], minZ: a[1], maxX: b[0], maxZ: b[1] }; };
let GREEN = null;
const greenAreas = () => [
  rectLL(52.508, 13.335, 52.520, 13.372),  // Tiergarten
  rectLL(52.467, 13.392, 52.481, 13.418),  // Tempelhofer Feld
  rectLL(52.440, 13.195, 52.500, 13.265),  // Grunewald
  rectLL(52.483, 13.462, 52.494, 13.484),  // Treptower Park
  rectLL(52.524, 13.428, 52.531, 13.442),  // Volkspark Friedrichshain
  rectLL(52.430, 13.600, 52.455, 13.660),  // Müggelheide (Köpenick)
];
function zoneAt(x, z) {
  if (!GREEN) { GREEN = greenAreas(); PLATTE_AREAS = [project(52.540, 13.580), project(52.566, 13.505), project(52.425, 13.462), project(52.555, 13.330), project(52.512, 13.495)]; }
  const d = Math.hypot(x, z) / 1000;
  if (GREEN.some((g) => inRect(x, z, g))) return 'green';
  if (PLATTE_AREAS.some(([px, pz]) => Math.hypot(x - px, z - pz) < 1600)) return 'platte';
  if (d < 6.5) return 'altbau';
  if (d < 10) return 'mixed';
  return 'suburb';
}

function proceduralTile(i, j) {
  const b = tileBounds(i, j);
  const data = { buildings: [], roads: [], water: [], parks: [], rails: [] };
  const k0 = Math.floor(b.minX / SP) - 1, k1 = Math.ceil(b.maxX / SP) + 1;
  const m0 = Math.floor(b.minZ / SP) - 1, m1 = Math.ceil(b.maxZ / SP) + 1;
  const skipSeg = (x0, z0, x1, z1) => inRect((x0 + x1) / 2, (z0 + z1) / 2, coreRect);
  // Nord-Süd-Straßen
  for (let k = k0; k <= k1; k++) {
    const x = lineX(k); if (x < b.minX - 1 || x > b.maxX + 1) continue;
    const [type, width] = lineType(k, 1);
    const name = STREETS[Math.floor(h3(k, 3) * STREETS.length)];
    for (let m = m0; m < m1; m++) {
      const z0 = lineZ(m), z1 = lineZ(m + 1);
      if (skipSeg(x, z0, x, z1)) continue;
      if (type === 'residential' && zoneAt(x, (z0 + z1) / 2) === 'green') continue;
      for (const pts of clipPolyline([[x, z0], [x, z1]], b)) data.roads.push({ pts, type, width, name, oneway: 0 });
    }
  }
  // Ost-West-Straßen
  for (let m = m0; m <= m1; m++) {
    const z = lineZ(m); if (z < b.minZ - 1 || z > b.maxZ + 1) continue;
    const [type, width] = lineType(m, 2);
    const name = STREETS[Math.floor(h3(m, 4) * STREETS.length)];
    for (let k = k0; k < k1; k++) {
      const x0 = lineX(k), x1 = lineX(k + 1);
      if (skipSeg(x0, z, x1, z)) continue;
      if (type === 'residential' && zoneAt((x0 + x1) / 2, z) === 'green') continue;
      for (const pts of clipPolyline([[x0, z], [x1, z]], b)) data.roads.push({ pts, type, width, name, oneway: 0 });
    }
  }
  // Blöcke
  for (let k = k0; k < k1; k++) for (let m = m0; m < m1; m++) {
    const xa0 = lineX(k), xb0 = lineX(k + 1), za0 = lineZ(m), zb0 = lineZ(m + 1);
    const cx = (xa0 + xb0) / 2, cz = (za0 + zb0) / 2;
    if (cx < b.minX || cx >= b.maxX || cz < b.minZ || cz >= b.maxZ) continue;
    if (inRect(cx, cz, coreRect)) continue;
    const xa = xa0 + lineType(k, 1)[1] / 2 + 4, xb = xb0 - lineType(k + 1, 1)[1] / 2 - 4;
    const za = za0 + lineType(m, 2)[1] / 2 + 4, zb = zb0 - lineType(m + 1, 2)[1] / 2 - 4;
    if (xb - xa < 30 || zb - za < 30) continue;
    const r = mulberry32(Math.floor(h3(k, m, 7) * 1e9));
    const zone = zoneAt(cx, cz);
    if (zone === 'green' || r() < (zone === 'suburb' ? 0.12 : 0.07)) { data.parks.push([[xa, za], [xb, za], [xb, zb], [xa, zb]]); continue; }
    const add = (x0, z0, x1, z1, hgt, col) => data.buildings.push({ ring: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], h: hgt, color: col, name: '' });
    if (zone === 'altbau' || zone === 'mixed') {
      const hBase = zone === 'altbau' ? 17 : 12, hVar = zone === 'altbau' ? 7 : 6;
      const depth = 12 + r() * 4;
      for (const side of [0, 1]) {
        let x = xa;
        while (x < xb - 6) { const w = Math.min(xb - x, 13 + r() * 14); const hh = hBase + r() * hVar; if (side === 0) add(x, za, x + w, za + depth, hh, PALETTE[Math.floor(r() * PALETTE.length)]); else add(x, zb - depth, x + w, zb, hh, PALETTE[Math.floor(r() * PALETTE.length)]); x += w; }
      }
      for (const side of [0, 1]) {
        let z = za + depth;
        while (z < zb - depth - 6) { const w = Math.min(zb - depth - z, 13 + r() * 14); const hh = hBase + r() * hVar; if (side === 0) add(xa, z, xa + depth, z + w, hh, PALETTE[Math.floor(r() * PALETTE.length)]); else add(xb - depth, z, xb, z + w, hh, PALETTE[Math.floor(r() * PALETTE.length)]); z += w; }
      }
    } else if (zone === 'platte') {
      // Plattenbau-Riegel und Punkthochhäuser
      const col = PLATTE[Math.floor(r() * PLATTE.length)];
      if (r() < 0.6) {
        const along = xb - xa > zb - za;
        const n = 1 + Math.floor(r() * 2);
        for (let q = 0; q < n; q++) {
          const hh = 3 * (5 + Math.floor(r() * 7)) + 1;
          if (along) { const z = za + 10 + q * ((zb - za - 30) / Math.max(1, n - 1 || 1)); add(xa + 8, z, xb - 8, z + 13, hh, col); }
          else { const x = xa + 10 + q * ((xb - xa - 30) / Math.max(1, n - 1 || 1)); add(x, za + 8, x + 13, zb - 8, hh, col); }
        }
      } else {
        const hh = 3 * (11 + Math.floor(r() * 10)) + 1;
        add(cx - 14, cz - 14, cx + 14, cz + 14, hh, col);
      }
    } else {
      // Einfamilienhäuser am Stadtrand
      for (let x = xa + 6; x < xb - 14; x += 22 + r() * 8) for (const zz of [za + 8, zb - 18]) {
        if (r() < 0.15) continue;
        add(x, zz, x + 10 + r() * 4, zz + 9 + r() * 3, 6 + r() * 4, PALETTE[Math.floor(r() * PALETTE.length)]);
      }
    }
  }
  return data;
}

/** Modell-Daten für eine Kachel: im Zentrum das Mitte-Modell, außerhalb ein generiertes Berlin. */
export function makeFallbackTile(i, j) {
  const c = getCore();
  const b = tileBounds(i, j);
  const out = clipData(c, b);
  const p = proceduralTile(i, j);
  for (const k of ['buildings', 'roads', 'water', 'parks', 'rails']) out[k].push(...p[k]);
  let uid = (i * 100003 + j) * 10000;
  for (const r of out.roads) if (!r.uid) r.uid = 'p' + (uid++);
  return out;
}
