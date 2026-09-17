/* Absolute Zero scoped offline cache. Never delete caches belonging to other games. */
'use strict';
const PREFIX = `absolute-zero:${self.registration.scope}:`;
const CACHE = `${PREFIX}1.0.2`;
const ROOT = self.registration.scope;
const ASSETS = ['./', 'index.html', 'styles.css', 'core.js', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'].map(p => new URL(p, ROOT).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  // Updates wait for explicit user action; a game in progress is not reloaded.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(ROOT)) return;
  if (event.request.mode === 'navigate') {
    const home = new URL('index.html', ROOT).href;
    const rootPath = new URL(ROOT).pathname;
    if (url.pathname !== rootPath && url.pathname !== new URL(home).pathname) return;
    // Serve one installed version atomically: never mix a new HTML file with old JS/CSS.
    // The next installation preloads its complete asset set before an explicit update.
    event.respondWith(caches.open(CACHE).then(cache => cache.match(home)).then(hit => hit || fetch(event.request)));
    return;
  }
  const plain = url.origin + url.pathname;
  if (!ASSETS.includes(plain)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(plain)).then(hit => hit || fetch(event.request)));
});
