/* sw.js — offline shell.
   ASSETS must list every file the app loads. tools/check-cache.js verifies
   this list against index.html and the js/ + css/ folders.

   BUMP CACHE ON EVERY RELEASE. Non-navigation requests are served cache
   first, so a returning user keeps getting the old js/ and css/ out of the
   old cache until the name changes. Changing it is also what the page
   watches for: a new sw.js installs, skipWaiting() puts it in charge, and
   App.watchForUpdate() shows "App is updating" and reloads once. */
var CACHE = 'poket-daily-v10';

var ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'css/animations.css',
  'js/db.js',
  'js/format.js',
  'js/cycles.js',
  'js/calc.js',
  'js/ui.js',
  'js/charts.js',
  'js/actions.js',
  'js/forms.js',
  'js/checklist.js',
  'js/tab-home.js',
  'js/tab-log.js',
  'js/tab-plan.js',
  'js/tab-accounts.js',
  'js/tab-breakdown.js',
  'js/splash.js',
  'js/onboarding.js',
  'js/settings.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/logo-wordmark.png',
  'icons/splash.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

/* The page asks for this if it ever finds a worker stuck in 'installed'. */
self.addEventListener('message', function (e) {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  /* Navigations: network first so updates land, cache as the offline fallback. */
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('index.html', copy); });
          return res;
        })
        .catch(function () {
          return caches.match('index.html').then(function (r) { return r || caches.match('./'); });
        })
    );
    return;
  }

  /* Everything else: cache first, then network, and keep what we fetch. */
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      });
    })
  );
});
