const CACHE_NAME = 'kit-studyflow-v9';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/styles.css',
  './js/main.js',
  './js/icons.js',
  './js/qr.js',
  './js/store.js',
  './js/checklist.js',
  './js/ics.js',
  './js/sync.js',
  './js/anki.js',
  './js/gemini.js',
  './js/charts.js',
  './js/views/today.js',
  './js/views/week.js',
  './js/views/planner.js',
  './js/views/stats.js',
  './js/views/more.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never intercept external API calls (GitHub API, Gemini API, AnkiConnect)
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
