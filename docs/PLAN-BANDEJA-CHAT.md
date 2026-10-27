# Plan de la pantalla de chat (Bandeja)

Versión 1 · 27 oct 2026 · Estado: propuesta para revisión

Este documento revisa la pantalla donde el asesor conversa con el cliente (caja de texto, mensajes,
cabecera, panel del contacto y lista de chats), la compara con las apps más usadas y propone qué
agregar, en qué orden y qué no hacer. Complementa la sección 7.1 de `PLAN-CRM.md` y respeta sus
principios y exclusiones (sección 8).

Se comparó con Kommo, respond.io, Callbell, Leadsales, Wati, Treble, B2Chat, WhatsApp Business,
Meta Business Suite, Intercom, Zendesk, Front, Chatwoot, Freshchat, Gorgias, Trengo, Missive,
Help Scout y HubSpot. Lo que se dice sobre Zernio sale de su SDK (`@zernio/node`), tanto la versión
instalada (0.2.519) como la última (0.2.1340).

---

## 1. Diagnóstico

1. **Hay más de lo que se ve.** Las respuestas guardadas existen desde la fase 1: se usan escribiendo
   `/` en la caja, con variables, alcances (empresa, equipo, personal) y sugeridas por tipo de
   gestión. No se descubren porque no hay botón, solo un texto de ayuda pequeño, y **desaparecen
   cuando el chat pasó las 24 horas de WhatsApp**: la caja se reemplaza por el aviso de "Usar
   plantilla". Eso es justo lo que muestra la captura que motivó este plan.
2. **Todo es texto.** El asesor no puede enviar fotos, PDF, audios ni videos. Lo que manda el cliente
   sale como "Archivo adjunto", sin verse. Para una tienda que recibe capturas de Yape, fotos de
   productos y notas de voz todo el día, es la mayor carencia.
3. **No hay corrector de ortografía.** La caja ni siquiera pide al navegador que corrija en español.
4. **Hay errores que dan información falsa** y conviene corregirlos antes de agregar funciones:
   un caso poco frecuente en que se ven los mensajes de otro cliente, el contador de no leídos que se
   queda en 2, mensajes que siempre figuran como "enviado" aunque WhatsApp los rechace, y chats
   largos que podrían estar mostrando los mensajes más antiguos.

---

## 2. Lo que ya existe

| Función | Dónde | Comentario |
|---|---|---|
| Respuestas guardadas con `/` | Caja de texto | Variables `{nombre}`, `{asesor}`, `{sede}`, `{empresa}` y campos personalizados. Se pegan para revisar, no se envían solas. Se administran en Configuración → Respuestas. |
| Plantillas de WhatsApp | Caja (ventana cerrada) | Buscador, vista previa en burbuja y un campo por variable. |
| Notas internas con @menciones | Caja de texto | Interruptor "Nota interna" (amarillo); la mención notifica. |
| Tarjeta de gestión | Cabecera | Tipo, etapa, responsable, próximo contacto, cerrar, nueva gestión. |
| Pausar el bot | Cabecera | "Pausar bot" por chat. |
| Panel del contacto | Derecha | Tipo de contacto, responsable, etiquetas, campos personalizados. |
| Vistas, filtros y búsqueda | Lista de chats | Vistas según el rol, filtros por tipo, etapa, asesor, canal y "esperando". |

---

## 3. Correcciones antes de agregar funciones

Son baratas (casi todas de menos de un día) y evitan errores que el asesor no puede detectar.

| # | Error | Efecto | Esfuerzo |
|---|---|---|---|
| C1 | **Mensajes de otro chat.** Si una actualización del chat anterior termina después de abrir el siguiente, se ven los mensajes del cliente anterior con el nombre del nuevo. Lo que se escriba va al nuevo. | Responder pensando en otro cliente (precio, dirección, datos de pago). Poco frecuente, pero grave. | S |
| C2 | **Envíos en curso que se pierden al cambiar de chat.** Si un envío falla después de cambiar de chat, desaparecen la burbuja roja y el botón Reintentar, y el aviso no dice de qué chat era. | El asesor cree que respondió y el cliente queda esperando. | S |
| C3 | **Contador de no leídos.** En un cliente que vuelve a escribir queda en 2, mande 1 o 20 mensajes. | Números falsos en la lista. Impide además poner sonido de mensaje nuevo. | S |
| C4 | **Filtro oculto "Sin gestión".** Al cambiar de vista puede quedar activo y la lista sale vacía. | "No tengo chats" cuando sí hay. | S |
| C5 | **Dirección de los mensajes.** El código espera `outbound`, pero Zernio documenta `outgoing`. Si es así, los mensajes de la tienda aparecen como del cliente. Confirmar con un chat real y aceptar ambos valores. | Chat ilegible. | S |
| C6 | **Chats de más de 100 mensajes.** Se piden en orden ascendente sin paginar: en WhatsApp, Instagram y Telegram se verían los 100 más antiguos y no los últimos. | Clientes de Recompra con historial largo. | M |
| C7 | **Estado real del mensaje.** Todo se marca como "enviado"; Zernio ya devuelve entregado, leído y el error si WhatsApp lo rechazó. | Mensajes rechazados que nadie ve. | S (paso 1) |
| C8 | **Reintentos sin duplicar.** Mandar una clave única por mensaje (Idempotency-Key) y, si la falla es ambigua, revisar si el mensaje salió antes de reintentar. | El cliente recibe el mismo mensaje dos veces. | S |
| C9 | **Reconexión.** Al volver de suspender la laptop o recuperar internet, la lista y el chat no se recargan. | Chats nuevos que no aparecen. | S |
| C10 | **Enlaces largos** se salen de la burbuja y no se pueden abrir con un clic. | Copiar y pegar a mano. | S |
| C11 | **Enter con teclado en composición** (tildes en algunos teclados) puede enviar a medias. | Mensajes cortados. | S |

---

## 4. Corrector de ortografía en español

Se propone en tres pasos, de menor a mayor costo. Ninguno corrige ni envía nada solo: el asesor
siempre decide.

| Paso | Qué hace | Costo | Prioridad |
|---|---|---|---|
| **1. Corrector del navegador** | Activar `spellcheck` y `lang="es-PE"` en la caja, más mayúscula automática al inicio de oración. Subraya en rojo y sugiere con clic derecho. Guía de un minuto para activar el español en Chrome. En el celular corrige el teclado. | Gratis, horas de trabajo | P1 |
| **2. Revisión al enviar** | Antes de enviar, un aviso "¿Corregir?" con una lista fija de tildes seguras (asi→así, tambien→también, envio→envío, q→que, xq→porque) y el signo de apertura ¿ ¡ que falta. Un clic aplica todo. | Gratis, 1 día | P1 |
| **3. Subrayado propio** | Corrector local (nspell con diccionario de español de Perú) que subraya mientras se escribe, con sugerencias, "Ignorar" y "Agregar al diccionario de la tienda" (marcas, sabores, distritos). | Gratis, más de 1 semana. Se carga en segundo plano (pesa ~50 MB en memoria). | P2 |
| **Opcional: "Corregir con IA"** | Botón que corrige lo que depende del contexto (como/cómo, esta/está, mas/más) y la gramática, y muestra los cambios para aceptarlos. Solo corrige; no reescribe el tono. Se oculta si no hay clave de IA. | 1 a 5 USD al mes, 2 a 5 días | P2 |

Por qué no LanguageTool como primera opción: su versión gratuita en la nube tiene límites bajos y la
de pago (unos 6 a 20 EUR al mes) o el servidor propio suman costo y mantenimiento. Se puede evaluar si
el paso 3 se queda corto.

**Privacidad.** Los pasos 1 a 3 no envían texto fuera del navegador. El botón con IA sí manda el
borrador a un proveedor externo; requiere decisión del dueño (Ley 29733).

---

## 5. Catálogo de funciones

**Prioridad:** P1 = alto valor diario y viable ya; P2 = siguiente; P3 = más adelante.
**Esfuerzo:** S = hasta 1 día; M = 2 a 5 días; L = más de 1 semana.

### 5.1 Caja de texto

| Función | Hoy | Prioridad | Esfuerzo | Canales y notas |
|---|---|---|---|---|
| **Botón de respuestas guardadas** (rayo) y `/` en cualquier parte del texto, insertando donde está el cursor. Búsqueda también por el contenido. | Parcial | P1 | S | Todos. |
| **Respuestas con la ventana de 24 h cerrada, paso 1:** el aviso explica que vuelven cuando el cliente escribe y `/` funciona en notas internas. | Falta | P1 | S | — |
| Paso 2: ligar una respuesta a una plantilla aprobada, para que `/precios` ofrezca su plantilla con las variables llenas. | Falta | P2 | M | Solo WhatsApp. Columna nueva en las dos bases. |
| **Más variables:** `{primer_nombre}`, `{saludo}` (según la hora de Lima), `{hoy}`; avisar si una variable queda vacía o si quedan llaves sin reemplazar antes de enviar. | Parcial | P1 | S | Todos. |
| **Cuenta regresiva de las 24 h** ("Quedan 2 h"), en ámbar la última hora. | Parcial | P1 | S | Solo WhatsApp. |
| **Adjuntar fotos, PDF y videos:** clip, arrastrar o pegar (Ctrl+V), con vista previa. Primero imágenes, luego PDF y video. | Falta | P1 | L | WhatsApp, Instagram, Messenger, Telegram. No Bluesky ni Reddit. WhatsApp acepta imagen 5 MB, video 16 MB, documento 100 MB. |
| **Archivo en respuestas guardadas** (lista de precios, tabla nutricional, foto de producto), incluso sin texto. Mostrar cuándo se actualizó. | Parcial | P1 | M | Requiere el punto anterior. |
| **Borrador por chat:** lo escrito se conserva al cambiar de chat o recargar; la lista marca "Borrador". Separado por usuario y con vencimiento, por si comparten PC. | Falta | P1 | S | Todos. |
| Notas de voz: grabar, escuchar y enviar. | Falta | P2 | M | Nota de voz nativa solo en WhatsApp (OGG/Opus). En Instagram sale como audio (m4a). |
| Selector de emojis en español. | Falta | P2 | S | Todos. |
| Límite de caracteres por canal, con aviso antes de enviar. | Falta | P2 | S | Instagram cuenta 1000 bytes (las tildes y emojis ocupan más), Messenger 2000, WhatsApp 4096. |
| Plantillas también con la ventana abierta (con botones o imagen). | Falta | P2 | S | Solo WhatsApp. |
| Aviso claro y respuesta como "atención humana" (hasta 7 días) en Instagram y Messenger fuera de 24 h. | Falta | P2 | M | Depende de que la app de Zernio tenga el permiso de Meta; confirmar con Zernio. |
| "Escribiendo…" visible para el cliente. | Falta | P2 | S | WhatsApp, Instagram, Messenger, Telegram. En WhatsApp también marca como leído; va con el mismo interruptor que los ticks azules. |
| Deshacer envío (3 a 5 s). | Falta | P2 | S | Única forma de "borrar" en WhatsApp, Instagram y Messenger, que no permiten borrar ni editar lo enviado. |
| Pedir ubicación y pedir teléfono con un botón de WhatsApp. | Falta | P2 | M | Solo WhatsApp, dentro de 24 h. Útil para delivery y para clientes que escriben con nombre de usuario sin número. |
| Sugerencias por palabras del cliente (sin IA): si escribe "precio", "envío" o "yape", aparecen 1 a 3 respuestas guardadas sobre la caja. | Falta | P2 | M | Todos. |
| Botones, enlace y ubicación de la tienda desde la caja. | Falta | P3 | M | Botones: WhatsApp, Instagram, Messenger, Telegram. Botón con enlace y ubicación: sobre todo WhatsApp. |
| Programar un mensaje para más tarde. | Falta | P3 | L | En WhatsApp solo sale si la ventana sigue abierta. |
| Firma del asesor opcional ("*Ana:*"). | Falta | P3 | S | Útil con varias sedes en un número. |

### 5.2 Mensajes

| Función | Hoy | Prioridad | Esfuerzo | Canales y notas |
|---|---|---|---|---|
| **Ver fotos, videos, audios y documentos recibidos:** imagen ampliable, reproductor con 1,5x y 2x, tarjeta de documento. | Parcial | P1 | L | En WhatsApp hay que copiar el archivo al recibirlo: Meta lo borra a los 7 días o antes. Bucket privado en Supabase con acceso por contacto (las capturas de Yape tienen datos personales). |
| **Estado del mensaje:** ticks de enviado, entregado y leído; rechazo en rojo con motivo en español y "Reintentar" o "Usar plantilla". | Parcial | P1 | M | Entregado: WhatsApp y Messenger. Leído: WhatsApp, Messenger, Instagram. Escuchado: notas de voz de WhatsApp. |
| **Quién envió cada mensaje:** "Ana", "Bot · Flujo Bienvenida". | Parcial | P1 | M | Hoy no queda registro de qué asesor envió cada texto; también sirve para auditar. |
| **Ir al final y línea de no leídos:** abrir abajo sin animación, no bajar si el asesor lee arriba, botón "Ir al final (3)". | Parcial | P1 | S | Depende de C3. |
| **Historias de Instagram:** etiqueta "Respondió a tu historia" o "Te mencionó". | Falta | P1 | S | Solo Instagram. La miniatura va en P2 (caduca a las 24 h, hay que copiarla). |
| **Mostrar ubicaciones, contactos y el botón que tocó el cliente** como tarjetas ("Abrir en Google Maps"). | Falta | P1 | M | Hoy se pierden. |
| Responder citando, copiar, crear nota sobre un mensaje e info de horas. Mostrar la cita que hace el cliente. | Falta | P2 | M | Citar al enviar: solo WhatsApp y Telegram (Zernio la ignora en Instagram y Messenger). |
| Reacciones del cliente, "(editado)" y "El cliente eliminó este mensaje". Reaccionar desde el CRM. | Falta | P2 | S a M | Reacciones visibles en WhatsApp y Telegram; Instagram y Messenger requieren webhook nuevo (M). |
| Formato de WhatsApp (*negrita*, _cursiva_) y teléfonos clicables. | Falta | P2 | S | WhatsApp y Telegram. |
| Buscar dentro del chat, con anterior y siguiente. | Falta | P2 | M | Todos. |
| Eventos de la gestión en el chat: "Ana tomó la gestión", "Etapa: Cotización → Ganada". | Falta | P2 | M | Interno. |
| Registrar respuestas enviadas desde el celular (WhatsApp Business en coexistencia). | Falta | P2 | M | Pasa a P1 si responden desde el celular. |
| Marcar una imagen como comprobante de pago (Yape o Plin): copia permanente, nota en la gestión y avance de "Esperando pago". | Falta | P2 | M | Evidencia para reclamos y control de capturas falsas. |

### 5.3 Cabecera y gestión

| Función | Hoy | Prioridad | Esfuerzo | Notas |
|---|---|---|---|---|
| **Posponer hasta una fecha** (mañana 9:00, el lunes, en 3 días) guardado como próximo contacto; quitar el "Cerrar" duplicado de la conversación. | Parcial | P1 | S | "Para hoy" solo muestra las gestiones propias: al posponer una sin asignar hay que asignarla. |
| Cabecera con teléfono o @usuario, canal y "esperando hace 12 min". | Parcial | P2 | S | |
| Pasar al chat del mismo cliente en otro canal (WhatsApp ↔ Instagram). | Falta | P2 | S | |
| Responder solo con permiso y botón "Tomar y responder" según la matriz 4.4 del plan. | Falta | P2 | M | Hoy cualquiera que ve el chat puede responder. Con la opción por defecto ("Solo las suyas") el asesor solo ve lo suyo, por eso no es P1. |
| Aviso "Luis está viendo / escribiendo" y confirmación si otro respondió hace segundos. | Falta | P3 | M | |
| Encuesta "¿Cómo te atendimos?" al cerrar. | Falta | P3 | M | |

### 5.4 Panel del contacto

| Función | Hoy | Prioridad | Esfuerzo | Notas |
|---|---|---|---|---|
| **Teléfono con botón copiar, origen y edición rápida** de nombre, teléfono, correo y campos. | Parcial | P1 | S | El teléfono ya está en la base, no se muestra. |
| Gestiones anteriores con su resultado; luego, galería de archivos del chat. | Parcial | P2 | S | Las gestiones cerradas ya se cargan. |
| Copiar ficha de despacho (nombre, DNI, teléfono, dirección, distrito, referencia, pedido) para Olva, Shalom o el motorizado. Avisa si falta un dato. | Falta | P2 | S | No crea pedidos en el CRM (respeta §8). |
| Enlace a la tienda: "Ver pedido" con el número guardado y "Buscar cliente en la tienda". | Falta | P2 | S | Puente hasta la integración de la fase 4. |
| Pedidos de la tienda y membresía del gimnasio, solo lectura. | Falta | P3 | L | Fase 4 del plan. |

### 5.5 Lista de chats

| Función | Hoy | Prioridad | Esfuerzo | Notas |
|---|---|---|---|---|
| **Vista previa sin texto:** "Foto", "Nota de voz", "Documento", "Ubicación" en vez de una línea vacía. | Parcial | P1 | S | |
| **Sonido, notificación del navegador y contador en la pestaña** para mensajes nuevos en chats propios o en la cola. Cada persona elige. | Falta | P1 | M | Depende de C3. Amplía lo que pide la sección 7.6 del plan. |
| Indicadores por fila: color según objetivo de respuesta, "Tú:" o "Bot:", reloj de 24 h, bot en pausa, etiquetas. | Parcial | P2 | S | |
| Filtros que pide el plan: equipo, etiqueta, tipo de contacto y "fuera de 24 h". | Falta | P2 | M | |
| Cargar más chats y buscar en el servidor por nombre, teléfono (solo dígitos) o @usuario. | Parcial | P2 | M | Hoy se cargan 200. |
| Uso cómodo desde el celular: una columna a la vez. | Falta | P2 | L | Pasa a P1 si atienden desde el celular. |
| Acciones rápidas por fila y acciones en lote (asignar, etiquetar, cerrar varias). | Falta | P3 | M | |
| Solicitudes de mensajes de Facebook (carpeta que Meta separa). | Falta | P3 | M | Confirmar primero si llegan al CRM. |

### 5.6 Productividad

| Función | Hoy | Prioridad | Esfuerzo | Notas |
|---|---|---|---|---|
| Vigencia de respuestas con precios ("válida hasta") y "Actualizada hace 40 días". | Falta | P2 | S | Los precios de suplementos cambian seguido. |
| Datos de pago oficiales (`{yape}`, `{plin}`, `{cuenta_bcp}`, `{cci}`) que solo edita el administrador, y aviso si un mensaje menciona un Yape o cuenta distinta de la oficial. | Falta | P2 | M | Evita números mal escritos y desvío de pagos. |
| Enviar y cerrar, enviar y posponer, enviar y cambiar etapa. | Falta | P2 | S | |
| Organizar respuestas: guardar desde el chat (S), más usadas y categorías (M), favoritas, duplicar, importar y exportar. | Falta | P2 | S a L | Se puede hacer por partes. |
| Atajos de teclado (siguiente chat en espera, Ctrl+K) y elegir si Enter envía. | Falta | P3 | M | |

### 5.7 Inteligencia artificial

| Función | Prioridad | Esfuerzo | Notas |
|---|---|---|---|
| Corregir redacción con IA (ver sección 4). | P2 | M | Solo corrige, no reescribe. |
| Resumen del chat como nota interna al transferir. | P3 | S | |
| Transcripción de notas de voz recibidas. | P3 | M | |

---

## 6. Lo que no vamos a hacer

| Función | Motivo |
|---|---|
| Respuestas escritas por la IA, traducción automática, puntaje de clientes y detección de ánimo | Plan §8: IA avanzada hasta tener datos reales. Las sugerencias por palabras clave (5.1) cubren lo básico. |
| Catálogo, carrito, pedidos y enlaces de pago dentro del chat | Plan §8. Además, el pago dentro del chat de WhatsApp no existe en Perú. Enviar una ficha de producto del catálogo de Meta sería posible (M) si algún día se decide. |
| Botón de llamada de WhatsApp | Plan §8: llamadas no son canal. |
| Borrar o editar mensajes ya enviados | WhatsApp, Instagram y Messenger no lo permiten (solo Telegram edita). Se cubre con "Deshacer envío". |

---

## 7. Orden de construcción

| Etapa | Contenido | Resultado |
|---|---|---|
| **A. Correcciones** | C1 a C11 | La pantalla muestra información confiable. |
| **B. Lo que ya existe, a la vista** | Botón de respuestas guardadas, `/` en cualquier parte, ventana cerrada paso 1, variables nuevas y aviso de llaves sin reemplazar, cuenta regresiva de 24 h, corrector del navegador y revisión al enviar (pasos 1 y 2), borradores, vista previa sin texto, etiqueta de historias, posponer con fecha, teléfono en el panel | El asesor escribe más rápido y con menos errores. Casi todo es S. |
| **C. Multimedia** | Actualizar el SDK de Zernio; ver lo recibido (con copia al llegar); adjuntar fotos, luego PDF y video; archivo en respuestas guardadas; ubicaciones y contactos como tarjetas | Se atiende sin salir del CRM. |
| **D. Control** | Estado del mensaje completo, autor de cada mensaje, sonido y notificaciones, ir al final y no leídos | El supervisor sabe quién respondió qué y nadie se pierde un mensaje. |
| **E. Siguiente** | Las P2 según lo que pidan los asesores después de usar A a D | — |

---

## 8. Cambios técnicos previstos

- **Actualizar `@zernio/node`** de 0.2.519 a la última. La API ya devuelve campos que faltan en los
  tipos instalados: autor del envío, enlaces renovables de Instagram y Messenger, avisos de campos
  ignorados, envíos parciales e historias como objeto. Correr build y pruebas.
- **Supabase Storage:** bucket privado para archivos enviados y recibidos, con acceso según quién
  puede ver el contacto y plazo de conservación definido. Para subir más de unos 4,5 MB usar la
  subida firmada de Zernio o de Supabase; la URL debe durar al menos una hora porque Meta la descarga
  después.
- **Migraciones en las dos bases** (tienda y gimnasio): autor del mensaje, borradores si se guardan en
  la base, archivo y vigencia en respuestas guardadas, plantilla ligada, diccionario de la tienda,
  estado "leído" en `messages`.
- **Webhook único de Zernio por perfil**, compartido por ambas instalaciones. Suscribir eventos nuevos
  (estado de entrega, reacciones, mensajes enviados desde el celular) se prueba primero en el canal de
  prueba.
- `components/composer/saved-reply-picker.tsx` tiene un carácter nulo literal que hace que git lo trate
  como binario; reemplazarlo por `\u0000` antes de editarlo.

---

## 9. Preguntas para el dueño

1. ¿Los asesores responden desde el celular, con la app WhatsApp Business (coexistencia) o con el
   navegador? Si es así, "Uso desde el celular" y "Respuestas desde el celular" pasan a P1.
2. Corrector: ¿basta con los pasos gratuitos o se quiere también el botón con IA? ¿Se acepta que el
   borrador del asesor, que puede tener datos del cliente, pase por un proveedor externo?
3. ¿Qué palabras van en el diccionario de la tienda (marcas, productos, sabores, distritos) y quién lo
   mantiene?
4. ¿Qué archivos mandan más los asesores (fotos, PDF de precios, videos) y de qué tamaño?
5. ¿Cuánto pesa Instagram frente a WhatsApp en las ventas? Ordena las funciones de historias y de la
   regla de 24 h en Instagram.
6. ¿Quieren que el cliente vea "leído" (ticks azules) apenas el asesor abre el chat?
7. ¿El sonido de mensaje nuevo debe sonar solo para chats propios o también para la cola? ¿Con horario
   de silencio?
8. ¿Ya cargaron respuestas guardadas? Si no, ¿preparamos un primer juego (Precios, Envíos y delivery,
   Yape y Plin, Horarios, Stock, Membresías) con sus plantillas aprobadas equivalentes?
9. ¿La cuenta de WhatsApp es elegible para el envío "utility" sin plantilla de Meta? Ayudaría en
   postventa con la ventana cerrada (no sirve para contenido de venta).
