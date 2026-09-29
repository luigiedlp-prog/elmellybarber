self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data?e.data.text():''}}
  e.waitUntil((async()=>{
    await self.registration.showNotification(d.title||'ElMellyBarber',{body:d.body||'',icon:'/icon.png',badge:'/icon-192.png',tag:d.tag||undefined,data:{url:d.url||'/'}});
    const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    cs.forEach(c=>c.postMessage({type:'push',url:d.url||'/'}));
  })());
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const target=new URL((e.notification.data&&e.notification.data.url)||'/',self.location.origin);
  e.waitUntil((async()=>{
    const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of cs){ if(new URL(c.url).pathname.startsWith(target.pathname)&&'focus' in c) return c.focus(); }
    return self.clients.openWindow(target.href);
  })());
});
