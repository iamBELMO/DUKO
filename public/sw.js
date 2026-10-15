const HOME = self.registration.scope;
const PREFIX = 'duko-shell:' + encodeURIComponent(HOME) + ':';
const CACHE = PREFIX + 'v0.5.1';
const ASSET_BASE = new URL(self.DUKO_ASSET_DIRECTORY || './', HOME);
const ASSETS = [HOME, new URL('manifest.webmanifest', HOME).href, ...['styles.css','app.js','api-client.js','connection.js','card-gestures.js','card-art.js','effects.js','sounds.js','icon.svg','icon-192.png','icon-512.png'].map(path=>new URL(path,ASSET_BASE).href)];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);
  const resource=u.origin+u.pathname;
  if(event.request.method!=='GET'||u.origin!==self.location.origin||!ASSETS.includes(resource))return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;}).catch(async()=>{
    const cached=await caches.match(event.request);if(cached)return cached;
    if(event.request.mode==='navigate')return (await caches.match(HOME))||Response.error();
    return Response.error();
  }));
});
