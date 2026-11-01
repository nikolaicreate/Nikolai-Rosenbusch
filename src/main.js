// Berlin Drive – Einstiegspunkt: Renderer, Spielschleife, Kamera, HUD, Steuerung.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadMapData, ROAD_TYPES, LANDMARKS } from './geo.js';
import { buildWorld } from './world.js';
import { Traffic } from './traffic.js';
import { WeatherService, Environment, berlinHour } from './weather.js';
import { Player, CarAudio } from './player.js';
import { MapRenderer, flowColor } from './minimap.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- Einstellungen
const store = {
  get(k, d) { try { const v = localStorage.getItem('bd.' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bd.' + k, v); } catch { /* privat */ } },
};
const settings = {
  weather: params.get('weather') || store.get('weather', 'live'),
  time: params.get('time') || store.get('time', 'live'),
  quality: params.get('quality') || store.get('quality', 'high'),
  color: store.get('color', '0xff5a1f'),
  tomtom: store.get('tomtom', ''),
};

// ---------------------------------------------------------------- Renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 8000);

const QUALITY = {
  ultra: { pr: Math.min(devicePixelRatio, 2), shadow: 4096, bloom: true, samples: 4 },
  high: { pr: Math.min(devicePixelRatio, 1.5), shadow: 2048, bloom: true, samples: 4 },
  medium: { pr: 1, shadow: 1024, bloom: true, samples: 2 },
  low: { pr: Math.min(devicePixelRatio, 1) * 0.75, shadow: 0, bloom: false, samples: 0 },
};
let composer, bloom;
function setupComposer() {
  const q = QUALITY[settings.quality] || QUALITY.high;
  renderer.setPixelRatio(q.pr);
  renderer.setSize(innerWidth, innerHeight);
  const rt = new THREE.WebGLRenderTarget(innerWidth * q.pr, innerHeight * q.pr, { type: THREE.HalfFloatType, samples: q.samples });
  composer?.dispose();
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(q.pr);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.55, 0.9);
  bloom.enabled = q.bloom;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  renderer.shadowMap.enabled = q.shadow > 0;
  if (env) { env.sun.castShadow = q.shadow > 0; if (q.shadow) env.setShadowQuality(q.shadow); }
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer?.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- Laden
let env, world, traffic, player, map, data;
const weather = new WeatherService();
weather.override = settings.weather;
const audio = new CarAudio();
const loadStep = (pct, text) => { $('load-fill').style.width = pct + '%'; if (text) $('load-text').textContent = text; };

async function init() {
  loadStep(5, 'Initialisiere Grafik …');
  env = new Environment(scene, renderer);
  setupComposer();
  const weatherP = weather.fetchLive();
  loadStep(12);
  data = await loadMapData((t) => loadStep(25, t));
  loadStep(55, `Baue ${data.buildings.length.toLocaleString('de-DE')} Gebäude und ${data.roads.length.toLocaleString('de-DE')} Straßen …`);
  await new Promise((r) => setTimeout(r, 30));
  world = buildWorld(scene, data, renderer);
  loadStep(75, 'Setze Verkehr auf die Straßen …');
  await new Promise((r) => setTimeout(r, 30));
  traffic = new Traffic(scene, data.roads, settings.quality === 'low' ? 90 : 170);
  traffic.live.key = settings.tomtom;
  player = new Player(scene, Number(settings.color));
  resetPlayer(true);
  await weatherP;
  loadStep(85, 'Hole Live-Verkehrslage …');
  await traffic.live.refresh(weather.state.kind);
  traffic.density = 0.3 + traffic.live.level * 0.7;
  map = new MapRenderer(data, traffic);
  loadStep(95, 'Fast fertig …');
  // Vorab einige Frames simulieren, damit der Verkehr verteilt ist
  for (let i = 0; i < 30; i++) traffic.update(0.1, player);
  updateEnvironment(0.016);
  composer.render();
  loadStep(100, data.source === 'osm' ? `Echte Kartendaten geladen: ${data.buildings.length.toLocaleString('de-DE')} Gebäude aus OpenStreetMap.` : 'Modell-Stadt aktiv (OpenStreetMap war nicht erreichbar).');
  $('start-btn').classList.remove('hidden');
  if (params.has('autostart')) start();
}

function start() {
  $('loading').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (matchMedia('(pointer: coarse)').matches) $('touch').classList.remove('hidden');
  audio.start();
  running = true;
  showBanner(currentStreet || 'Berlin', data.source === 'osm' ? 'Mitte · OpenStreetMap' : 'Mitte · Modell');
}
$('start-btn').addEventListener('click', start);

function resetPlayer(initial = false) {
  let spot = null;
  if (initial) {
    // Start auf „Unter den Linden“, östlich vom Brandenburger Tor
    const [tx, tz] = LANDMARKS.tor;
    spot = world.roadIndex.nearest(tx + 140, tz, 120, (r) => /Unter den Linden/.test(r.name) && ROAD_TYPES[r.type].drive) || world.roadIndex.nearest(tx + 140, tz, 400, (r) => ROAD_TYPES[r.type].major);
  } else spot = world.roadIndex.nearest(player.x, player.z, 300, (r) => ROAD_TYPES[r.type].drive);
  if (!spot) spot = { x: 0, z: 0, dirX: 1, dirZ: 0, road: { width: 10 } };
  let dx = spot.dirX, dz = spot.dirZ;
  const ow = spot.road.oneway || 0;
  if (ow) { if (ow < 0) { dx = -dx; dz = -dz; } }
  else if (initial && dx < 0) { dx = -dx; dz = -dz; }
  else if (!initial && dx * Math.sin(player.heading) + dz * Math.cos(player.heading) < 0) { dx = -dx; dz = -dz; }
  const L = Math.hypot(dx, dz) || 1;
  const off = ow ? 0 : Math.min(4, (spot.road.width || 10) / 4);
  player.place(spot.x - (dz / L) * off, spot.z + (dx / L) * off, Math.atan2(dx, dz));
  camState.init = false;
}

// ---------------------------------------------------------------- Steuerung
const keys = new Set();
const touch = { left: false, right: false, gas: false, brake: false, hand: false };
let camMode = 0, mapOpen = false, menuOpen = false, running = false;
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyC') camMode = (camMode + 1) % 4;
  if (e.code === 'KeyM' && running) toggleMap();
  if (e.code === 'KeyR' && running) { resetPlayer(); toast('Zurück auf die Straße'); }
  if (e.code === 'KeyL') { player.autoLights = false; player.lightsOn = !player.lightsOn; toast(player.lightsOn ? 'Licht an' : 'Licht aus'); }
  if (e.code === 'KeyH') audio.horn(true);
  if ((e.code === 'Escape' || e.code === 'KeyP') && running) { if (mapOpen) toggleMap(); else toggleMenu(); }
  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'KeyH') audio.horn(false); });
addEventListener('blur', () => keys.clear());
document.querySelectorAll('#touch button').forEach((b) => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { touch[k] = true; e.preventDefault(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { touch[k] = false; });
});
function readInput() {
  const k = (c) => keys.has(c);
  const inp = {
    steer: (k('KeyA') || k('ArrowLeft') || touch.left ? 1 : 0) - (k('KeyD') || k('ArrowRight') || touch.right ? 1 : 0),
    throttle: k('KeyW') || k('ArrowUp') || touch.gas ? 1 : 0,
    brake: k('KeyS') || k('ArrowDown') || touch.brake ? 1 : 0,
    hand: k('Space') || touch.hand,
  };
  const gp = navigator.getGamepads?.()[0];
  if (gp) {
    const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.12) inp.steer = -ax;
    inp.throttle = Math.max(inp.throttle, gp.buttons[7]?.value || 0);
    inp.brake = Math.max(inp.brake, gp.buttons[6]?.value || 0);
    inp.hand = inp.hand || gp.buttons[0]?.pressed;
  }
  if (mapOpen || menuOpen) { inp.steer = 0; inp.throttle = 0; inp.brake = 0.3; }
  return inp;
}

// ---------------------------------------------------------------- Menü
const sel = { weather: $('opt-weather'), time: $('opt-time'), quality: $('opt-quality'), color: $('opt-color'), tomtom: $('opt-tomtom') };
for (const [k, el] of Object.entries(sel)) el.value = settings[k];
sel.weather.onchange = () => { settings.weather = sel.weather.value; weather.override = settings.weather; store.set('weather', settings.weather); };
sel.time.onchange = () => { settings.time = sel.time.value; store.set('time', settings.time); };
sel.quality.onchange = () => { settings.quality = sel.quality.value; store.set('quality', settings.quality); setupComposer(); };
sel.color.onchange = () => { settings.color = sel.color.value; store.set('color', settings.color); player.setPaint(Number(settings.color)); };
sel.tomtom.onchange = async () => {
  settings.tomtom = sel.tomtom.value.trim(); store.set('tomtom', settings.tomtom);
  traffic.live.key = settings.tomtom; await refreshTraffic(); toast(traffic.live.source === 'tomtom' ? 'Live-Verkehr von TomTom aktiv' : 'Verkehrsmodell aktiv');
};
$('menu-resume').onclick = () => toggleMenu(false);
$('menu-reset').onclick = () => { resetPlayer(); toggleMenu(false); };
function toggleMenu(force) { menuOpen = force ?? !menuOpen; $('menu').classList.toggle('hidden', !menuOpen); }

// ---------------------------------------------------------------- Karte
const mapView = { x: 0, z: 0, zoom: 0.6 };
function toggleMap() {
  mapOpen = !mapOpen;
  $('mapview').classList.toggle('hidden', !mapOpen);
  if (mapOpen) { mapView.x = player.x; mapView.z = player.z; mapView.zoom = 0.6; }
}
{
  const c = $('bigmap'); let drag = null;
  c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); });
  c.addEventListener('pointermove', (e) => { if (!drag) return; mapView.x -= (e.clientX - drag.x) / mapView.zoom; mapView.z -= (e.clientY - drag.y) / mapView.zoom; drag = { x: e.clientX, y: e.clientY }; });
  c.addEventListener('pointerup', () => { drag = null; });
  c.addEventListener('wheel', (e) => { e.preventDefault(); mapView.zoom = Math.max(0.15, Math.min(6, mapView.zoom * Math.exp(-e.deltaY * 0.0015))); }, { passive: false });
}

// ---------------------------------------------------------------- HUD
let currentStreet = '', streetCandidate = '', streetTimer = 0, bannerTimer = 0;
function showBanner(name, sub) {
  $('banner-name').textContent = name; $('banner-sub').textContent = sub;
  $('banner').classList.add('show'); bannerTimer = 4;
}
let toastTimer;
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200); }

function updateHUD(dt) {
  const kmh = Math.round(Math.abs(player.forwardSpeed) * 3.6);
  $('speed').textContent = kmh;
  $('gear').textContent = player.gear;
  $('rpm-fill').style.width = Math.min(100, (player.rpm / 8000) * 100) + '%';
  const d = gameDate();
  $('clock').textContent = d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
  $('date').textContent = 'Berlin · ' + d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: 'numeric', month: 'long' }) + (settings.time === 'live' ? '' : ' · Zeit manuell');
  const w = weather.state;
  $('w-icon').textContent = w.icon;
  $('w-temp').textContent = w.temp != null ? `${Math.round(w.temp)}°C` : '--';
  $('w-desc').textContent = `${w.desc}${w.wind != null ? ` · Wind ${Math.round(w.wind)} km/h` : ''}`;
  $('w-src').textContent = w.source; $('w-src').classList.toggle('live', w.isLive);
  const lvl = traffic.live.level;
  const label = lvl < 0.25 ? 'Freie Fahrt' : lvl < 0.5 ? 'Mäßiger Verkehr' : lvl < 0.75 ? 'Dichter Verkehr' : 'Stau in Mitte';
  $('t-text').textContent = label;
  $('t-dot').style.background = flowColor(1 - lvl * 0.85); $('t-dot').style.color = flowColor(1 - lvl * 0.85);
  const src = traffic.live.source === 'tomtom' ? `Live · TomTom · ${traffic.live.status}` : `Modell · ${traffic.live.status}`;
  $('t-src').textContent = src; $('t-src').classList.toggle('live', traffic.live.source === 'tomtom');

  // Straßenname
  const near = world.roadIndex.nearest(player.x, player.z, 22, (r) => !!r.name);
  const name = near?.road.name || '';
  if (name && name !== currentStreet) {
    if (name === streetCandidate) { streetTimer += dt; if (streetTimer > 0.8) { currentStreet = name; showBanner(name, 'Berlin-Mitte'); } }
    else { streetCandidate = name; streetTimer = 0; }
  }
  bannerTimer -= dt; if (bannerTimer <= 0) $('banner').classList.remove('show');
  $('map-place').textContent = (currentStreet ? currentStreet + ', ' : '') + '10117 Berlin';
}

// ---------------------------------------------------------------- Zeit & Umwelt
function gameDate() {
  const now = new Date();
  if (settings.time === 'live') return now;
  const target = parseFloat(settings.time);
  return new Date(now.getTime() - (berlinHour(now) - target) * 3600e3);
}
let envInfo = { night: 0, wet: 0, snow: 0 };
function updateEnvironment(dt) {
  const w = weather.state;
  envInfo = env.update(dt, gameDate(), w, camera, new THREE.Vector3(player.x, 0, player.z));
  world.applyEnvironment({ night: envInfo.night, wet: envInfo.wet, snow: envInfo.snow, t: performance.now() / 1000 });
  const needLights = envInfo.night > 0.35 || w.kind === 'fog' || (envInfo.overcast > 0.8 && envInfo.day < 0.6) || envInfo.intensity > 0.6;
  if (player.autoLights) player.lightsOn = needLights;
  player.setLights(player.lightsOn, envInfo.night, player.braking);
  traffic.setNight(Math.max(envInfo.night, needLights ? 0.5 : 0));
  player.grip = 1 - envInfo.wet * 0.18 - envInfo.snow * 0.45;
  if (bloom) bloom.strength = 0.25 + envInfo.night * 0.55 + envInfo.wet * 0.1;
}
env && (env.onThunder = () => audio.thunder());

async function refreshTraffic() {
  await traffic.live.refresh(weather.state.kind);
  traffic.density = 0.3 + traffic.live.level * 0.7;
  map?.render();
}
setInterval(() => { if (traffic) refreshTraffic(); }, 120000);
setInterval(() => weather.fetchLive(), 600000);

// ---------------------------------------------------------------- Kamera
const camState = { init: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), shake: 0, orbit: 0 };
function updateCamera(dt) {
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  const sp = player.speed;
  const p = new THREE.Vector3(player.x, 0, player.z);
  let want, look, k = 1 - Math.exp(-dt * 6);
  // Blickrichtung leicht der Bewegungsrichtung nachführen
  const vdir = sp > 3 ? new THREE.Vector3(player.vx / sp, 0, player.vz / sp) : new THREE.Vector3(fx, 0, fz);
  const dir = new THREE.Vector3(fx, 0, fz).lerp(vdir, 0.35).normalize();
  if (camMode === 0 || camMode === 1) {
    const dist = (camMode === 0 ? 7.4 : 12) + sp * 0.04, hgt = (camMode === 0 ? 2.9 : 4.8) + sp * 0.01;
    want = p.clone().addScaledVector(dir, -dist); want.y = hgt;
    look = p.clone().addScaledVector(dir, 5); look.y = 1.1;
  } else if (camMode === 2) {
    want = p.clone().addScaledVector(new THREE.Vector3(fx, 0, fz), -0.25); want.y = 1.08;
    look = p.clone().addScaledVector(new THREE.Vector3(fx, 0, fz), 20); look.y = 0.95;
    k = 1;
  } else {
    camState.orbit += dt * 0.25;
    want = p.clone().add(new THREE.Vector3(Math.sin(camState.orbit) * 11, 2.2 + Math.sin(camState.orbit * 0.7) * 1.2, Math.cos(camState.orbit) * 11));
    look = p.clone(); look.y = 0.9;
    k = 1 - Math.exp(-dt * 3);
  }
  if (!camState.init) { camState.pos.copy(want); camState.look.copy(look); camState.init = true; }
  camState.pos.lerp(want, k); camState.look.lerp(look, Math.min(1, k * 1.5));
  // Kamera nicht in Gebäude schieben
  if (camMode !== 2) {
    const r = world.colliders.resolveCircle(camState.pos.x, camState.pos.z, 0.6);
    if (r.hit) { camState.pos.x = r.x; camState.pos.z = r.z; }
  }
  camState.shake = Math.max(camState.shake * Math.exp(-dt * 5), player.impact);
  camera.position.copy(camState.pos);
  camera.position.x += (Math.random() - 0.5) * camState.shake * 0.5;
  camera.position.y += (Math.random() - 0.5) * camState.shake * 0.5;
  camera.lookAt(camState.look);
  const fov = (camMode === 2 ? 70 : 60) + Math.min(16, sp * 0.22);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------- Schleife
const clock = new THREE.Clock();
let hudTimer = 0, mapTimer = 0, lastImpact = 0;
function loop() {
  requestAnimationFrame(loop);
  if (!world) return;
  const dt = Math.min(0.05, clock.getDelta());
  const input = readInput();
  if (!menuOpen) {
    player.update(dt, input, world, traffic);
    traffic.update(dt, player);
  }
  if (player.impact > lastImpact + 0.1) audio.crash(player.impact);
  lastImpact = player.impact;
  updateEnvironment(dt);
  updateCamera(dt);
  audio.update(player, envInfo.intensity || 0, input);
  hudTimer -= dt;
  if (hudTimer <= 0 && running) { hudTimer = 0.1; updateHUD(0.1); }
  mapTimer -= dt;
  if (mapTimer <= 0) { mapTimer = 1 / 20; map?.drawRadar($('minimap'), player); }
  if (mapOpen) map.drawBig($('bigmap'), mapView, player);
  if (!mapOpen) composer.render();
}

init().then(() => { env.onThunder = () => audio.thunder(); loop(); }).catch((e) => {
  console.error(e);
  loadStep(100, 'Fehler beim Start: ' + e.message);
});

// Debug-/Testzugriff
window.__bd = { get player() { return player; }, get traffic() { return traffic; }, get world() { return world; }, get data() { return data; }, settings, weather, camera, setCam: (m) => (camMode = m), start };
