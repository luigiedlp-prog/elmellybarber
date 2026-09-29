
(function(){
const ROLE=document.documentElement.dataset.role==='admin'?'admin':'client',ADMIN=ROLE==='admin';
const P=window.PUSH={role:ROLE,state:'checking',key:null,synced:false};
const ua=navigator.userAgent||'';
const isIOS=/iphone|ipad|ipod/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const standalone=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
const b64=s=>{s=String(s).replace(/-/g,'+').replace(/_/g,'/');s+='='.repeat((4-s.length%4)%4);const r=atob(s),u=new Uint8Array(r.length);for(let i=0;i<r.length;i++)u[i]=r.charCodeAt(i);return u};
const hasD=()=>{try{return !!D}catch(e){return false}};
const say=t=>{try{toast(t)}catch(e){}};
const btn=(label,fn,primary)=>`<button class="btn ${primary?'primary':''}" onclick="${fn}">${label}</button>`;
const box=(t,p,b)=>`<div class="pushBox"><b>${t}</b><p>${p}</p>${b||''}</div>`;
const T=ADMIN?{
  offT:'Activá los avisos',offP:'Recibí en este teléfono cada turno nuevo, cada cancelación y un recordatorio 1 hora antes de cada turno.',
  onT:'Avisos activados',onP:'Este teléfono recibe los avisos de tus turnos.'
}:{
  offT:'Recibí avisos de tu turno',offP:'Te avisamos 1 hora antes de tu turno y si se cancela.',
  onT:'Avisos activados',onP:'Te vamos a avisar 1 hora antes de tu turno.'
};
function html(kind){
  const s=P.state,card=kind==='card';
  if(s==='off')return box(T.offT,T.offP,btn('Activar avisos','PUSH.enable()',true));
  if(s==='ios-install')return box('Instalá la app para recibir avisos','En iPhone los avisos funcionan desde la pantalla de inicio: tocá el botón <b>Compartir</b> (el cuadrado con la flecha) → <b>Agregar a inicio</b> y abrí la página desde ese ícono.');
  if(s==='on'){
    if(ADMIN&&!card)return '';
    return box(T.onT,T.onP,card?(ADMIN?btn('Enviar aviso de prueba','PUSH.test()',false):'')+btn('Desactivar avisos en este teléfono','PUSH.disable()',false):'');
  }
  if(!card)return '';
  if(s==='denied')return box('Avisos bloqueados','Las notificaciones de este sitio están bloqueadas. Activalas desde los ajustes del teléfono o del navegador y volvé a abrir esta página.');
  if(s==='off-server')return box('Avisos','Todavía no están configurados en el servidor.');
  if(s==='unsupported')return box('Avisos','Este navegador no permite recibir avisos. Probá con Chrome en Android, o desde la pantalla de inicio en iPhone.');
  return '';
}
P.refresh=function(){
  document.querySelectorAll('.pushSlot').forEach(el=>{el.innerHTML=html(el.dataset.kind||'banner')});
  if(P.state==='on'&&!P.synced&&(ADMIN?hasD():(typeof clientWA==='string'&&clientWA.length===13))){P.synced=true;sync()}
};
window.pushRefreshUI=P.refresh;
async function sync(){
  try{
    const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(!sub)return;
    if(ADMIN)await post('/admin/push/subscribe',{subscription:sub.toJSON()});
    else await post('/push/subscribe-client',{subscription:sub.toJSON(),whatsapp:clientWA});
  }catch(e){}
}
async function init(){
  try{
    if(!('serviceWorker' in navigator)){P.state=isIOS&&!standalone?'ios-install':'unsupported';return P.refresh()}
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
    if(!('PushManager' in window)||!('Notification' in window)){P.state=isIOS&&!standalone?'ios-install':'unsupported';return P.refresh()}
    const k=await api('/push/key');P.key=k.key;
    if(!P.key){P.state='off-server';return P.refresh()}
    if(Notification.permission==='denied'){P.state='denied';return P.refresh()}
    const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();
    P.state=sub&&Notification.permission==='granted'?'on':'off';
  }catch(e){P.state='unsupported'}
  P.refresh();
}
P.enable=async function(){
  try{
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){P.state=perm==='denied'?'denied':'off';return P.refresh()}
    const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();
    if(!sub){
      const opts={userVisibleOnly:true,applicationServerKey:b64(P.key)};
      try{sub=await reg.pushManager.subscribe(opts)}catch(e){const old=await reg.pushManager.getSubscription();if(old)await old.unsubscribe();sub=await reg.pushManager.subscribe(opts)}
    }
    if(ADMIN)await post('/admin/push/subscribe',{subscription:sub.toJSON()});
    else await post('/push/subscribe-client',{subscription:sub.toJSON(),whatsapp:clientWA});
    P.state='on';P.synced=true;
  }catch(e){alertD('No se pudieron activar los avisos: '+(e&&e.message||e))}
  P.refresh();
};
P.disable=async function(){
  try{
    const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();
    if(sub){try{await post(ADMIN?'/admin/push/unsubscribe':'/push/unsubscribe',{endpoint:sub.endpoint})}catch(e){}await sub.unsubscribe()}
    P.state='off';P.synced=false;
  }catch(e){alertD('No se pudieron desactivar los avisos: '+(e&&e.message||e))}
  P.refresh();
};
P.test=async function(){
  try{const r=await post('/admin/push/test');say(r.sent?'Aviso enviado. Tiene que llegarte en unos segundos.':'No hay ningún teléfono registrado. Desactivá y volvé a activar los avisos.')}catch(e){alertD(e.message)}
};
function adminReload(){
  if(!ADMIN||!hasD())return;
  api('/admin').then(d=>{
    D=d;const ov=document.getElementById('overlay');
    // Si Juan tiene una hoja abierta o está en otra pestaña (por ejemplo editando horarios), no se redibuja: solo se actualiza la campanita.
    const busy=(ov&&ov.classList.contains('show'))||(typeof view!=='undefined'&&view!=='agenda');
    if(busy){const ab=document.getElementById('adminBadge');if(ab)ab.classList.toggle('hidden',!(D.notifications||[]).length)}else render();
  }).catch(()=>{});
}
function clientReload(){if(!ADMIN&&typeof clientWA==='string'&&clientWA&&typeof loadNotifications==='function')loadNotifications(clientWA)}
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.type==='push'){adminReload();clientReload()}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){adminReload();clientReload()}});
init();
})();
