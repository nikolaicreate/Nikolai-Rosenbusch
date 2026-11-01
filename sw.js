// Service Worker: Spieldateien und three.js zwischenspeichern, damit die App schnell startet.
const CACHE = 'berlin-drive-app-v1';
const SHELL = ['./', './index.html', './style.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './src/main.js', './src/geo.js', './src/fallback.js', './src/world.js', './src/cars.js', './src/traffic.js', './src/weather.js',
  './src/player.js', './src/minimap.js', './src/rail.js', './src/people.js', './src/walker.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('berlin-drive-app-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return; // Overpass-POST etc. nicht anfassen
  const isThree = url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/three@0.160.0/');
  const isShell = url.origin === location.origin && !url.pathname.includes('__bd_tile');
  if (!isThree && !isShell) return;
  // Spieldateien: erst Netz (Updates), sonst Cache; three.js: erst Cache
  if (isThree) e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return res; })));
  else e.respondWith(fetch(e.request).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return res; }).catch(() => caches.match(e.request)));
});
