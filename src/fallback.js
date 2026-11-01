// Ersatz-Stadt, falls OpenStreetMap nicht erreichbar ist: grobes Modell von
// Berlin-Mitte (Straßennamen, Spree, Tiergarten, Blockrandbebauung mit 22 m Traufhöhe).
import { mulberry32, LANDMARKS } from './geo.js';

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
