/* Все файлы одной версии кэшируются вместе. Новая версия ждёт согласия
   игрока, чтобы не смешать старую физику с новым интерфейсом посреди заезда. */
'use strict';
const CACHE_NAME = 'quiet-hills-shell-1.1.0-r2';
const SHELL = [
  './', './index.html', './about.html', './css/style.css',
  './js/data.js', './js/storage.js', './js/audio.js', './js/quests.js',
  './js/decor.js', './js/terrain.js', './js/vehicle.js', './js/ride.js',
  './js/base.js', './js/ui.js', './js/main.js', './js/pwa.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-512-maskable.png', './icons/apple-touch-icon.png'
];
const SHELL_URLS = new Set(SHELL.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(SHELL.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })))
  ));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('quiet-hills-shell-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Параметры ссылки не создают вторую копию самой игры.
  url.search = '';
  url.hash = '';
  // Vercel cleanUrls показывает страницу проекта как /about.
  if (url.pathname === new URL('./about', self.registration.scope).pathname) {
    url.pathname = new URL('./about.html', self.registration.scope).pathname;
  }
  if (SHELL_URLS.has(url.href)) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
      const saved = await cache.match(url.href);
      return saved || fetch(request);
    }));
    return;
  }
  // Иллюстрации страницы «Об игре» появятся офлайн после первого просмотра.
  const scope = new URL(self.registration.scope).pathname;
  if (url.pathname.startsWith(scope + 'shots/') || url.pathname === scope + 'og.png') {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
      const saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    }));
  }
});
