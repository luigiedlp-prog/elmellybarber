# ElMellyBarber · Juan Ceballos

Sistema de turnos para la barbería, sobre Cloudflare Workers + D1.

- **Clientes reservan en:** `https://TU-DOMINIO/reservar/`  (ese es el link para compartir)
- **Juan gestiona en:** `https://TU-DOMINIO/gestion/`  (con PIN, pensado para el celular)

## Qué incluye
Agenda y gestión de turnos · registro e historial de clientes · recordatorios automáticos (aviso 1 hora antes) ·
link de reservas · estadísticas de actividad e ingresos · panel móvil. Avisos tipo app (notificaciones push).
Lo que quedó fuera de esa lista está guardado en `FUTURO.md`.

## Publicar: GitHub → Cloudflare
1. Subí **el contenido** de este proyecto a un repositorio de GitHub (el `wrangler.toml` tiene que quedar en la raíz del repo).
2. En Cloudflare: **Workers & Pages → Create → Workers → Import a repository** (elegí *Workers*, no *Pages*: los
   recordatorios necesitan el cron del Worker) y seleccioná el repo. Dejá los comandos por defecto
   (deploy: `npx wrangler deploy`).
3. En el primer deploy Cloudflare crea solo la base D1 (`DB`) y la vincula. El Worker crea las tablas la primera vez que se usa.
   Cada `git push` vuelve a publicar.
4. Abrí `/gestion/`, entrá con el PIN inicial y **cambialo enseguida**.

## Avisos push (notificaciones tipo app)
Sin esto la página funciona igual, pero no llegan avisos.
1. Generá las claves: `npx web-push generate-vapid-keys`
2. En Cloudflare → tu Worker → **Settings → Variables and Secrets**:
   - `VAPID_PUBLIC_KEY` (tipo *Text*) = clave pública
   - `VAPID_PRIVATE_KEY` (tipo *Secret*) = clave privada
3. En `wrangler.toml` poné un mail real en `VAPID_SUBJECT`.
> Cargá las claves desde el panel de Cloudflare, no en el repo. Si las ponés en `[vars]` de `wrangler.toml`, no las subas a un repo público.

## Valores iniciales (cambiar desde Gestión → Servicios)
| Dato | Valor inicial |
|---|---|
| PIN de Juan | `5820` (cambiarlo ya) |
| Pregunta de recuperación | ¿En qué ciudad está la barbería? → `Pergamino` |
| Dirección | Pergamino, Buenos Aires |
| Teléfono | +54 9 2477 233313 |
| Servicios | Corte $10.000 (30 min) · Corte + barba $13.000 (45 min) |
| Horario | Lunes a sábado, 10:00 a 20:00 |

## Avisos en el celular
Android: funcionan desde Chrome. iPhone: abrir en Safari → Compartir → **Agregar a inicio** y activar los avisos desde ese ícono.

## Estructura
```
worker.js        API + D1 + push + recordatorios (cron)
wrangler.toml    configuración (assets, D1, cron)
schema.sql       tablas (referencia; el Worker las crea solo)
public/          páginas (/reservar, /gestion), estilos, logo, service worker
future/          código archivado de funciones fuera de alcance
```
