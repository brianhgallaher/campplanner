/* Camp Planner Go — offline support for the phone app (go.html) only. The planner itself is not touched.
   • the app's own files: fresh from the network when there is service, else the saved copy;
   • map tiles: the saved copy first (saved as you look at the map, or with "Save map for offline"). */
const SHELL = 'go-shell-v3', TILES = 'go-tiles';
const APP = ['go.html', 'js/go.js', 'js/geo.js', 'css/go.css', 'go.webmanifest', 'img/go-192.png', 'img/go-512.png', 'img/watermark.webp',
  'checkin.html', 'js/checkin.js', 'js/regolib.js', 'css/rego.css', 'lib/qrcode.js', 'lib/jsQR.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(APP.map(u => c.add(new Request(u, { mode: u.startsWith('http') ? 'no-cors' : 'same-origin' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('go-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isTile = u => /(^|\.)tile\.opentopomap\.org$/.test(u.hostname);
const isApp = u => (u.origin === location.origin && /\/(go\.html|checkin\.html|go\.webmanifest|js\/(go|geo|checkin|regolib)\.js|css\/(go|rego)\.css|lib\/(qrcode|jsQR)\.js|img\/go-\d+\.png|img\/logo-header\.png)$/.test(u.pathname)) ||
  (u.hostname === 'unpkg.com' && u.pathname.includes('/leaflet@'));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (isTile(u)) {
    e.respondWith(caches.open(TILES).then(async c => (await c.match(e.request, { ignoreVary: true })) || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; })));
  } else if (isApp(u)) {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('go.html'))));
  }
  /* everything else (the planner, the API) goes straight to the network */
});
