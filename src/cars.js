// Prozedurale Fahrzeugmodelle (Limousine, Kompakt, SUV, Transporter, Berliner Taxi, BVG-Bus, Sportwagen).
// Koordinaten: Länge entlang +z (Front), Breite entlang x, y nach oben.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const sedan = { L: 4.7, W: 1.84, clear: 0.22, wheelR: 0.33, wf: 1.42, wr: -1.38, noseH: 0.55, hoodF: 0.74, belt: 0.98, wsBase: 0.95, wsTop: 0.05, roofH: 1.45, roofBack: -1.0, rearBase: -1.65, trunk: 0.95 };
export const CAR_TYPES = {
  sedan,
  hatch: { L: 4.1, W: 1.78, clear: 0.2, wheelR: 0.31, wf: 1.28, wr: -1.25, noseH: 0.55, hoodF: 0.76, belt: 0.98, wsBase: 0.8, wsTop: 0.0, roofH: 1.48, roofBack: -1.6, rearBase: -1.85, trunk: 0.96 },
  suv: { L: 4.75, W: 1.95, clear: 0.3, wheelR: 0.39, wf: 1.45, wr: -1.4, noseH: 0.72, hoodF: 1.0, belt: 1.12, wsBase: 1.05, wsTop: 0.25, roofH: 1.74, roofBack: -1.9, rearBase: -2.12, trunk: 1.08 },
  van: { L: 5.3, W: 2.0, clear: 0.25, wheelR: 0.36, wf: 1.85, wr: -1.75, noseH: 0.72, hoodF: 1.02, belt: 1.15, wsBase: 1.95, wsTop: 1.4, roofH: 2.3, roofBack: 0.95, rearBase: 0.95, trunk: 1.1, cargo: [-2.62, 0.95, 0.5, 2.3] },
  taxi: { ...sedan, sign: true },
  bus: { L: 12, W: 2.55, clear: 0.3, wheelR: 0.5, wf: 3.6, wr: -2.6, noseH: 1.0, hoodF: 1.18, belt: 1.2, wsBase: 5.72, wsTop: 5.66, roofH: 2.95, roofBack: -5.75, rearBase: -5.78, trunk: 1.15, bus: true },
  sport: { L: 4.5, W: 1.96, clear: 0.15, wheelR: 0.35, wf: 1.38, wr: -1.3, noseH: 0.42, hoodF: 0.62, belt: 0.82, wsBase: 0.62, wsTop: -0.38, roofH: 1.2, roofBack: -1.15, rearBase: -1.95, trunk: 0.86, spoiler: true },
};

// Typische Lackfarben auf Berliner Straßen (Grau/Schwarz/Weiß dominieren)
export const PAINTS = [0x1b1c1f, 0x1b1c1f, 0xd9dbde, 0xf2f2f0, 0x8d9196, 0x5c6066, 0x6b7280, 0x23344f, 0x7a1c1c, 0x2d4a3a, 0x9aa3ad, 0x3b3f47, 0xb8b2a6, 0x1e3a8a];
export const TAXI_COLOR = 0xe9e2c8;   // „Hellelfenbein“ RAL 1015
export const BVG_YELLOW = 0xf5c400;

function prep(geo, color) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (color !== undefined) {
    const c = new THREE.Color(color);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}
function extrudeProfile(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  g.rotateY(-Math.PI / 2); // Profil-x (Länge) -> Welt-z
  return g;
}
function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Liefert Geometrien: body (lackiert), glass, detail (vertexColors), lights (vertexColors, leuchtend), wheels. */
export function buildCarGeometry(key, { separateWheels = false } = {}) {
  const p = CAR_TYPES[key];
  const h = p.L / 2, W = p.W;
  const r = p.wheelR + 0.06;

  const s = new THREE.Shape();
  s.moveTo(-h, p.clear + 0.14);
  s.lineTo(p.wr - r, p.clear);
  s.absarc(p.wr, p.wheelR, r, Math.PI, 0, true);
  s.lineTo(p.wf - r, p.clear);
  s.absarc(p.wf, p.wheelR, r, Math.PI, 0, true);
  s.lineTo(h - 0.05, p.clear + 0.06);
  s.lineTo(h + 0.02, p.noseH);
  s.quadraticCurveTo(h + 0.02, p.hoodF, h - 0.28, p.hoodF);
  s.lineTo(p.wsBase, p.belt);
  s.lineTo(p.rearBase, p.belt);
  s.lineTo(-h + 0.22, p.trunk);
  s.quadraticCurveTo(-h, p.trunk, -h, p.trunk - 0.22);
  s.lineTo(-h, p.clear + 0.14);

  const body = [prep(extrudeProfile(s, W, 0.07))];

  const gs = new THREE.Shape();
  gs.moveTo(p.wsBase, p.belt - 0.02);
  gs.lineTo(p.wsTop, p.roofH);
  gs.lineTo(p.roofBack, p.roofH);
  gs.lineTo(p.rearBase, p.belt - 0.02);
  gs.lineTo(p.wsBase, p.belt - 0.02);
  const glass = [prep(extrudeProfile(gs, W - 0.16, 0.03))];

  const rs = new THREE.Shape();
  const slopeF = (p.wsTop - p.wsBase) / (p.roofH - p.belt);
  rs.moveTo(p.wsTop - slopeF * 0.03 + 0.02, p.roofH - 0.03);
  rs.lineTo(p.wsTop - 0.04, p.roofH + 0.05);
  rs.lineTo(p.roofBack + 0.06, p.roofH + 0.05);
  rs.lineTo(p.roofBack - 0.02, p.roofH - 0.03);
  body.push(prep(extrudeProfile(rs, W - 0.2, 0.025)));

  if (p.cargo) {
    const [z0, z1, y0, y1] = p.cargo;
    body.push(prep(box(W - 0.04, y1 - y0 + 0.05, z1 - z0, 0, (y0 + y1) / 2 + 0.02, (z0 + z1) / 2)));
  }
  if (!p.bus) {
    // B-Säule + Außenspiegel
    const bz = (p.wsTop + p.roofBack) / 2 - 0.1;
    body.push(prep(box(W - 0.13, p.roofH - p.belt, 0.12, 0, (p.roofH + p.belt) / 2, bz)));
    for (const sx of [-1, 1]) body.push(prep(box(0.14, 0.1, 0.22, sx * (W / 2 + 0.06), p.belt + 0.06, p.wsBase - 0.15)));
  } else {
    for (let z = -4.5; z < 5; z += 2.2) body.push(prep(box(W - 0.1, p.roofH - p.belt, 0.14, 0, (p.roofH + p.belt) / 2, z)));
  }
  if (p.spoiler) {
    body.push(prep(box(W - 0.3, 0.05, 0.3, 0, p.trunk + 0.22, -h + 0.22)));
    for (const sx of [-0.6, 0.6]) body.push(prep(box(0.05, 0.2, 0.12, sx, p.trunk + 0.1, -h + 0.25)));
  }

  const detail = [];
  const DARK = 0x111214, TRIM = 0x1d1f23, CHROME = 0xbfc5cc;
  detail.push(prep(box(W - 0.06, 0.2, 0.16, 0, p.clear + 0.14, h - 0.02), TRIM));
  detail.push(prep(box(W - 0.06, 0.2, 0.16, 0, p.clear + 0.14, -h + 0.02), TRIM));
  detail.push(prep(box(W * 0.45, 0.16, 0.05, 0, p.noseH - 0.06, h + 0.02), DARK));
  // Kennzeichen (weiß, EU-Band)
  detail.push(prep(box(0.52, 0.12, 0.02, 0, p.clear + 0.2, h + 0.1), 0xf2f2f2));
  detail.push(prep(box(0.52, 0.12, 0.02, 0, p.trunk - 0.32, -h - 0.02), 0xf2f2f2));

  if (p.spoiler) {
    detail.push(prep(box(W - 0.5, 0.14, 0.3, 0, p.clear + 0.06, -h + 0.12), DARK)); // Diffusor
    for (const sx of [-0.45, 0.45]) detail.push(prep(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10).rotateX(Math.PI / 2).translate(sx, p.clear + 0.1, -h - 0.04), CHROME));
    for (const sx of [-1, 1]) detail.push(prep(box(0.04, 0.22, 0.9, sx * (W / 2 + 0.005), p.clear + 0.26, 0.05), DARK)); // Seitenschweller
  }
  const wheels = [];
  const wheelGeo = () => {
    const tire = prep(new THREE.CylinderGeometry(p.wheelR, p.wheelR, 0.26, 22).rotateZ(Math.PI / 2), DARK);
    const rim = prep(new THREE.CylinderGeometry(p.wheelR * 0.64, p.wheelR * 0.64, 0.27, 14).rotateZ(Math.PI / 2), CHROME);
    const hub = prep(new THREE.CylinderGeometry(p.wheelR * 0.18, p.wheelR * 0.18, 0.29, 8).rotateZ(Math.PI / 2), 0x2a2d31);
    const spokes = [];
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.BoxGeometry(0.28, p.wheelR * 1.15, 0.07);
      sp.rotateX((i / 5) * Math.PI);
      spokes.push(prep(sp, 0x9aa1a8));
    }
    return mergeGeometries([tire, rim, hub, ...spokes]);
  };
  const wx = W / 2 - 0.2;
  const wpos = [[-wx, p.wheelR, p.wf], [wx, p.wheelR, p.wf], [-wx, p.wheelR, p.wr], [wx, p.wheelR, p.wr]];
  if (p.bus) wpos.push([-wx, p.wheelR, p.wr - 1.4], [wx, p.wheelR, p.wr - 1.4]);
  if (separateWheels) {
    for (const wp of wpos) wheels.push({ geo: wheelGeo(), pos: wp, front: wp[2] > 0 });
  } else {
    for (const wp of wpos) detail.push(wheelGeo().translate(...wp));
  }

  const lights = [];
  const lh = p.bus ? 0.75 : Math.min(p.hoodF - 0.1, p.noseH + 0.08);
  for (const sx of [-1, 1]) {
    lights.push(prep(box(0.42, 0.11, 0.06, sx * (W / 2 - 0.32), lh, h + 0.005), 0xfff4dc));
    lights.push(prep(box(0.44, 0.12, 0.06, sx * (W / 2 - 0.3), p.bus ? 1.0 : p.trunk - 0.14, -h - 0.005), 0xff1a10));
  }
  if (p.spoiler) {
    lights.push(prep(box(W - 0.5, 0.05, 0.04, 0, p.trunk - 0.1, -h - 0.01), 0xff1a10)); // Leuchtband hinten
    lights.push(prep(box(W - 0.6, 0.03, 0.03, 0, p.hoodF - 0.05, h - 0.2), 0xe8f0ff));  // Tagfahrlicht
  }
  if (p.sign) lights.push(prep(box(0.56, 0.17, 0.22, 0, p.roofH + 0.14, -0.35), 0xfff2a0));
  if (p.bus) lights.push(prep(box(W * 0.7, 0.28, 0.04, 0, p.roofH - 0.25, h + 0.02), 0xffb000)); // Zielanzeige

  return {
    body: mergeGeometries(body),
    glass: mergeGeometries(glass),
    detail: mergeGeometries(detail),
    lights: mergeGeometries(lights),
    wheels,
    params: p,
  };
}

export function makeCarMaterials(paint) {
  return {
    body: new THREE.MeshPhysicalMaterial({ color: paint ?? 0xffffff, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0d141c, metalness: 0.9, roughness: 0.05, clearcoat: 1 }),
    detail: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.55 }),
    lights: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  };
}
