// Spieler zu Fuß: gehen, rennen, Kollision mit Häusern, Autos und Bahnen.
import { makePersonFigure } from './people.js';

export class Walker {
  constructor(scene) {
    this.fig = makePersonFigure({ coat: 0x7a1c1c, pants: 0x23262d, skin: 0xd8a883, hair: 0x1a1512 });
    this.fig.visible = false;
    scene.add(this.fig);
    this.x = 0; this.z = 0; this.heading = 0;
    this.speed = 0; this.forwardSpeed = 0; this.vx = 0; this.vz = 0;
    this.phase = 0; this.impact = 0; this.rpm = 0; this.gear = '–';
    this.active = false;
  }
  enable(x, z, heading) { this.x = x; this.z = z; this.heading = heading; this.speed = 0; this.active = true; this.fig.visible = true; }
  disable() { this.active = false; this.fig.visible = false; }
  update(dt, input, run, world, traffic, rail) {
    // Drehen mit A/D, gehen mit W/S, rennen mit Shift
    this.heading += input.steer * dt * 2.6;
    const max = run ? 6.2 : 1.7;
    const want = input.throttle ? max : input.brake ? -1.1 : 0;
    this.speed += (want - this.speed) * Math.min(1, dt * 8);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.vx = fx * this.speed; this.vz = fz * this.speed;
    this.x += this.vx * dt; this.z += this.vz * dt;
    const r = world.colliders.resolveCircle(this.x, this.z, 0.35);
    if (r.hit) { this.x = r.x; this.z = r.z; }
    // Fahrzeuge schieben die Figur beiseite (niemand wird verletzt)
    const c = traffic.collidePlayer(this.x, this.z, 0.35);
    if (c.hit) { this.x += c.px; this.z += c.pz; this.impact = Math.max(this.impact, 0.3); }
    const t = rail.collidePlayer(this.x, this.z, 0.35);
    if (t.hit) { this.x += t.px; this.z += t.pz; }
    this.impact = Math.max(0, this.impact - dt * 2);
    this.forwardSpeed = this.speed;
    this.phase += Math.abs(this.speed) * dt * (run ? 2.2 : 3.6);
    const u = this.fig.userData;
    const sw = Math.abs(this.speed) > 0.1 ? Math.sin(this.phase) * Math.min(0.9, 0.35 + Math.abs(this.speed) * 0.1) : 0;
    u.legL.rotation.x = sw; u.legR.rotation.x = -sw;
    u.armL.rotation.x = -sw * 0.8; u.armR.rotation.x = sw * 0.8;
    u.torso.rotation.x = run && this.speed > 2 ? 0.15 : 0;
    this.fig.position.set(this.x, Math.abs(Math.cos(this.phase)) * (Math.abs(this.speed) > 0.1 ? 0.04 : 0), this.z);
    this.fig.rotation.y = this.heading;
  }
}
