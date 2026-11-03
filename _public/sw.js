/* EdgeControl SW */
const CACHE='edgecontrol-v4';
/* Casca do app: garante que a primeira abertura offline já tenha o painel e
   os módulos locais (Supabase e gráficos), sem depender de CDN. */
const CORE=[
  './',
  './index.html',
  './edgecontrol-glass-v2.html',
  './manifest.webmanifest',
  './vendor/supabase.min.js',
  './vendor/chart.umd.min.js',
  './supabase/runtime-config.js',
  './supabase/app-sync.js',
  './icones-app/icon-192.png',
  './icones-app/icon-512.png'
];
self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    try{
      const c=await caches.open(CACHE);
      await Promise.all(CORE.map(url=>c.add(new Request(url,{cache:'reload'})).catch(()=>{})));
    }catch(_){/* sem cache o app continua abrindo pela rede */}
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  try{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE&&k.indexOf('edgecontrol-')===0).map(k=>caches.delete(k)));
  }catch(_){/* nada a limpar */}
  await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;

  const url=new URL(req.url);
  /* A failed third-party request must remain a network failure: returning the
     app shell for a font/API/script makes callers treat HTML as valid data. */
  if(url.origin!==self.location.origin){
    e.respondWith(fetch(req));
    return;
  }
  /* Dados padrão do site (backup de MB): o app já guarda tudo no IndexedDB,
     então não faz sentido inflar o Cache Storage com eles. */
  if(url.pathname.indexOf('/dados/')!==-1){
    e.respondWith(fetch(req));
    return;
  }

  e.respondWith((async()=>{
    try{
      const net=await fetch(req);
      if(net&&net.ok){
        /* Cache failures must not turn a successful network response into an
           application error (e.g. when storage is full or unavailable). */
        try{
          const c=await caches.open(CACHE);
          await c.put(req,net.clone());
        }catch(_){/* best effort */}
      }
      return net;
    }catch(_){
      try{
        const c=await caches.open(CACHE);
        const cached=await c.match(req);
        if(cached) return cached;
        /* Only document navigations may fall back to the app shell. */
        if(req.mode==='navigate'){
          const shell=(await c.match('./edgecontrol-glass-v2.html')) || (await c.match('./index.html')) || (await c.match('./'));
          if(shell) return shell;
        }
      }catch(_){/* storage may also be unavailable while offline */}
      return new Response('Offline',{status:503,statusText:'Service Unavailable'});
    }
  })());
});
