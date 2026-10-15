const CACHE = 'duko-shell-v0.5.0';
const ASSETS = ['/','/styles.css','/app.js','/connection.js','/card-gestures.js','/card-art.js','/effects.js','/sounds.js','/icon.svg','/icon-192.png','/icon-512.png','/manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('duko-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);
  if(event.request.method!=='GET'||u.origin!==self.location.origin||!ASSETS.includes(u.pathname))return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;}).catch(async()=>{
    const cached=await caches.match(event.request);if(cached)return cached;
    if(event.request.mode==='navigate')return (await caches.match('/'))||Response.error();
    return Response.error();
  }));
});
