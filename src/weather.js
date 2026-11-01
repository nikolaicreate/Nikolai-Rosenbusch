// Live-Wetter (Open-Meteo) + Tageszeit (echter Sonnenstand über Berlin) + visuelle Effekte.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { mulberry32 } from './geo.js';

const LAT = 52.52, LON = 13.405;

const WMO = {
  0: ['Klar', '☀️', 'clear'], 1: ['Überwiegend klar', '🌤️', 'clear'], 2: ['Teilweise bewölkt', '⛅', 'cloudy'], 3: ['Bedeckt', '☁️', 'cloudy'],
  45: ['Nebel', '🌫️', 'fog'], 48: ['Reifnebel', '🌫️', 'fog'],
  51: ['Leichter Nieselregen', '🌦️', 'drizzle'], 53: ['Nieselregen', '🌦️', 'drizzle'], 55: ['Starker Nieselregen', '🌧️', 'drizzle'],
  56: ['Gefrierender Niesel', '🌧️', 'drizzle'], 57: ['Gefrierender Niesel', '🌧️', 'drizzle'],
  61: ['Leichter Regen', '🌧️', 'rain'], 63: ['Regen', '🌧️', 'rain'], 65: ['Starkregen', '🌧️', 'rain'], 66: ['Eisregen', '🌧️', 'rain'], 67: ['Starker Eisregen', '🌧️', 'rain'],
  71: ['Leichter Schneefall', '🌨️', 'snow'], 73: ['Schneefall', '🌨️', 'snow'], 75: ['Starker Schneefall', '❄️', 'snow'], 77: ['Schneegriesel', '🌨️', 'snow'],
  80: ['Regenschauer', '🌦️', 'rain'], 81: ['Regenschauer', '🌧️', 'rain'], 82: ['Heftige Schauer', '⛈️', 'rain'],
  85: ['Schneeschauer', '🌨️', 'snow'], 86: ['Starke Schneeschauer', '❄️', 'snow'],
  95: ['Gewitter', '⛈️', 'storm'], 96: ['Gewitter mit Hagel', '⛈️', 'storm'], 99: ['Schweres Gewitter', '⛈️', 'storm'],
};
const PRESETS = {
  clear: { code: 0, cloud: 5, precip: 0 }, cloudy: { code: 3, cloud: 90, precip: 0 }, rain: { code: 63, cloud: 100, precip: 3 },
  storm: { code: 95, cloud: 100, precip: 6 }, snow: { code: 73, cloud: 100, precip: 1.5 }, fog: { code: 45, cloud: 80, precip: 0 },
};

export class WeatherService {
  constructor() {
    this.live = null;
    this.override = 'live';
    this.error = null;
  }
  async fetchLive() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,rain,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m&timezone=Europe%2FBerlin`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const c = j.current;
      this.live = { code: c.weather_code, temp: c.temperature_2m, feels: c.apparent_temperature, hum: c.relative_humidity_2m, cloud: c.cloud_cover, precip: c.precipitation, wind: c.wind_speed_10m, windDir: c.wind_direction_10m, time: c.time };
      this.error = null;
    } catch (e) {
      console.warn('[Open-Meteo]', e);
      this.error = e.message;
    }
  }
  get state() {
    let base;
    let src;
    if (this.override !== 'live') { base = { ...(this.live || { temp: 12, wind: 12, windDir: 250 }), ...PRESETS[this.override] }; src = 'Manuell'; }
    else if (this.live) { base = this.live; src = 'Live · Open-Meteo'; }
    else { base = { temp: 12, wind: 10, windDir: 250, ...PRESETS.cloudy }; src = this.error ? 'Offline – Annahme' : 'lädt …'; }
    const w = WMO[base.code] || ['Unbekannt', '❔', 'cloudy'];
    if (base.temp != null && base.temp <= 0.5 && w[2] === 'rain') w[2] = 'snow';
    return { ...base, desc: w[0], icon: w[1], kind: w[2], source: src, isLive: this.override === 'live' && !!this.live };
  }
}

// ---------------------------------------------------------------- Sonnenstand
export function sunPosition(date, lat = LAT, lon = LON) {
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;
  const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const e = rad * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const th = rad * (280.16 + 360.9856235 * d) + rad * lon;
  const H = th - ra, phi = rad * lat;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)); // von Süden, westwärts positiv
  return { alt, az };
}
export function berlinHour(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(date).map((x) => [x.type, x.value]));
  return (parseInt(p.hour, 10) % 24) + parseInt(p.minute, 10) / 60 + parseInt(p.second, 10) / 3600;
}

// ---------------------------------------------------------------- Effekte
function cloudTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(77);
  const grid = (n) => { const g = []; for (let i = 0; i < n * n; i++) g.push(rnd()); return g; };
  const octaves = [[4, 0.5], [8, 0.25], [16, 0.13], [32, 0.07], [64, 0.05]].map(([n, a]) => ({ n, a, g: grid(n) }));
  const img = ctx.createImageData(S, S);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    for (const o of octaves) {
      const fx = (x / S) * o.n, fy = (y / S) * o.n; const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = smooth(fx - ix), ty = smooth(fy - iy);
      const g = (a, b) => o.g[((b % o.n) * o.n + (a % o.n))];
      const v0 = g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx, v1 = g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx;
      v += (v0 * (1 - ty) + v1 * ty) * o.a;
    }
    const a = Math.max(0, Math.min(1, (v - 0.42) * 2.6));
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d'); const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.sky = new Sky(); this.sky.scale.setScalar(9000); scene.add(this.sky);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4300, 32, 16), new THREE.MeshBasicMaterial({ color: 0x8a9096, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.dome.renderOrder = -1; scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.near = 10; sc.far = 1200;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4036, 0.8); scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xb9c6d2, 0.0004);

    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, opacity: 0.5 }));
    this.clouds.material.map.repeat.set(6, 6);
    this.clouds.rotation.x = Math.PI / 2; this.clouds.position.y = 900; scene.add(this.clouds);

    // Sterne
    const sp = []; const rnd = mulberry32(5);
    for (let i = 0; i < 2500; i++) { const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 4000; const s = Math.sqrt(1 - u * u); if (u < 0.05) continue; sp.push(Math.cos(th) * s * r, u * r, Math.sin(th) * s * r); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);

    // Regen (Linien) & Schnee (Punkte) im Volumen um die Kamera
    this.RAIN = 7000; this.SNOW = 7000; this.box = 90;
    const rp = new Float32Array(this.RAIN * 6); this.rainSeed = new Float32Array(this.RAIN * 3);
    for (let i = 0; i < this.RAIN; i++) { this.rainSeed[i * 3] = rnd() * this.box * 2 - this.box; this.rainSeed[i * 3 + 1] = rnd() * 60; this.rainSeed[i * 3 + 2] = rnd() * this.box * 2 - this.box; }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab4c4, transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; scene.add(this.rain);
    const snp = new Float32Array(this.SNOW * 3); this.snowSeed = new Float32Array(this.SNOW * 4);
    for (let i = 0; i < this.SNOW; i++) { this.snowSeed[i * 4] = rnd() * this.box * 2 - this.box; this.snowSeed[i * 4 + 1] = rnd() * 50; this.snowSeed[i * 4 + 2] = rnd() * this.box * 2 - this.box; this.snowSeed[i * 4 + 3] = rnd() * 6.28; }
    const sng = new THREE.BufferGeometry(); sng.setAttribute('position', new THREE.BufferAttribute(snp, 3));
    this.snow = new THREE.Points(sng, new THREE.PointsMaterial({ size: 0.22, map: dotTexture(), transparent: true, depthWrite: false, color: 0xffffff }));
    this.snow.frustumCulled = false; this.snow.visible = false; scene.add(this.snow);

    // Linsenreflexe der Sonne
    const flareTex = (inner, outer, ring = false) => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      if (ring) { g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.75, 'rgba(255,255,255,0)'); g.addColorStop(0.85, inner); g.addColorStop(1, 'rgba(255,255,255,0)'); }
      else { g.addColorStop(0, inner); g.addColorStop(0.3, outer); g.addColorStop(1, 'rgba(0,0,0,0)'); }
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    };
    this.flareAnchor = new THREE.Object3D(); scene.add(this.flareAnchor);
    this.flare = new Lensflare();
    this.flare.addElement(new LensflareElement(flareTex('rgba(255,250,235,1)', 'rgba(255,200,140,0.35)'), 420, 0, new THREE.Color(1, 0.95, 0.85)));
    this.flare.addElement(new LensflareElement(flareTex('rgba(255,180,120,0.5)', 'rgba(255,120,60,0.1)'), 70, 0.35));
    this.flare.addElement(new LensflareElement(flareTex('rgba(140,200,255,0.45)', 'rgba(60,120,255,0.08)'), 110, 0.6));
    this.flare.addElement(new LensflareElement(flareTex('rgba(255,220,160,0.35)', '', true), 200, 0.85));
    this.flare.addElement(new LensflareElement(flareTex('rgba(200,255,200,0.3)', 'rgba(60,255,120,0.05)'), 60, 1.0));
    this.flareAnchor.add(this.flare);
    this.flareEnabled = true;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envTimer = 0; this.lastEnvKey = '';
    this.flash = 0; this.nextFlash = 8;
    this.wet = 0; this.snowCover = 0;
    this.t = 0;
    this.onThunder = null;
    this.sunDir = new THREE.Vector3();
    this.info = {};
  }
  setShadowRange(r) { const sc = this.sun.shadow.camera; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.updateProjectionMatrix(); }
  setShadowQuality(size) {
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }
  update(dt, date, weather, camera, target) {
    this.t += dt;
    const { alt, az } = sunPosition(date);
    const kind = weather.kind;
    const cloud = (weather.cloud ?? 50) / 100;
    const raining = ['rain', 'drizzle', 'storm'].includes(kind);
    const snowing = kind === 'snow';
    const intensity = raining ? (kind === 'drizzle' ? 0.35 : kind === 'storm' ? 1 : 0.7) : snowing ? 0.8 : 0;

    const dir = this.sunDir.set(-Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt)).normalize();
    const day = THREE.MathUtils.smoothstep(alt, -0.1, 0.12);
    const night = 1 - THREE.MathUtils.smoothstep(alt, -0.18, -0.02);
    const golden = THREE.MathUtils.smoothstep(alt, -0.05, 0.05) * (1 - THREE.MathUtils.smoothstep(alt, 0.08, 0.35));
    const overcast = Math.max(0, Math.min(1, (cloud - 0.55) / 0.45)) * 0.75 + (raining || snowing ? 0.25 : 0) + (kind === 'fog' ? 0.3 : 0);

    // Himmel
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.5 + overcast * 14;
    u.rayleigh.value = 1.2 + golden * 1.8 - overcast * 0.8;
    u.mieCoefficient.value = 0.004 + overcast * 0.01;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(dir);

    this.dome.material.opacity = Math.min(0.92, overcast * 0.95);
    const domeCol = new THREE.Color(0x8d939a).multiplyScalar(0.25 + day * 0.8);
    this.dome.material.color.copy(domeCol);

    // Licht
    const lit = 1 - overcast * 0.7;
    const sunCol = new THREE.Color(0xfff1df).lerp(new THREE.Color(0xff9a4d), golden * 0.85);
    if (day > 0.02) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 3.4 * day * lit;
      this.sun.position.copy(target).addScaledVector(dir, 600);
    } else {
      // Mondlicht
      this.sun.color.set(0x8ea6ff);
      this.sun.intensity = 0.25 * (1 - overcast * 0.6);
      this.sun.position.copy(target).add(new THREE.Vector3(-200, 500, 260));
    }
    this.sun.target.position.copy(target);
    this.hemi.intensity = 0.15 + day * (0.55 + overcast * 0.35) + this.flash * 4;
    this.hemi.color.set(0xbcd4ff).lerp(new THREE.Color(0xc8ccd2), overcast).multiplyScalar(night > 0.5 ? 0.35 : 1);

    // Nebel
    let fogD = 0.00028 + overcast * 0.00035 + intensity * 0.0011;
    if (kind === 'fog') fogD = 0.0042;
    const fogCol = new THREE.Color(0xb7c4d1).lerp(new THREE.Color(0xe8b48a), golden * 0.55).lerp(new THREE.Color(0x9aa1a8), overcast);
    fogCol.multiplyScalar(0.06 + 0.94 * Math.max(day, 0.04));
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = fogD;

    // Wolken
    this.clouds.material.opacity = Math.min(0.95, cloud * 0.9 + overcast * 0.2);
    this.clouds.material.color.copy(new THREE.Color(0xffffff).lerp(new THREE.Color(0xffc49a), golden * 0.6).multiplyScalar(0.12 + day * 0.88 * (1 - overcast * 0.45)));
    const wind = (weather.wind ?? 10) / 3.6, wdir = ((weather.windDir ?? 250) * Math.PI) / 180;
    this.clouds.material.map.offset.x += Math.sin(wdir) * wind * dt * 0.00003;
    this.clouds.material.map.offset.y += Math.cos(wdir) * wind * dt * 0.00003;
    this.clouds.position.x = camera.position.x; this.clouds.position.z = camera.position.z;

    this.stars.material.opacity = night * (1 - overcast);
    this.flareAnchor.position.copy(camera.position).addScaledVector(dir, 3000);
    this.flare.visible = this.flareEnabled && alt > -0.01 && overcast < 0.55 && kind !== 'fog';
    this.stars.position.copy(camera.position);

    // Niederschlag
    this.rain.visible = raining; this.snow.visible = snowing;
    const cam = camera.position;
    const B = this.box, B2 = B * 2;
    const wrap = (v) => ((v % B2) + B2) % B2 - B;
    if (raining) {
      const pos = this.rain.geometry.attributes.position.array; const n = Math.floor(this.RAIN * intensity);
      const sx = -Math.sin(wdir) * wind * 0.25, sz = -Math.cos(wdir) * wind * 0.25;
      for (let i = 0; i < this.RAIN; i++) {
        const s = this.rainSeed;
        if (i >= n) { pos.fill(0, i * 6, i * 6 + 6); continue; }
        s[i * 3 + 1] -= dt * 26; if (s[i * 3 + 1] < 0) s[i * 3 + 1] += 60;
        const x = wrap(s[i * 3] - cam.x), z = wrap(s[i * 3 + 2] - cam.z);
        const y = s[i * 3 + 1] + cam.y - 20;
        pos[i * 6] = cam.x + x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = cam.z + z;
        pos[i * 6 + 3] = cam.x + x + sx * 0.04; pos[i * 6 + 4] = y + 0.9; pos[i * 6 + 5] = cam.z + z + sz * 0.04;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.color.setScalar(0.25 + day * 0.5);
    }
    if (snowing) {
      const pos = this.snow.geometry.attributes.position.array; const s = this.snowSeed;
      for (let i = 0; i < this.SNOW; i++) {
        s[i * 4 + 1] -= dt * 1.6; if (s[i * 4 + 1] < 0) s[i * 4 + 1] += 50;
        const sway = Math.sin(this.t * 0.8 + s[i * 4 + 3]) * 0.8;
        const x = wrap(s[i * 4] + sway - cam.x), z = wrap(s[i * 4 + 2] - cam.z);
        pos[i * 3] = cam.x + x; pos[i * 3 + 1] = s[i * 4 + 1] + cam.y - 15; pos[i * 3 + 2] = cam.z + z;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }

    // Nässe / Schneedecke träge nachführen
    const wetTarget = raining ? 1 : snowing ? 0.4 : (weather.precip > 0 ? 0.6 : 0);
    this.wet += (wetTarget - this.wet) * Math.min(1, dt * 0.15);
    const snowTarget = snowing || (weather.temp != null && weather.temp < 0.5 && weather.kind === 'snow') ? 1 : 0;
    this.snowCover += (snowTarget - this.snowCover) * Math.min(1, dt * 0.05);

    // Gewitter
    this.flash = Math.max(0, this.flash - dt * 6);
    if (kind === 'storm') {
      this.nextFlash -= dt;
      if (this.nextFlash < 0) {
        this.flash = 1; this.nextFlash = 5 + Math.random() * 14;
        const delay = 0.6 + Math.random() * 2.5; setTimeout(() => this.onThunder?.(), delay * 1000);
      }
      if (this.flash > 0) this.dome.material.color.setScalar(0.4 + this.flash * 2);
    }

    // Belichtung
    this.renderer.toneMappingExposure = 0.55 + day * 0.0 + night * 0.25 + this.flash * 0.6;

    // Umgebungs-Reflexionen aktualisieren
    this.envTimer -= dt;
    const key = `${Math.round(alt * 40)}|${Math.round(overcast * 10)}`;
    if (this.envTimer <= 0 && key !== this.lastEnvKey) {
      this.envTimer = 3; this.lastEnvKey = key;
      this.updateEnvMap();
    }

    this.info = { alt, day, night, golden, overcast, wet: this.wet, snow: this.snowCover, intensity };
    return this.info;
  }
  updateEnvMap() {
    const parentSky = this.sky.parent, parentDome = this.dome.parent;
    this.envScene.add(this.sky); this.envScene.add(this.dome);
    const prevFog = this.scene.fog;
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 10000);
    parentSky.add(this.sky); parentDome.add(this.dome);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.fog = prevFog;
  }
}
