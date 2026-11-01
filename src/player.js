// Spielerfahrzeug: Arcade-Fahrphysik mit Drift, Kollisionen, Scheinwerfern und Motorsound.
import * as THREE from 'three';
import { buildCarGeometry, makeCarMaterials, buildBeamGeometry, makeBeamMaterial } from './cars.js';

const GEAR_TOP = [0, 13, 24, 36, 49, 63, 80]; // m/s pro Gang
// Beschleunigung (m/s²) und Höchstgeschwindigkeit (m/s) je Fahrzeugtyp
export const PERF = {
  sport: [10.5, 72], vision: [9.5, 64], city: [7.8, 42], sedan: [8, 58], hatch: [7.2, 52], suv: [7.5, 54],
  van: [5.5, 44], taxi: [8, 56], bus: [3.2, 24], dd: [2.8, 22],
};

export class Player {
  constructor(scene, paint = 0xf05a1a, model = 'city') {
    this.mats = makeCarMaterials(paint);
    this.mats.lights = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.wheels = [];
    this.setModel(model);
    // Scheinwerfer
    this.headlights = [];
    for (const sx of [-0.65, 0.65]) {
      const s = new THREE.SpotLight(0xfff1d6, 0, 90, 0.5, 0.45, 1.2);
      s.position.set(sx, 0.6, this.params.L / 2 - 0.2);
      s.target.position.set(sx * 1.5, -0.6, 22);
      this.group.add(s, s.target);
      this.headlights.push(s);
    }
    // Lichtschein vor dem Auto (günstiger Fake-Lichtkegel)
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d'); const gr = ctx.createRadialGradient(64, 40, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,240,210,0.9)'); gr.addColorStop(1, 'rgba(255,240,210,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 128);
    const glowGeo = new THREE.PlaneGeometry(9, 22); glowGeo.rotateX(-Math.PI / 2); glowGeo.translate(0, 0.16, 12);
    this.glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.group.add(this.glow);
    scene.add(this.group);

    this.x = 0; this.z = 0; this.heading = 0;
    this.vx = 0; this.vz = 0; this.steer = 0; this.yawRate = 0;
    this.speed = 0; this.forwardSpeed = 0; this.rpm = 0; this.gear = 1;
    this.wheelSpin = 0; this.roll = 0; this.pitch = 0;
    this.grip = 1; this.lightsOn = false; this.autoLights = true; this.braking = false;
    this.impact = 0;
  }
  get length() { return this.params.L; }
  setVisible(v) { this.group.visible = v; }
  setModel(model) {
    const g = buildCarGeometry(model, { separateWheels: true });
    this.model = model;
    this.params = g.params;
    this.perf = PERF[model] || PERF.sedan;
    const half = g.params.L / 2 - 1.0;
    this.circles = g.params.L > 6 ? [half, half / 2, 0, -half / 2, -half] : [half, -half];
    this.radius = g.params.W / 2 + 0.1;
    this.wheelbase = g.params.wf - g.params.wr;
    for (const c of [...this.body.children]) { this.body.remove(c); c.geometry.dispose(); }
    for (const w of this.wheels) { this.group.remove(w.pivot); w.mesh.geometry.dispose(); }
    for (const part of ['body', 'glass', 'detail', 'lights']) {
      const m = new THREE.Mesh(g[part], this.mats[part]);
      m.castShadow = part !== 'lights'; m.receiveShadow = part === 'body';
      this.body.add(m);
    }
    this.wheels = g.wheels.map((w) => {
      const pivot = new THREE.Group(); pivot.position.set(...w.pos);
      const mesh = new THREE.Mesh(w.geo, this.mats.detail); mesh.castShadow = true;
      pivot.add(mesh); this.group.add(pivot);
      return { pivot, mesh, front: w.front };
    });
    for (const h of this.headlights || []) h.position.z = g.params.L / 2 - 0.2;
    if (!this.beamMat) this.beamMat = makeBeamMaterial();
    if (this.beams) { this.body.remove(this.beams); this.beams.geometry.dispose(); }
    this.beams = new THREE.Mesh(buildBeamGeometry(model), this.beamMat); this.beams.renderOrder = 3;
    this.body.add(this.beams);
  }
  setPaint(hex) { this.mats.body.color.setHex(hex); }
  place(x, z, heading) { this.x = x; this.z = z; this.heading = heading; this.vx = this.vz = 0; this.yawRate = 0; }

  update(dt, input, world, traffic, rail) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx; // rechts
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * rx + this.vz * rz;
    const abs = Math.abs(vf);

    // Lenkung
    const maxSteer = 0.62 / (1 + abs * 0.055);
    const steerTarget = input.steer * maxSteer;
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * (input.steer ? 7 : 10));

    // Antrieb / Bremse
    let acc = 0;
    this.braking = false;
    if (input.throttle > 0) {
      if (vf < -0.5) { acc = 16 * input.throttle; this.braking = true; }
      else acc = this.perf[0] * input.throttle * Math.max(0.08, 1 - Math.pow(Math.max(0, vf) / this.perf[1], 1.6));
    }
    if (input.brake > 0) {
      if (vf > 0.5) { acc -= 17 * input.brake; this.braking = true; }
      else acc -= 6 * input.brake * (vf > -14 ? 1 : 0);
    }
    acc -= vf * 0.012 * abs * 0.06 + Math.sign(vf) * 0.35 + vf * 0.04; // Luft- & Rollwiderstand
    if (input.hand) acc -= Math.sign(vf) * 5;
    vf += acc * dt;
    if (!input.throttle && !input.brake && Math.abs(vf) < 0.3) vf = 0;

    // Seitenführung (niedrig = Drift)
    const gripK = (input.hand ? 1.2 : 9) * this.grip;
    vl *= Math.exp(-gripK * dt);

    // Gieren
    const yawTarget = (vf * Math.tan(this.steer)) / this.wheelbase * (input.hand ? 1.35 : 1);
    this.yawRate += (yawTarget - this.yawRate) * Math.min(1, dt * 8 * this.grip);
    this.heading += this.yawRate * dt;

    // neue Weltgeschwindigkeit (Trägheit -> Drift)
    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    this.vx = fx * vf + rx * vl;
    this.vz = fz * vf + rz * vl;
    // Teil der Geschwindigkeit dreht mit dem Fahrzeug mit
    const keep = 1 - Math.exp(-(input.hand ? 0.8 : 6) * this.grip * dt);
    const sp = Math.hypot(this.vx, this.vz);
    const sgn = Math.sign(vf) || 1;
    this.vx += (nfx * sp * sgn - this.vx) * keep;
    this.vz += (nfz * sp * sgn - this.vz) * keep;

    this.x += this.vx * dt; this.z += this.vz * dt;

    // Kollision Gebäude (zwei Kreise)
    this.impact = Math.max(0, this.impact - dt * 2);
    for (const off of this.circles) {
      const cx = this.x + nfx * off, cz = this.z + nfz * off;
      const r = world.colliders.resolveCircle(cx, cz, this.radius);
      if (r.hit) {
        this.x += r.x - cx; this.z += r.z - cz;
        const vn = this.vx * r.nx + this.vz * r.nz;
        if (vn < 0) {
          this.vx -= r.nx * vn * 1.25; this.vz -= r.nz * vn * 1.25;
          this.vx *= 0.8; this.vz *= 0.8;
          this.impact = Math.max(this.impact, Math.min(1, -vn / 15));
        }
      }
    }
    // Kollision Verkehr
    let c = { hit: false, px: 0, pz: 0 };
    for (const off of this.circles) {
      const cc = traffic.collidePlayer(this.x + nfx * off, this.z + nfz * off, this.radius + 0.2);
      if (cc.hit) { c.hit = true; c.px += cc.px; c.pz += cc.pz; }
    }
    if (c.hit) {
      this.x += c.px; this.z += c.pz;
      const l = Math.hypot(c.px, c.pz) || 1; const nx = c.px / l, nz = c.pz / l;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) { this.vx -= nx * vn * 1.4; this.vz -= nz * vn * 1.4; this.impact = Math.max(this.impact, Math.min(1, -vn / 12)); }
      this.vx *= 0.92; this.vz *= 0.92;
    }

    if (rail) {
      const t = rail.collidePlayer(this.x, this.z, this.radius + 0.2);
      if (t.hit) {
        this.x += t.px; this.z += t.pz;
        const l = Math.hypot(t.px, t.pz) || 1; const nx = t.px / l, nz = t.pz / l;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) { this.vx -= nx * vn * 1.3; this.vz -= nz * vn * 1.3; this.impact = Math.max(this.impact, Math.min(1, -vn / 12)); }
      }
    }
    this.forwardSpeed = this.vx * nfx + this.vz * nfz;
    this.speed = Math.hypot(this.vx, this.vz);
    this.slip = Math.abs(this.vx * -nfz + this.vz * nfx);

    // Getriebe & Drehzahl
    const s = Math.abs(this.forwardSpeed);
    let gear = 1; while (gear < GEAR_TOP.length - 1 && s > GEAR_TOP[gear]) gear++;
    this.gear = this.forwardSpeed < -0.5 ? 'R' : s < 0.3 && !input.throttle ? 'N' : gear;
    const lo = GEAR_TOP[gear - 1], hi = GEAR_TOP[gear];
    const targetRpm = 900 + Math.max(0, Math.min(1, (s - lo * 0.75) / (hi - lo * 0.75))) * 6900 + (input.throttle && s < 2 ? 2200 : 0);
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 9);

    // Darstellung
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
    this.roll += ((-this.yawRate * this.forwardSpeed) * 0.0035 - this.roll) * Math.min(1, dt * 6);
    this.pitch += ((-acc) * 0.004 - this.pitch) * Math.min(1, dt * 6);
    this.body.rotation.set(THREE.MathUtils.clamp(this.pitch, -0.05, 0.05), 0, THREE.MathUtils.clamp(this.roll, -0.07, 0.07));
    this.wheelSpin += (this.forwardSpeed / this.params.wheelR) * dt;
    for (const w of this.wheels) {
      w.mesh.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steer;
    }
  }
  setLights(on, night, brake, haze = 0) {
    if (this.beamMat) this.beamMat.opacity = on ? Math.min(0.22, 0.03 + night * 0.06 + haze * 0.12) : 0;
    for (const h of this.headlights) h.intensity = on ? 160 : 0;
    this.glow.material.opacity = on ? 0.35 * Math.max(0.3, night) : 0;
    this.mats.lights.color.setScalar(on ? 3.5 : 1).add(new THREE.Color(brake ? 2 : 0, 0, 0));
  }
}

// ---------------------------------------------------------------- Audio
export class CarAudio {
  constructor() { this.ctx = null; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
      this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
      this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 900; this.filter.Q.value = 3;
      this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0.0;
      this.filter.connect(this.engineGain).connect(this.master);
      this.osc = [ctx.createOscillator(), ctx.createOscillator(), ctx.createOscillator()];
      this.osc[0].type = 'sawtooth'; this.osc[1].type = 'square'; this.osc[2].type = 'sawtooth';
      const g2 = ctx.createGain(); g2.gain.value = 0.35;
      this.osc[0].connect(this.filter); this.osc[1].connect(g2).connect(this.filter); this.osc[2].connect(this.filter);
      this.osc.forEach((o) => o.start());
      // Rauschen (Regen, Reifen)
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      const mkNoise = (type, freq) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(f).connect(g).connect(this.master); src.start();
        return g;
      };
      this.rainGain = mkNoise('lowpass', 2400);
      this.skidGain = mkNoise('bandpass', 1300);
      this.windGain = mkNoise('lowpass', 500);
    } catch (e) { console.warn('Audio nicht verfügbar', e); this.ctx = null; }
  }
  update(player, rain, input, engineOn = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 28 + player.rpm / 60 * 0.9;
    this.osc[0].frequency.setTargetAtTime(f, t, 0.03);
    this.osc[1].frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.osc[2].frequency.setTargetAtTime(f * 1.01 * 2, t, 0.03);
    this.filter.frequency.setTargetAtTime(500 + player.rpm * 0.25 + (input.throttle ? 900 : 0), t, 0.05);
    this.engineGain.gain.setTargetAtTime(engineOn ? 0.09 + (input.throttle ? 0.1 : 0.02) : 0, t, 0.08);
    this.rainGain.gain.setTargetAtTime(rain * 0.12, t, 0.5);
    const skid = player.speed > 6 ? Math.min(1, Math.max(0, player.slip - 2.5) / 6) : 0;
    this.skidGain.gain.setTargetAtTime(skid * 0.18, t, 0.05);
    this.windGain.gain.setTargetAtTime(Math.min(0.2, player.speed / 300), t, 0.2);
  }
  horn(on) {
    if (!this.ctx) return;
    if (on && !this.hornNodes) {
      const g = this.ctx.createGain(); g.gain.value = 0.12; g.connect(this.master);
      this.hornNodes = [415, 520].map((fr) => { const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(g); o.start(); return o; });
      this.hornNodes.gain = g;
    } else if (!on && this.hornNodes) { this.hornNodes.forEach((o) => o.stop()); this.hornNodes.gain.disconnect(); this.hornNodes = null; }
  }
  crash(strength) {
    if (!this.ctx || strength < 0.15) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = this.ctx.createGain(); const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.6 * strength, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(f).connect(g).connect(this.master); src.start(); src.stop(t + 0.6);
  }
  thunder() {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160;
    const g = this.ctx.createGain(); const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.15); g.gain.exponentialRampToValueAtTime(0.001, t + 4);
    src.connect(f).connect(g).connect(this.master); src.start(); src.stop(t + 4.2);
  }
}
