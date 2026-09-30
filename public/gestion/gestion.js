/* ElMellyBarber · Gestión (panel de Juan) */
'use strict';
$('bellIco').innerHTML=ico('bell');$('fab').innerHTML=ico('plus');
let D=null,view='agenda',selectedDate='',sheetLocked=false;
const TABS=[['agenda','cal','Agenda'],['clientes','users','Clientes'],['ganancias','chart','Ganancias'],['servicios','scissors','Servicios']];
$('tabs').innerHTML=TABS.map(([v,i,l])=>`<button class="tab ${v==='agenda'?'active':''}" data-view="${v}" onclick="go('${v}')">${ico(i)}<span>${l}</span></button>`).join('');

function showSheet(h,locked){sheetLocked=!!locked;$('sheet').innerHTML='<div class="handle"></div>'+h;$('overlay').classList.add('show');window.pushRefreshUI&&pushRefreshUI()}
function closeSheet(force){if(sheetLocked&&!force)return;$('overlay').classList.remove('show')}
const saveBtn=(fn,label='Guardar')=>`<button class="btn primary" onclick="${fn}">${label}</button>`;

/* ── Sesión ── */
async function boot(){try{D=await api('/admin');selectedDate=D.today;render()}catch(e){login()}}
function login(){
  showSheet(`<h2>Gestión privada</h2><p class="sub">Ingresá tu PIN de 4 dígitos, Juan.</p><div class="field"><label for="pin">PIN</label><input id="pin" class="pin" inputmode="numeric" maxlength="4" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()"></div><button class="btn primary" onclick="doLogin()">Entrar</button><button class="btn ghost" onclick="recover()">Olvidé mi PIN</button>`,true);
  setTimeout(()=>$('pin')?.focus(),250);
}
async function doLogin(){try{await post('/login',{pin:$('pin').value});closeSheet(true);D=await api('/admin');selectedDate=D.today;render()}catch(e){alertD(e.message)}}
async function recover(){
  try{const r=await api('/recover-info');showSheet(`<h2>Recuperar PIN</h2><p class="sub">${esc(r.question||'Pregunta de recuperación')}</p><div class="field"><label for="ans">Respuesta</label><input id="ans" autocomplete="off"></div><div class="field"><label for="newpin">Nuevo PIN</label><input id="newpin" class="pin" inputmode="numeric" maxlength="4" type="password"></div><button class="btn primary" onclick="doRecover()">Cambiar PIN</button><button class="btn ghost" onclick="login()">Volver</button>`,true)}catch(e){alertD(e.message)}
}
async function doRecover(){try{await post('/recover',{answer:$('ans').value,newPin:$('newpin').value});await alertD('PIN cambiado.');login()}catch(e){alertD(e.message)}}
async function logout(){try{await post('/logout');D=null;login()}catch(e){alertD(e.message)}}

/* ── Navegación ── */
function go(v){view=v;render();window.scrollTo({top:0})}
function render(){
  $('adminBadge').classList.toggle('hidden',!(D?.notifications||[]).length);
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  $('fab').style.display=view==='agenda'?'grid':'none';
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$(view).classList.add('active');
  ({agenda,clientes:contacts,ganancias:gains,servicios:settings})[view]();
  window.pushRefreshUI&&pushRefreshUI();
}
const dateLabel=d=>longDate(d);
function moveDay(n){const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()+n);const k=d.toISOString().slice(0,10);if(k<D.today)return;selectedDate=k;agenda()}
function goToday(){selectedDate=D.today;agenda()}

/* ── Agenda ── */
const statusInfo=a=>a.status==='done'?['done','Finalizado']:a.status==='cancelled'?['cancelled','Cancelado']:a.status==='no_show'?['noshow','No asistió']:['pending','Pendiente'];
function eventHTML(a){
  const [cls,label]=statusInfo(a),isT=a.date===D.today;let acts='';
  if(a.status==='pending')acts=`<div class="evacts"><button onclick="editAppointment('${a.id}')">${ico('edit')} Editar</button>${isT?`<button class="go" onclick="finish('${a.id}')">${ico('check')} Hecho</button><button class="wn" onclick="noShow('${a.id}')">${ico('noshow')} No asistió</button>`:''}<button class="bad" onclick="cancelManual('${a.id}')">${ico('x')} Cancelar</button></div>`;
  return `<div class="appt"><div class="tm">${esc(String(a.time).slice(0,5))}</div><div class="ev ${cls}"><div class="hd"><div><div class="nm">${esc(a.name)}</div><span class="tag ${cls}">${label}</span></div><span class="pr">${fmt(a.price)}</span></div><div class="sv">${esc(a.service_name)} · ${a.duration} min</div><div class="ph">${ico('phone')} ${esc(displayWA(a.whatsapp))}</div>${acts}</div></div>`;
}
function agenda(){
  const xs=D.appointments.filter(a=>String(a.date).slice(0,10)===selectedDate).sort((a,b)=>String(a.time).localeCompare(String(b.time))),isToday=selectedDate===D.today;
  const done=xs.filter(a=>a.status==='done'),next=xs.find(a=>a.status==='pending'),now=isToday?new Date().toTimeString().slice(0,5):null,isNow=!!(next&&now&&String(next.time).slice(0,5)<=now);
  const blocks=(D.blocks||[]).filter(b=>String(b.date).slice(0,10)===selectedDate);
  const nextHtml=next?`<div class="next${isNow?' now':''}"><div class="t">${esc(String(next.time).slice(0,5))}</div><div class="mn"><span class="lb">${isNow?'Ahora':'Próximo'}</span><b>${esc(next.name)}</b><small>${esc(next.service_name)} · ${fmt(next.price)}</small></div>${isToday?`<button class="qd" onclick="finish('${next.id}')" aria-label="Marcar como hecho">${ico('check')}</button>`:''}</div>`
   :isToday?`<div class="next" style="opacity:.75"><div class="t">${ico('check')}</div><div class="mn"><span class="lb">Todo al día</span><b>No quedan turnos pendientes</b><small>${done.length?`${done.length} finalizado${done.length===1?'':'s'} hoy`:'Agenda libre'}</small></div></div>`:'';
  const blockHtml=blocks.map(b=>`<div class="lrow group" style="margin-bottom:12px;border-radius:14px"><span style="color:var(--warn)">${ico('block')}</span><div class="main"><b>Horario bloqueado</b><small>${b.whole_day?'Todo el día':esc(String(b.start_time).slice(0,5))+' a '+esc(String(b.end_time).slice(0,5))}${b.reason?' · '+esc(b.reason):''}</small></div><button class="btn sm" onclick="removeBlock('${b.id}')">Quitar</button></div>`).join('');
  $('agenda').innerHTML=`<h1 class="title">${isToday?'Hoy':'Agenda'}</h1><div class="pushSlot" data-kind="banner"></div>
  <div class="today"><div class="d">${dateLabel(selectedDate)}</div><div class="m"><div><b>${xs.filter(a=>a.status!=='cancelled').length}</b><span>turnos</span></div><div><b>${fmt(done.reduce((s,a)=>s+Number(a.price),0))}</b><span>${isToday?'ganado hoy':'ganado ese día'}</span></div></div></div>
  <div class="daynav"><button class="glassbtn" onclick="moveDay(-1)" aria-label="Día anterior" ${selectedDate<=D.today?'disabled style="opacity:.35"':''}>${ico('chevL')}</button><div class="mid">${isToday?'Hoy':esc(dateLabel(selectedDate))}${!isToday?'<button class="btn sm ghost" onclick="goToday()">Hoy</button>':''}</div><button class="glassbtn" onclick="moveDay(1)" aria-label="Día siguiente">${ico('chev')}</button></div>
  ${nextHtml}${blockHtml}<div>${xs.length?xs.map(eventHTML).join(''):`<div class="group"><div class="empty"><b>${isToday?'Día libre':'Sin turnos'}</b>${isToday?'No hay turnos para hoy.':'No hay turnos para esta fecha.'}<br>Tocá + para cargar el primero.</div></div>`}</div>`;
}
async function action(url,id,msg){
  if(msg&&!await confirmD(msg))return false;
  try{await post(url,{id});const a=D?.appointments?.find(x=>x.id===id);if(a)a.status=url.includes('/finish')?'done':url.includes('/no-show')?'no_show':a.status;render();toast('Turno actualizado');api('/admin').then(x=>{D=x;render()}).catch(()=>{});return true}
  catch(e){alertD(e.message);return false}
}
const finish=id=>action('/admin/finish',id,'¿Marcar este turno como terminado?');
const noShow=id=>action('/admin/no-show',id,'¿Marcar este turno como “No asistió”?');
async function cancelManual(id){
  const reason=await promptD('Motivo de cancelación (opcional)','Cancelación realizada por Juan');if(reason===null)return;
  try{await post('/admin/cancel',{id,reason});const a=D?.appointments?.find(x=>x.id===id);if(a)a.status='cancelled';toast('Turno cancelado');render();api('/admin').then(x=>{D=x;render()}).catch(()=>{})}catch(e){alertD(e.message)}
}

/* ── Nuevo turno / bloqueo ── */
function fabMenu(){showSheet(`<h2>Agregar</h2><div class="group" style="margin-top:14px"><button class="lrow" onclick="newAppointment()"><span style="color:var(--red)">${ico('cal')}</span><div class="main"><b>Nuevo turno</b><small>Cargar un turno a mano</small></div><span class="chev">${ico('chev')}</span></button><button class="lrow" onclick="openBlock()"><span style="color:var(--warn)">${ico('block')}</span><div class="main"><b>Bloquear horario</b><small>Cerrar un rango o el día completo</small></div><span class="chev">${ico('chev')}</span></button></div>`)}
async function loadManualTimes(){
  const date=$('ad')?.value,service=$('as')?.value,addon=$('aa')?.value||'',exclude=window.__editId||'',box=$('atWrap');if(!date||!service||!box)return;
  const sel=h=>`<div class="field"><label for="at">Horario disponible</label><select id="at">${h}</select></div>`;
  box.innerHTML=sel('<option>Buscando…</option>');
  try{const r=await api(`/admin-availability?date=${encodeURIComponent(date)}&service=${encodeURIComponent(service)}${addon?'&addon='+encodeURIComponent(addon):''}${exclude?'&exclude='+encodeURIComponent(exclude):''}`);
    box.innerHTML=sel(r.times.length?r.times.map(t=>`<option value="${t}" ${window.__editTime===t?'selected':''}>${t}</option>`).join(''):'<option value="">No hay horarios disponibles</option>')}
  catch(e){box.innerHTML=sel('<option value="">No se pudo cargar</option>')}
}
function appointmentForm(a){
  const max=new Date(Date.now()+365*864e5).toISOString().slice(0,10);
  return `<h2>${a?'Editar turno':'Nuevo turno'}</h2>
  <div class="field"><label for="ac">Cliente</label><select id="ac">${D.clients.map(c=>`<option value="${c.id}" ${a&&c.id===a.client_id?'selected':''}>${esc(c.name)} · ${esc(displayWA(c.whatsapp))}</option>`).join('')}</select></div>
  <div class="field"><label for="as">Servicio</label><select id="as" onchange="loadManualTimes()">${D.services.filter(s=>!s.addon).map(s=>`<option value="${s.id}" ${a&&s.id===a.service_id?'selected':''}>${esc(s.name)} · ${fmt(s.price)} · ${s.duration} min</option>`).join('')}</select></div>
  ${D.services.some(s=>s.addon)?`<div class="field"><label for="aa">Adicional (opcional)</label><select id="aa" onchange="loadManualTimes()"><option value="">Sin adicional</option>${D.services.filter(s=>s.addon).map(s=>`<option value="${s.id}" ${a&&a.addon_id===s.id?'selected':''}>${esc(s.name)} · +${fmt(s.price)} · +${s.duration} min</option>`).join('')}</select></div>`:''}
  <div class="field"><label for="ad">Fecha</label><input id="ad" type="date" min="${D.today}" max="${max}" value="${a?String(a.date).slice(0,10):(selectedDate||D.today)}" onchange="loadManualTimes()"></div>
  <div id="atWrap"></div>
  <div class="field"><label for="an">Nota (opcional)</label><textarea id="an" placeholder="Ej.: pidió cambio de horario">${esc(a?.notes||'')}</textarea></div>
  ${saveBtn(`saveAppointment(${a?`'${a.id}'`:'null'})`,a?'Guardar cambios':'Guardar turno')}`;
}
function newAppointment(){
  if(!D.clients.length){showSheet('<h2>Todavía no hay clientes</h2><p class="sub">Los clientes se registran solos cuando reservan desde tu link. Cuando haya uno vas a poder cargarle turnos a mano.</p><button class="btn" onclick="closeSheet()">Entendido</button>');return}
  window.__editId='';window.__editTime='';showSheet(appointmentForm(null));loadManualTimes();
}
function editAppointment(id){const a=D.appointments.find(x=>x.id===id);if(!a||a.status!=='pending')return;window.__editId=id;window.__editTime=String(a.time).slice(0,5);showSheet(appointmentForm(a));loadManualTimes()}
async function saveAppointment(id){
  try{await post('/admin/appointment',{id:id||null,clientId:$('ac').value,date:$('ad').value,time:$('at').value,serviceId:$('as').value,addonId:$('aa')?.value||'',status:'pending',notes:$('an').value});
    const d=$('ad').value;closeSheet();D=await api('/admin');selectedDate=d;render();toast(id?'Turno actualizado':'Turno creado')}catch(e){alertD(e.message)}
}
function openBlock(){
  showSheet(`<h2>Bloquear horario</h2><div class="field"><label for="bd">Fecha</label><input id="bd" type="date" min="${D.today}" value="${selectedDate}"></div><div class="two"><div class="field"><label for="bs">Desde</label><input id="bs" type="time" value="15:00"></div><div class="field"><label for="be">Hasta</label><input id="be" type="time" value="16:00"></div></div><label class="check-row"><input id="whole" type="checkbox"> Bloquear todo el día</label><div class="field"><label for="br">Motivo (opcional)</label><input id="br"></div>${saveBtn('createBlock()','Continuar')}`);
}
async function createBlock(){
  const cfg={date:$('bd').value,start:$('bs').value,end:$('be').value,wholeDay:$('whole').checked,reason:$('br').value};
  try{await post('/admin/block',{...cfg,confirm:false,cancelAffected:false});closeSheet();D=await api('/admin');toast('Horario bloqueado');render()}
  catch(e){
    if(e.data?.affected){window.__pendingBlock=cfg;const list=e.data.affected.map(a=>`<div class="hrow"><div><b>${esc(String(a.time).slice(0,5))} · ${esc(a.name)}</b><small>${esc(a.service_name)}</small></div></div>`).join('');
      showSheet(`<h2>Hay turnos afectados</h2><p class="sub">Podés conservarlos o cancelarlos y bloquear el horario.</p><div class="group pad" style="margin-top:12px">${list}</div><button class="btn" onclick="closeSheet()">Conservar turnos</button><button class="btn danger" onclick="applyAffectedBlock()">Cancelar y bloquear</button>`)}
    else alertD(e.message)}
}
async function applyAffectedBlock(){
  const cfg=window.__pendingBlock;if(!cfg)return;
  try{await post('/admin/block',{...cfg,confirm:true,cancelAffected:true});window.__pendingBlock=null;closeSheet();D=await api('/admin');toast('Turnos cancelados y horario bloqueado');render()}catch(e){alertD(e.message)}
}
async function removeBlock(id){
  if(!await confirmD('¿Quitar este bloqueo? El horario vuelve a estar disponible para reservar.','Quitar bloqueo'))return;
  try{await post('/admin/block/delete',{id});D=await api('/admin');render();toast('Bloqueo quitado')}catch(e){alertD(e.message)}
}

/* ── Clientes ── */
function contacts(){
  $('clientes').innerHTML=`<h1 class="title">Clientes</h1><div class="sechead" style="padding-top:0"><span>${D.clients.length} registrado${D.clients.length===1?'':'s'}</span></div><input id="clientSearch" class="search" placeholder="Buscar por nombre o WhatsApp" oninput="renderClientList()"><div id="clientList" class="group"></div>`;renderClientList();
}
function renderClientList(){
  const q=($('clientSearch')?.value||'').toLowerCase(),xs=D.clients.filter(c=>String(c.name).toLowerCase().includes(q)||String(c.whatsapp).includes(q)).sort((a,b)=>a.name.localeCompare(b.name));
  $('clientList').innerHTML=xs.length?xs.map(c=>`<button class="lrow" onclick="contactDetail('${c.id}')"><div class="avatar">${esc(initials(c.name))}</div><div class="main"><b>${esc(c.name)}</b><small>${esc(displayWA(c.whatsapp))}</small><small>${c.visits} visita${c.visits===1?'':'s'} · ${fmt(c.total_spent)}</small></div><span class="chev">${ico('chev')}</span></button>`).join(''):'<div class="empty"><b>Sin clientes</b>Los clientes aparecen acá cuando reservan desde tu link.</div>';
}
function contactDetail(id){
  const c=D.clients.find(x=>x.id===id);if(!c)return;
  const up=D.appointments.filter(a=>a.client_id===id&&a.status==='pending').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  showSheet(`<div class="center" style="margin-top:4px"><div class="avatar lg" style="margin:0 auto">${esc(initials(c.name))}</div><h2 style="margin-top:12px">${esc(c.name)}</h2><div class="sub">${esc(displayWA(c.whatsapp))}</div></div>
  <div class="two" style="margin-top:14px"><button class="btn" style="margin:0" onclick="editContact('${c.id}')">${ico('edit')} Editar</button><a class="btn" style="margin:0;text-decoration:none" href="https://wa.me/${encodeURIComponent(String(c.whatsapp).replace(/\D/g,''))}" target="_blank" rel="noopener">${ico('wa')} WhatsApp</a></div>
  <div class="cstats"><div><b>${c.visits}</b><small>Visitas</small></div><div><b>${c.cancellations}</b><small>Cancel.</small></div><div><b>${c.no_shows}</b><small>No asistió</small></div><div><b>${fmt(c.total_spent)}</b><small>Gastado</small></div></div>
  <div class="sechead" style="margin-top:20px"><b>Última visita</b></div><div class="group pad">${c.last_visit?esc(longDate(c.last_visit)):'<span class="muted">Todavía no registró una visita</span>'}</div>
  <div class="sechead" style="margin-top:20px"><b>Próximos turnos</b></div><div class="group pad">${up.length?up.map(a=>`<div class="hrow"><div><b>${esc(longDate(a.date))}</b><small>${esc(String(a.time).slice(0,5))} · ${esc(a.service_name)}</small></div><b>${fmt(a.price)}</b></div>`).join(''):'<span class="muted">No tiene turnos pendientes.</span>'}</div>
  <div class="sechead" style="margin-top:20px"><b>Historial</b></div><div class="group pad" id="hist"><span class="muted">Cargando…</span></div>`);
  api('/admin/client-history?id='+encodeURIComponent(id)).then(r=>{const el=$('hist');if(!el)return;const h=r.history||[];
    el.innerHTML=h.length?h.map(a=>{const [cls,label]=statusInfo(a);return `<div class="hrow"><div><b>${esc(longDate(a.date))}</b><small>${esc(String(a.time).slice(0,5))} · ${esc(a.service_name)}</small></div><div style="text-align:right"><b>${fmt(a.price)}</b><br><span class="tag ${cls}" style="margin:0">${label}</span></div></div>`}).join(''):'<span class="muted">Sin turnos anteriores.</span>'}).catch(()=>{const el=$('hist');if(el)el.innerHTML='<span class="muted">No se pudo cargar el historial.</span>'});
}
function editContact(id){
  const c=D.clients.find(x=>x.id===id);if(!c)return;
  showSheet(`<h2>Editar cliente</h2><div class="field"><label for="cnName">Nombre</label><input id="cnName" value="${esc(c.name)}" autocomplete="name"></div><div class="field"><label for="cnWA">WhatsApp / teléfono</label><input id="cnWA" value="${esc(c.whatsapp)}" inputmode="tel" autocomplete="tel"></div>${saveBtn(`saveContact('${id}')`,'Guardar cambios')}`);
}
async function saveContact(id){
  const name=($('cnName')?.value||'').trim(),whatsapp=($('cnWA')?.value||'').trim();if(!name||!whatsapp)return alertD('Completá nombre y WhatsApp.');
  try{await post('/admin/client',{id,name,whatsapp});D=await api('/admin');closeSheet();contacts();toast('Cliente actualizado')}catch(e){alertD(e.message)}
}

/* ── Ganancias ── */
function gains(){
  const sums=Array.isArray(D.summaries)?D.summaries:[],t=D.today,month=t.slice(0,7),sum=(f,k)=>sums.filter(f).reduce((s,x)=>s+Number(x[k]||0),0);
  const td=sums.find(x=>x.date===t)||{revenue:0,turns:0,cancelled:0},monthRev=sum(x=>String(x.date).slice(0,7)===month,'revenue'),monthTurns=sum(x=>String(x.date).slice(0,7)===month,'turns');
  const months=[];for(let i=2;i>=0;i--){const d=new Date(t+'T12:00:00');d.setDate(1);d.setMonth(d.getMonth()-i);const k=d.toISOString().slice(0,7);months.push([new Intl.DateTimeFormat('es-AR',{month:'short'}).format(d).replace('.',''),sum(x=>String(x.date).slice(0,7)===k,'revenue')])}
  const max=Math.max(1,...months.map(x=>x[1])),n=Number(td.turns||0),c=Number(td.cancelled||0);
  $('ganancias').innerHTML=`<h1 class="title">Ganancias</h1>
  <div class="today"><div class="d">Hoy</div><div class="big">${fmt(td.revenue)}</div><div style="color:#d6a9a5;font-size:14px;margin-top:6px">${n} turno${n===1?'':'s'} hecho${n===1?'':'s'} · ${c} cancelado${c===1?'':'s'}</div></div>
  <div class="stats"><div class="stat"><b>${fmt(monthRev)}</b><small>Este mes</small></div><div class="stat"><b>${monthTurns}</b><small>Turnos hechos este mes</small></div><div class="stat"><b>${fmt(sum(()=>true,'revenue'))}</b><small>Total registrado</small></div><div class="stat"><b>${sum(()=>true,'turns')}</b><small>Turnos hechos en total</small></div><div class="stat"><b>${sum(()=>true,'cancelled')}</b><small>Cancelaciones</small></div><div class="stat"><b>${D.clients.length}</b><small>Clientes</small></div></div>
  <div class="sec"><div class="sechead"><b>Últimos 3 meses</b></div><div class="group pad"><div class="bars">${months.map(([k,v])=>`<div class="bw"><em>${v?fmt(v):''}</em><div class="bar1" style="height:${Math.max(6,v/max*110)}px"></div><span>${k}</span></div>`).join('')}</div></div></div>
  <p class="small" style="margin:14px 4px 0">Los ingresos se registran cuando marcás un turno como “Hecho”.</p>`;
}

/* ── Servicios y ajustes ── */
function settings(){
  const s=D.settings,sc=D.schedule||{},link=location.origin+'/reservar/';
  const days=[['1','Lunes'],['2','Martes'],['3','Miércoles'],['4','Jueves'],['5','Viernes'],['6','Sábado'],['0','Domingo']];
  const rows=days.map(([k,n])=>{const v=sc[k]||sc[Number(k)]||[],a=v[0]||['',''],b=v[1]||['',''];
    return `<div class="sched"><b>${n}</b><div><div class="f"><input id="s${k}a" type="time" value="${a[0]||''}" aria-label="${n} desde"><span class="muted">a</span><input id="s${k}b" type="time" value="${a[1]||''}" aria-label="${n} hasta"></div><div class="f"><input id="s${k}c" type="time" value="${b[0]||''}" aria-label="${n} segunda franja desde"><span class="muted">a</span><input id="s${k}d" type="time" value="${b[1]||''}" aria-label="${n} segunda franja hasta"></div></div></div>`}).join('');
  $('servicios').innerHTML=`<h1 class="title">Servicios</h1>
  <div class="sechead"><b>Tu link de reservas</b></div><div class="group pad"><div class="linkbox">${ico('link')}<span>${esc(link)}</span></div><p class="hint">Compartilo por WhatsApp o Instagram para que tus clientes pidan turno solos.</p><div class="two"><button class="btn" onclick="copyLink()">${ico('copy')} Copiar</button><button class="btn primary" onclick="shareLink()">${ico('share')} Compartir</button></div></div>
  <div class="sec"><div class="sechead"><b>Servicios</b><span>${D.services.length}</span></div><div class="group">${D.services.map(x=>`<button class="lrow" onclick="editService('${x.id}')"><span style="color:var(--red)">${ico('scissors')}</span><div class="main"><b>${esc(x.name)}</b><small>${x.addon?'Adicional · ':''}${x.duration} min · ${x.online?'Reservable online':'Solo cargado por vos'}</small></div><b>${fmt(x.price)}</b><span class="chev">${ico('chev')}</span></button>`).join('')||'<div class="empty">No hay servicios.</div>'}</div><button class="btn" onclick="editService('')">${ico('plus')} Agregar servicio</button></div>
  <div class="sec"><div class="sechead"><b>Promociones</b><span>${(D.promotions||[]).length}</span></div>${(D.promotions||[]).map(promotionCard).join('')||'<div class="group"><div class="empty"><b>Sin promociones</b>Creá una para mostrarla a tus clientes al reservar.</div></div>'}<button class="btn" onclick="editPromotion('')">${ico('tag')} Nueva promoción</button></div>
  <div class="sec"><div class="sechead"><b>Avisos</b></div><div class="pushSlot" data-kind="card"></div></div>
  <div class="sec"><div class="sechead"><b>Local</b></div><div class="group"><div class="lrow"><span style="color:var(--red)">${ico('pin')}</span><div class="main"><small>Dirección</small><b>${esc(s.address)}</b></div></div><div class="lrow"><span style="color:var(--red)">${ico('phone')}</span><div class="main"><small>Teléfono</small><b>${esc(s.phone)}</b></div></div></div><button class="btn" onclick="editSettings()">${ico('edit')} Editar datos</button></div>
  <div class="sec"><div class="sechead"><b>Horarios de atención</b></div><div class="group pad">${rows}<p class="hint">Dejá ambos campos vacíos para cerrar ese día. La segunda franja es opcional.</p><p class="hint">Los turnos se generan desde acá, cada 15 minutos. La hora “hasta” es el último turno que se puede reservar.</p>${saveBtn('saveSchedule()','Guardar horarios')}</div></div>
  <div class="sec"><div class="sechead"><b>Seguridad</b></div><button class="btn" style="margin-top:0" onclick="changePin()">${ico('lock')} Cambiar PIN</button><button class="btn" onclick="changeRecovery()">Cambiar pregunta de recuperación</button><button class="btn danger" onclick="logout()">${ico('out')} Cerrar sesión</button></div>`;
}
async function copyLink(){const l=location.origin+'/reservar/';try{await navigator.clipboard.writeText(l);toast('Link copiado')}catch(e){promptD('Copiá este link',l)}}
async function shareLink(){const l=location.origin+'/reservar/';if(navigator.share){try{await navigator.share({title:'ElMellyBarber',text:'Reservá tu turno con Juan Ceballos',url:l})}catch(e){}}else copyLink()}
function scheduleFromUI(){const sc={};for(let k=0;k<7;k++)sc[k]=[[$('s'+k+'a')?.value||'',$('s'+k+'b')?.value||''],[$('s'+k+'c')?.value||'',$('s'+k+'d')?.value||'']].filter(x=>x[0]&&x[1]);return sc}
async function saveSchedule(){
  try{const sc=scheduleFromUI();for(const k of Object.keys(sc))for(const [a,b] of sc[k])if(a>=b)throw new Error('Cada intervalo debe tener inicio anterior al final.');
    await post('/admin/schedule',{schedule:sc});D=await api('/admin');toast('Horarios guardados');settings()}catch(e){alertD(e.message)}
}
function editService(id){
  const x=id?D.services.find(s=>s.id===id):{name:'',price:0,duration:30,online:true,addon:false};
  showSheet(`<h2>${id?'Editar':'Nuevo'} servicio</h2><div class="field"><label for="sn">Nombre</label><input id="sn" value="${esc(x.name)}"></div><div class="two"><div class="field"><label for="sp">Precio</label><input id="sp" type="number" inputmode="numeric" value="${x.price}"></div><div class="field"><label for="sd">Duración (min)</label><input id="sd" type="number" inputmode="numeric" value="${x.duration}"></div></div><label class="check-row"><input id="so" type="checkbox" ${x.online?'checked':''}> Reservable online</label><label class="check-row"><input id="sa" type="checkbox" ${x.addon?'checked':''}> Es un adicional (opcional, se suma a otro servicio)</label>${saveBtn(`saveService('${id}')`)}`);
}
async function saveService(id){
  try{await post('/admin/service',{id:id||null,name:$('sn').value.trim(),price:Number($('sp').value),duration:Number($('sd').value),online:$('so').checked,addon:$('sa').checked});closeSheet();D=await api('/admin');render();toast('Servicio guardado')}catch(e){alertD(e.message)}
}
function editSettings(){showSheet(`<h2>Datos del local</h2><div class="field"><label for="address">Dirección</label><input id="address" value="${esc(D.settings.address)}"></div><div class="field"><label for="phone">Teléfono</label><input id="phone" value="${esc(D.settings.phone)}" inputmode="tel"></div>${saveBtn('saveSettings()')}`)}
async function saveSettings(){try{await post('/admin/settings',{address:$('address').value,phone:$('phone').value});closeSheet();D=await api('/admin');render();toast('Datos guardados')}catch(e){alertD(e.message)}}
function changePin(){showSheet(`<h2>Cambiar PIN</h2><div class="field"><label for="cpin">Nuevo PIN de 4 dígitos</label><input id="cpin" class="pin" inputmode="numeric" maxlength="4" type="password"></div>${saveBtn('savePin()')}`)}
async function savePin(){const p=$('cpin').value;if(!/^\d{4}$/.test(p))return alertD('El PIN debe tener 4 dígitos.');try{await post('/admin/pin',{pin:p});closeSheet();toast('PIN cambiado')}catch(e){alertD(e.message)}}
function changeRecovery(){showSheet(`<h2>Recuperación</h2><p class="sub">Sirve para recuperar el PIN si lo olvidás.</p><div class="field"><label for="rq">Pregunta</label><input id="rq" value="${esc(D.settings.recoveryQ)}"></div><div class="field"><label for="ra">Respuesta</label><input id="ra" autocomplete="off"></div>${saveBtn('saveRecovery()')}`)}
async function saveRecovery(){try{await post('/admin/recovery',{question:$('rq').value,answer:$('ra').value});closeSheet();D=await api('/admin');render();toast('Recuperación actualizada')}catch(e){alertD(e.message)}}

/* ── Promociones ── */
const ptime=v=>{const s=String(v||'').trim();return /Z$|[+-]\d\d:\d\d$/.test(s)?Date.parse(s):Date.parse(s+':00-03:00')};
const fmtDT=v=>{const d=new Date(String(v).slice(0,16));return isNaN(d)?String(v):d.toLocaleString('es-AR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})};
function promotionStatus(p){const a=ptime(p.starts_at),b=ptime(p.ends_at),n=Date.now();return p.enabled&&a<=n&&n<b?'Activa ahora':p.enabled?(n>=b?'Terminada':'Programada'):'Pausada'}
const promoServicesText=p=>(p.service_ids||[]).map(id=>D.services.find(s=>s.id===id)?.name).filter(Boolean).join(' · ')||'Sin servicios';
function promotionCard(p){
  const st=promotionStatus(p),live=st==='Activa ahora',badge=p.type==='2x1'?'2×1':Number(p.discount_percent)+'% OFF';
  return `<div class="promo-card ${live?'live':''}"><div class="pc-top"><span class="pc-badge">${badge}</span><span class="tag ${live?'done':p.enabled?'pending':'cancelled'}">${st}</span></div><b class="pc-name">${esc(p.name)}</b>${p.message?`<p class="pc-msg">${esc(p.message)}</p>`:''}<small class="small">${esc(promoServicesText(p))}</small><small class="small">${esc(fmtDT(p.starts_at))} → ${esc(fmtDT(p.ends_at))}</small><div class="evacts" style="grid-template-columns:repeat(3,1fr)"><button onclick="editPromotion('${p.id}')">${ico('edit')} Editar</button><button onclick="togglePromotion('${p.id}')">${p.enabled?'Pausar':'Activar'}</button><button class="bad" onclick="deletePromotion('${p.id}')">${ico('x')} Borrar</button></div></div>`;
}
function editPromotion(id){
  const p=id?(D.promotions||[]).find(x=>x.id===id):null,e=new Date(D.today+'T12:00:00');e.setDate(e.getDate()+6);
  const type=p?.type||'percent',start=p?.starts_at||`${D.today}T00:00`,end=p?.ends_at||`${e.toISOString().slice(0,10)}T23:59`,ids=new Set(p?.service_ids||[]);
  showSheet(`<h2>${p?'Editar':'Nueva'} promoción</h2>
  <div class="field"><label for="pn">Nombre</label><input id="pn" maxlength="120" value="${esc(p?.name||'')}" placeholder="Ej.: Promo de primavera"></div>
  <div class="field"><label for="pm">Mensaje para el cliente (opcional)</label><input id="pm" maxlength="300" value="${esc(p?.message||'')}" placeholder="Ej.: Válida hasta el domingo"></div>
  <div class="two"><div class="field"><label for="pt">Tipo</label><select id="pt" onchange="promoTypeChanged()"><option value="percent" ${type==='percent'?'selected':''}>Descuento %</option><option value="2x1" ${type==='2x1'?'selected':''}>2×1</option></select></div><div class="field"><label for="pp">% de descuento</label><input id="pp" type="number" inputmode="numeric" min="1" max="100" value="${type==='2x1'?0:(p?.discount_percent||10)}" ${type==='2x1'?'disabled':''}></div></div>
  <div class="field"><label>Servicios incluidos</label><div class="group pad" style="padding:6px 14px">${D.services.map(s=>`<label class="check-row" style="margin:10px 0"><input class="promoSvc" type="checkbox" value="${s.id}" ${ids.has(s.id)?'checked':''}> ${esc(s.name)}${s.addon?' (adicional)':''}</label>`).join('')}</div></div>
  <div class="field"><label for="ps">Desde (hora de Argentina)</label><input id="ps" type="datetime-local" value="${esc(start)}"></div>
  <div class="field"><label for="pe">Hasta</label><input id="pe" type="datetime-local" value="${esc(end)}"></div>
  <label class="check-row"><input id="pen" type="checkbox" ${p?.enabled===false?'':'checked'}> Promoción habilitada</label>${saveBtn(`savePromotion('${id||''}')`)}`);
}
function promoTypeChanged(){const is2=$('pt').value==='2x1';$('pp').disabled=is2;if(is2)$('pp').value=0;else if(!Number($('pp').value))$('pp').value=10}
async function savePromotion(id){
  try{const ids=[...document.querySelectorAll('.promoSvc:checked')].map(x=>x.value);if(!ids.length)throw new Error('Elegí al menos un servicio.');
    const type=$('pt').value;await post('/admin/promotion',{id:id||null,name:$('pn').value.trim(),message:$('pm').value.trim(),type,discountPercent:type==='2x1'?0:Number($('pp').value),serviceIds:ids,startsAt:$('ps').value,endsAt:$('pe').value,enabled:$('pen').checked});
    closeSheet();D=await api('/admin');render();toast('Promoción guardada')}catch(e){alertD(e.message)}
}
async function togglePromotion(id){try{await post('/admin/promotion/toggle',{id});D=await api('/admin');render();toast('Promoción actualizada')}catch(e){alertD(e.message)}}
async function deletePromotion(id){if(!await confirmD('¿Eliminar esta promoción?','Eliminar',true))return;try{await post('/admin/promotion/delete',{id});D=await api('/admin');render();toast('Promoción eliminada')}catch(e){alertD(e.message)}}

/* ── Avisos ── */
function notifications(){
  const n=D?.notifications||[];
  showSheet(`<h2>Avisos</h2><div class="pushSlot" data-kind="banner"></div><div class="group">${n.length?n.map(x=>`<div class="note"><b>${esc(x.title)}</b><p>${esc(x.body)}</p><button class="btn sm" style="margin-top:10px" onclick="readNote('${x.id}')">Marcar como visto</button></div>`).join(''):'<div class="empty"><b>Sin avisos nuevos</b>Acá aparecen los turnos y cancelaciones.</div>'}</div>`);
}
async function readNote(id){try{await post('/admin/notifications/read',{id});D=await api('/admin');render();notifications()}catch(e){alertD(e.message)}}
boot();
