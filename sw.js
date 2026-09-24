/* EdgeControl SW */
const CACHE='edgecontrol-v3';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  e.respondWith((async()=>{
    try{
      const net=await fetch(req);
      if(net&&net.ok&&new URL(req.url).origin===self.location.origin){
        const c=await caches.open(CACHE); c.put(req,net.clone());
      }
      return net;
    }catch(err){
      const c=await caches.open(CACHE);
      return (await c.match(req)) || (await c.match('./')) ||
             (await c.match('./index.html')) || new Response('Offline',{status:503});
    }
  })());
});