// Karte im klassischen Web-Karten-Look: Radar (rotierend) + Vollbildkarte mit Verkehrs-Layer.
import { ROAD_TYPES, EXTENT } from './geo.js';

const C = {
  land: '#f1efe9', water: '#9cc0f9', park: '#c3e6c9', building: '#e3e1dc', buildingStroke: '#d4d1ca',
  road: '#ffffff', roadStroke: '#d6d6d6', major: '#fde293', majorStroke: '#e9bc62', label: '#5f6368',
  ped: '#ebe8e1',
};
export function flowColor(f) {
  if (f > 0.78) return '#1e8e3e';
  if (f > 0.55) return '#f29900';
  if (f > 0.32) return '#d93025';
  return '#8b1a10';
}

export class MapRenderer {
  constructor(data, traffic) {
    this.data = data; this.traffic = traffic;
    this.pad = 400;
    this.minX = EXTENT.minX - this.pad; this.minZ = EXTENT.minZ - this.pad;
    this.w = EXTENT.maxX - EXTENT.minX + this.pad * 2; this.h = EXTENT.maxZ - EXTENT.minZ + this.pad * 2;
    this.scale = Math.min(1.6, 4096 / Math.max(this.w, this.h)); // px pro Meter
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(this.w * this.scale); this.canvas.height = Math.ceil(this.h * this.scale);
    this.render();
  }
  toPx(x, z) { return [(x - this.minX) * this.scale, (z - this.minZ) * this.scale]; }
  poly(ctx, ring) { ctx.beginPath(); ring.forEach(([x, z], i) => { const [px, py] = this.toPx(x, z); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); }
  line(ctx, pts) { ctx.beginPath(); pts.forEach(([x, z], i) => { const [px, py] = this.toPx(x, z); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); }
  render() {
    const ctx = this.canvas.getContext('2d'), s = this.scale;
    ctx.fillStyle = C.land; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = C.park; for (const r of this.data.parks) { this.poly(ctx, r); ctx.fill(); }
    ctx.fillStyle = C.water; for (const r of this.data.water) { this.poly(ctx, r); ctx.fill(); }
    ctx.fillStyle = C.building; ctx.strokeStyle = C.buildingStroke; ctx.lineWidth = 1;
    for (const b of this.data.buildings) { this.poly(ctx, b.ring); ctx.fill(); ctx.stroke(); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const roads = this.data.roads.slice().sort((a, b) => (ROAD_TYPES[a.type].major ? 1 : 0) - (ROAD_TYPES[b.type].major ? 1 : 0));
    for (const pass of [0, 1]) for (const r of roads) {
      const major = ROAD_TYPES[r.type].major;
      const w = Math.max(2, r.width * s * 0.8);
      if (r.type === 'pedestrian' || r.type === 'service') { if (pass) { ctx.strokeStyle = C.ped; ctx.lineWidth = w; this.line(ctx, r.pts); ctx.stroke(); } continue; }
      ctx.strokeStyle = pass ? (major ? C.major : C.road) : major ? C.majorStroke : C.roadStroke;
      ctx.lineWidth = pass ? w : w + 2.5;
      this.line(ctx, r.pts); ctx.stroke();
    }
    // Verkehrs-Layer
    ctx.lineWidth = Math.max(2.5, 4 * s);
    for (const l of this.traffic.links) {
      if (!l.major) continue;
      ctx.strokeStyle = flowColor(l.flow);
      // auf die rechte Fahrbahnseite versetzt zeichnen, wie bei Verkehrskarten üblich
      const off = l.oneway ? 0 : l.road.width * 0.22;
      const pts = l.pts.map((p, i) => {
        const a = l.pts[Math.max(0, i - 1)], b = l.pts[Math.min(l.pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
        return [p[0] - (dz / L) * off, p[1] + (dx / L) * off];
      });
      this.line(ctx, pts); ctx.stroke();
      if (!l.oneway) {
        const back = l.pts.map((p, i) => {
          const a = l.pts[Math.max(0, i - 1)], b = l.pts[Math.min(l.pts.length - 1, i + 1)];
          const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
          return [p[0] + (dz / L) * off, p[1] - (dx / L) * off];
        });
        ctx.strokeStyle = flowColor(Math.min(1, l.flow + 0.08)); this.line(ctx, back); ctx.stroke();
      }
    }
    // Straßennamen
    ctx.font = `600 ${Math.round(11 * Math.max(1, s))}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const placed = [];
    for (const r of roads) {
      if (!r.name || !ROAD_TYPES[r.type].drive) continue;
      let best = null, bl = 0;
      for (let i = 0; i < r.pts.length - 1; i++) { const L = Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]); if (L > bl) { bl = L; best = i; } }
      if (bl < 70) continue;
      const a = r.pts[best], b = r.pts[best + 1];
      const [mx, my] = this.toPx((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (placed.some(([x, y, n]) => (n === r.name && Math.hypot(x - mx, y - my) < 500 * s) || Math.hypot(x - mx, y - my) < 50 * s)) continue;
      placed.push([mx, my, r.name]);
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(r.name, 0, 0);
      ctx.fillStyle = C.label; ctx.fillText(r.name, 0, 0); ctx.restore();
    }
    // Wahrzeichen
    this.rendered = Date.now();
  }
  drawCars(ctx, toScreen, size) {
    for (const c of this.traffic.cars) {
      if (!c.active) continue;
      const [x, y] = toScreen(c.x, c.z);
      ctx.fillStyle = c.type === 'bus' ? '#f5c400' : c.type === 'taxi' ? '#c9b98a' : '#5f6368';
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    }
  }
  drawArrow(ctx, x, y, ang, r) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = 'rgba(26,115,232,0.18)'; ctx.beginPath(); ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a73e8'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -r * 1.4); ctx.lineTo(r, r); ctx.lineTo(0, r * 0.45); ctx.lineTo(-r, r); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  /** Radar: rotiert mit der Fahrtrichtung. */
  drawRadar(canvas, player) {
    const ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
    const zoom = 1.25 - Math.min(0.55, player.speed / 90); // px pro Meter
    ctx.save();
    ctx.fillStyle = C.land; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H * 0.62);
    ctx.rotate(player.heading - Math.PI);
    const k = zoom / this.scale;
    ctx.scale(k, k);
    const [px, py] = this.toPx(player.x, player.z);
    ctx.drawImage(this.canvas, -px, -py);
    ctx.restore();
    ctx.save(); ctx.translate(W / 2, H * 0.62); ctx.rotate(player.heading - Math.PI);
    const toScreen = (x, z) => [(x - player.x) * zoom, (z - player.z) * zoom];
    this.drawCars(ctx, toScreen, 2.6);
    ctx.restore();
    this.drawArrow(ctx, W / 2, H * 0.62, 0, 9);
    // Nordpfeil rotiert
    const n = document.getElementById('radar-n');
    if (n) {
      const phi = player.heading - 1.5 * Math.PI;
      const cl = (v) => Math.max(7, Math.min(93, v));
      n.style.left = cl(50 + 44 * Math.cos(phi)) + '%';
      n.style.top = cl(62 + 44 * Math.sin(phi)) + '%';
      n.style.transform = 'translate(-50%,-50%)';
    }
  }
  /** Vollbildkarte mit Pan/Zoom. */
  drawBig(canvas, view, player) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = C.land; ctx.fillRect(0, 0, W, H);
    const z = view.zoom * dpr;
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z / this.scale, z / this.scale);
    const [cx, cy] = this.toPx(view.x, view.z);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.canvas, -cx, -cy);
    ctx.restore();
    const toScreen = (x, zz) => [W / 2 + (x - view.x) * z, H / 2 + (zz - view.z) * z];
    this.drawCars(ctx, toScreen, Math.max(2, 1.6 * z));
    const [ax, ay] = toScreen(player.x, player.z);
    this.drawArrow(ctx, ax, ay, Math.PI - player.heading, 10 * dpr);
  }
}
