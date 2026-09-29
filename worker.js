// ElMellyBarber — Cloudflare Worker (API + D1 + avisos push + recordatorios).
// Las páginas (/reservar/ y /gestion/) son archivos estáticos dentro de /public.
// D1 se lee desde env.DB. Variables para avisos: VAPID_PUBLIC_KEY, VAPID_SUBJECT y el secreto VAPID_PRIVATE_KEY.

// ═══════════════ Notificaciones push (Web Push: VAPID + cifrado aes128gcm, RFC 8291/8292) ═══════════════
// Requiere en Cloudflare: variable VAPID_PUBLIC_KEY, variable VAPID_SUBJECT y SECRETO VAPID_PRIVATE_KEY.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|updates-autopush\.(prod|stage)\.mozaws\.net|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/i;
const pushEnc = s => new TextEncoder().encode(s);
const b64u = {
  enc(buf){ const b=new Uint8Array(buf); let s=''; for(const x of b) s+=String.fromCharCode(x); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); },
  dec(str){ let s=String(str).replace(/-/g,'+').replace(/_/g,'/'); s+='='.repeat((4-s.length%4)%4); const bin=atob(s); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
};
function concatBytes(...parts){ const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let o=0; for(const p of parts){ out.set(p,o); o+=p.length; } return out; }
async function hkdf(salt,ikm,info,length){
  const key=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,length*8));
}
// Cifra el mensaje para el navegador destino. `opts` (par de claves y salt) existe solo para pruebas.
async function pushEncrypt(sub,payloadBytes,opts={}){
  const uaPublic=b64u.dec(sub.p256dh), authSecret=b64u.dec(sub.auth);
  const as=opts.keyPair||await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const asPublic=new Uint8Array(await crypto.subtle.exportKey('raw',as.publicKey));
  const uaKey=await crypto.subtle.importKey('raw',uaPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:uaKey},as.privateKey,256));
  const ikm=await hkdf(authSecret,shared,concatBytes(pushEnc('WebPush: info\0'),uaPublic,asPublic),32);
  const salt=opts.salt||crypto.getRandomValues(new Uint8Array(16));
  const cek=await hkdf(salt,ikm,pushEnc('Content-Encoding: aes128gcm\0'),16);
  const nonce=await hkdf(salt,ikm,pushEnc('Content-Encoding: nonce\0'),12);
  const aes=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},aes,concatBytes(payloadBytes,new Uint8Array([2]))));
  return concatBytes(salt,new Uint8Array([0,0,0x10,0]),new Uint8Array([asPublic.length]),asPublic,cipher);
}
const vapidCache={keyFor:null,key:null,jwt:new Map()};
async function vapidPrivateKey(env){
  if(vapidCache.key&&vapidCache.keyFor===env.VAPID_PRIVATE_KEY) return vapidCache.key;
  const pub=b64u.dec(env.VAPID_PUBLIC_KEY);
  const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',d:env.VAPID_PRIVATE_KEY,x:b64u.enc(pub.slice(1,33)),y:b64u.enc(pub.slice(33,65)),ext:true},{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  vapidCache.key=key; vapidCache.keyFor=env.VAPID_PRIVATE_KEY; vapidCache.jwt.clear();
  return key;
}
async function vapidJWT(env,audience){
  const now=Math.floor(Date.now()/1000), hit=vapidCache.jwt.get(audience);
  if(hit&&hit.exp-now>3600) return hit.jwt;
  const exp=now+12*3600;
  const head=b64u.enc(pushEnc(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const claims=b64u.enc(pushEnc(JSON.stringify({aud:audience,exp,sub:env.VAPID_SUBJECT||'mailto:contacto@elmellybarber.com'})));
  const sig=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},await vapidPrivateKey(env),pushEnc(`${head}.${claims}`)));
  const jwt=`${head}.${claims}.${b64u.enc(sig)}`;
  vapidCache.jwt.set(audience,{jwt,exp});
  return jwt;
}
function pushReady(env){ return !!(env&&env.DB&&env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY); }
async function sendWebPush(env,sub,payload,ttl=86400){
  const audience=new URL(sub.endpoint).origin;
  const body=await pushEncrypt(sub,pushEnc(JSON.stringify(payload)));
  const res=await fetch(sub.endpoint,{method:'POST',headers:{
    'Authorization':`vapid t=${await vapidJWT(env,audience)}, k=${env.VAPID_PUBLIC_KEY}`,
    'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','TTL':String(ttl),'Urgency':'high'
  },body});
  return res.status;
}
function cleanSub(s){
  const endpoint=String(s?.endpoint||''), p256dh=String(s?.keys?.p256dh||''), auth=String(s?.keys?.auth||'');
  let u; try{ u=new URL(endpoint); }catch{ return null; }
  if(u.protocol!=='https:'||!PUSH_HOSTS.test(u.hostname)||endpoint.length>700) return null;
  try{ if(b64u.dec(p256dh).length!==65||b64u.dec(auth).length<16) return null; }catch{ return null; }
  return {endpoint,p256dh,auth};
}
async function saveSub(db,role,clientId,sub){
  await db.prepare(`INSERT INTO em_push_subs(id,role,client_id,endpoint,p256dh,auth) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint,role,client_id) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth`).bind(uid('ps'),role,clientId||'',sub.endpoint,sub.p256dh,sub.auth).run();
}
// Envía a todos los dispositivos de un rol ('admin' o 'client'+id). Devuelve cuántos lo recibieron.
async function pushToRole(env,role,clientId,payload,ttl=86400){
  const subs=(await env.DB.prepare('SELECT id,endpoint,p256dh,auth FROM em_push_subs WHERE role=? AND client_id=?').bind(role,clientId||'').all()).results||[];
  let ok=0;
  await Promise.all(subs.map(async s=>{
    try{
      const st=await sendWebPush(env,s,payload,ttl);
      if(st>=200&&st<300) ok++;
      else if(st===404||st===410) await env.DB.prepare('DELETE FROM em_push_subs WHERE id=?').bind(s.id).run();
      else console.error('PUSH_STATUS',st,new URL(s.endpoint).hostname);
    }catch(e){ console.error('PUSH_SEND_ERROR',String(e?.message||e)); }
  }));
  return ok;
}
// Bandeja de salida: cada aviso guardado en em_notifications / em_client_notifications con pushed=0 se envía una sola vez
// (pushed: 0 pendiente · 2 enviándose · 1 listo). El "reclamo" es atómico, así que dos ejecuciones simultáneas no lo duplican.
async function flushPush(env){
  if(!pushReady(env)) return 0;
  const db=env.DB; let sent=0;
  // Los avisos de hace más de 2 horas ya no sirven (se descartan). Los que quedaron "enviándose" por más de 5 minutos
  // (una ejecución que se cortó a mitad de camino) vuelven a la cola.
  await db.batch([
    db.prepare(`UPDATE em_notifications SET pushed=1 WHERE pushed=0 AND created_at<datetime('now','-2 hours')`),
    db.prepare(`UPDATE em_client_notifications SET pushed=1 WHERE pushed=0 AND created_at<datetime('now','-2 hours')`),
    db.prepare(`UPDATE em_notifications SET pushed=0 WHERE pushed=2 AND created_at<datetime('now','-5 minutes') AND created_at>=datetime('now','-2 hours')`),
    db.prepare(`UPDATE em_client_notifications SET pushed=0 WHERE pushed=2 AND created_at<datetime('now','-5 minutes') AND created_at>=datetime('now','-2 hours')`)
  ]);
  const admin=(await db.prepare(`SELECT id,kind,title,body FROM em_notifications WHERE pushed=0 ORDER BY created_at LIMIT 4`).all()).results||[];
  for(const n of admin){
    const claim=await db.prepare(`UPDATE em_notifications SET pushed=2 WHERE id=? AND pushed=0`).bind(n.id).run();
    if(Number(claim?.meta?.changes||0)!==1) continue;
    try{
      // Lo que Juan hace desde Gestión (admin_cancel) queda en su lista de avisos pero no le llega como push a sí mismo.
      if(n.kind!=='admin_cancel') sent+=await pushToRole(env,'admin','',{title:n.title,body:n.body,url:'/gestion/',tag:n.id},n.kind==='reminder'?1800:86400);
    }catch(e){ console.error('PUSH_ADMIN_ERROR',String(e?.message||e)); }
    await db.prepare('UPDATE em_notifications SET pushed=1 WHERE id=?').bind(n.id).run();
  }
  const clients=(await db.prepare(`SELECT id,client_id,kind,title,body FROM em_client_notifications WHERE pushed=0 ORDER BY created_at LIMIT 4`).all()).results||[];
  for(const n of clients){
    const claim=await db.prepare(`UPDATE em_client_notifications SET pushed=2 WHERE id=? AND pushed=0`).bind(n.id).run();
    if(Number(claim?.meta?.changes||0)!==1) continue;
    try{ sent+=await pushToRole(env,'client',n.client_id,{title:n.title,body:n.body,url:'/reservar/',tag:n.id},n.kind==='reminder'?1800:86400); }
    catch(e){ console.error('PUSH_CLIENT_ERROR',String(e?.message||e)); }
    await db.prepare('UPDATE em_client_notifications SET pushed=1 WHERE id=?').bind(n.id).run();
  }
  return sent;
}
// Recordatorio: turnos pendientes que empiezan dentro de la próxima hora y todavía no avisamos (una sola vez por turno).
async function createReminders(db){
  const t=today(), tomorrow=new Date(Date.parse(`${t}T12:00:00Z`)+86400000).toISOString().slice(0,10);
  const rs=(await db.prepare(`SELECT a.id,a.date,a.time,a.service_name,a.client_id,c.name FROM em_appointments a JOIN em_clients c ON c.id=a.client_id WHERE a.status='pending' AND a.reminded_at IS NULL AND a.date IN (?,?) ORDER BY a.date,a.time`).bind(t,tomorrow).all()).results||[];
  if(!rs.length) return 0;
  const st=await settings(db); let made=0;
  for(const a of rs){
    const hm=String(a.time).slice(0,5);
    const left=(Date.parse(`${a.date}T${hm}:00-03:00`)-Date.now())/60000;
    if(!(left>0&&left<=61)) continue;
    const cuando=Math.round(left)>=55?'en 1 hora':`en ${Math.max(1,Math.round(left))} min`;
    // Un solo lote atómico. Los ids son fijos por turno (nrem_/cnrem_ + id del turno): aunque dos ejecuciones del cron
    // coincidan, o una se repita tras un error, el aviso se crea UNA sola vez (INSERT OR IGNORE).
    const res=await db.batch([
      // Para Juan el recordatorio llega solo como push (seen=1: no ensucia su lista de avisos).
      db.prepare(`INSERT OR IGNORE INTO em_notifications(id,kind,title,body,seen,pushed) SELECT ?,?,?,?,1,0 WHERE EXISTS(SELECT 1 FROM em_appointments WHERE id=? AND status='pending')`).bind('nrem_'+a.id,'reminder',`Turno ${cuando}`,`${a.name} · ${a.service_name} · ${hm}`,a.id),
      db.prepare(`INSERT OR IGNORE INTO em_client_notifications(id,client_id,kind,title,body,pushed) SELECT ?,?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM em_appointments WHERE id=? AND status='pending')`).bind('cnrem_'+a.id,a.client_id,'reminder',`Tu turno es ${cuando}`,`${a.service_name} · ${a.date===t?'hoy':'mañana'} a las ${hm} · ${st.address}`,a.id),
      db.prepare(`UPDATE em_appointments SET reminded_at=CURRENT_TIMESTAMP WHERE id=? AND reminded_at IS NULL`).bind(a.id)
    ]);
    if(Number(res?.[0]?.meta?.changes||0)===1) made++;
  }
  return made;
}
async function runScheduled(env){
  const db=env.DB; if(!db) return;
  await dbInitOnce(db); await rolloverOnce(db);
  await createReminders(db);
  await flushPush(env);
}
const DEFAULTS = {
  address: 'Pergamino, Buenos Aires',
  phone: '+54 9 2477 233313',
  pin: '5820',
  recoveryQ: '¿En qué ciudad está la barbería?',
  recoveryA: 'Pergamino',
  // 0 = domingo … 6 = sábado. Cada día admite hasta 2 franjas [desde, hasta].
  schedule: {
    1: [['10:00','20:00']],
    2: [['10:00','20:00']],
    3: [['10:00','20:00']],
    4: [['10:00','20:00']],
    5: [['10:00','20:00']],
    6: [['10:00','20:00']]
  }
};
const SERVICES = [
  ['s1','Corte',10000,30],
  ['s2','Corte + barba',13000,45]
];

const json = (status, body, headers={}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers }
});
const uid = p => `${p}${crypto.randomUUID().replaceAll('-','').slice(0,12)}`;
const minutes = t => { const [h,m]=String(t).slice(0,5).split(':').map(Number); return h*60+m; };
const hhmm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date());
function cleanWA(v){
  const d=String(v||'').replace(/\D/g,'');
  if(d.startsWith('549')&&d.length===13)return d;
  if(d.startsWith('54')&&d.length===12)return '549'+d.slice(2);
  if(d.startsWith('9')&&d.length===11)return '54'+d;
  if(d.length===10)return '549'+d;
  return d;
}
function waVariants(v){
  const d=String(v||'').replace(/\D/g,'');
  const c=cleanWA(d), out=new Set([c,d]);
  if(c.length===13&&c.startsWith('549')){const local=c.slice(3);out.add(local);out.add('9'+local);out.add('54'+local);}
  return [...out].filter(Boolean);
}
function isValidWA(v){ const d=String(v||''); return /^549\d{10}$/.test(d); }
async function clientByWA(db,wa){
  const vs=waVariants(wa),qs=vs.map(()=>'?').join(',');
  return db.prepare(`SELECT * FROM em_clients WHERE whatsapp IN (${qs}) ORDER BY CASE whatsapp WHEN ? THEN 0 ELSE 1 END LIMIT 1`).bind(...vs,cleanWA(wa)).first();
}

async function sha256(value){
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function cookies(req){
  const out={};
  for(const part of (req.headers.get('cookie')||'').split(';')){
    const [k,...v]=part.trim().split('='); if(k) out[k]=v.join('=');
  }
  return out;
}
function sessionCookie(token){
  return `em_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
}
function clearSessionCookie(){ return 'em_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'; }
function dateDiff(a,b){ return Math.round((new Date(`${a}T12:00:00Z`)-new Date(`${b}T12:00:00Z`))/86400000); }
function validDate(date){ const d=dateDiff(date,today()); return d>=0 && d<=2; }
function currentMinutesAR(){ const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()); return Number(parts.find(x=>x.type==='hour')?.value||0)*60+Number(parts.find(x=>x.type==='minute')?.value||0); }
function slotTimes(start,duration){ const out=[]; for(let m=minutes(start);m<minutes(start)+duration;m+=15) out.push(hhmm(m)); return out; }
async function scheduleFor(db,date){ const st=await settings(db); let sc=DEFAULTS.schedule; try{if(st?.schedule_json) sc=JSON.parse(st.schedule_json)||DEFAULTS.schedule}catch{} const dow=new Date(`${date}T12:00:00Z`).getUTCDay(); return sc[dow]||sc[String(dow)]||[]; }
function startsFromSchedule(schedule,date,duration){ const out=[]; for(const [a,b] of schedule){ for(let m=minutes(a);m<=minutes(b);m+=15){ if(m>=1440) continue; out.push(hhmm(m)); } } return [...new Set(out)]; }
async function startsFor(db,date,duration){ if(!validDate(date)) return []; let out=startsFromSchedule(await scheduleFor(db,date),date,duration); if(date===today()){ const now=currentMinutesAR(); out=out.filter(t=>minutes(t)>=now); } return out; }
async function startInsideSchedule(db,date,time){ return (await scheduleFor(db,date)).some(([a,b])=>minutes(time)>=minutes(a)&&minutes(time)<=minutes(b)); }
async function allowedStart(db,date,time,duration){ if(!await startInsideSchedule(db,date,time)) return false; return (await startsFor(db,date,duration)).includes(time); }
async function ensureColumn(db,table,column,definition){
  try{await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();return true;}
  catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e))) throw e;return false;}
}
async function migrate(db){
  await ensureColumn(db,'em_settings','schedule_json','TEXT');
  await ensureColumn(db,'em_appointments','cancel_source','TEXT');
  await ensureColumn(db,'em_appointments','cancel_reason','TEXT');
  await ensureColumn(db,'em_appointments','no_show_at','TEXT');
  await ensureColumn(db,'em_clients','no_shows','INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db,'em_daily_summaries','cancelled','INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db,'em_appointments','reminded_at','TEXT');
  // Avisos push: los avisos que ya existían se marcan como enviados (pushed=1) para no mandar de golpe el historial viejo.
  if(await ensureColumn(db,'em_notifications','pushed','INTEGER NOT NULL DEFAULT 0')) await db.prepare('UPDATE em_notifications SET pushed=1').run();
  if(await ensureColumn(db,'em_client_notifications','pushed','INTEGER NOT NULL DEFAULT 0')) await db.prepare('UPDATE em_client_notifications SET pushed=1').run();
}

let initPromise=null;
let rolloverDay=null;
let rolloverPromise=null;
async function dbInitOnce(db){if(!initPromise)initPromise=dbInit(db).catch(e=>{initPromise=null;throw e});return initPromise}
async function rolloverOnce(db){const now=today();if(rolloverDay===now)return;if(!rolloverPromise)rolloverPromise=rollover(db).then(()=>{rolloverDay=now}).catch(e=>{rolloverPromise=null;throw e});await rolloverPromise}

async function dbInit(db){
  // The schema is installed from schema.sql before first use. This tiny bootstrap is idempotent
  // and makes a fresh D1 database self-starting even when the schema was not imported yet.
  const statements = [
    `CREATE TABLE IF NOT EXISTS em_settings (id INTEGER PRIMARY KEY,address TEXT NOT NULL,phone TEXT NOT NULL,pin_hash TEXT NOT NULL,recovery_q TEXT NOT NULL,recovery_a_hash TEXT NOT NULL,schedule_json TEXT)`,
    `CREATE TABLE IF NOT EXISTS em_services (id TEXT PRIMARY KEY,name TEXT NOT NULL,price INTEGER NOT NULL,duration INTEGER NOT NULL,online INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS em_clients (id TEXT PRIMARY KEY,name TEXT NOT NULL,whatsapp TEXT UNIQUE NOT NULL,visits INTEGER NOT NULL DEFAULT 0,cancellations INTEGER NOT NULL DEFAULT 0,late_cancellations INTEGER NOT NULL DEFAULT 0,no_shows INTEGER NOT NULL DEFAULT 0,total_spent INTEGER NOT NULL DEFAULT 0,last_visit TEXT)`,
    `CREATE TABLE IF NOT EXISTS em_appointments (id TEXT PRIMARY KEY,client_id TEXT NOT NULL,service_id TEXT NOT NULL,service_name TEXT NOT NULL,price INTEGER NOT NULL,duration INTEGER NOT NULL,date TEXT NOT NULL,time TEXT NOT NULL,status TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'online',notes TEXT DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,cancelled_at TEXT,late_cancel INTEGER NOT NULL DEFAULT 0,cancel_source TEXT,cancel_reason TEXT,no_show_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS em_slots (date TEXT NOT NULL,time TEXT NOT NULL,owner_id TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(date,time))`,
    `CREATE TABLE IF NOT EXISTS em_blocks (id TEXT PRIMARY KEY,date TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,whole_day INTEGER NOT NULL DEFAULT 0,reason TEXT DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS em_notifications (id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,seen INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS em_client_notifications (id TEXT PRIMARY KEY,client_id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,seen INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_client_notifications ON em_client_notifications(client_id,seen,created_at)`,
    `CREATE TABLE IF NOT EXISTS em_sessions (token_hash TEXT PRIMARY KEY,expires_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS em_auth_attempts (kind TEXT NOT NULL,ip TEXT NOT NULL,created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_auth_attempts ON em_auth_attempts(kind,ip,created_at)`,
    `CREATE TABLE IF NOT EXISTS em_daily_summaries (date TEXT PRIMARY KEY,turns INTEGER NOT NULL DEFAULT 0,revenue INTEGER NOT NULL DEFAULT 0,cancelled INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_appt_date_time ON em_appointments(date,time)`,
    `CREATE INDEX IF NOT EXISTS idx_appt_client ON em_appointments(client_id,date)`,
    `CREATE INDEX IF NOT EXISTS idx_blocks_date ON em_blocks(date)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_seen ON em_notifications(seen,created_at)`,
    `CREATE TABLE IF NOT EXISTS em_push_subs (id TEXT PRIMARY KEY,role TEXT NOT NULL,client_id TEXT NOT NULL DEFAULT '',endpoint TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(endpoint,role,client_id))`,
    `CREATE INDEX IF NOT EXISTS idx_push_role ON em_push_subs(role,client_id)`
  ];
  await db.batch(statements.map(s=>db.prepare(s)));
  await migrate(db);
  const st=await db.prepare('SELECT * FROM em_settings WHERE id=1').first();
  const isDupError=e=>/unique|constraint/i.test(String(e?.message||e));
  if(!st){
    try{
      await db.prepare('INSERT INTO em_settings(id,address,phone,pin_hash,recovery_q,recovery_a_hash,schedule_json) VALUES(1,?,?,?,?,?,?)')
        .bind(DEFAULTS.address,DEFAULTS.phone,await sha256(DEFAULTS.pin),DEFAULTS.recoveryQ,await sha256(DEFAULTS.recoveryA.toLowerCase()),JSON.stringify(DEFAULTS.schedule)).run();
    }catch(e){ if(!isDupError(e)) throw e; }
  } else if(!st.schedule_json){ await db.prepare('UPDATE em_settings SET schedule_json=? WHERE id=1').bind(JSON.stringify(DEFAULTS.schedule)).run();
  }
  const n=await db.prepare('SELECT COUNT(*) AS n FROM em_services').first();
  if(Number(n?.n||0)===0){
    try{
      await db.batch(SERVICES.map(s=>db.prepare('INSERT INTO em_services(id,name,price,duration,online) VALUES(?,?,?,?,1)').bind(...s)));
    }catch(e){ if(!isDupError(e)) throw e; }
  }
}
async function rollover(db){
  const now=today();
  await db.prepare("DELETE FROM em_sessions WHERE expires_at<CURRENT_TIMESTAMP").run();
  const old=await db.prepare(`SELECT * FROM em_appointments WHERE date<? AND status='pending'`).bind(now).all();
  for(const a of old.results||[]){
    // Idempotent: only the worker that successfully changes pending -> no_show updates the client.
    const changed=await db.prepare(`UPDATE em_appointments SET status='no_show',no_show_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`).bind(a.id).run();
    if(Number(changed?.meta?.changes||0)!==1) continue;
    await db.batch([
      db.prepare('DELETE FROM em_slots WHERE owner_id=?').bind(a.id),
      db.prepare('UPDATE em_clients SET no_shows=no_shows+1 WHERE id=?').bind(a.client_id)
    ]);
  }
}
async function settings(db){ return db.prepare('SELECT * FROM em_settings WHERE id=1').first(); }
async function isAdmin(req,db){
  const raw=cookies(req).em_session; if(!raw) return false;
  const h=await sha256(raw);
  const r=await db.prepare('SELECT 1 FROM em_sessions WHERE token_hash=? AND expires_at>CURRENT_TIMESTAMP').bind(h).first();
  return !!r;
}
async function notify(db,kind,title,body){ await db.prepare('INSERT INTO em_notifications(id,kind,title,body) VALUES(?,?,?,?)').bind(uid('n'),kind,title,body).run(); }
async function service(db,id){ return db.prepare('SELECT * FROM em_services WHERE id=?').bind(id).first(); }
async function occupiedSlots(db,date){ return db.prepare('SELECT time FROM em_slots WHERE date=? ORDER BY time').bind(date).all(); }
async function publicData(db){
  const st=await settings(db); const sv=await db.prepare('SELECT id,name,price,duration FROM em_services WHERE online=1 ORDER BY name').all();
  let schedule=DEFAULTS.schedule;try{if(st.schedule_json)schedule=JSON.parse(st.schedule_json)||schedule}catch{} return {address:st.address,phone:st.phone,services:sv.results,schedule,days:3,today:today()};
}
async function canReserve(db,date,time,duration,excludeOwner=null){
  if(!validDate(date)||!await allowedStart(db,date,time,duration)) return false;
  const slots=slotTimes(time,duration); if(slots.some(t=>minutes(t)>=1440)) return false;
  const occupied=excludeOwner ? await db.prepare('SELECT time FROM em_slots WHERE date=? AND owner_id<>?').bind(date,excludeOwner).all() : await occupiedSlots(db,date);
  const blocked=new Set((occupied.results||[]).map(x=>String(x.time).slice(0,5)));
  return slots.every(t=>!blocked.has(t));
}

async function canReserveAny(db,date,time,duration,excludeOwner=null){
  const schedule=await scheduleFor(db,date);
  if(date===today() && minutes(time)<currentMinutesAR()) return false;
  if(!schedule.some(([a,b])=>minutes(time)>=minutes(a)&&minutes(time)<=minutes(b))) return false;
  if(!startsFromSchedule(schedule,date,duration).includes(time)) return false;
  const slots=slotTimes(time,duration); if(slots.some(t=>minutes(t)>=1440)) return false;
  const q=excludeOwner ? await db.prepare('SELECT time FROM em_slots WHERE date=? AND owner_id<>?').bind(date,excludeOwner).all() : await occupiedSlots(db,date);
  const blocked=new Set((q.results||[]).map(x=>String(x.time).slice(0,5)));
  return slots.every(t=>!blocked.has(t));
}

async function insertAppointment(db,{id,clientId,s,date,time,status='pending',source='online',notes=''}){
  const stm=[db.prepare(`INSERT INTO em_appointments(id,client_id,service_id,service_name,price,duration,date,time,status,source,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id,clientId,s.id,s.name,s.price,s.duration,date,time,status,source,notes)];
  for(const t of slotTimes(time,s.duration)) stm.push(db.prepare('INSERT INTO em_slots(date,time,owner_id,kind) VALUES(?,?,?,?)').bind(date,t,id,'appointment'));
  await db.batch(stm);
}
async function cancelAppointment(db,a,{late=false,source='customer',reason=''}={}){
  const half=late?Math.round(a.price/2):0;
  const guard=await db.prepare(`UPDATE em_appointments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,late_cancel=?,cancel_source=?,cancel_reason=? WHERE id=? AND status='pending'`).bind(late?1:0,source,reason||'',a.id).run();
  if(Number(guard?.meta?.changes||0)!==1) return {ok:false};
  await db.batch([
    db.prepare('DELETE FROM em_slots WHERE owner_id=?').bind(a.id),
    db.prepare(`UPDATE em_clients SET cancellations=cancellations+1,late_cancellations=late_cancellations+? WHERE id=?`).bind(late?1:0,a.client_id),
    db.prepare(`INSERT INTO em_daily_summaries(date,turns,revenue,cancelled) VALUES(?,0,0,1) ON CONFLICT(date) DO UPDATE SET cancelled=cancelled+1`).bind(a.date),
    db.prepare('INSERT INTO em_client_notifications(id,client_id,kind,title,body) VALUES(?,?,?,?,?)').bind(uid('cn'),a.client_id,late?'late_cancel':'cancel','Turno cancelado',late?`Tu turno del ${a.date} a las ${String(a.time).slice(0,5)} fue cancelado. Se notificó a Juan Ceballos.`:`Tu turno del ${a.date} a las ${String(a.time).slice(0,5)} fue cancelado.`),
    db.prepare('INSERT INTO em_notifications(id,kind,title,body) VALUES(?,?,?,?)').bind(uid('n'),late?'late_cancel':source==='admin'?'admin_cancel':'cancel',source==='admin'?'Turno cancelado por Juan':late?'Cancelación con menos de 1 hora':'Turno cancelado',late?`${a.service_name} · ${a.date} · ${String(a.time).slice(0,5)} · corresponde informar 50% (${half})`:`${a.service_name} · ${a.date} · ${String(a.time).slice(0,5)}`)
  ]);
  return {ok:true,half};
}


async function authReserve(db,request,kind,limit=6,windowModifier='-15 minutes'){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  await db.prepare("DELETE FROM em_auth_attempts WHERE created_at<datetime('now','-24 hours')").run();
  // Atómico: el INSERT solo se concreta si, en la MISMA sentencia, el conteo sigue bajo el límite.
  // Esto elimina la ventana de carrera entre "contar" e "insertar" de la versión anterior.
  const r=await db.prepare(`INSERT INTO em_auth_attempts(kind,ip,created_at) SELECT ?,?,CURRENT_TIMESTAMP WHERE (SELECT COUNT(*) FROM em_auth_attempts WHERE kind=? AND ip=? AND created_at>datetime('now',?))<?`).bind(kind,ip,kind,ip,windowModifier,limit).run();
  return Number(r?.meta?.changes||0)===1;
}
async function authSuccess(db,request,kind){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  await db.prepare('DELETE FROM em_auth_attempts WHERE kind=? AND ip=?').bind(kind,ip).run();
}
async function publicRateAllowed(db,request,kind,limit=30){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown'; const now=Date.now();
  const row=await db.prepare("SELECT COUNT(*) AS n FROM em_auth_attempts WHERE kind=? AND ip=? AND created_at>datetime('now','-15 minutes')").bind(kind,ip).first();
  if(Number(row?.n||0)>=limit)return false;
  await db.prepare('INSERT INTO em_auth_attempts(kind,ip,created_at) VALUES(?,?,CURRENT_TIMESTAMP)').bind(kind,ip).run();
  return true;
}

async function onRequest(context){
  const {request,env,params}=context;
  const db=env.DB;
  const path='/' + (Array.isArray(params.path)?params.path.join('/'):(params.path||''));
  const method=request.method;
  if(path==='/health' && method==='GET'){
    if(!db) return json(503,{ok:false,d1:false,error:'Falta configurar el binding D1 llamado DB.'});
    try{
      const r=await db.prepare('SELECT 1 AS ok').first();
      return json(200,{ok:true,d1:true,select:Number(r?.ok||0)===1});
    }catch(e){
      console.error('D1_HEALTH_ERROR', e);
      return json(503,{ok:false,d1:false,error:'D1 no responde'});
    }
  }
if(!db) return json(500,{error:'Falta configurar el binding D1 llamado DB.'});
  try{
    await dbInitOnce(db);
    await rolloverOnce(db);
    let body={};
    if(method!=='GET'&&method!=='HEAD') {
      let bodyText='';
      try{ bodyText=await request.text(); }catch{}
      if(bodyText){
        try{ body=JSON.parse(bodyText); }catch{ return json(400,{error:'JSON inválido'}); }
      }
    }

    if(method==='GET'&&path==='/public') return json(200,await publicData(db));
    if(method==='GET'&&path==='/push/key') return json(200,{key:pushReady(env)?env.VAPID_PUBLIC_KEY:null});

    if(method==='GET'&&path==='/availability'){
      const u=new URL(request.url),date=u.searchParams.get('date'),serviceId=u.searchParams.get('service'),exclude=u.searchParams.get('exclude');
      const s=await service(db,serviceId);
      if(!date||!s||!s.online) return json(400,{error:'Datos inválidos'});
      const times=await startsFor(db,date,s.duration);
      const occupied=exclude
        ? await db.prepare('SELECT time FROM em_slots WHERE date=? AND owner_id<>? ORDER BY time').bind(date,exclude).all()
        : await occupiedSlots(db,date);
      const blocked=new Set((occupied.results||[]).map(x=>String(x.time).slice(0,5)));
      const free=times.filter(t=>slotTimes(t,s.duration).every(x=>minutes(x)<1440&&!blocked.has(x)));
      return json(200,{date,service:s.id,times:free});
    }

    if(method==='POST'&&path==='/book'){
      if(!(await authReserve(db,request,'book_daily',10,'-24 hours'))) return json(429,{error:'Alcanzaste el límite de turnos por día desde esta conexión. Probá de nuevo mañana o comunicate por WhatsApp.'});
      const {service:serviceId,date,time,name,whatsapp}=body; const s=await service(db,serviceId); const wa=cleanWA(whatsapp); const finalPrice=s?Number(s.price):0;
      if(!s||!s.online||!date||!time||!String(name||'').trim()||!isValidWA(wa)) return json(400,{error:'Completá todos los datos con un WhatsApp argentino válido'});
      if(!validDate(date)) return json(400,{error:'Solo se pueden reservar hoy, mañana o pasado mañana'});
      const id=uid('a'); const cid=uid('c'); const old=await clientByWA(db,wa); const clientId=old?.id||cid;
      const stm=[];
      if(!old) stm.push(db.prepare('INSERT INTO em_clients(id,name,whatsapp) VALUES(?,?,?)').bind(clientId,String(name).trim(),wa));
      else stm.push(db.prepare('UPDATE em_clients SET name=? WHERE id=?').bind(String(name).trim(),clientId));
      if(!await canReserve(db,date,time,s.duration)) return json(409,{error:'Ese horario ya no está disponible'});
      stm.push(db.prepare(`INSERT INTO em_appointments(id,client_id,service_id,service_name,price,duration,date,time,status,source) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,clientId,s.id,s.name,finalPrice,s.duration,date,time,'pending','online'));
      for(const t of slotTimes(time,s.duration)) stm.push(db.prepare('INSERT INTO em_slots(date,time,owner_id,kind) VALUES(?,?,?,?)').bind(date,t,id,'appointment'));
      stm.push(db.prepare('INSERT INTO em_notifications(id,kind,title,body) VALUES(?,?,?,?)').bind(uid('n'),'booking','Nuevo turno online',`${String(name).trim()} · ${s.name} · ${date} · ${time}`));
      try { await db.batch(stm); } catch(e) { return json(409,{error:'Ese horario acaba de ser ocupado. Elegí otro.'}); }
      const st=await settings(db); return json(200,{id,service:s.name,price:finalPrice,duration:s.duration,date,time,address:st.address,phone:st.phone});
    }

    if(method==='GET'&&path==='/my-appointments'){
      if(!(await publicRateAllowed(db,request,'client_appointments',30)))return json(429,{error:'Demasiadas consultas. Esperá unos minutos.'});
      const u=new URL(request.url),wa=cleanWA(u.searchParams.get('whatsapp')),c=await clientByWA(db,wa); if(!c){const st=await settings(db);return json(200,{appointments:[],address:st.address,phone:st.phone});}
      const r=await db.prepare(`SELECT a.*,c.name,c.whatsapp FROM em_appointments a JOIN em_clients c ON c.id=a.client_id WHERE c.id=? AND a.date>=? AND a.status='pending' ORDER BY a.date,a.time`).bind(c.id,today()).all(); const st=await settings(db);
      return json(200,{appointments:r.results,address:st.address,phone:st.phone});
    }

    if(method==='POST'&&path==='/cancel'){
      if(!(await publicRateAllowed(db,request,'client_cancel',10)))return json(429,{error:'Demasiados intentos. Esperá 15 minutos y probá de nuevo.'});
      const {id,whatsapp}=body,wa=cleanWA(whatsapp),c=await clientByWA(db,wa); const a=c?await db.prepare(`SELECT a.*,c.whatsapp FROM em_appointments a JOIN em_clients c ON c.id=a.client_id WHERE a.id=? AND c.id=?`).bind(id,c.id).first():null;
      if(!a||a.status!=='pending') return json(404,{error:'Turno no encontrado'});
      const ap=Date.parse(`${a.date}T${String(a.time).slice(0,5)}:00-03:00`); const hours=(ap-Date.now())/3600000; if(hours<0)return json(400,{error:'El turno ya comenzó o pasó'});
      const late=hours<1; const result=await cancelAppointment(db,a,{late,source:'customer',reason:late?'Cancelación con menos de 1 hora':'Cancelación del cliente'});
      if(!result.ok) return json(409,{error:'Ese turno ya había sido modificado.'});
      return json(200,{ok:true,late,halfPrice:result.half});
    }

    if(method==='POST'&&path==='/login'){
      if(!(await authReserve(db,request,'login'))) return json(429,{error:'Demasiados intentos. Esperá 15 minutos y probá de nuevo.'});
      const st=await settings(db); if(await sha256(body.pin||'')!==st.pin_hash){return json(401,{error:'PIN incorrecto'});} await authSuccess(db,request,'login');
      const raw=crypto.randomUUID()+crypto.randomUUID(), h=await sha256(raw); await db.prepare(`INSERT INTO em_sessions(token_hash,expires_at) VALUES(?,datetime('now','+7 days'))`).bind(h).run();
      return json(200,{ok:true},{'set-cookie':sessionCookie(raw)});
    }

    if(method==='GET'&&path==='/recover-info'){if(!(await authReserve(db,request,'recover')))return json(429,{error:'Demasiados intentos. Esperá 15 minutos y probá de nuevo.'});const st=await settings(db);return json(200,{question:st.recovery_q});}

    if(method==='POST'&&path==='/recover'){
      if(!(await authReserve(db,request,'recover'))) return json(429,{error:'Demasiados intentos. Esperá 15 minutos y probá de nuevo.'});
      const st=await settings(db); if(await sha256(String(body.answer||'').trim().toLowerCase())!==st.recovery_a_hash){return json(401,{error:'Respuesta incorrecta'});}
      if(!/^\d{4}$/.test(String(body.newPin||'')))return json(400,{error:'El PIN debe tener 4 dígitos'});
      await db.prepare('UPDATE em_settings SET pin_hash=? WHERE id=1').bind(await sha256(body.newPin)).run();await authSuccess(db,request,'recover');return json(200,{ok:true});
    }

    if(method==='GET'&&path==='/client-notifications'){
      if(!(await publicRateAllowed(db,request,'client_notifications',30)))return json(429,{error:'Demasiadas consultas. Esperá unos minutos.'});
      const u=new URL(request.url),wa=cleanWA(u.searchParams.get('whatsapp')),c=await clientByWA(db,wa); if(!c)return json(200,{notifications:[]});
      const r=await db.prepare('SELECT id,kind,title,body,created_at,seen FROM em_client_notifications WHERE client_id=? ORDER BY created_at DESC LIMIT 50').bind(c.id).all(); return json(200,{notifications:r.results});
    }
    if(method==='POST'&&path==='/client-notifications/read'){
      if(!(await publicRateAllowed(db,request,'client_notifications_read',30)))return json(429,{error:'Demasiadas consultas. Esperá unos minutos.'});
      const wa=cleanWA(body.whatsapp),c=await clientByWA(db,wa); if(!c)return json(404,{error:'Contacto no encontrado'}); await db.prepare('UPDATE em_client_notifications SET seen=1 WHERE id=? AND client_id=?').bind(body.id,c.id).run(); return json(200,{ok:true});
    }

    if(method==='POST'&&path==='/push/subscribe-client'){
      if(!(await publicRateAllowed(db,request,'push_client',30)))return json(429,{error:'Demasiadas consultas. Esperá unos minutos.'});
      if(!pushReady(env))return json(503,{error:'Los avisos todavía no están configurados.'});
      const sub=cleanSub(body.subscription); if(!sub)return json(400,{error:'Suscripción inválida'});
      const c=await clientByWA(db,cleanWA(body.whatsapp)); if(!c)return json(200,{ok:true,registered:false});
      await saveSub(db,'client',c.id,sub); return json(200,{ok:true,registered:true});
    }
    if(method==='POST'&&path==='/push/unsubscribe'){
      if(!(await publicRateAllowed(db,request,'push_client',30)))return json(429,{error:'Demasiadas consultas. Esperá unos minutos.'});
      await db.prepare("DELETE FROM em_push_subs WHERE role='client' AND endpoint=?").bind(String(body.endpoint||'')).run(); return json(200,{ok:true});
    }

    if(!(await isAdmin(request,db))) return json(401,{error:'No autorizado'});

    if(method==='POST'&&path==='/admin/push/subscribe'){
      if(!pushReady(env))return json(503,{error:'Los avisos todavía no están configurados.'});
      const sub=cleanSub(body.subscription); if(!sub)return json(400,{error:'Suscripción inválida'});
      await saveSub(db,'admin','',sub); return json(200,{ok:true});
    }
    if(method==='POST'&&path==='/admin/push/unsubscribe'){
      await db.prepare("DELETE FROM em_push_subs WHERE role='admin' AND endpoint=?").bind(String(body.endpoint||'')).run(); return json(200,{ok:true});
    }
    if(method==='POST'&&path==='/admin/push/test'){
      if(!pushReady(env))return json(503,{error:'Los avisos todavía no están configurados.'});
      const sent=await pushToRole(env,'admin','',{title:'Prueba de avisos',body:'Si ves este aviso, las notificaciones funcionan ✅',url:'/gestion/',tag:'test-'+Date.now()},300);
      return json(200,{ok:true,sent});
    }
    if(method==='GET'&&path==='/admin-availability'){
      const u=new URL(request.url),date=u.searchParams.get('date'),serviceId=u.searchParams.get('service'),exclude=u.searchParams.get('exclude')||null,s=await service(db,serviceId);
      if(!date||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!s)return json(400,{error:'Datos inválidos'});
      const days=dateDiff(date,today()); if(days<0||days>365)return json(400,{error:'La fecha debe estar entre hoy y un año.'});
      const times=await startsFor(db,date,s.duration),free=[]; const occupied=exclude ? await db.prepare('SELECT time FROM em_slots WHERE date=? AND owner_id<>?').bind(date,exclude).all() : await occupiedSlots(db,date); const blocked=new Set((occupied.results||[]).map(x=>String(x.time).slice(0,5))); for(const t of times) if(slotTimes(t,s.duration).every(x=>minutes(x)<1440&&!blocked.has(x))) free.push(t);
      return json(200,{date,service:s.id,times:free});
    }

    if(method==='GET'&&path==='/admin'){
      const [st,sv,ap,cl,bl,n]=await Promise.all([
        settings(db),
        db.prepare("SELECT id,name,price,duration,online FROM em_services ORDER BY name").all(),
        db.prepare(`SELECT a.*,c.name,c.whatsapp FROM em_appointments a JOIN em_clients c ON c.id=a.client_id WHERE a.date>=? ORDER BY a.date,a.time`).bind(today()).all(),
        db.prepare('SELECT * FROM em_clients ORDER BY name').all(),
        db.prepare('SELECT * FROM em_blocks WHERE date>=? ORDER BY date,start_time').bind(today()).all(),
        db.prepare('SELECT * FROM em_notifications WHERE seen=0 ORDER BY created_at DESC').all()
      ]);
      let summaries=[];
      try{summaries=(await db.prepare("SELECT * FROM em_daily_summaries ORDER BY date DESC").all()).results||[]}catch(e){console.error('SUMMARY_READ_ERROR',e);}
      let schedule=DEFAULTS.schedule;try{if(st.schedule_json)schedule=JSON.parse(st.schedule_json)||schedule}catch{} return json(200,{settings:{address:st.address,phone:st.phone,recoveryQ:st.recovery_q},services:sv.results,appointments:ap.results,clients:cl.results,blocks:bl.results,notifications:n.results,summaries,schedule,today:today()});
    }
    if(method==='GET'&&path==='/admin/client-history'){
      const id=String(new URL(request.url).searchParams.get('id')||'');
      const r=await db.prepare(`SELECT id,date,time,service_name,price,duration,status,source,cancel_reason FROM em_appointments WHERE client_id=? ORDER BY date DESC,time DESC LIMIT 60`).bind(id).all();
      return json(200,{history:r.results||[]});
    }
    if(method==='POST'&&path==='/admin/settings'){const address=String(body.address||'').trim(),phone=String(body.phone||'').trim();if(!address||!phone||address.length>160||phone.length>40)return json(400,{error:'Dirección o teléfono inválido'});await db.prepare('UPDATE em_settings SET address=?,phone=? WHERE id=1').bind(address,phone).run();return json(200,{ok:true});}
    if(method==='POST'&&path==='/admin/schedule'){
      const sc=body.schedule;
      if(!sc||typeof sc!=='object'||Array.isArray(sc))return json(400,{error:'Horarios inválidos'});
      const normalized={};
      for(let k=0;k<7;k++){
        const arr=sc[k]??sc[String(k)]??[];
        if(!Array.isArray(arr)||arr.length>2)return json(400,{error:'Horarios inválidos'});
        const clean=[];
        for(const pair of arr){
          if(!Array.isArray(pair)||pair.length!==2) return json(400,{error:'Horarios inválidos'});
          const a=String(pair[0]||''),b=String(pair[1]||'');
          if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(a)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b)||minutes(a)>=minutes(b))return json(400,{error:'Cada intervalo debe tener inicio anterior al final'});
          clean.push([a,b]);
        }
        clean.sort((x,y)=>minutes(x[0])-minutes(y[0]));
        for(let i=1;i<clean.length;i++) if(minutes(clean[i][0])<=minutes(clean[i-1][1])) return json(400,{error:'Los intervalos no pueden superponerse ni tocarse'});
        normalized[k]=clean;
      }
      await db.prepare('UPDATE em_settings SET schedule_json=? WHERE id=1').bind(JSON.stringify(normalized)).run();
      return json(200,{ok:true});
    }
    if(method==='POST'&&path==='/admin/pin'){if(!/^\d{4}$/.test(String(body.pin||'')))return json(400,{error:'El PIN debe tener 4 dígitos'});await db.prepare('UPDATE em_settings SET pin_hash=? WHERE id=1').bind(await sha256(body.pin)).run();return json(200,{ok:true});}
    if(method==='POST'&&path==='/admin/recovery'){const q=String(body.question||'').trim(),a=String(body.answer||'').trim();if(q.length<3||q.length>160||!a||a.length>120)return json(400,{error:'Completá una pregunta y una respuesta válidas'});await db.prepare('UPDATE em_settings SET recovery_q=?,recovery_a_hash=? WHERE id=1').bind(q,await sha256(a.toLowerCase())).run();return json(200,{ok:true});}
    if(method==='POST'&&path==='/admin/service'){
      const name=String(body.name||'').trim(),price=Number(body.price),duration=Number(body.duration);
      if(!name||name.length>80||!Number.isFinite(price)||price<0||!Number.isInteger(price)||!Number.isFinite(duration)||duration<1||duration>480||!Number.isInteger(duration))return json(400,{error:'Datos del servicio inválidos'});
      if(body.id){const existing=await service(db,body.id);if(!existing)return json(404,{error:'Servicio no encontrado'});await db.prepare('UPDATE em_services SET name=?,price=?,duration=?,online=? WHERE id=?').bind(name,price,duration,body.online?1:0,body.id).run();}
      else await db.prepare('INSERT INTO em_services(id,name,price,duration,online) VALUES(?,?,?,?,?)').bind(uid('s'),name,price,duration,body.online===false?0:1).run();
      return json(200,{ok:true});
    }
    if(method==='POST'&&path==='/admin/client'){
      const id=String(body.id||'').trim(),name=String(body.name||'').trim(),wa=cleanWA(body.whatsapp);
      if(!id||!name||name.length>120||!isValidWA(wa))return json(400,{error:'Nombre o WhatsApp inválido'});
      const c=await db.prepare('SELECT id FROM em_clients WHERE id=?').bind(id).first(); if(!c)return json(404,{error:'Contacto no encontrado'});
      const dup=await db.prepare('SELECT id FROM em_clients WHERE whatsapp=? AND id<>?').bind(wa,id).first(); if(dup)return json(409,{error:'Ese WhatsApp ya pertenece a otro contacto'});
      await db.prepare('UPDATE em_clients SET name=?,whatsapp=? WHERE id=?').bind(name,wa,id).run();
      return json(200,{ok:true});
    }
    if(method==='POST'&&path==='/admin/appointment'){
      const {id,clientId,date,time,serviceId,status='pending',notes=''}=body; const sv=await service(db,serviceId); if(!sv)return json(400,{error:'Servicio inválido'});
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))||!/^\d{2}:\d{2}$/.test(String(time||''))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time||'')))return json(400,{error:'Fecha u hora inválida'});
      if(status!=='pending')return json(400,{error:'Los estados se cambian desde sus acciones correspondientes'});
      if(dateDiff(date,today())<0||dateDiff(date,today())>365)return json(400,{error:'La fecha debe estar entre hoy y un año.'});
      if(id){
        const old=await db.prepare('SELECT * FROM em_appointments WHERE id=?').bind(id).first(); if(!old)return json(404,{error:'Turno no encontrado'});
        if(old.status!=='pending')return json(400,{error:'Solo se pueden editar turnos pendientes'});
        if(!await canReserveAny(db,date,time,sv.duration,id))return json(409,{error:'Horario ocupado o fuera del horario configurado'});
        const stm=[db.prepare('DELETE FROM em_slots WHERE owner_id=?').bind(id),db.prepare(`UPDATE em_appointments SET date=?,time=?,service_id=?,service_name=?,price=?,duration=?,status='pending',notes=? WHERE id=?`).bind(date,time,sv.id,sv.name,sv.price,sv.duration,notes,id)];
        for(const t of slotTimes(time,sv.duration))stm.push(db.prepare('INSERT INTO em_slots(date,time,owner_id,kind) VALUES(?,?,?,?)').bind(date,t,id,'appointment'));
        try{await db.batch(stm)}catch(e){return json(409,{error:'No se pudo guardar el cambio porque el horario acaba de ocuparse.'});}
        return json(200,{ok:true});
      }
      if(!clientId||!await canReserveAny(db,date,time,sv.duration))return json(409,{error:'Horario ocupado o fuera del horario configurado'});
      try{await insertAppointment(db,{id:uid('a'),clientId,s:sv,date,time,status:'pending',source:'manual',notes});}catch(e){return json(409,{error:'No se pudo crear el turno porque el horario acaba de ocuparse.'});}
      return json(200,{ok:true});
    }
    if(method==='POST'&&path==='/admin/cancel'){
      const a=await db.prepare('SELECT * FROM em_appointments WHERE id=?').bind(body.id).first(); if(!a||a.status!=='pending')return json(400,{error:'Solo se puede cancelar un turno pendiente'});
      const result=await cancelAppointment(db,a,{source:'admin',reason:String(body.reason||'Cancelación realizada por Juan').trim()});
      if(!result.ok) return json(409,{error:'Ese turno ya había sido modificado por otra acción.'});
      return json(200,{ok:true});
    }
    if(method==='POST'&&path==='/admin/no-show'){
      const a=await db.prepare('SELECT * FROM em_appointments WHERE id=?').bind(body.id).first(); if(!a||a.date!==today()||a.status!=='pending')return json(400,{error:'Solo se puede marcar como no asistió un turno pendiente de hoy'});
      const guard=await db.prepare(`UPDATE em_appointments SET status='no_show',no_show_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`).bind(a.id).run();
      if(Number(guard?.meta?.changes||0)!==1) return json(409,{error:'Ese turno ya había sido modificado por otra acción.'});
      await db.batch([db.prepare('DELETE FROM em_slots WHERE owner_id=?').bind(a.id),db.prepare('UPDATE em_clients SET no_shows=no_shows+1 WHERE id=?').bind(a.client_id)]); return json(200,{ok:true});
    }
    if(method==='POST'&&path==='/admin/block'){
      const {date,start,end,wholeDay,reason}=body;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))||dateDiff(date,today())<0||dateDiff(date,today())>365)return json(400,{error:'Fecha de bloqueo inválida'});
      if(!wholeDay){
        if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(start||''))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(end||''))||minutes(start)>=minutes(end))return json(400,{error:'Rango de bloqueo inválido'});
        if(minutes(start)%15!==0||minutes(end)%15!==0)return json(400,{error:'Los bloqueos deben comenzar y terminar en intervalos de 15 minutos'});
      }
      let existingBlocks=[];
      if(wholeDay) existingBlocks=(await db.prepare('SELECT * FROM em_blocks WHERE date=?').bind(date).all()).results;
      else existingBlocks=(await db.prepare(`SELECT * FROM em_blocks WHERE date=? AND (whole_day=1 OR (start_time<? AND end_time>?))`).bind(date,end,start).all()).results;
      if(existingBlocks.length)return json(409,{error:'Ese bloqueo se superpone con otro bloqueo existente.'});
      let affected=[];
      if(wholeDay) affected=(await db.prepare(`SELECT a.*,c.name,c.whatsapp FROM em_appointments a JOIN em_clients c ON c.id=a.client_id WHERE a.date=? AND a.status='pending'`).bind(date).all()).results;
      else affected=(await db.prepare(`SELECT a.*,c.name,c.whatsapp FROM em_appointments a JOIN em_clients c ON c.id=a.client_id WHERE a.date=? AND a.status='pending' AND a.time<? AND time(a.time, '+'||a.duration||' minutes')>?`).bind(date,end,start).all()).results;
      if(affected.length&&!body.confirm)return json(409,{affected});
      const bid=uid('b'); const bStart=wholeDay?'00:00':start,bEnd=wholeDay?'23:59':end;
      const stm=[db.prepare('INSERT INTO em_blocks(id,date,start_time,end_time,whole_day,reason) VALUES(?,?,?,?,?,?)').bind(bid,date,bStart,bEnd,wholeDay?1:0,reason||'')];
      if(affected.length&&body.cancelAffected){for(const a of affected){stm.push(db.prepare(`UPDATE em_appointments SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_source='block',cancel_reason=? WHERE id=? AND status='pending'`).bind(reason||'Bloqueo de horario',a.id));stm.push(db.prepare('DELETE FROM em_slots WHERE owner_id=?').bind(a.id));stm.push(db.prepare('UPDATE em_clients SET cancellations=cancellations+1 WHERE id=?').bind(a.client_id));stm.push(db.prepare(`INSERT INTO em_daily_summaries(date,turns,revenue,cancelled) VALUES(?,0,0,1) ON CONFLICT(date) DO UPDATE SET cancelled=cancelled+1`).bind(a.date));stm.push(db.prepare('INSERT INTO em_client_notifications(id,client_id,kind,title,body) VALUES(?,?,?,?,?)').bind(uid('cn'),a.client_id,'block_cancel','Turno cancelado',`Tu turno del ${a.date} a las ${String(a.time).slice(0,5)} fue cancelado porque el horario fue bloqueado.`));}}
      const blockSlots=[];if(wholeDay){for(let m=0;m<1440;m+=15)blockSlots.push(hhmm(m));}else{for(let m=minutes(start);m<minutes(end);m+=15)blockSlots.push(hhmm(m));}
      for(const t of blockSlots)stm.push(db.prepare('INSERT INTO em_slots(date,time,owner_id,kind) VALUES(?,?,?,?)').bind(date,t,bid,'block'));
      try{await db.batch(stm);}catch(e){return json(409,{error:'No se pudo aplicar el bloqueo porque se superpone con otro horario.'});}
      return json(200,{ok:true,affected:affected.length});
    }
    if(method==='POST'&&path==='/admin/block/delete'){
      const id=String(body.id||''),b=await db.prepare('SELECT id FROM em_blocks WHERE id=?').bind(id).first();
      if(!b)return json(404,{error:'Bloqueo no encontrado'});
      await db.batch([db.prepare("DELETE FROM em_slots WHERE owner_id=? AND kind='block'").bind(id),db.prepare('DELETE FROM em_blocks WHERE id=?').bind(id)]);
      return json(200,{ok:true});
    }
    if(method==='POST'&&path==='/admin/notifications/read'){await db.prepare('UPDATE em_notifications SET seen=1 WHERE id=?').bind(body.id).run();return json(200,{ok:true});}
    if(method==='POST'&&path==='/admin/finish'){
      const a=await db.prepare('SELECT * FROM em_appointments WHERE id=?').bind(body.id).first(); if(!a||a.date!==today()||a.status!=='pending')return json(400,{error:'Solo se puede finalizar un turno pendiente de hoy'});
      const guard=await db.prepare(`UPDATE em_appointments SET status='done' WHERE id=? AND status='pending'`).bind(a.id).run();
      if(Number(guard?.meta?.changes||0)!==1) return json(409,{error:'Ese turno ya había sido modificado por otra acción.'});
      await db.batch([
        db.prepare('DELETE FROM em_slots WHERE owner_id=?').bind(a.id),
        db.prepare('UPDATE em_clients SET visits=visits+1,total_spent=total_spent+?,last_visit=? WHERE id=?').bind(a.price,today(),a.client_id),
        db.prepare(`INSERT INTO em_daily_summaries(date,turns,revenue,cancelled) VALUES(?,?,?,0) ON CONFLICT(date) DO UPDATE SET turns=turns+1,revenue=revenue+excluded.revenue`).bind(today(),1,a.price)
      ]); return json(200,{ok:true});
    }
    if(method==='POST'&&path==='/logout'){const raw=cookies(request).em_session;if(raw)await db.prepare('DELETE FROM em_sessions WHERE token_hash=?').bind(await sha256(raw)).run();return json(200,{ok:true},{'set-cookie':clearSessionCookie()});}
    return json(404,{error:'Ruta no encontrada'});
  }catch(e){ console.error(e); return json(500,{error:'Error interno',diagnostic:'PUBLIC_ROUTE_FAILED'}); }
}


const PUSH_TRIGGER_PATHS = new Set(['/api/book','/api/cancel','/api/admin/cancel','/api/admin/block']);
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const raw = url.pathname.replace(/^\/api\/?/, "");
      const path = raw ? raw.split("/").filter(Boolean) : [];
      const res = await onRequest({ request, env, ctx, params: { path } });
      if (request.method === "POST" && res.status < 400 && PUSH_TRIGGER_PATHS.has(url.pathname.replace(/\/+$/, ""))) {
        ctx.waitUntil(flushPush(env).catch(e => console.error('PUSH_FLUSH_ERROR', String(e?.message || e))));
      }
      return res;
    }
    // Páginas, logo, service worker y manifiestos: archivos estáticos de /public.
    return env.ASSETS.fetch(request);
  },

  // Cron de Cloudflare (cada 5 minutos): crea los recordatorios de "falta 1 hora" y envía los avisos pendientes.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env).catch(e => console.error('SCHEDULED_ERROR', String(e?.message || e))));
  }
};
