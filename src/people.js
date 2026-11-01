// Fußgänger: instanzierte, animierte Figuren auf den Gehwegen; weichen Autos aus, Schirme bei Regen.
import * as THREE from 'three';
import { ROAD_TYPES, mulberry32 } from './geo.js';

const COATS = [0x1d1e22, 0x22262e, 0x2e3440, 0x3b3b3b, 0x4a4f57, 0x6b5b4b, 0x8a7a63, 0xb8a98c, 0x7a1f2b, 0x24496b, 0x37523a, 0xc4b8a8, 0x9c3d1e, 0xe0dcd2, 0x5a4a6a];
const PANTS = [0x1b1c20, 0x23262d, 0x2b3a55, 0x3a3d44, 0x4b4339, 0x5c5f66, 0x1f2a3a];
const SKIN = [0xf1d3bd, 0xe6bfa1, 0xd8a883, 0xc08a63, 0x9b6a48, 0x6e4a32, 0x4a3122];
const HAIR = [0x1a1512, 0x2b2019, 0x4a3324, 0x6e4f33, 0xb08a5a, 0xd6c09a, 0x8a8a8a, 0x3a2a20];
const UMBRELLA = [0x111111, 0x1b2a4a, 0x7a1c1c, 0x2a5a3a, 0xe6c200, 0x444444];

function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / L) * d, p[1] + (dx / L) * d];
  });
}

export class People {
  constructor(scene, roads, colliders, count = 320) {
    this.colliders = colliders;
    this.rnd = mulberry32(77);
    this.paths = [];
    this.setRoads(roads);
    this.count = count;
    const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, count); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = true; m.frustumCulled = false; scene.add(m); return m; };
    const cloth = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    const torsoG = new THREE.CapsuleGeometry(0.2, 0.42, 4, 10); torsoG.scale(1, 1, 0.62);
    const legG = new THREE.CapsuleGeometry(0.075, 0.72, 3, 8); legG.translate(0, -0.43, 0);
    const armG = new THREE.CapsuleGeometry(0.055, 0.5, 3, 8); armG.translate(0, -0.3, 0);
    const headG = new THREE.SphereGeometry(0.11, 14, 10); headG.scale(0.92, 1.08, 1);
    const hairG = new THREE.SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55); hairG.translate(0, 0.012, -0.01);
    const umbG = new THREE.ConeGeometry(0.62, 0.32, 10, 1, true); umbG.translate(0, 0.16, 0);
    const umbStick = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 4); umbStick.translate(0, -0.4, 0);
    this.m = {
      torso: mk(torsoG, cloth), legL: mk(legG, cloth.clone()), legR: mk(legG, cloth.clone()),
      armL: mk(armG, cloth.clone()), armR: mk(armG, cloth.clone()), head: mk(headG, skin), hair: mk(hairG, new THREE.MeshStandardMaterial({ roughness: 0.9 })),
      umb: mk(umbG, new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide })), stick: mk(umbStick, new THREE.MeshStandardMaterial({ color: 0x222222 })),
    };
    this.p = [];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const coat = COATS[Math.floor(this.rnd() * COATS.length)];
      const pants = PANTS[Math.floor(this.rnd() * PANTS.length)];
      this.m.torso.setColorAt(i, c.setHex(coat)); this.m.armL.setColorAt(i, c); this.m.armR.setColorAt(i, c);
      this.m.legL.setColorAt(i, c.setHex(pants)); this.m.legR.setColorAt(i, c);
      this.m.head.setColorAt(i, c.setHex(SKIN[Math.floor(this.rnd() * SKIN.length)]));
      this.m.hair.setColorAt(i, c.setHex(HAIR[Math.floor(this.rnd() * HAIR.length)]));
      this.m.umb.setColorAt(i, c.setHex(UMBRELLA[Math.floor(this.rnd() * UMBRELLA.length)]));
      const scale = 0.9 + this.rnd() * 0.2;
      this.p.push({ path: null, s: 0, dir: 1, speed: 1.0 + this.rnd() * 0.65, phase: this.rnd() * 6.28, idle: 0, x: 0, z: 0, h: 0, push: 0, px: 0, pz: 0, scale, active: false, lat: (this.rnd() - 0.5) * 1.2, umbrellaUser: this.rnd() < 0.75 });
    }
    this.frame = 0;
    this.M = new THREE.Matrix4(); this.L = new THREE.Matrix4(); this.R = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.V = new THREE.Vector3(); this.S = new THREE.Vector3(); this.E = new THREE.Euler(); this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }
  setRoads(roads) {
    const paths = [];
    for (const r of roads) {
      if (r.type === 'service') continue;
      const ped = r.type === 'pedestrian';
      const offs = ped ? [-(r.width / 2 - 1.4), 0, r.width / 2 - 1.4] : [-(r.width / 2 + 1.6), r.width / 2 + 1.6];
      for (const o of offs) {
        const pts = offsetLine(r.pts, o);
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const len = cum[cum.length - 1];
        if (len > 8) paths.push({ pts, cum, len, w: ped ? 3 : 1 });
      }
    }
    this.paths = paths;
  }
  spawn(p, px, pz, minR, maxR) {
    for (let t = 0; t < 30; t++) {
      const path = this.paths[Math.floor(this.rnd() * this.paths.length)];
      if (!path) return false;
      const s = this.rnd() * path.len;
      const pos = this.sample(path, s);
      const d = Math.hypot(pos[0] - px, pos[1] - pz);
      if (d < minR || d > maxR || this.colliders.inside(pos[0], pos[1])) continue;
      p.path = path; p.s = s; p.dir = this.rnd() < 0.5 ? 1 : -1; p.active = true; p.idle = this.rnd() < 0.1 ? 3 + this.rnd() * 10 : 0; p.push = 0;
      return true;
    }
    return false;
  }
  sample(path, s) {
    const { pts, cum } = path;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m + 1] < s) lo = m + 1; else hi = m; }
    const i = Math.min(lo, pts.length - 2);
    const seg = cum[i + 1] - cum[i] || 1e-6, t = Math.max(0, Math.min(1, (s - cum[i]) / seg));
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, (pts[i + 1][0] - pts[i][0]) / seg, (pts[i + 1][1] - pts[i][1]) / seg];
  }
  update(dt, player, raining, activeCount) {
    this.frame++;
    const { M, L, Q, V, S, E } = this;
    const pfx = Math.sin(player.heading), pfz = Math.cos(player.heading);
    for (let i = 0; i < this.count; i++) {
      const p = this.p[i];
      if (i >= activeCount) { p.active = false; }
      else if (!p.active || Math.hypot(p.x - player.x, p.z - player.z) > 240) {
        if (!this.spawn(p, player.x, player.z, p.active ? 140 : 8, 230)) p.active = false;
      }
      if (!p.active) { for (const k in this.m) this.m[k].setMatrixAt(i, this.zero); continue; }

      let moving = p.idle <= 0;
      if (p.idle > 0) p.idle -= dt;
      // Auto in der Nähe? -> zur Seite springen
      const dx = p.x - player.x, dz = p.z - player.z;
      const along = dx * pfx + dz * pfz;
      const t = Math.max(-2.2, Math.min(2.2, along));
      const ex = p.x - (player.x + pfx * t), ez = p.z - (player.z + pfz * t), d = Math.hypot(ex, ez);
      let run = 1;
      if (d < 4.5 && player.speed > 1.5) {
        const k = (4.5 - d) * Math.min(1, dt * 6);
        p.px += (ex / (d || 1)) * k; p.pz += (ez / (d || 1)) * k;
        run = 2.4; moving = true; p.idle = 0;
      }
      p.px *= Math.exp(-dt * 0.4); p.pz *= Math.exp(-dt * 0.4);

      const v = moving ? p.speed * run : 0;
      p.s += v * p.dir * dt;
      if (p.s > p.path.len || p.s < 0) { p.dir = -p.dir; p.s = Math.max(0, Math.min(p.path.len, p.s)); if (this.rnd() < 0.3) p.idle = 2 + this.rnd() * 6; }
      const [x, z, tx, tz] = this.sample(p.path, p.s);
      const nx = -tz, nz = tx;
      const nxp = x + nx * p.lat + p.px, nzp = z + nz * p.lat + p.pz;
      // nicht in Gebäude laufen (gestaffelt geprüft)
      if ((i + this.frame) % 6 === 0 && this.colliders.inside(nxp, nzp)) { p.px *= 0.3; p.pz *= 0.3; p.dir = -p.dir; }
      p.x = nxp; p.z = nzp;
      const targetH = Math.atan2(tx * p.dir, tz * p.dir);
      let dh = targetH - p.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      p.h += dh * Math.min(1, dt * 8);
      p.phase += v * dt * 3.6;

      const sw = moving ? Math.sin(p.phase) * Math.min(0.75, 0.42 * run) : 0;
      const bob = moving ? Math.abs(Math.cos(p.phase)) * 0.035 : 0;
      const sc = p.scale;
      V.set(p.x, bob, p.z); Q.setFromAxisAngle(this.up || (this.up = new THREE.Vector3(0, 1, 0)), p.h); S.set(sc, sc, sc);
      M.compose(V, Q, S);
      const part = (mesh, x0, y0, z0, rx) => {
        E.set(rx, 0, 0); this.Q2 = this.Q2 || new THREE.Quaternion(); this.Q2.setFromEuler(E);
        this.V2 = this.V2 || new THREE.Vector3(); this.V2.set(x0, y0, z0);
        L.compose(this.V2, this.Q2, this.one || (this.one = new THREE.Vector3(1, 1, 1)));
        this.R.multiplyMatrices(M, L);
        mesh.setMatrixAt(i, this.R);
      };
      part(this.m.torso, 0, 1.22, 0, moving ? 0.05 * run : 0);
      part(this.m.legL, -0.1, 0.9, 0, sw);
      part(this.m.legR, 0.1, 0.9, 0, -sw);
      const umbrella = raining && p.umbrellaUser;
      part(this.m.armL, -0.26, 1.48, 0, umbrella ? -1.2 : -sw * 0.8);
      part(this.m.armR, 0.26, 1.48, 0, -sw * (umbrella ? 0.3 : 0.8));
      part(this.m.head, 0, 1.66, 0.01, 0);
      part(this.m.hair, 0, 1.68, 0, 0);
      if (umbrella) { part(this.m.umb, -0.12, 2.12, 0.15, 0); part(this.m.stick, -0.12, 2.12, 0.15, 0); }
      else { this.m.umb.setMatrixAt(i, this.zero); this.m.stick.setMatrixAt(i, this.zero); }
    }
    for (const k in this.m) this.m[k].instanceMatrix.needsUpdate = true;
  }
}

/** Einzelne Figur (für den Spieler zu Fuß) mit beweglichen Gliedern. */
export function makePersonFigure({ coat = 0x2b3a55, pants = 0x1b1c20, skin = 0xe6bfa1, hair = 0x3a2a20 } = {}) {
  const g = new THREE.Group();
  const mat = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const torsoG = new THREE.CapsuleGeometry(0.2, 0.42, 4, 12); torsoG.scale(1, 1, 0.62);
  const torso = new THREE.Mesh(torsoG, mat(coat)); torso.position.y = 1.22; g.add(torso);
  const limb = (r, len, c, x, y) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
    const geo = new THREE.CapsuleGeometry(r, len, 3, 8); geo.translate(0, -(len / 2 + r), 0);
    pivot.add(new THREE.Mesh(geo, mat(c))); g.add(pivot); return pivot;
  };
  const legL = limb(0.075, 0.72, pants, -0.1, 0.9), legR = limb(0.075, 0.72, pants, 0.1, 0.9);
  const armL = limb(0.055, 0.5, coat, -0.26, 1.48), armR = limb(0.055, 0.5, coat, 0.26, 1.48);
  const headG = new THREE.SphereGeometry(0.11, 16, 12); headG.scale(0.92, 1.08, 1);
  const head = new THREE.Mesh(headG, mat(skin, 0.6)); head.position.set(0, 1.66, 0.01); g.add(head);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.118, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(hair, 0.9)); hairM.position.set(0, 1.69, 0); g.add(hairM);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData = { legL, legR, armL, armR, torso };
  return g;
}
