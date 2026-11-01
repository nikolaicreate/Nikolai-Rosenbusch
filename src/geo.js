// Geodaten: Projektion, OpenStreetMap-Import (Overpass API) und Datenmodell.
import { makeFallbackCity } from './fallback.js';

// Spielfeld: Berlin-Mitte vom Brandenburger Tor bis kurz vor den Alexanderplatz.
export const CENTER = { lat: 52.5165, lon: 13.3900 };
export const BBOX = { s: 52.5095, w: 13.3730, n: 52.5225, e: 13.4075 };

const R = 6378137;
const RAD = Math.PI / 180;
const KX = RAD * R * Math.cos(CENTER.lat * RAD);
const KZ = RAD * R;

/** WGS84 -> lokale Meter. +x = Osten, -z = Norden. */
export function project(lat, lon) {
  return [(lon - CENTER.lon) * KX, -(lat - CENTER.lat) * KZ];
}
export function unproject(x, z) {
  return { lat: CENTER.lat - z / KZ, lon: CENTER.lon + x / KX };
}
export const EXTENT = (() => {
  const a = project(BBOX.n, BBOX.w);
  const b = project(BBOX.s, BBOX.e);
  return { minX: a[0], minZ: a[1], maxX: b[0], maxZ: b[1] };
})();

export const LANDMARKS = {
  tor: project(52.516275, 13.377704),
  fernsehturm: project(52.520815, 13.409419),
};

// Straßenklassen: Breite (m), Tempo (m/s), befahrbar, Hauptstraße
export const ROAD_TYPES = {
  motorway:      { w: 24, speed: 22.2, drive: true,  major: true },
  trunk:         { w: 20, speed: 16.7, drive: true,  major: true },
  primary:       { w: 17, speed: 13.9, drive: true,  major: true },
  secondary:     { w: 14, speed: 13.9, drive: true,  major: true },
  tertiary:      { w: 11, speed: 13.9, drive: true,  major: true },
  unclassified:  { w: 8,  speed: 8.3,  drive: true,  major: false },
  residential:   { w: 8,  speed: 8.3,  drive: true,  major: false },
  living_street: { w: 6,  speed: 4.0,  drive: true,  major: false },
  service:       { w: 4.5, speed: 5.0, drive: false, major: false },
  pedestrian:    { w: 9,  speed: 2.0,  drive: false, major: false },
};
export function roadTypeOf(hw) {
  if (!hw) return null;
  const base = hw.replace('_link', '');
  return ROAD_TYPES[base] ? base : null;
}

// --- kleine Helfer -------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function openRing(pts) {
  const r = pts.slice();
  if (r.length > 2) {
    const a = r[0], b = r[r.length - 1];
    if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01) r.pop();
  }
  return r;
}
/** Verbindet Teilstücke (Multipolygon-Mitglieder) zu geschlossenen Ringen. */
function assembleRings(parts) {
  const rings = [];
  const pool = parts.map((p) => p.slice());
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
  while (pool.length) {
    let cur = pool.shift();
    let guard = 0;
    while (!same(cur[0], cur[cur.length - 1]) && guard++ < 5000) {
      const end = cur[cur.length - 1];
      const i = pool.findIndex((p) => same(p[0], end) || same(p[p.length - 1], end));
      if (i < 0) break;
      let nxt = pool.splice(i, 1)[0];
      if (!same(nxt[0], end)) nxt = nxt.reverse();
      cur = cur.concat(nxt.slice(1));
    }
    if (cur.length >= 4) rings.push(openRing(cur));
  }
  return rings;
}

const BERLIN_FACADES = [0xeae2d4, 0xdcd0bb, 0xd2c8b8, 0xc4baa9, 0xe7dfd2, 0xcdbb9f, 0xb2ada4, 0xd9d3c9, 0xf0ebe1, 0xbfa98d, 0xc9c2b8, 0xe2d6c0];

function parseColor(c) {
  if (!c) return null;
  if (/^#?[0-9a-f]{6}$/i.test(c)) return parseInt(c.replace('#', ''), 16);
  const named = { white: 0xf2f2ee, grey: 0xa8a8a8, gray: 0xa8a8a8, beige: 0xe0d2b4, brown: 0x8a6a50, red: 0xa64b3c, yellow: 0xe6d38a, black: 0x404040 };
  return named[c.toLowerCase()] ?? null;
}

function buildingHeight(t, rnd) {
  const h = parseFloat(t.height);
  if (h > 0) return Math.min(h, 380);
  const lv = parseFloat(t['building:levels']);
  if (lv > 0) return lv * 3.3 + (parseFloat(t['roof:levels']) || 0) * 2.2 + 1;
  if (t.building === 'church' || t.building === 'cathedral') return 30;
  if (['garage', 'garages', 'shed', 'kiosk', 'hut'].includes(t.building)) return 3.5;
  // Berliner Traufhöhe ~22 m
  return 15 + rnd() * 9;
}

export function parseOSM(json) {
  const data = { buildings: [], roads: [], water: [], parks: [], source: 'osm' };
  const proj = (geom) => geom.filter(Boolean).map((g) => project(g.lat, g.lon));
  const addArea = (ring, t, id) => {
    if (ring.length < 3) return;
    if (t.building && t.building !== 'roof' && t.building !== 'construction') {
      const rnd = mulberry32(id);
      data.buildings.push({ ring, h: buildingHeight(t, rnd), color: parseColor(t['building:colour']) ?? BERLIN_FACADES[Math.floor(rnd() * BERLIN_FACADES.length)], name: t.name || '' });
    } else if (t.natural === 'water') data.water.push(ring);
    else if (t.leisure || t.landuse) data.parks.push(ring);
  };
  for (const el of json.elements || []) {
    const t = el.tags || {};
    if (el.type === 'way' && el.geometry) {
      const pts = proj(el.geometry);
      if (t.highway) {
        const type = roadTypeOf(t.highway);
        if (!type || pts.length < 2 || t.area === 'yes') continue;
        const def = ROAD_TYPES[type];
        let w = parseFloat(t.width);
        if (!(w > 2)) w = t.lanes ? Math.max(def.w * 0.6, parseFloat(t.lanes) * 3.4 + 1.5) : def.w;
        if (t.highway.endsWith('_link')) w = Math.min(w, 8);
        let oneway = 0;
        if (['yes', '1', 'true'].includes(t.oneway) || t.junction === 'roundabout') oneway = 1;
        if (t.oneway === '-1') oneway = -1;
        data.roads.push({ pts, type, width: Math.min(w, 40), name: t.name || '', oneway, id: el.id });
      } else {
        addArea(openRing(pts), t, el.id);
      }
    } else if (el.type === 'relation' && el.members) {
      const outers = el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => proj(m.geometry));
      for (const ring of assembleRings(outers)) addArea(ring, t, el.id);
    }
  }
  return data;
}

// --- Laden -----------------------------------------------------------------
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const CACHE_URL = './__berlin_drive_osm_v2.json';

async function readCache() {
  try {
    if (!('caches' in self)) return null;
    const c = await caches.open('berlin-drive');
    const r = await c.match(CACHE_URL);
    if (!r) return null;
    const age = Date.now() - Number(r.headers.get('x-saved') || 0);
    if (age > 14 * 864e5) return null;
    return await r.json();
  } catch { return null; }
}
async function writeCache(json) {
  try {
    if (!('caches' in self)) return;
    const c = await caches.open('berlin-drive');
    await c.put(CACHE_URL, new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json', 'x-saved': String(Date.now()) } }));
  } catch { /* egal */ }
}

export async function loadMapData(onStatus) {
  const b = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
  const q = `[out:json][timeout:120];(
    way["building"](${b});relation["building"](${b});
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)(_link)?$"](${b});
    way["natural"="water"](${b});relation["natural"="water"](${b});
    way["leisure"~"^(park|garden)$"](${b});relation["leisure"="park"](${b});
    way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green)$"](${b});
  );out geom;`;

  let json = await readCache();
  if (json) onStatus?.('OpenStreetMap-Daten aus dem Cache …');
  if (!json) {
    for (const url of ENDPOINTS) {
      try {
        onStatus?.(`Lade echte Gebäude & Straßen von OpenStreetMap (${new URL(url).host}) …`);
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 50000);
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(q),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: ctrl.signal,
        });
        clearTimeout(to);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        json = await res.json();
        if (!json.elements?.length) throw new Error('leere Antwort');
        writeCache(json);
        break;
      } catch (e) {
        console.warn('[Overpass] fehlgeschlagen:', url, e);
        json = null;
      }
    }
  }
  if (json) {
    const d = parseOSM(json);
    if (d.buildings.length > 50 && d.roads.length > 20) return d;
  }
  onStatus?.('OpenStreetMap nicht erreichbar – baue Berlin-Mitte als Modell nach …');
  return makeFallbackCity();
}
