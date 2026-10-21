/* EdgeControl SW */
const CACHE='edgecontrol-v3';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
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
          const shell=(await c.match('./')) || (await c.match('./index.html'));
          if(shell) return shell;
        }
      }catch(_){/* storage may also be unavailable while offline */}
      return new Response('Offline',{status:503,statusText:'Service Unavailable'});
    }
  })());
});
