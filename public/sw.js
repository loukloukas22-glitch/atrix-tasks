const C='atrix-v7', SHELL=['/','/index.html','/app.js','/invoices.js','/styles.css','/manifest.webmanifest','/icons/icon-192.png','/brand/logo_vertical.svg','/brand/logo_horizontal_dark.svg','/fonts/Manrope.ttf','/fonts/Montserrat.ttf'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim();});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.pathname.startsWith('/api/'))return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r;})
    .catch(()=>caches.match(e.request).then(r=>r||caches.match('/index.html'))));});
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch{d={title:'AtriX',body:e.data&&e.data.text()}}
  e.waitUntil(self.registration.showNotification(d.title||'AtriX Tasks',{body:d.body,icon:'/icons/icon-192.png',badge:'/icons/badge-96.png',data:{url:d.url||'/'},silent:false,vibrate:[300,100,300],renotify:true,tag:'atrix-'+Date.now()}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=e.notification.data.url;
  e.waitUntil(clients.matchAll({type:'window'}).then(ws=>{for(const w of ws){w.navigate(url);return w.focus();}return clients.openWindow(url);}));});
