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
  // Retro-Elektro-Stadtwagen: rund, hoch, Kontrastdach, Ring-Scheinwerfer, Scheibenräder
  city: { L: 3.78, W: 1.78, clear: 0.2, wheelR: 0.33, wf: 1.22, wr: -1.2, noseH: 0.64, hoodF: 0.9, belt: 1.02, wsBase: 0.9, wsTop: 0.12, roofH: 1.6, roofBack: -1.55, rearBase: -1.72, trunk: 1.0, roofColor: 0x15161a, ringLights: true, discWheels: 0xeeeae2, roundNose: 0.5, bevel: 0.13, glassBevel: 0.07 },
  // Flache Konzept-Limousine: schwebendes Dach, Lichtband, Aero-Felgen
  vision: { L: 5.15, W: 1.98, clear: 0.13, wheelR: 0.41, wf: 1.72, wr: -1.66, noseH: 0.46, hoodF: 0.64, belt: 0.84, wsBase: 1.05, wsTop: -0.3, roofH: 1.3, roofBack: -1.75, rearBase: -2.35, trunk: 0.88, floatingRoof: true, lightBar: true, aeroWheels: true, roundNose: 0.6, bevel: 0.1, glassBevel: 0.05 },
  // Berliner Doppeldecker
  dd: { L: 11.4, W: 2.55, clear: 0.3, wheelR: 0.5, wf: 3.5, wr: -2.4, noseH: 1.0, hoodF: 1.18, belt: 1.2, wsBase: 5.42, wsTop: 5.38, roofH: 4.05, roofBack: -5.45, rearBase: -5.48, trunk: 1.15, bus: true, decks: 2 },
  sport: { L: 4.5, W: 1.96, clear: 0.15, wheelR: 0.35, wf: 1.38, wr: -1.3, noseH: 0.42, hoodF: 0.62, belt: 0.82, wsBase: 0.62, wsTop: -0.38, roofH: 1.2, roofBack: -1.15, rearBase: -1.95, trunk: 0.86, spoiler: true },
};

// Typische Lackfarben auf Berliner Straßen (Grau/Schwarz/Weiß dominieren)
export const PAINTS = [0x1b1c1f, 0x1b1c1f, 0xd9dbde, 0xf2f2f0, 0x8d9196, 0x5c6066, 0x6b7280, 0x23344f, 0x7a1c1c, 0x2d4a3a, 0x9aa3ad, 0x3b3f47, 0xb8b2a6, 0x1e3a8a];
export const TAXI_COLOR = 0xe9e2c8;   // „Hellelfenbein“ RAL 1015
export const BVG_YELLOW = 0xf5c400;
export const CITY_PAINTS = [0xf05a1a, 0xf05a1a, 0xe9e4d8, 0x7fa7c9, 0xd9b44a, 0x6e8b5e];
export const VISION_PAINTS = [0xb7ad97, 0x9a978e, 0x2b2d31, 0xd8d6d0, 0x5a6470];

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
  const bv = p.bevel || 0.07;
  const hs = h - bv; // Umriss um die Fase verkleinern, damit die Endmaße stimmen
  const r = p.wheelR + 0.06 + bv;

  const s = new THREE.Shape();
  s.moveTo(-hs, p.clear + 0.14);
  s.lineTo(p.wr - r, p.clear);
  s.absarc(p.wr, p.wheelR, r, Math.PI, 0, true);
  s.lineTo(p.wf - r, p.clear);
  s.absarc(p.wf, p.wheelR, r, Math.PI, 0, true);
  s.lineTo(hs - 0.05, p.clear + 0.06);
  s.lineTo(hs + 0.02, p.noseH);
  const rn = p.roundNose || 0.28;
  s.quadraticCurveTo(hs + 0.02, p.hoodF, hs - rn, p.hoodF);
  s.lineTo(p.wsBase, p.belt);
  s.lineTo(p.rearBase, p.belt);
  s.lineTo(-hs + 0.22, p.trunk);
  s.quadraticCurveTo(-hs, p.trunk, -hs, p.trunk - 0.22);
  s.lineTo(-hs, p.clear + 0.14);

  const body = [prep(extrudeProfile(s, W, bv))];

  const gs = new THREE.Shape();
  gs.moveTo(p.wsBase, p.belt - 0.02);
  gs.lineTo(p.wsTop, p.roofH);
  gs.lineTo(p.roofBack, p.roofH);
  gs.lineTo(p.rearBase, p.belt - 0.02);
  gs.lineTo(p.wsBase, p.belt - 0.02);
  const glass = [prep(extrudeProfile(gs, W - 0.16, p.glassBevel || 0.03))];

  const rs = new THREE.Shape();
  const slopeF = (p.wsTop - p.wsBase) / (p.roofH - p.belt);
  const roofLift = p.floatingRoof ? 0.05 : 0;
  const roofEnd = p.floatingRoof ? p.rearBase + 0.15 : p.roofBack;
  rs.moveTo(p.wsTop - slopeF * 0.03 + 0.02, p.roofH - 0.03 + roofLift);
  rs.lineTo(p.wsTop - 0.04, p.roofH + 0.05 + roofLift);
  if (p.floatingRoof) {
    // flügelartiges Dach, das hinten über die Heckscheibe hinausragt
    rs.quadraticCurveTo((p.wsTop + roofEnd) / 2, p.roofH + 0.1 + roofLift, roofEnd - 0.1, p.roofH - 0.12);
    rs.lineTo(roofEnd - 0.08, p.roofH - 0.18);
    rs.quadraticCurveTo((p.wsTop + roofEnd) / 2, p.roofH + 0.02 + roofLift, p.wsTop + 0.05, p.roofH - 0.03 + roofLift);
  } else {
    rs.lineTo(p.roofBack + 0.06, p.roofH + 0.05);
    rs.lineTo(p.roofBack - 0.02, p.roofH - 0.03);
  }
  const roofGeo = extrudeProfile(rs, W - (p.floatingRoof ? 0.12 : 0.2) + (p.glassBevel ? 0.06 : 0), p.glassBevel ? 0.05 : 0.025);
  const detailEarly = [];
  if (p.roofColor !== undefined) detailEarly.push(prep(roofGeo, p.roofColor));
  else body.push(prep(roofGeo));
  if (p.floatingRoof) {
    // dunkles Glasband als „Spalt“ zwischen Karosserie und Dach + Heckscheibe
    const gb = new THREE.Shape();
    gb.moveTo(p.roofBack + 0.2, p.roofH - 0.02); gb.lineTo(roofEnd - 0.05, p.roofH - 0.16); gb.lineTo(p.rearBase, p.belt); gb.lineTo(p.roofBack, p.belt); gb.lineTo(p.roofBack + 0.2, p.roofH - 0.02);
    glass.push(prep(extrudeProfile(gb, W - 0.22, 0.03)));
  }

  if (p.cargo) {
    const [z0, z1, y0, y1] = p.cargo;
    body.push(prep(box(W - 0.04, y1 - y0 + 0.05, z1 - z0, 0, (y0 + y1) / 2 + 0.02, (z0 + z1) / 2)));
  }
  if (!p.bus) {
    // B-Säule + Außenspiegel
    const bz = (p.wsTop + p.roofBack) / 2 - 0.1;
    const pillar = box(W - 0.13, p.roofH - p.belt, 0.12, 0, (p.roofH + p.belt) / 2, bz);
    if (p.roofColor !== undefined) detailEarly.push(prep(pillar, p.roofColor));
    else if (!p.floatingRoof) body.push(prep(pillar));
    for (const sx of [-1, 1]) body.push(prep(box(0.14, 0.1, 0.22, sx * (W / 2 + 0.06), p.belt + 0.06, p.wsBase - 0.15)));
  } else {
    for (let z = -4.5; z < 5; z += 2.2) body.push(prep(box(W - 0.1, p.roofH - p.belt, 0.14, 0, (p.roofH + p.belt) / 2, z)));
  }
  if (p.decks === 2) {
    // Band zwischen den Decks und unter dem Dach
    body.push(prep(box(W - 0.02, 0.42, p.L - 0.12, 0, 2.38, 0)));
    body.push(prep(box(W - 0.02, 0.18, p.L - 0.12, 0, 3.98, 0)));
  }
  if (p.spoiler) {
    body.push(prep(box(W - 0.3, 0.05, 0.3, 0, p.trunk + 0.22, -h + 0.22)));
    for (const sx of [-0.6, 0.6]) body.push(prep(box(0.05, 0.2, 0.12, sx, p.trunk + 0.1, -h + 0.25)));
  }

  const detail = [...detailEarly];
  const DARK = 0x111214, TRIM = 0x1d1f23, CHROME = 0xbfc5cc;
  detail.push(prep(box(W - 0.06, 0.2, 0.16, 0, p.clear + 0.14, h - 0.02), TRIM));
  detail.push(prep(box(W - 0.06, 0.2, 0.16, 0, p.clear + 0.14, -h + 0.02), TRIM));
  detail.push(prep(box(W * 0.45, 0.16, 0.05, 0, p.noseH - 0.06, h + 0.02), DARK));
  // Kennzeichen (weiß, EU-Band)
  detail.push(prep(box(0.52, 0.12, 0.02, 0, p.clear + 0.2, h + 0.1), 0xf2f2f2));
  detail.push(prep(box(0.52, 0.12, 0.02, 0, p.trunk - 0.32, -h - 0.02), 0xf2f2f2));

  if (p.lightBar) for (const sx of [-1, 1]) detail.push(prep(box(0.05, 0.16, p.wf - p.wr - 1.0, sx * (W / 2 + 0.01), p.clear + 0.12, (p.wf + p.wr) / 2), 0x0c0d10));
  if (p.spoiler) {
    detail.push(prep(box(W - 0.5, 0.14, 0.3, 0, p.clear + 0.06, -h + 0.12), DARK)); // Diffusor
    for (const sx of [-0.45, 0.45]) detail.push(prep(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10).rotateX(Math.PI / 2).translate(sx, p.clear + 0.1, -h - 0.04), CHROME));
    for (const sx of [-1, 1]) detail.push(prep(box(0.04, 0.22, 0.9, sx * (W / 2 + 0.005), p.clear + 0.26, 0.05), DARK)); // Seitenschweller
  }
  const wheels = [];
  const wheelGeo = () => {
    const tire = prep(new THREE.CylinderGeometry(p.wheelR, p.wheelR, 0.26, 26).rotateZ(Math.PI / 2), DARK);
    const parts = [tire];
    if (p.discWheels !== undefined) {
      // geschlossene Scheibe mit vier Löchern, Retro-Look
      parts.push(prep(new THREE.CylinderGeometry(p.wheelR * 0.74, p.wheelR * 0.74, 0.27, 24).rotateZ(Math.PI / 2), p.discWheels));
      parts.push(prep(new THREE.TorusGeometry(p.wheelR * 0.5, 0.012, 6, 24).rotateY(Math.PI / 2).translate(0.137, 0, 0), 0xb9b4aa));
      parts.push(prep(new THREE.TorusGeometry(p.wheelR * 0.5, 0.012, 6, 24).rotateY(Math.PI / 2).translate(-0.137, 0, 0), 0xb9b4aa));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        parts.push(prep(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 10).rotateZ(Math.PI / 2).translate(0, Math.cos(a) * 0.09, Math.sin(a) * 0.09), 0x1a1a1a));
      }
    } else if (p.aeroWheels) {
      // dunkle Aero-Scheibe mit Turbinenschaufeln
      parts.push(prep(new THREE.CylinderGeometry(p.wheelR * 0.82, p.wheelR * 0.82, 0.27, 28).rotateZ(Math.PI / 2), 0x2a2b2e));
      for (let i = 0; i < 5; i++) {
        const blade = new THREE.BoxGeometry(0.285, p.wheelR * 0.72, 0.1);
        blade.rotateX(0.5); blade.translate(0, p.wheelR * 0.4, 0); blade.rotateX((i / 5) * Math.PI * 2);
        parts.push(prep(blade, 0x8d8a82));
      }
      parts.push(prep(new THREE.CylinderGeometry(p.wheelR * 0.12, p.wheelR * 0.12, 0.29, 12).rotateZ(Math.PI / 2), 0xd8d4c8));
    } else {
      parts.push(prep(new THREE.CylinderGeometry(p.wheelR * 0.64, p.wheelR * 0.64, 0.27, 14).rotateZ(Math.PI / 2), CHROME));
      parts.push(prep(new THREE.CylinderGeometry(p.wheelR * 0.18, p.wheelR * 0.18, 0.29, 8).rotateZ(Math.PI / 2), 0x2a2d31));
      for (let i = 0; i < 5; i++) {
        const sp = new THREE.BoxGeometry(0.28, p.wheelR * 1.15, 0.07);
        sp.rotateX((i / 5) * Math.PI);
        parts.push(prep(sp, 0x9aa1a8));
      }
    }
    return mergeGeometries(parts);
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
  if (p.ringLights) {
    // runde Scheinwerfer mit LED-Ring
    const ly = p.noseH + 0.08;
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.36);
      detail.push(prep(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20).rotateX(Math.PI / 2).translate(x, ly, h - 0.01), 0x22262c));
      lights.push(prep(new THREE.TorusGeometry(0.16, 0.028, 8, 28).translate(x, ly, h + 0.01), 0xf4f8ff));
      lights.push(prep(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12).rotateX(Math.PI / 2).translate(x, ly, h + 0.01), 0xfff4dc));
      // schmale senkrechte Rückleuchten
      lights.push(prep(box(0.08, 0.4, 0.05, sx * (W / 2 - 0.2), p.trunk - 0.2, -h - 0.01), 0xff1a10));
    }
    // breiter Stoßfänger-Einsatz vorne (wie Retro-Kühlerband)
    detail.push(prep(box(W * 0.6, 0.12, 0.05, 0, p.clear + 0.3, h + 0.08), 0xc9c6bf));
  } else if (p.lightBar) {
    // durchgehendes Lichtband vorne und hinten + senkrechte Lichtklingen
    lights.push(prep(box(W - 0.34, 0.04, 0.04, 0, p.noseH + 0.0, h + 0.01), 0xf4f8ff));
    for (const sx of [-1, 1]) lights.push(prep(box(0.04, 0.24, 0.04, sx * (W / 2 - 0.2), p.noseH - 0.14, h + 0.0), 0xf4f8ff));
    lights.push(prep(box(W - 0.3, 0.05, 0.04, 0, p.trunk - 0.12, -h - 0.01), 0xff1a10));
    detail.push(prep(box(W - 0.5, 0.16, 0.05, 0, p.clear + 0.18, h + 0.0), 0x0c0d10));
  } else {
    for (const sx of [-1, 1]) {
      lights.push(prep(box(0.42, 0.11, 0.06, sx * (W / 2 - 0.32), lh, h + 0.005), 0xfff4dc));
      lights.push(prep(box(0.44, 0.12, 0.06, sx * (W / 2 - 0.3), p.bus ? 1.0 : p.trunk - 0.14, -h - 0.005), 0xff1a10));
    }
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

/** Sichtbare Scheinwerferkegel (zwei offene Kegel, nach vorn breiter werdend). */
export function buildBeamGeometry(key) {
  const p = CAR_TYPES[key], h = p.L / 2;
  const len = 16, rad = 2.6;
  const parts = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.ConeGeometry(rad, len, 18, 1, true);
    g.rotateX(-Math.PI / 2);
    g.translate(sx * (p.W / 2 - 0.35), (p.bus ? 0.75 : p.noseH + 0.05), h + len / 2);
    parts.push(g);
  }
  return mergeGeometries(parts);
}
let beamTex = null;
export function makeBeamMaterial() {
  if (!beamTex) {
    const c = document.createElement('canvas'); c.width = 4; c.height = 128;
    const ctx = c.getContext('2d'); const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,244,220,1)'); g.addColorStop(0.35, 'rgba(255,244,220,0.35)'); g.addColorStop(1, 'rgba(255,244,220,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 128);
    beamTex = new THREE.CanvasTexture(c);
  }
  return new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
}
