// Keeps Open Gauge working with no signal: the app's own files are cached on first visit.
const CACHE = 'open-gauge-1.0.0';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg',
  'src/app.js', 'src/app-info.js', 'src/drive.js', 'src/elm.js', 'src/pids.js',
  'src/session.js', 'src/store.js', 'src/transports.js'
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))))
);
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
