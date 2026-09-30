# Funciones guardadas para más adelante

ElMellyBarber hoy incluye lo pedido: agenda y turnos, clientes con historial, recordatorios automáticos,
link de reservas, estadísticas e ingresos, panel para celular, **promociones** (% de descuento o 2×1 con vigencia)
y un **adicional opcional (Alisado)** que se suma a otro servicio.

Lo que existía en el sistema original y **no** se activó quedó archivado:

| Función | Dónde está el código | Qué falta para activarla |
|---|---|---|
| Mensajes de WhatsApp con plantilla (confirmar, recordar, agradecer) | `future/whatsapp-mensajes.js` | Instrucciones al comienzo del archivo |
| Fotos de cada servicio en la pantalla de reserva | No se copiaron | Subir fotos propias a `public/fotos/` y mostrarlas en `serviceRow()` de `public/reservar/index.html` |
