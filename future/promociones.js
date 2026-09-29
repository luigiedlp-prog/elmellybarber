// ═══ FUTURO · Promociones (descuento por % o 2×1 con vigencia) ═══
// Estaba en ElMellyBarber y NO está en la lista de ElMellyBarber. Se guarda para sumarlo más adelante.
//
// Para reactivarlo hay que:
//   1) Agregar la tabla (abajo) a dbInit() y a schema.sql.
//   2) Pegar el bloque BACKEND en worker.js; usar activePromotion(db) en publicData() y en la ruta /book
//      (precio final = promoPrice(servicio, promocion)) y devolver `promotions` en GET /admin.
//   3) Pegar el bloque PANEL en public/gestion/gestion.js (tarjeta en la pestaña Servicios) y
//      el bloque RESERVA en public/reservar/index.html (insignia y precio tachado en cada servicio).
//   Los estilos hay que rehacerlos con el sistema visual de /app.css (los originales eran de otro diseño).

// ── TABLA ──
`CREATE TABLE IF NOT EXISTS em_promotions (id TEXT PRIMARY KEY,name TEXT NOT NULL,message TEXT NOT NULL DEFAULT '',type TEXT NOT NULL,discount_percent INTEGER NOT NULL DEFAULT 0,service_ids TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`

// ── BACKEND ──
function parsePromotion(row){
  if(!row)return null; let ids=[];try{ids=JSON.parse(row.service_ids||'[]')}catch{}
  return {...row,service_ids:Array.isArray(ids)?ids:[],enabled:!!row.enabled,discount_percent:Number(row.discount_percent||0)};
}
function promoTimestamp(value){const v=String(value||'').trim();if(!v)return NaN;return Date.parse(/Z$|[+-]\d\d:\d\d$/.test(v)?v:`${v}:00-03:00`)}
function promoIsActive(p,now=Date.now()){if(!p||!p.enabled)return false;const a=promoTimestamp(p.starts_at),b=promoTimestamp(p.ends_at);return Number.isFinite(a)&&Number.isFinite(b)&&a<=now&&now<b}
function promoApplies(p,serviceId){return promoIsActive(p)&&Array.isArray(p.service_ids)&&p.service_ids.includes(serviceId)}
function promoPrice(service,p){if(!promoApplies(p,service.id))return Number(service.price);if(p.type==='percent'){const pct=Math.max(0,Math.min(100,Number(p.discount_percent)||0));return Math.round(Number(service.price)*(100-pct)/100)}return Number(service.price)}
async function activePromotion(db){const r=await db.prepare('SELECT * FROM em_promotions WHERE enabled=1 ORDER BY created_at DESC').all();return (r.results||[]).map(parsePromotion).find(x=>promoIsActive(x))||null}
async function allPromotions(db){const r=await db.prepare('SELECT * FROM em_promotions ORDER BY starts_at DESC,created_at DESC').all();return (r.results||[]).map(parsePromotion)}

// ── Rutas del API (dentro de onRequest, después de la comprobación de admin) ──
    if(method==='POST'&&path==='/admin/promotion'){
      const id=String(body.id||'').trim(),name=String(body.name||'').trim(),message=String(body.message||'').trim();
      const type=String(body.type||'percent').trim(),pct=Number(body.discountPercent||0),start=String(body.startsAt||'').trim(),end=String(body.endsAt||'').trim();
      const ids=Array.isArray(body.serviceIds)?[...new Set(body.serviceIds.map(String))]:[];
      if(!name||name.length>120||message.length>300||!['percent','2x1'].includes(type)||!ids.length||!start||!end)return json(400,{error:'Completá nombre, servicios, tipo y vigencia de la promoción'});
      if(type==='percent'&&(!Number.isInteger(pct)||pct<1||pct>100))return json(400,{error:'El descuento debe ser un entero entre 1 y 100'});
      if(type==='2x1'&&pct!==0)return json(400,{error:'La promoción 2x1 no usa porcentaje de descuento'});
      const a=promoTimestamp(start),b=promoTimestamp(end); if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b)return json(400,{error:'La fecha de inicio debe ser anterior al fin'});
      const validServices=(await db.prepare(`SELECT id FROM em_services WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all()).results||[];
      if(validServices.length!==ids.length)return json(400,{error:'Uno o más servicios no existen'});
      const cleanIds=validServices.map(x=>x.id),enabled=body.enabled===false?0:1,promoId=id||uid('p');
      if(id){const existing=await db.prepare('SELECT id FROM em_promotions WHERE id=?').bind(id).first();if(!existing)return json(404,{error:'Promoción no encontrada'});await db.prepare('UPDATE em_promotions SET name=?,message=?,type=?,discount_percent=?,service_ids=?,starts_at=?,ends_at=?,enabled=? WHERE id=?').bind(name,message,type,type==='percent'?pct:0,JSON.stringify(cleanIds),start,end,enabled,id).run();}
      else await db.prepare('INSERT INTO em_promotions(id,name,message,type,discount_percent,service_ids,starts_at,ends_at,enabled) VALUES(?,?,?,?,?,?,?,?,?)').bind(promoId,name,message,type,type==='percent'?pct:0,JSON.stringify(cleanIds),start,end,enabled).run();
      return json(200,{ok:true,id:promoId});
    }
    if(method==='POST'&&path==='/admin/promotion/toggle'){
      const id=String(body.id||'').trim();if(!id)return json(400,{error:'Promoción inválida'});const p=await db.prepare('SELECT enabled FROM em_promotions WHERE id=?').bind(id).first();if(!p)return json(404,{error:'Promoción no encontrada'});await db.prepare('UPDATE em_promotions SET enabled=? WHERE id=?').bind(Number(p.enabled)?0:1,id).run();return json(200,{ok:true,enabled:!Number(p.enabled)});
    }
    if(method==='POST'&&path==='/admin/promotion/delete'){
      const id=String(body.id||'').trim();if(!id)return json(400,{error:'Promoción inválida'});await db.prepare('DELETE FROM em_promotions WHERE id=?').bind(id).run();return json(200,{ok:true});
    }


// ── PANEL (gestión) ──
function promotionStatus(p){const a=promoTimestampClient(p.starts_at),b=promoTimestampClient(p.ends_at),now=Date.now();return p.enabled&&Number.isFinite(a)&&Number.isFinite(b)&&a<=now&&now<b?'Activa ahora':p.enabled?'Programada':'Desactivada'}
function promoTimestampClient(v){const s=String(v||'').trim();if(!s)return NaN;return Date.parse(/Z$|[+-]\d\d:\d\d$/.test(s)?s:`${s}:00-03:00`)}
function promoServicesText(p){return (p.service_ids||[]).map(id=>D.services.find(s=>s.id===id)?.name).filter(Boolean).join(' · ')||'Sin servicios'}
function promotionCard(p){const status=promotionStatus(p),active=status==='Activa ahora',badge=p.type==='2x1'?'2×1':`${Number(p.discount_percent)}% OFF`;return `<div class="promo-admin-card" style="padding:16px;border:1px solid rgba(255,210,72,.42);border-radius:20px;background:linear-gradient(145deg,rgba(72,31,104,.34),rgba(7,25,16,.94));box-shadow:0 16px 42px rgba(0,0,0,.35);margin-top:12px;overflow:hidden"><div class="promo-admin-head" style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div style="min-width:0"><span class="promo-admin-badge" style="display:inline-block;padding:5px 9px;border-radius:999px;background:linear-gradient(90deg,#ffd84d,#b76dff);color:#241d08;font-weight:950;font-size:10px">${badge}</span><b style="display:block;margin-top:9px;font-size:18px;color:#fff">${esc(p.name)}</b><small style="display:block;color:#aeb8b1;margin-top:5px;line-height:1.45">${esc(promoServicesText(p))}<br>${esc(p.starts_at.replace('T',' '))} → ${esc(p.ends_at.replace('T',' '))}<br>${esc(status)}</small></div><div style="font-size:22px;flex:0 0 auto">${active?'🟢':p.enabled?'🟡':'⚪'}</div></div>${p.message?`<div style="margin-top:12px;padding:11px 12px;border-radius:14px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08);color:#eef3ef;font-size:13px;line-height:1.45">${esc(p.message)}</div>`:''}<div class="promo-admin-actions" style="display:grid;grid-template-columns:1fr 1fr 48px;gap:8px;margin-top:12px"><button style="padding:11px;border-radius:13px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;font-weight:800" onclick="editPromotion('${p.id}')">✎ Editar</button><button style="padding:11px;border-radius:13px;border:1px solid ${p.enabled?'rgba(255,69,58,.32)':'rgba(52,199,89,.32)'};background:${p.enabled?'rgba(255,69,58,.08)':'rgba(52,199,89,.08)'};color:${p.enabled?'#ff9b92':'#72ed92'};font-weight:800" onclick="togglePromotion('${p.id}')">${p.enabled?'Desactivar':'Activar'}</button><button style="padding:11px;border-radius:13px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff" onclick="deletePromotion('${p.id}')">🗑️</button></div></div>`}
function editPromotion(id){const p=id?(D.promotions||[]).find(x=>x.id===id):null;const services=D.services||[];const type=p?.type||'percent',pct=p?.discount_percent||10,start=p?.starts_at||`${D.today}T09:00`,end=p?.ends_at||`${D.today}T23:59`,checkedIds=new Set(p?.service_ids||[]);const list=services.map(s=>`<label class="promo-service-item"><input type="checkbox" class="promoSvc" value="${esc(s.id)}" ${checkedIds.has(s.id)?'checked':''}><span><b>${esc(s.name)}</b><small>${fmt(s.price)} · ${s.duration} min</small></span></label>`).join('');showSheet(`<div class="handle"></div><h2>${p?'Editar':'Nueva'} promoción</h2><div class="field"><label>Nombre</label><input id="pn" value="${esc(p?.name||'Promoción exclusiva')}"></div><div class="field"><label>Servicios</label><div class="promo-service-list">${list}</div><div class="promo-type-help">Podés elegir uno, varios o todos los servicios.</div></div><div class="field"><label>Tipo</label><select id="pt" onchange="promoTypeChanged()"><option value="percent" ${type==='percent'?'selected':''}>Descuento por porcentaje</option><option value="2x1" ${type==='2x1'?'selected':''}>2×1</option></select></div><div class="field"><label>Porcentaje de descuento</label><input id="pp" type="number" min="1" max="100" value="${pct}" ${type==='2x1'?'disabled':''}><div class="promo-type-help">En 2×1 queda desactivado: no se aplica porcentaje.</div></div><div class="field"><label>Desde</label><input id="pstart" type="datetime-local" value="${start}"></div><div class="field"><label>Hasta</label><input id="pend" type="datetime-local" value="${end}"></div><div class="field"><label>Texto que verá el cliente</label><textarea id="pmsg" placeholder="Ej.: Solo por viernes y sábado...">${esc(p?.message||'')}</textarea></div><button class="save" style="width:100%;padding:13px;border-radius:14px;margin-top:15px" onclick="savePromotion('${id}')">Guardar promoción</button>`)}
function promoTypeChanged(){const is2=$('pt').value==='2x1';$('pp').disabled=is2;if(is2)$('pp').value=0;else if(!$('pp').value)$('pp').value=10}
async function savePromotion(id){try{const ids=[...document.querySelectorAll('.promoSvc:checked')].map(x=>x.value);if(!ids.length)throw new Error('Elegí al menos un servicio.');const type=$('pt').value,pct=type==='2x1'?0:Number($('pp').value),payload={id:id||null,name:$('pn').value.trim(),serviceIds:ids,type,discountPercent:pct,startsAt:$('pstart').value,endsAt:$('pend').value,message:$('pmsg').value.trim(),enabled:true};await api('/admin/promotion',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});closeSheet();D=await api('/admin');settings();toast('Promoción guardada')}catch(e){alert(e.message)}}
async function togglePromotion(id){try{await api('/admin/promotion/toggle',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});D=await api('/admin');settings();toast('Promoción actualizada')}catch(e){alert(e.message)}}
async function deletePromotion(id){if(!confirm('¿Eliminar esta promoción?'))return;try{await api('/admin/promotion/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});D=await api('/admin');settings();toast('Promoción eliminada')}catch(e){alert(e.message)}}

// ── RESERVA (cliente) ──
function promoForService(s){const p=data.promotion;if(!p||!Array.isArray(p.service_ids)||!p.service_ids.includes(s.id))return null;return p}
function promoDisplayPrice(s,p){if(!p)return Number(s.price);if(p.type==='percent')return Math.round(Number(s.price)*(100-Number(p.discount_percent||0))/100);return Number(s.price)}
function promoText(p){return p?.message||''}
