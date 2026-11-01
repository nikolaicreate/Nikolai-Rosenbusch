// Berlin Drive – Einstiegspunkt: Renderer, Spielschleife, Kamera, HUD, Steuerung.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ROAD_TYPES, LANDMARKS, TILE, tileOf, tileId, tileBounds, tileInBerlin, loadTileOSM, districtAt } from './geo.js';
import { makeFallbackTile } from './fallback.js';
import { createWorld } from './world.js';
import { Traffic } from './traffic.js';
import { WeatherService, Environment, berlinHour } from './weather.js';
import { Player, CarAudio } from './player.js';
import { MapRenderer, flowColor } from './minimap.js';
import { RailNetwork } from './rail.js';
import { People } from './people.js';
import { Walker } from './walker.js';
import { buildCarGeometry, makeCarMaterials } from './cars.js';

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
  quality: params.get('quality') || store.get('quality', !matchMedia('(pointer: coarse)').matches && (navigator.hardwareConcurrency || 4) >= 8 ? 'max' : 'high'),
  color: store.get('color', '0xf05a1a'),
  model: params.get('car') || store.get('model', 'city'),
  tomtom: store.get('tomtom', ''),
};

// ---------------------------------------------------------------- Renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 8000);

const QUALITY = {
  // Maximum: Supersampling auch auf normalen Bildschirmen, 4K-Schatten auf engem Bereich (schärfer), Tiefenschärfe, Linsenreflexe
  max: { pr: Math.min(2, Math.max(1.5, devicePixelRatio)), shadow: 4096, range: 110, bloom: true, samples: 4, ao: true, aoSamples: 16, people: 600, cars: 230, grade: true, dof: true, flare: true },
  ultra: { pr: Math.min(devicePixelRatio, 2), shadow: 4096, range: 160, bloom: true, samples: 4, ao: true, aoSamples: 12, people: 480, cars: 200, grade: true, dof: true, flare: true },
  high: { pr: Math.min(devicePixelRatio, 1.5), shadow: 2048, range: 160, bloom: true, samples: 4, ao: true, aoSamples: 10, people: 340, cars: 170, grade: true, dof: false, flare: true },
  medium: { pr: 1, shadow: 1024, range: 160, bloom: true, samples: 2, ao: false, people: 220, cars: 140, grade: true, dof: false, flare: false },
  low: { pr: Math.min(devicePixelRatio, 1) * 0.75, shadow: 0, range: 160, bloom: false, samples: 0, ao: false, people: 100, cars: 90, grade: false, dof: false, flare: false },
};
// Farbkorrektur: leichte S-Kurve, Sättigung, Vignette, chromatische Aberration am Rand, Filmkorn
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, sat: { value: 1.08 }, vignette: { value: 0.32 }, grain: { value: 0.035 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, sat, vignette, grain; varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5; float r = dot(d, d);
      float ca = 0.006 * r;
      vec3 c = vec3(texture2D(tDiffuse, vUv + d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * ca).b);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      c *= 1.0 - vignette * r * 1.8;
      float n = fract(sin(dot(vUv * vec2(12.9898, 78.233) + time, vec2(1.0))) * 43758.5453);
      c += (n - 0.5) * grain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};
let composer, bloom, grade, dof;
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
  if (q.ao) {
    try {
      const ao = new GTAOPass(scene, camera, innerWidth * q.pr, innerHeight * q.pr);
      ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1.1, samples: q.aoSamples || 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 0.85;
      composer.addPass(ao);
    } catch (e) { console.warn('GTAO nicht verfügbar', e); }
  }
  dof = null;
  if (q.dof) {
    try { dof = new BokehPass(scene, camera, { focus: 12, aperture: 0.0016, maxblur: 0.008 }); dof.enabled = false; composer.addPass(dof); } catch (e) { dof = null; }
  }
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.55, 0.9);
  bloom.enabled = q.bloom;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader);
  grade.enabled = q.grade;
  composer.addPass(grade);
  renderer.shadowMap.enabled = q.shadow > 0;
  if (env) { env.sun.castShadow = q.shadow > 0; if (q.shadow) env.setShadowQuality(q.shadow); env.setShadowRange(q.range); env.flareEnabled = q.flare; }
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer?.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- Laden
let env, world, traffic, player, map, data, rail, people, walker;
let mode = 'car'; // 'car' | 'foot' | 'rail'
const railActor = { x: 0, z: 0, y: 0, heading: 0, speed: 0, forwardSpeed: 0, vx: 0, vz: 0, impact: 0, rpm: 0, gear: 'D' };
const actor = () => (mode === 'foot' ? walker : mode === 'rail' ? railActor : player);
const weather = new WeatherService();
weather.override = settings.weather;
const audio = new CarAudio();
const loadStep = (pct, text) => { $('load-fill').style.width = pct + '%'; if (text) $('load-text').textContent = text; };

// ---------------------------------------------------------------- Kacheln (ganz Berlin)
const tileState = new Map();
let mapMode = null, loadingCount = 0, aggDirty = false, aggTimer = 0;
data = { source: 'model', buildings: [], roads: [] };

async function fetchTile(i, j) {
  const id = tileId(i, j);
  const st = { i, j, status: 'loading' };
  tileState.set(id, st); loadingCount++;
  try {
    let d = null;
    if (mapMode !== 'model') {
      try { d = await loadTileOSM(i, j); mapMode = 'osm'; }
      catch (e) {
        console.warn('[Kachel]', id, e);
        if (mapMode === 'osm') { st.status = 'failed'; st.retry = performance.now() + 15000; return; }
        mapMode = 'model';
      }
    }
    if (!d) d = makeFallbackTile(i, j);
    if (tileState.get(id) !== st) return; // inzwischen wieder entladen
    world.addTile(id, d, tileBounds(i, j));
    rail.addTile(id, d.rails, world.colliders, world.roadIndex);
    st.data = d; st.status = 'built'; aggDirty = true;
  } catch (e) {
    console.error('[Kachel]', id, e); st.status = 'failed'; st.retry = performance.now() + 15000;
  } finally { loadingCount--; }
}
function tilesAround(ci, cj, R) {
  const out = [];
  for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) out.push([ci + di, cj + dj, Math.max(Math.abs(di), Math.abs(dj)) + Math.hypot(di, dj) * 0.01]);
  return out.sort((a, b) => a[2] - b[2]);
}
function manageTiles() {
  const a = actor(); const [ci, cj] = tileOf(a.x, a.z);
  for (const [id, st] of tileState) {
    if (Math.max(Math.abs(st.i - ci), Math.abs(st.j - cj)) > 2) {
      if (st.status === 'built') { world.removeTile(id); rail.removeTile(id); aggDirty = true; }
      tileState.delete(id);
    }
  }
  const maxConc = mapMode === 'model' ? 1 : 2;
  for (const [i, j] of tilesAround(ci, cj, 1)) {
    if (loadingCount >= maxConc) break;
    if (!tileInBerlin(i, j)) continue;
    const st = tileState.get(tileId(i, j));
    if (st && !(st.status === 'failed' && performance.now() > st.retry)) continue;
    fetchTile(i, j);
  }
}
function rebuildAggregates() {
  const agg = { buildings: [], roads: [], water: [], parks: [], rails: [] };
  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const st of tileState.values()) {
    if (st.status !== 'built') continue;
    for (const k in agg) agg[k].push(...st.data[k]);
    const tb = tileBounds(st.i, st.j);
    b.minX = Math.min(b.minX, tb.minX); b.minZ = Math.min(b.minZ, tb.minZ); b.maxX = Math.max(b.maxX, tb.maxX); b.maxZ = Math.max(b.maxZ, tb.maxZ);
  }
  agg.source = mapMode || 'model';
  data = agg;
  traffic.setRoads(agg.roads);
  people.setRoads(agg.roads);
  rail.setRails(agg.rails);
  if (isFinite(b.minX)) map.setData(agg, b);
  aggDirty = false;
}

async function init() {
  loadStep(5, 'Initialisiere Grafik …');
  env = new Environment(scene, renderer);
  setupComposer();
  { const q = QUALITY[settings.quality] || QUALITY.high; env.setShadowRange(q.range); env.flareEnabled = q.flare; }
  const weatherP = weather.fetchLive();
  world = createWorld(scene, renderer);
  rail = new RailNetwork(scene);
  traffic = new Traffic(scene, [], (QUALITY[settings.quality] || QUALITY.high).cars);
  traffic.live.key = settings.tomtom;
  people = new People(scene, [], world.colliders, (QUALITY[settings.quality] || QUALITY.high).people);
  player = new Player(scene, Number(settings.color), settings.model);
  walker = new Walker(scene);
  map = new MapRenderer(traffic);

  // Start: Unter den Linden, östlich vom Brandenburger Tor
  const [tx, tz] = LANDMARKS.tor;
  const [si, sj] = tileOf(tx + 140, tz);
  loadStep(15, 'Lade echte Gebäude & Straßen von OpenStreetMap …');
  await fetchTile(si, sj);
  loadStep(45, mapMode === 'osm' ? 'Lade Nachbarviertel …' : 'OpenStreetMap nicht erreichbar – baue Berlin als Modell …');
  const around = tilesAround(si, sj, 1).filter(([i, j]) => !(i === si && j === sj) && tileInBerlin(i, j));
  if (mapMode === 'model') {
    let n = 0;
    for (const [i, j] of around) { await fetchTile(i, j); loadStep(45 + (++n / around.length) * 30); await new Promise((r) => setTimeout(r, 0)); }
  } else {
    // erste Nachbarn abwarten (max. 2 parallel), Rest lädt während der Fahrt
    const first = around.slice(0, 4);
    for (let k = 0; k < first.length; k += 2) { await Promise.all(first.slice(k, k + 2).map(([i, j]) => fetchTile(i, j))); loadStep(45 + (k + 2) * 7); }
  }
  rebuildAggregates();
  resetPlayer(true);
  await weatherP;
  loadStep(85, 'Hole Live-Verkehrslage …');
  await traffic.live.refresh(weather.state.kind);
  traffic.density = 0.3 + traffic.live.level * 0.7;
  map.render();
  loadStep(95, 'Fast fertig …');
  for (let i = 0; i < 30; i++) { traffic.update(0.1, player); rail.update(0.1, player); }
  updateEnvironment(0.016);
  composer.render();
  const nb = data.buildings.length.toLocaleString('de-DE');
  loadStep(100, mapMode === 'osm' ? `Echte Kartendaten: ${nb} Gebäude rund um den Start. Weitere Viertel laden beim Fahren.` : 'Modell-Berlin aktiv (OpenStreetMap war nicht erreichbar). Ganz Berlin wird beim Fahren erzeugt.');
  $('start-btn').classList.remove('hidden');
  if (params.has('autostart')) start();
}

function start() {
  $('loading').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (matchMedia('(pointer: coarse)').matches) $('touch').classList.remove('hidden');
  audio.start();
  running = true;
  showBanner(currentStreet || 'Berlin', districtAt(player.x, player.z) + (mapMode === 'osm' ? ' · OpenStreetMap' : ' · Modell'));
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
  if (e.code === 'KeyR' && running && mode === 'car') { resetPlayer(); toast('Zurück auf die Straße'); }
  if ((e.code === 'KeyF' || e.code === 'KeyE' || e.code === 'Enter') && running && !menuOpen && !mapOpen) enterExit();
  if (e.code === 'KeyL') { player.autoLights = false; player.lightsOn = !player.lightsOn; toast(player.lightsOn ? 'Licht an' : 'Licht aus'); }
  if (e.code === 'KeyH') audio.horn(true);
  if ((e.code === 'Escape' || e.code === 'KeyP') && running) { if (mapOpen) toggleMap(); else toggleMenu(); }
  if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'KeyH') audio.horn(false); });
addEventListener('blur', () => keys.clear());
document.querySelectorAll('#touch button').forEach((b) => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (k === 'enter') { if (running) enterExit(); return; } touch[k] = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { touch[k] = false; });
});
function readInput() {
  const k = (c) => keys.has(c);
  const inp = {
    steer: (k('KeyA') || k('ArrowLeft') || touch.left ? 1 : 0) - (k('KeyD') || k('ArrowRight') || touch.right ? 1 : 0),
    throttle: k('KeyW') || k('ArrowUp') || touch.gas ? 1 : 0,
    brake: k('KeyS') || k('ArrowDown') || touch.brake ? 1 : 0,
    hand: k('Space') || touch.hand,
    run: k('ShiftLeft') || k('ShiftRight'),
  };
  const gp = navigator.getGamepads?.()[0];
  if (gp) {
    const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.12) inp.steer = -ax;
    inp.throttle = Math.max(inp.throttle, gp.buttons[7]?.value || 0);
    inp.brake = Math.max(inp.brake, gp.buttons[6]?.value || 0);
    inp.hand = inp.hand || gp.buttons[0]?.pressed;
    inp.run = inp.run || gp.buttons[1]?.pressed;
    if (gp.buttons[3]?.pressed && !readInput.yWas && running) enterExit();
    readInput.yWas = gp.buttons[3]?.pressed;
  }
  if (mapOpen || menuOpen) { inp.steer = 0; inp.throttle = 0; inp.brake = 0.3; }
  return inp;
}

// ---------------------------------------------------------------- Aussteigen / Einsteigen
const parked = [];
const VEHICLE_NAMES = { city: 'City EV', vision: 'Vision', sport: 'Coupé', sedan: 'Limousine', hatch: 'Kompaktwagen', suv: 'SUV', van: 'Transporter', taxi: 'Taxi', bus: 'BVG-Bus', dd: 'Doppeldecker', tram: 'Straßenbahn', sbahn: 'S-Bahn' };
let carPaint = Number(settings.color);
function parkPlayerCar() {
  const g = buildCarGeometry(player.model), m = makeCarMaterials(carPaint);
  const grp = new THREE.Group();
  for (const part of ['body', 'glass', 'detail', 'lights']) { const mesh = new THREE.Mesh(g[part], m[part]); mesh.castShadow = part !== 'lights'; grp.add(mesh); }
  for (const w of g.wheels || []) { const mesh = new THREE.Mesh(w.geo, m.detail); mesh.position.set(...w.pos); grp.add(mesh); }
  grp.position.set(player.x, 0, player.z); grp.rotation.y = player.heading;
  scene.add(grp);
  const obstacle = { x: player.x, z: player.z, hx: Math.sin(player.heading), hz: Math.cos(player.heading), len: g.params.L };
  traffic.obstacles.push(obstacle);
  parked.push({ group: grp, type: player.model, paint: carPaint, x: player.x, z: player.z, heading: player.heading, obstacle, len: g.params.L, w: g.params.W });
  // nicht zu viele geparkte Autos sammeln
  if (parked.length > 6) removeParked(parked[0]);
}
function removeParked(p) {
  scene.remove(p.group); p.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  traffic.obstacles.splice(traffic.obstacles.indexOf(p.obstacle), 1);
  parked.splice(parked.indexOf(p), 1);
}
function nearestParked(x, z, maxD) {
  let best = null, bd = maxD;
  for (const p of parked) {
    const hx = Math.sin(p.heading), hz = Math.cos(p.heading);
    const t = Math.max(-p.len / 2, Math.min(p.len / 2, (x - p.x) * hx + (z - p.z) * hz));
    const d = Math.hypot(x - (p.x + hx * t), z - (p.z + hz * t)) - p.w / 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { p: best, d: bd } : null;
}
function findEnterable() {
  const x = walker.x, z = walker.z;
  const opts = [];
  const pk = nearestParked(x, z, 2.2); if (pk) opts.push({ kind: 'parked', d: pk.d, target: pk.p, name: VEHICLE_NAMES[pk.p.type] });
  const c = traffic.nearestCar(x, z, 2.5);
  if (c) { const half = traffic.length[c.type] / 2; const t = Math.max(-half, Math.min(half, (x - c.x) * c.hx + (z - c.z) * c.hz)); opts.push({ kind: 'ai', d: Math.hypot(x - (c.x + c.hx * t), z - (c.z + c.hz * t)) - 1, target: c, name: VEHICLE_NAMES[c.type] }); }
  const v = rail.nearest(x, z, 2.5); if (v) opts.push({ kind: 'rail', d: 1.5, target: v, name: VEHICLE_NAMES[v.kind] });
  opts.sort((a, b) => a.d - b.d);
  return opts[0] || null;
}
function placeWalkerBeside(x, z, heading, side) {
  const rx = -Math.cos(heading), rz = Math.sin(heading); // rechte Seite = (-fz, fx)
  for (const s of [-1, 1]) {
    const px = x - rx * side * s, pz = z - rz * side * s;
    if (!world.colliders.inside(px, pz)) { walker.enable(px, pz, heading); return; }
  }
  walker.enable(x, z, heading);
}
function enterExit() {
  if (mode === 'car') {
    if (player.speed > 3) { toast('Erst anhalten, dann mit F aussteigen'); return; }
    parkPlayerCar();
    player.setVisible(false);
    placeWalkerBeside(player.x, player.z, player.heading, player.params.W / 2 + 0.7);
    mode = 'foot'; camState.init = false;
    toast('Zu Fuß · W/S gehen, A/D drehen, Shift rennen, F einsteigen');
    return;
  }
  if (mode === 'rail') {
    const v = rail.controlled;
    if (v.v > 2) { toast('Erst anhalten, dann mit F aussteigen'); return; }
    const m = v.meshes[0];
    rail.controlled = null;
    placeWalkerBeside(m.position.x, m.position.z, m.rotation.y, v.kind === 'sbahn' ? 7 : 2.6);
    const r = world.colliders.resolveCircle(walker.x, walker.z, 0.4); walker.x = r.x; walker.z = r.z;
    mode = 'foot'; camState.init = false;
    toast(v.kind === 'sbahn' ? 'Ausgestiegen – unten am Viadukt' : 'Ausgestiegen');
    return;
  }
  // zu Fuß -> einsteigen
  const t = findEnterable();
  if (!t) { toast('Kein Fahrzeug in der Nähe'); return; }
  if (t.kind === 'parked') {
    const p = t.target;
    player.setModel(p.type); carPaint = p.paint; player.setPaint(p.paint);
    player.place(p.x, p.z, p.heading); removeParked(p);
  } else if (t.kind === 'ai') {
    const info = traffic.takeCar(t.target);
    player.setModel(info.type); carPaint = info.color; player.setPaint(info.color);
    player.place(info.x, info.z, info.heading);
    toast(`Der Fahrer steigt aus und überlässt dir den ${t.name}.`);
  } else {
    rail.controlled = t.target; t.target.v = Math.min(t.target.v, 1);
    walker.disable(); mode = 'rail'; camState.init = false;
    toast(`Du fährst die ${t.name} · W fahren, S bremsen, F aussteigen`);
    return;
  }
  walker.disable(); player.setVisible(true); mode = 'car'; camState.init = false;
}

// ---------------------------------------------------------------- Menü
const sel = { weather: $('opt-weather'), time: $('opt-time'), quality: $('opt-quality'), model: $('opt-model'), color: $('opt-color'), tomtom: $('opt-tomtom') };
for (const [k, el] of Object.entries(sel)) el.value = settings[k];
sel.weather.onchange = () => { settings.weather = sel.weather.value; weather.override = settings.weather; store.set('weather', settings.weather); };
sel.time.onchange = () => { settings.time = sel.time.value; store.set('time', settings.time); };
sel.quality.onchange = () => { settings.quality = sel.quality.value; store.set('quality', settings.quality); setupComposer(); };
sel.model.onchange = () => { settings.model = sel.model.value; store.set('model', settings.model); player.setModel(settings.model); };
$('menu-reset').textContent = 'Zurück auf die Straße';
sel.color.onchange = () => { settings.color = sel.color.value; store.set('color', settings.color); carPaint = Number(settings.color); player.setPaint(carPaint); };
sel.tomtom.onchange = async () => {
  settings.tomtom = sel.tomtom.value.trim(); store.set('tomtom', settings.tomtom);
  traffic.live.key = settings.tomtom; await refreshTraffic(); toast(traffic.live.source === 'tomtom' ? 'Live-Verkehr von TomTom aktiv' : 'Verkehrsmodell aktiv');
};
$('menu-resume').onclick = () => toggleMenu(false);
$('menu-reset').onclick = () => { if (mode === 'rail') { rail.controlled = null; } if (mode !== 'car') { walker.disable(); player.setVisible(true); mode = 'car'; } resetPlayer(); toggleMenu(false); };
function toggleMenu(force) { menuOpen = force ?? !menuOpen; $('menu').classList.toggle('hidden', !menuOpen); }

// ---------------------------------------------------------------- Karte
const mapView = { x: 0, z: 0, zoom: 0.6 };
function toggleMap() {
  mapOpen = !mapOpen;
  $('mapview').classList.toggle('hidden', !mapOpen);
  if (mapOpen) { const a = actor(); mapView.x = a.x; mapView.z = a.z; mapView.zoom = 0.6; }
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

let currentDistrict = '';
function updateHUD(dt) {
  const a = actor();
  const kmh = Math.round(Math.abs(a.forwardSpeed) * 3.6);
  $('speed').textContent = kmh;
  $('gear').textContent = mode === 'foot' ? (a.speed > 3 ? 'Rennen' : 'Zu Fuß') : mode === 'rail' ? VEHICLE_NAMES[rail.controlled.kind] : a.gear;
  $('rpm-fill').style.width = mode === 'car' ? Math.min(100, (player.rpm / 8000) * 100) + '%' : '0%';
  // Hinweis zum Ein-/Aussteigen
  let hint = '';
  if (mode === 'foot') { const t = findEnterable(); if (t) hint = `<kbd>F</kbd> Einsteigen: ${t.name}`; }
  else if (mode === 'car' && player.speed < 1) hint = '<kbd>F</kbd> Aussteigen';
  else if (mode === 'rail' && rail.controlled.v < 1) hint = '<kbd>F</kbd> Aussteigen';
  const pe = $('prompt'); if (pe.innerHTML !== hint) pe.innerHTML = hint; pe.classList.toggle('show', !!hint);
  const dname = districtAt(a.x, a.z);
  if (dname !== currentDistrict) { if (currentDistrict) showBanner(dname, 'Berlin'); currentDistrict = dname; }
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
  const near = world.roadIndex.nearest(a.x, a.z, 22, (r) => !!r.name);
  const name = near?.road.name || '';
  if (name && name !== currentStreet) {
    if (name === streetCandidate) { streetTimer += dt; if (streetTimer > 0.8) { currentStreet = name; showBanner(name, dname); } }
    else { streetCandidate = name; streetTimer = 0; }
  }
  bannerTimer -= dt; if (bannerTimer <= 0) $('banner').classList.remove('show');
  $('map-place').textContent = (currentStreet ? currentStreet + ', ' : '') + dname + ', Berlin';
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
  const a = actor();
  envInfo = env.update(dt, gameDate(), w, camera, new THREE.Vector3(a.x, 0, a.z));
  const envI = 0.12 + 0.88 * Math.max(envInfo.day ?? 1, 0) * (1 - (envInfo.overcast || 0) * 0.3);
  world.applyEnvironment({ night: envInfo.night, wet: envInfo.wet, snow: envInfo.snow, t: performance.now() / 1000, x: a.x, z: a.z, envI });
  const needLights = envInfo.night > 0.35 || w.kind === 'fog' || (envInfo.overcast > 0.8 && envInfo.day < 0.6) || envInfo.intensity > 0.6;
  if (player.autoLights) player.lightsOn = needLights;
  const haze = (w.kind === 'fog' ? 1 : 0) + (envInfo.intensity || 0) * 0.6;
  player.setLights(player.lightsOn, envInfo.night, player.braking, haze);
  traffic.setNight(Math.max(envInfo.night, needLights ? 0.5 : 0), 0, haze);
  rail.setNight(Math.max(envInfo.night, needLights ? 0.5 : 0));
  // Umgebungsreflexionen nachts dämpfen (sonst wirken Bäume/Fassaden zu hell)
  if (Math.abs(envI - (updateEnvironment.lastEnv ?? -1)) > 0.02) {
    updateEnvironment.lastEnv = envI;
    scene.traverse((o) => { const m = o.material; if (m && 'envMapIntensity' in m && m !== world.mats.roadMajor && m !== world.mats.roadMinor) m.envMapIntensity = envI; });
  }
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
  const a = actor();
  const fx = Math.sin(a.heading), fz = Math.cos(a.heading);
  const sp = a.speed;
  const baseY = mode === 'rail' ? railActor.y : 0;
  const p = new THREE.Vector3(a.x, baseY, a.z);
  let want, look, k = 1 - Math.exp(-dt * 6);
  const vdir = sp > 3 ? new THREE.Vector3(a.vx / sp, 0, a.vz / sp) : new THREE.Vector3(fx, 0, fz);
  const dir = new THREE.Vector3(fx, 0, fz).lerp(vdir, 0.35).normalize();
  // Abstand passend zur Fahrzeuggröße
  const L = mode === 'car' ? player.length : mode === 'rail' ? 22 : 0;
  if (mode === 'foot' && camMode !== 3) {
    want = p.clone().addScaledVector(dir, camMode === 1 ? -6 : -3.4); want.y = camMode === 1 ? 3.2 : 2.0;
    look = p.clone().addScaledVector(dir, 2); look.y = 1.45;
    if (camMode === 2) { want = p.clone().addScaledVector(dir, 0.15); want.y = 1.65; look = p.clone().addScaledVector(dir, 10); look.y = 1.6; k = 1; }
  } else if (camMode === 0 || camMode === 1) {
    const extra = Math.max(0, L - 4.5);
    const dist = (camMode === 0 ? 7.4 : 12) + sp * 0.04 + extra * 0.9, hgt = (camMode === 0 ? 2.9 : 4.8) + sp * 0.01 + extra * 0.25;
    want = p.clone().addScaledVector(dir, -dist); want.y = baseY + hgt;
    look = p.clone().addScaledVector(dir, 5); look.y = baseY + 1.1 + extra * 0.12;
  } else if (camMode === 2) {
    const cab = mode === 'car' ? player.params.wsBase - 0.3 : 0.5;
    const eye = mode === 'car' ? Math.max(1.08, player.params.belt + 0.15) : 2.4;
    want = p.clone().addScaledVector(new THREE.Vector3(fx, 0, fz), mode === 'rail' ? -0.8 : cab - 0.5); want.y = baseY + eye;
    look = p.clone().addScaledVector(new THREE.Vector3(fx, 0, fz), 20); look.y = baseY + eye - 0.12;
    k = 1;
  } else {
    camState.orbit += dt * 0.25;
    const R = 11 + L * 0.6;
    want = p.clone().add(new THREE.Vector3(Math.sin(camState.orbit) * R, 2.2 + Math.sin(camState.orbit * 0.7) * 1.2, Math.cos(camState.orbit) * R));
    look = p.clone(); look.y = baseY + 0.9;
    k = 1 - Math.exp(-dt * 3);
  }
  if (!camState.init) { camState.pos.copy(want); camState.look.copy(look); camState.init = true; }
  camState.pos.lerp(want, k); camState.look.lerp(look, Math.min(1, k * 1.5));
  if (camMode !== 2 && camState.pos.y < baseY + 6) {
    const r = world.colliders.resolveCircle(camState.pos.x, camState.pos.z, 0.6);
    if (r.hit) { camState.pos.x = r.x; camState.pos.z = r.z; }
  }
  camState.shake = Math.max(camState.shake * Math.exp(-dt * 5), a.impact || 0);
  camera.position.copy(camState.pos);
  camera.position.x += (Math.random() - 0.5) * camState.shake * 0.5;
  camera.position.y += (Math.random() - 0.5) * camState.shake * 0.5;
  camera.lookAt(camState.look);
  if (dof) {
    dof.enabled = camMode === 3;
    if (dof.enabled) dof.uniforms.focus.value = camera.position.distanceTo(new THREE.Vector3(a.x, baseY + 1, a.z));
  }
  const fov = (camMode === 2 ? 70 : 60) + Math.min(16, sp * 0.22);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------- Schleife
const clock = new THREE.Clock();
let hudTimer = 0, mapTimer = 0, lastImpact = 0, tileTimer = 0;
let paused = false;
function simulate(dt, input) {
  if (mode === 'car') player.update(dt, input, world, traffic, rail);
  else if (mode === 'foot') walker.update(dt, input, input.run, world, traffic, rail);
  if (mode === 'rail') {
    rail.input = input;
    const v = rail.controlled, h = rail.head(v), m = v.meshes[0];
    Object.assign(railActor, { x: m.position.x, z: m.position.z, y: m.position.y, heading: m.rotation.y, speed: v.v, forwardSpeed: v.v, vx: Math.sin(m.rotation.y) * v.v, vz: Math.cos(m.rotation.y) * v.v, rpm: 0 });
  }
  const a = actor();
  traffic.update(dt, a);
  rail.update(dt, a);
  const q = QUALITY[settings.quality] || QUALITY.high;
  people.update(dt, a, ['rain', 'drizzle', 'storm'].includes(weather.state.kind), Math.min(people.count, Math.round(q.people * (0.45 + traffic.live.level * 0.55) * (envInfo.night > 0.5 ? 0.5 : 1))));
  // Kacheln nachladen
  tileTimer -= dt;
  if (tileTimer <= 0) { tileTimer = 0.5; manageTiles(); }
  aggTimer -= dt;
  if (aggDirty && aggTimer <= 0) { aggTimer = 1.0; rebuildAggregates(); }
}
function loop() {
  requestAnimationFrame(loop);
  if (!world || paused) return;
  const dt = Math.min(0.05, clock.getDelta());
  const input = readInput();
  if (!menuOpen) simulate(dt, input);
  if (grade) grade.uniforms.time.value = (grade.uniforms.time.value + dt) % 100;
  const a = actor();
  if (a.impact > lastImpact + 0.1 && mode === 'car') audio.crash(a.impact);
  lastImpact = a.impact || 0;
  updateEnvironment(dt);
  updateCamera(dt);
  audio.update(mode === 'car' ? player : { rpm: 0, speed: a.speed, slip: 0 }, envInfo.intensity || 0, mode === 'car' ? input : {}, mode === 'car');
  hudTimer -= dt;
  if (hudTimer <= 0 && running) { hudTimer = 0.1; updateHUD(0.1); }
  mapTimer -= dt;
  if (mapTimer <= 0) { mapTimer = 1 / 20; map?.drawRadar($('minimap'), a); }
  if (mapOpen) map.drawBig($('bigmap'), mapView, a);
  if (!mapOpen) composer.render();
}

init().then(() => { env.onThunder = () => audio.thunder(); loop(); }).catch((e) => {
  console.error(e);
  loadStep(100, 'Fehler beim Start: ' + e.message);
});

// Debug-/Testzugriff
window.__bd = { get player() { return player; }, get traffic() { return traffic; }, get world() { return world; }, get data() { return data; }, settings, weather, camera, setCam: (m) => (camMode = m), start,
  // Test-Hilfe: Simulation anhalten und gezielt Einzelbilder rendern
  pause: (v) => { paused = v; },
  step: (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { simulate(dt, readInput()); updateEnvironment(dt); updateCamera(dt); } if (aggDirty) rebuildAggregates(); updateHUD(0.1); map.drawRadar($('minimap'), actor()); composer.render(); },
  enterExit: () => enterExit(), get mode() { return mode; }, get walker() { return walker; }, get tiles() { return tileState; }, key: (code, down) => (down ? keys.add(code) : keys.delete(code)),
  view: (px, py, pz, tx, ty, tz) => { camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); composer.render(); },
  teleport: (x, z, h) => { if (mode === 'foot') { walker.x = x; walker.z = z; walker.heading = h; } else player.place(x, z, h); camState.init = false; },
  get rail() { return rail; }, get people() { return people; } };
