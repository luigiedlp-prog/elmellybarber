/* ElMellyBarber · utilidades compartidas (reserva + gestión) */
(function(W){
'use strict';
W.$=id=>document.getElementById(id);
W.fmt=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));
W.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
W.api=async function(url,opt){
  const r=await fetch('/api'+url,opt);let j={};try{j=await r.json()}catch(e){}
  if(!r.ok)throw Object.assign(new Error(j.error||'Error'),{data:j,status:r.status});
  return j;
};
W.post=(url,body)=>api(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});

/* Íconos (trazo, estilo SF Symbols) */
const IC={
bell:'<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',
cal:'<rect x="3" y="5" width="18" height="16" rx="3.5"/><path d="M8 3v4M16 3v4M3 10h18"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.2.7 3.5 2.6 3.5 5.7"/>',
chart:'<path d="M5 20v-9M12 20V5M19 20v-12"/>',
scissors:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
chev:'<path d="m9 6 6 6-6 6"/>',
chevL:'<path d="m15 6-6 6 6 6"/>',
check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
x:'<path d="M6 6l12 12M18 6 6 18"/>',
phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
pin:'<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
edit:'<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
share:'<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
copy:'<rect x="9" y="9" width="11" height="11" rx="3"/><path d="M5 15V7a2 2 0 0 1 2-2h8"/>',
block:'<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
noshow:'<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c0-3.6 2.9-6 6.5-6"/><path d="m15.5 15.5 5 5M20.5 15.5l-5 5"/>',
lock:'<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
out:'<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H9"/>',
spark:'<path d="M11 3l1.9 5.6L18.5 10.5l-5.6 1.9L11 18l-1.9-5.6L3.5 10.5l5.6-1.9Z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
tag:'<path d="M3 12V4h8l10 10-8 8Z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
wa:'<path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 18.8L4 20Z"/>'
};
const FILLED=new Set(['bell','cal','clock','users','chart','pin','lock','copy','block','noshow','phone','wa','scissors','spark','tag']);
W.ico=n=>`<svg class="i${FILLED.has(n)?' f':''}" viewBox="0 0 24 24" aria-hidden="true">${IC[n]||''}</svg>`;

/* WhatsApp argentino */
W.formatWA=function(v){let d=String(v||'').replace(/\D/g,'');if(d.startsWith('549')&&d.length===13)return d;if(d.startsWith('54')&&d.length===12)return '549'+d.slice(2);if(d.startsWith('9')&&d.length===11)return '54'+d;if(d.length===10)return '549'+d;return d};
W.displayWA=function(v){let d=formatWA(v);return d.length===13?'+54 9 '+d.slice(3,7)+' '+d.slice(7):(v||'')};
W.durationText=n=>n>=60?`${Math.floor(n/60)} h${n%60?' '+n%60+' min':''}`:`${n} min`;
W.longDate=d=>new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'numeric',month:'long'}).format(new Date(String(d).slice(0,10)+'T12:00:00')).replace(/^./,x=>x.toUpperCase());
W.initials=n=>String(n||'').trim().split(/\s+/).filter(Boolean).map(x=>x[0]).slice(0,2).join('').toUpperCase()||'EM';

/* Toast */
W.toast=function(t){const el=$('toast');if(!el)return;el.textContent=t;el.classList.add('show');clearTimeout(W.__toast);W.__toast=setTimeout(()=>el.classList.remove('show'),2300)};

/* Diálogos al estilo iOS: reemplazan alert / confirm / prompt del navegador */
W.dlg=function({title='',msg='',ok='Aceptar',cancel='',input=false,def='',ph='',danger=false}){
  return new Promise(res=>{
    const d=document.createElement('div');d.className='dlg';
    d.innerHTML=`<div class="box" role="alertdialog" aria-modal="true"><div class="body">${title?`<h3>${esc(title)}</h3>`:''}${msg?`<p>${esc(msg)}</p>`:''}${input?`<input id="dlgIn" value="${esc(def)}" placeholder="${esc(ph)}" autocomplete="off">`:''}</div><div class="acts">${cancel?`<button data-v="0">${esc(cancel)}</button>`:''}<button data-v="1" class="${danger?'bad':''}">${esc(ok)}</button></div></div>`;
    const done=v=>{d.remove();res(v)};
    d.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const yes=b.dataset.v==='1';done(input?(yes?d.querySelector('#dlgIn').value:null):yes)});
    document.body.appendChild(d);const i=d.querySelector('#dlgIn');if(i){i.focus();i.addEventListener('keydown',e=>{if(e.key==='Enter')done(i.value)})}
  });
};
W.alertD=(msg,title)=>dlg({msg,title});
W.confirmD=(msg,ok='Confirmar',danger=false)=>dlg({msg,ok,cancel:'Cancelar',danger});
W.promptD=(msg,def='',ph='')=>dlg({msg,input:true,def,ph,ok:'Aceptar',cancel:'Cancelar'});
})(window);
