/* QR Bookmark service worker — everything is same-origin, so once installed
   the app runs with the radio off. Bump CACHE on each deploy. */
const CACHE='qr-bookmark-author-v1';
const PRECACHE=[
  './',
  './index.html',
  './calibrate.html',
  './manifest.webmanifest',
  './fonts.css',
  './codec.js',
  './qrcode.js',
  './jsqr.js',
  './zxing.js',
  './zxing_reader.wasm',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './fonts/IBMPlexMono-400-latin-ext.woff2',
  './fonts/IBMPlexMono-400-latin.woff2',
  './fonts/IBMPlexMono-500-latin-ext.woff2',
  './fonts/IBMPlexMono-500-latin.woff2',
  './fonts/IBMPlexMono-600-latin-ext.woff2',
  './fonts/IBMPlexMono-600-latin.woff2',
  './fonts/IBMPlexSans-400-latin-ext.woff2',
  './fonts/IBMPlexSans-400-latin.woff2',
  './fonts/Oswald-300-latin-ext.woff2',
  './fonts/Oswald-300-latin.woff2'
];
self.addEventListener('install',e=>{e.waitUntil((async()=>{
  const c=await caches.open(CACHE); await c.addAll(PRECACHE); await self.skipWaiting();})());});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{
  const ks=await caches.keys();
  await Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();})());});
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET')return;
  if(new URL(req.url).origin!==self.location.origin)return;
  e.respondWith((async()=>{
    const c=await caches.open(CACHE);
    if(req.mode==='navigate'){
      try{const n=await fetch(req); c.put('./index.html',n.clone()); return n;}
      catch{ return (await c.match('./index.html'))||(await c.match('./'))||
              new Response('Offline.',{status:503}); }
    }
    const hit=await c.match(req); if(hit)return hit;
    try{const n=await fetch(req); if(n&&n.ok&&n.type==='basic')c.put(req,n.clone()); return n;}
    catch(err){const l=await c.match(req,{ignoreSearch:true}); if(l)return l; throw err;}
  })());
});
