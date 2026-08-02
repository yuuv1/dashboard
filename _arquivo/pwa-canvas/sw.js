/* ═══════════════════════════════════════════════
   EdgeControl — Service Worker
   Estratégia:
     • App shell  -> precache + cache-first (rápido e offline)
     • Navegação  -> network-first com fallback pro shell
     • Runtime    -> stale-while-revalidate
   Os DADOS do usuário NÃO passam por aqui: ficam em
   IndexedDB, que é persistente e não é limpo pelo SW.
═══════════════════════════════════════════════ */

const VERSION    = 'v1.0.0';
const SHELL      = `ec-shell-${VERSION}`;
const RUNTIME    = `ec-runtime-${VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/chart.umd.min.js',
  './assets/fonts.css',
  './assets/fonts/inter-400-latin.woff2',
  './assets/fonts/inter-500-latin.woff2',
  './assets/fonts/inter-600-latin.woff2',
  './assets/fonts/inter-700-latin.woff2',
  './assets/fonts/inter-800-latin.woff2',
  './assets/fonts/inter-400-latin-ext.woff2',
  './assets/fonts/inter-500-latin-ext.woff2',
  './assets/fonts/inter-600-latin-ext.woff2',
  './assets/fonts/inter-700-latin-ext.woff2',
  './assets/fonts/inter-800-latin-ext.woff2',
  './assets/fonts/spacegrotesk-700-latin.woff2',
  './assets/fonts/spacegrotesk-700-latin-ext.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-192.png',
  './assets/icons/maskable-512.png',
  './assets/icons/favicon.ico'
];

/* ── INSTALL: precache tolerante a falhas individuais ── */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.allSettled(
      SHELL_ASSETS.map(u => cache.add(new Request(u, { cache: 'reload' })))
    );
    await self.skipWaiting();
  })());
});

/* ── ACTIVATE: limpa versões antigas + navigation preload ── */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* ── Permite ao app forçar atualização ── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION') {
    event.ports[0]?.postMessage(VERSION);
  }
});

/* ── FETCH ── */
self.addEventListener('fetch', event => {
  const { request } = event;

  // só GET; ignora extensões e outros esquemas
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  // 1) Navegação -> network-first, cai pro shell offline
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        const net = await fetch(request);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', net.clone());
        return net;
      } catch (e) {
        const cache = await caches.open(SHELL);
        return (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // 2) Mesma origem -> cache-first + revalidação em segundo plano
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request).then(res => {
        if (res && res.ok) {
          caches.open(RUNTIME).then(c => c.put(request, res.clone()));
        }
        return res;
      }).catch(() => null);
      return cached || (await network) || new Response('', { status: 504 });
    })());
    return;
  }

  // 3) Terceiros (ex.: avatar remoto) -> tenta rede, cai pro cache
  event.respondWith((async () => {
    try {
      const res = await fetch(request);
      if (res && res.ok && res.type !== 'opaque') {
        const c = await caches.open(RUNTIME); c.put(request, res.clone());
      }
      return res;
    } catch (e) {
      return (await caches.match(request)) || new Response('', { status: 504 });
    }
  })());
});
