# Funciones guardadas para más adelante

ElMellyBarber hoy incluye **solo** lo pedido: agenda y turnos, clientes con historial, recordatorios automáticos,
link de reservas, estadísticas e ingresos, y panel pensado para el celular.

Lo que tenía el sistema original y **no** está en esa lista quedó archivado, sin activar:

| Función | Dónde está el código | Qué falta para activarla |
|---|---|---|
| Promociones (% de descuento o 2×1, con vigencia) | `future/promociones.js` | Instrucciones al comienzo del archivo |
| Mensajes de WhatsApp con plantilla (confirmar, recordar, agradecer) | `future/whatsapp-mensajes.js` | Instrucciones al comienzo del archivo |
| Fotos de cada servicio en la pantalla de reserva | No se copiaron (eran fotos de otra barbería) | Subir fotos propias a `public/fotos/` y mostrarlas en `serviceRow()` de `public/reservar/index.html` |

Además se quitó el endpoint de diagnóstico `/api/push/debug`, que mostraba datos de las claves de avisos.
