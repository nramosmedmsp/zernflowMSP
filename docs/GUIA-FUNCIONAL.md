# Cómo funciona el CRM de Muscle Shop (guía para una persona nueva)

Esta guía explica, en palabras simples, qué hace cada pantalla del CRM y cómo se conectan las piezas.
No necesitas saber programar. Si la cargas en Claude junto con el resto del ZIP, puedes hacerle preguntas
como «¿cómo se reparte un chat nuevo?» o «¿qué pasa cuando cierro una venta como ganada?».

> Esta guía describe la app **tal como está hoy**. Los nombres entre «comillas» son los textos reales de la
> pantalla. La configuración de la tienda (sección 9) es una foto del día en que se escribió esta guía:
> puede haber cambiado desde entonces porque se edita desde Configuración.
>
> Para crear o cambiar bots (flujos del chat) lee la otra guía: [`GUIA-FLUJOS.md`](GUIA-FLUJOS.md).

## Índice

1. [La idea en 2 minutos](#1-la-idea-en-2-minutos)
2. [El menú lateral](#2-el-menú-lateral)
3. [Bandeja: donde se atiende](#3-bandeja-donde-se-atiende)
4. [Conceptos clave](#4-conceptos-clave)
5. [Equipos, roles y qué ve cada uno](#5-equipos-roles-y-qué-ve-cada-uno)
6. [Cómo se reparte un chat nuevo](#6-cómo-se-reparte-un-chat-nuevo)
7. [Automatizaciones del día a día](#7-automatizaciones-del-día-a-día)
8. [Un día típico](#8-un-día-típico)
9. [La configuración actual de la tienda](#9-la-configuración-actual-de-la-tienda)
10. [Preguntas frecuentes](#10-preguntas-frecuentes)
11. [Glosario](#11-glosario)

---

## 1. La idea en 2 minutos

El CRM sirve para atender a los clientes que escriben por **WhatsApp** (el canal principal) e **Instagram**
(también soporta Facebook, Telegram, X, Bluesky y Reddit). La conexión con esas redes la hace un servicio
externo llamado **Zernio**; el CRM recibe los mensajes y los muestra en la **Bandeja**.

Tres ideas explican casi todo:

1. **Cada cliente es un contacto.** Un mismo contacto puede escribir por WhatsApp y por Instagram; son dos
   *chats* (conversaciones) de la misma persona.
2. **Cada motivo por el que escribe es una gestión.** Una gestión es «un asunto con principio y fin»: una
   venta, un reclamo, una consulta. Tiene un tipo, una etapa, un responsable y termina con un resultado.
3. **Un bot opcional (los flujos) atiende primero.** Saluda, clasifica, pide datos y reparte al asesor. Cuando
   una persona responde, el bot se calla.

```
Cliente escribe  ->  Zernio  ->  CRM (webhook)  ->  ¿bot activo?  ->  flujo del bot (opcional)
                                      |                                   |
                                      v                                   v
                                 Bandeja  <-----  gestión (tipo, etapa, responsable) <-- reparto automático
```

## 2. El menú lateral

Lo que aparece depende del rol: **Dueño** y **Administrador** ven todo; los demás ven solo lo marcado «Todos».

| Menú | Quién lo ve | Para qué sirve |
|---|---|---|
| **Flujos** | Dueño, Administrador | Crear y editar los bots del chat (ver `GUIA-FLUJOS.md`). Incluye Plantillas, Laboratorio, Escenarios, Explorador y Mapa. |
| **Bandeja** | Todos | Chatear con los clientes y trabajar cada gestión. Es la pantalla principal. |
| **Gestiones** | Todos | Todas las gestiones (no solo la del chat abierto) en tres vistas: **Por cliente**, **Por gestión** y **Tablero** (ver 2.2). |
| **Contactos** | Todos | Directorio de clientes: buscar, filtrar, ver ficha e historial, importar un archivo CSV. |
| **Difusiones** | Dueño, Administrador | Enviar un mensaje masivo a un grupo (segmento) de contactos. |
| **Secuencias** | Dueño, Administrador | Mensajes automáticos escalonados en el tiempo («día 1, día 3, día 7»). |
| **Métricas** | Todos (cada uno ve lo que su rol permite) | Resumen, Asesores, Embudo, Resultados, Atrasados y Volumen. |
| **Analítica del bot** | Dueño, Administrador | Cuánto rinden los flujos, volumen de mensajes y crecimiento de contactos. |
| **Crecimiento** | Dueño, Administrador | Disparadores por comentarios en publicaciones (responder el comentario y escribir por privado). |
| **Canales** | Dueño, Administrador | Conectar y ver las cuentas de WhatsApp, Instagram, etc. |
| **Configuración** | Todos (un asesor solo ve lo suyo) | Ajustes. Ver sección 2.1. |

### 2.1 Configuración, sección por sección

| Sección | Quién | Qué se configura |
|---|---|---|
| **General** | Dueño, Admin | Nombre del espacio, claves (Zernio, IA) y **palabras clave globales** (por ejemplo «baja» para desuscribir). |
| **Equipo** | Dueño, Admin | Crear usuarios, enviar o copiar el acceso, quitar miembros. Solo el Dueño puede **Editar** a una persona (nombre, correo y rol; ver 5.5). |
| **Correo** | Solo Dueño | Servidor de correo (SMTP) para invitaciones y recuperar contraseñas. |
| **Gestiones** | Dueño, Admin | Tipos de gestión y, dentro de cada uno, siete pestañas: **General, Etapas, Categorías y motivos, Destino, Tiempos, Control de reclamos, Reglas**. |
| **Tipos de contacto** | Dueño, Admin | Prospecto, Cliente, etc., y los **días sin comprar** para pasar a «Inactivo». |
| **Equipos** | Dueño, Admin | Sedes, áreas o turnos con sus miembros, su rol (supervisor/asesor), qué tipos atiende cada uno y su modo de reparto. |
| **Horarios** | Dueño, Admin | Horario de atención de la empresa y de cada equipo, y feriados. |
| **Atención** | Dueño, Admin | Qué ve cada asesor, reparto sin equipos, devolver a la cola, gestiones atrasadas, respuesta fuera de horario y reasignación por espera. |
| **Código de la app** | Dueño, Admin | Descarga este ZIP. |
| **Registro de «Ver como»** | Solo Dueño | Quién miró la app como otra persona, a quién y por cuánto tiempo (ver 5.6). |
| **Respuestas guardadas** | Todos | Textos listos que se insertan escribiendo `/`. |
| **Plantillas de WhatsApp** | Todos (lectura) | Plantillas aprobadas por WhatsApp para escribir pasadas 24 horas. |
| **Diccionario de la tienda** | Todos | Marcas y palabras que el corrector no debe marcar. Los asesores piden; los administradores aprueban. |
| **Cambiar contraseña** | Todos | Tu contraseña. |

### 2.2 La pantalla Gestiones: tres vistas

Arriba de la lista hay cuatro pestañas: **Abiertas**, **Para hoy**, **Programadas** y **Cerradas**. A la derecha
de las pestañas se elige la vista (la inicial es **Por cliente**). Los filtros (buscar por nombre del contacto,
tipo, etapa, responsable, equipo y, en Cerradas, el periodo) se mantienen al cambiar de vista. El botón
**Nueva gestión** crea una a mano.

| Vista | Qué muestra | Para qué sirve |
|---|---|---|
| **Por cliente** (la inicial) | Una fila por cliente con todas sus gestiones activas dentro, como etiquetas «Postventa · Nueva · Luis», la más urgente primero. Si tiene más de una, aparece «2 gestiones». Con la flecha de la izquierda se abre el detalle de cada una (tipo, etapa, responsable, próximo contacto) y el botón **Abrir chat** (o **Ver contacto** si no hay chat). Las gestiones que no cumplen el filtro actual se ven atenuadas, solo como contexto. | Ver «todo lo de este cliente» de un vistazo. |
| **Por gestión** | Una fila por gestión, con las columnas Contacto, Tipo, Etapa, Estado, Responsable, Equipo, Abierta, la fecha (Próximo contacto, Se activa o Cerrada, según la pestaña) y Espera. Al pulsar una fila se abre el chat. | Revisar y filtrar gestión por gestión. |
| **Tablero** | Las gestiones **abiertas de un solo tipo**, una columna por etapa (numeradas) y, al final, la columna **Cerrar**. El tipo se elige con las etiquetas de arriba (cada una muestra cuántas gestiones tiene). Cada tarjeta muestra el cliente, su nota de próximo contacto o último mensaje, el responsable, el próximo contacto y el plazo si lo hay. Las más urgentes van arriba; cada columna muestra 20 y **Ver más (N)** trae el resto. | Ver el recorrido de las ventas o reclamos como un tablero y moverlos. |

**El Tablero solo funciona en «Abiertas» y «Para hoy».** Las gestiones programadas y las cerradas no están en
el tablero: si estás en el Tablero y pulsas «Programadas» o «Cerradas», la pantalla vuelve a **Por cliente**; y si
eliges Tablero estando en una de esas pestañas, pasa a «Abiertas». En el Tablero no hay filtros de tipo ni de
etapa (el tipo son las etiquetas y la etapa son las columnas).

**Cómo mover una gestión en el Tablero**

- **Arrastrar:** toma la tarjeta y suéltala en otra columna. Pasa de etapa al instante y sale el aviso
  «Pasó a …» con el botón **Deshacer** (ver 3.3). También puedes soltarla en una zona de la columna **Cerrar**
  (por ejemplo «Pagado» o «No compró»): se abre la ventana de cierre de siempre con ese resultado ya elegido,
  y la gestión no se cierra hasta que confirmes. En los tipos protegidos (Postventa) la zona dice «pide
  aprobación de un supervisor».
- **Sin arrastrar:** cada tarjeta tiene el botón **Mover a…** (las dos flechas). Abre una lista con las mismas
  columnas y los mismos cierres («Cerrar como …»), con los candados explicados.
- **Quién puede mover:** quien tiene la gestión asignada, el supervisor de su equipo y los administradores. Si
  no eres tú, sale «Solo quien tiene la gestión puede moverla». Con «Ver como» el tablero es solo lectura.
- **Candados:** con el orden estricto (3.3) las columnas bloqueadas no aceptan la tarjeta y el aviso dice
  «Orden estricto: pídele a un supervisor». Si la etapa actual pide algo antes de avanzar (categoría, nota o
  solución), el aviso dice «Antes de ir a …: elige la categoría» y ofrece **Abrir en el chat** para hacerlo.

---

## 3. Bandeja: donde se atiende

La Bandeja tiene tres zonas: la **lista de chats** (izquierda), el **chat** (centro) y la **ficha del
contacto** (derecha). Arriba del chat está la **tarjeta de la gestión**.

### 3.1 Las pestañas de la lista: «Ver» y «Estado»

Hay **dos filtros** que se combinan.

**De quién son los chats («Ver»):**

| Pestaña | Muestra | Quién la tiene |
|---|---|---|
| **Míos** | Las gestiones asignadas a ti (es la pestaña inicial). | Todos |
| **Sin asignar** | Gestiones abiertas que nadie tiene todavía. | Admin, supervisores y asesores solo si la empresa eligió «Las suyas y las sin asignar» |
| **Equipo** | Las gestiones de los equipos que supervisas (el admin ve también los suyos o todos si no tiene equipo). | Admin y supervisores |
| **Todos** | Todo lo que tu rol permite ver. | Solo Dueño y Administradores |

**Qué hay que hacer con ellos («Estado»):**

| Estado | Significa |
|---|---|
| **Por responder** | El cliente escribió y nadie ha contestado todavía. |
| **Seguimiento hoy** | Tiene «próximo contacto» vencido o de hoy, se activó hoy (gestiones programadas como Recompra) o, en Postventa, el plazo para registrar la solución ya venció. |
| **Todo** | Sin filtro de estado (es la opción inicial). |

Además hay filtros de tipo de gestión, etapa, estado (abierta / programada / sin gestión, esta última solo en
«Todos»), responsable, canal y una búsqueda. Los chats que no tienen gestión abierta aparecen como «Sin
gestión abierta».

**Una línea por gestión.** Cada chat de la lista muestra, debajo del nombre, **una línea por cada gestión
activa** del cliente, la más urgente primero: `● Postventa · Nueva · Luis` y, si hay plazo, un reloj con
«vence en 3 h» (en rojo si ya es urgente). Así, un cliente con una venta y un reclamo a la vez se ve completo
sin abrir el chat (ver 3.10).

### 3.2 La tarjeta de la gestión

Arriba del chat verás la tarjeta con: el **tipo** de gestión («¿De qué trata?» si está sin clasificar), la
**barra de pasos** (3.3), el **responsable**, la **categoría**, el **próximo contacto** y un historial («Qué se
hizo en esta gestión»). Si el cliente tiene dos o más gestiones activas, la tarjeta tiene una pestaña por
gestión (ver 3.10). Desde ahí puedes:

- **Cambiar el tipo** («Cambiar tipo a…»). Pasa a la primera etapa del tipo nuevo y puede enviarse a otro
  equipo si ese tipo tiene destino distinto. En tipos protegidos (Postventa) solo lo cambia un supervisor.
- **Tomar la gestión** («Quedarte con esta gestión») si estaba sin asignar y tu rol lo permite.
- **Asignar a…**, **Transferir a equipo**, o **Devolver a la cola** (si la empresa lo permite a los asesores).
- **Programar el próximo contacto** («Cuándo volver a escribirle al cliente»): fecha y nota. Ese día la
  gestión aparece en «Seguimiento hoy».
- **Mover de paso** y **cerrar** la gestión (ver 3.3 y 3.4).

### 3.3 La tarjeta de la gestión: pasos, botón principal y «Para avanzar»

La tarjeta guía al asesor para que no tenga que memorizar el proceso. De arriba hacia abajo:

**1. La barra de pasos (una sola línea).** Muestra todas las etapas abiertas del tipo en orden, con el título
«Paso 2 de 4». Los pasos ya hechos van con una marca ✓, el paso actual con su número y nombre resaltado, y el
siguiente siempre con su nombre; si no cabe todo en el ancho, los demás pasos se acortan a su número y los
hechos se juntan en «✓ 3 hechos». **Cada paso es un botón: se toca para moverse.** Al tocarlo la tarjeta
pregunta en el mismo sitio «¿Mover a Asesorando?» con el detalle («Avanzas 1 paso» o «Vuelves 2 pasos») y los
botones **Mover** y **Cancelar**; recién al pulsar Mover cambia la etapa. Al final de la barra está el botón
**Cerrar** (ver 3.4). El texto a la derecha de la barra dice qué se puede hacer: «Toca un paso para moverte»,
«Orden estricto», «Supervisor: puedes saltar a cualquier paso» o «Solo quien tiene la gestión puede moverla».

**2. «Ahora».** La guía de la etapa actual en una frase (por ejemplo «Saluda y pregunta qué producto busca»).

**3. «Para avanzar».** Si la etapa pide algo antes de salir de ella, aparece un recuadro con una casilla:

| Lo que pide la etapa | Casilla | Cómo se cumple |
|---|---|---|
| Categoría | «Elige la categoría» | Se pulsa una de las categorías del tipo (queda «Categoría: …»). |
| Nota | «Deja una nota» | Se escribe en «Qué hiciste o acordaste en esta etapa» y se pulsa **Guardar nota**. |
| Solución (Postventa) | «Registra la solución» | Botón **Registrar solución** (fecha de compromiso con el cliente; luego se puede **Actualizar la solución**). |

Mientras falte eso, **no se puede avanzar** a un paso siguiente: el botón principal queda apagado con la letra
pequeña «primero elige la categoría» y, si se toca un paso de la barra, la tarjeta avisa «Antes de ir a
Esperando pago: elige la categoría». Volver atrás sí se puede. Los supervisores y administradores quedan
exentos. Si la etapa pide la solución, el botón principal es **Registrar solución** («luego podrás pasar de
paso») y los demás destinos aparecen con candado bajo «Después podrás pasar a:».

**4. El botón principal, con su destino.** Debajo van los botones de la guía. Cada uno dice la acción y, en
letra pequeña, **a dónde lleva**: **Pasar a Asesorando** («va al paso 2 de 4»), **Cerrar como Pagado** («cierra
la gestión») o **Volver a …**. Si la empresa les puso un texto propio, se ve ese texto y debajo «pasa a …» o
«cierra como …». El botón destacado es el siguiente paso natural. Los cierres «negativos» (por ejemplo «No
compró») van aparte, en rojo, a la derecha. Una **ayuda** como **Recordarle mañana** no cambia el paso: solo
fija el próximo contacto («no cambia el paso»).

**5. Orden estricto con candados (opcional, por tipo de gestión).** Si está activado, un asesor solo puede ir
a los pasos siguientes configurados de su etapa actual o **volver un paso** (tocando el paso anterior en la
barra). Los demás pasos se ven con un **candado** y al tocarlos sale «Orden estricto: pídele a un supervisor».
Un supervisor o administrador **puede saltar a cualquier paso**: el salto queda anotado en el historial. El
orden estricto solo afecta a lo que se hace con la pantalla (tarjeta y Tablero): los bots, las reglas y las
tareas automáticas pueden mover la etapa igual. Sin orden estricto, cualquiera que tenga la gestión puede
tocar cualquier paso.

**6. «Deshacer» (10 segundos).** Después de mover de paso aparece una franja verde «Pasó a Asesorando» con el
botón **Deshacer** y una barrita que se va acortando: **tienes 10 segundos**. Deshacer devuelve la gestión a la
etapa anterior, y solo funciona si:
- lo pide **la misma persona que movió** la gestión (si no: «Solo quien movió la gestión puede deshacer el
  cambio»);
- no pasó el tiempo («Ya pasó el tiempo para deshacer este cambio»);
- nadie más cambió la gestión después, y tú tampoco hiciste otra cosa (cualquier otra acción cierra la franja).

**Lo que Deshacer NO revierte:** solo devuelve la etapa. Si al entrar al paso se activó un flujo automático
(que pudo enviarle mensajes al cliente), una regla que cambió el tipo del contacto o una regla que programó
otra gestión, eso **ya pasó y no se deshace**: la misma franja lo avisa en letra pequeña («Deshacer solo devuelve
la etapa: eso no se revierte») y, al deshacer, tampoco se vuelven a enviar mensajes. **Cerrar la gestión no
tiene Deshacer** (para eso se puede reabrir si el cliente vuelve a escribir, ver 3.4). El mismo aviso con
**Deshacer** aparece al mover en el Tablero.

Todo el contenido (guía, pasos, qué exige cada etapa, orden estricto) se edita en Configuración → Gestiones →
[tipo] → **Etapas**.

### 3.4 Cerrar una gestión

El botón **Cerrar** de la barra de pasos (o un botón «Cerrar como …») abre el cierre dentro de la misma
tarjeta. Eliges el **resultado**: **ganada** (p. ej. «Pagado»), **perdida** («No compró») o **resuelta**. Según
el tipo te pide un **motivo** (por qué se perdió o cómo se resolvió), una **categoría** y/o una nota («Qué se
hizo»). El panel muestra «Lo que va a pasar»: por ejemplo, que el contacto pasará a Cliente y que se programará
una Recompra en 25 días, con la opción de **cambiar la fecha** para ese cliente. Se confirma con **Confirmar**
(o **Pedir aprobación** en los cierres que necesitan a un supervisor, ver 3.9).

Si el cliente vuelve a escribir poco después de cerrar, la **misma gestión se reabre** (por defecto dentro de
24 horas; en Postventa son 7 días).

### 3.5 Tipo de cliente: «¿Ya nos compró antes?»

Los contactos nuevos entran como **Prospecto**. Bajo la cabecera del chat aparece una pregunta única:
**«¿Ya nos compró antes?»** Responderla fija si es Prospecto o Cliente. No bloquea nada y tiene
**«Preguntar después»** (se calla 7 días). No se pregunta si el contacto ya tiene alguna venta ganada (ahí ya
se sabe que es cliente). Después el tipo cambia solo con las reglas (sección 4.4) y la inactividad (7.5).

### 3.6 Escribir, notas internas y adjuntos

| Función | Cómo funciona |
|---|---|
| **Responder** | Escribes y envías por el mismo canal del cliente. |
| **Nota interna** | Cambia el modo del cuadro a «Nota interna»: la ve solo el equipo, el cliente no. Requiere una gestión abierta. |
| **Respuestas guardadas** | Escribe `/` en cualquier parte del mensaje (o usa el botón) para elegir un texto guardado. Admiten variables: `{primer_nombre}`, `{nombre}`, `{saludo}` (Buenos días/tardes/noches según la hora de Lima), `{asesor}`, `{sede}`, `{empresa}`, `{hoy}` y `{campo:slug}` para campos personalizados. Pueden ser de la empresa (admin), del equipo (supervisor) o personales. |
| **Adjuntos** | Hasta **5 archivos** por mensaje, de hasta 25 MB (imágenes JPG/PNG, PDF, vídeo MP4; cada canal tiene sus propios límites, p. ej. WhatsApp: imagen 5 MB y vídeo 16 MB). |
| **Corrector ortográfico** | Subraya errores en la caja y propone correcciones. Al enviar hay una franja de **revisión** que junta las sugerencias. El **Diccionario de la tienda** evita que marque marcas y palabras propias. |
| **Borradores** | Lo que escribes y no envías se guarda por chat. |
| **Reintentos** | Si el envío falla, el mensaje queda en cola de salida y se reintenta sin duplicarse. |
| **Avisos** | Contador en la pestaña, sonido y notificación del navegador para mensajes nuevos (configurable). |

### 3.7 La ventana de 24 horas y las plantillas de WhatsApp

WhatsApp solo permite mensajes libres hasta **24 horas después del último mensaje del cliente**. El chat
muestra una **cuenta regresiva**. Pasado ese plazo el cuadro se bloquea y aparece **«Usar plantilla»**:
solo se puede enviar una plantilla de WhatsApp **ya aprobada** (se ven en Configuración → Plantillas de
WhatsApp). Instagram y los demás canales no tienen esta regla.

Los bots y las secuencias tratan igual la ventana: si está cerrada y el nodo tiene una plantilla
configurada, la usan; si no, **no envían nada** y lo anotan.

### 3.8 Pausa del bot en un chat

Cuando una persona responde, el bot de esa conversación se **pausa solo** (para no hablar encima del
asesor). Se puede pausar o reanudar a mano desde la cabecera del chat. Detalle en la guía de flujos.

### 3.9 Postventa y el control de reclamos

Los tipos marcados como **protegidos** (hoy, Postventa) tienen reglas extra para que ningún reclamo se
quede sin atender:

- **Plazo para registrar la solución** (en Postventa, 24 horas **hábiles** según el horario del equipo o de la
  empresa y sus feriados; sin horario, horas corridas). La gestión debe cerrarse como resuelta o tener una
  **solución en proceso** con fecha de compromiso («Compromiso con el cliente», «Registrar solución» /
  «Actualizar la solución»). Si no, se avisa al supervisor y aparece en «Seguimiento hoy».
- **Cerrar como perdida/sin solución** necesita al supervisor: el asesor deja un **pedido de cierre**
  («Pedir aprobación») con una nota y el supervisor aprueba o rechaza. Cerrar como resuelta exige describir
  «Qué se hizo».
- **Solo el supervisor cambia el tipo** de una gestión protegida.
- **Reclamos formales:** un detector de palabras marca el chat con un aviso cuando el cliente parece
  presentar un reclamo; la categoría «Reclamo» es de prioridad alta.
- Se configura en Configuración → Gestiones → Postventa → **Control de reclamos** (plazo y días de reapertura).

### 3.10 Varias gestiones de un mismo cliente

Un cliente puede tener **más de una gestión activa a la vez** (por ejemplo, una Venta y un reclamo de
Postventa). Se nota en tres sitios:

- **Bandeja, lista de chats:** una línea por gestión debajo del nombre, la más urgente primero (ver 3.1).
- **Chat, tarjeta de la gestión:** con 2 o más gestiones activas aparecen **pestañas, una por gestión**
  («Gestiones de este cliente»), cada una con su tipo, su etapa y su plazo. Cada pestaña tiene su propia barra de
  pasos, su guía y sus acciones: lo que haces en una no toca la otra. Junto a las pestañas hay un menú **Ver
  cerradas (N)** para abrir una gestión ya cerrada (se ve como pestaña «Cerrada: …», sin acciones) y el botón
  **Nueva gestión**.
- **Gestiones, vista Por cliente:** una fila por cliente con todas sus gestiones («2 gestiones»).

**Cuándo se puede abrir otra a mano («Nueva gestión»):**

| Situación | Qué pasa |
|---|---|
| Otro tipo distinto | Pide confirmar: «Este contacto ya tiene otra gestión abierta. Confirma que quieres abrir una en paralelo.» |
| El mismo tipo, y el tipo es **comercial** (tiene etapas finales «ganada» o «perdida», como Venta o Recompra, y no es protegido) | Pregunta «Este cliente ya tiene una venta abierta. ¿Abrir otra?» y se abre si confirmas. |
| El mismo tipo, y es protegido (Postventa) o solo se «resuelve» (Consulta) | No se puede: «Este contacto ya tiene una gestión abierta de ese tipo. Ve a esa gestión en vez de abrir otra igual.» |
| **Sin clasificar** y ya hay una gestión abierta o programada | No se puede ni confirmando: «Ya tiene una gestión abierta: clasifícala en vez de crear otra.» |

Además, la base de datos solo admite **una gestión «Sin clasificar» activa por cliente**: si dos mensajes
llegan casi a la vez, el segundo reutiliza la que ya se abrió en vez de crear otra.

---

## 4. Conceptos clave

### 4.1 Chat vs gestión

| | Chat (conversación) | Gestión |
|---|---|---|
| Qué es | El hilo de mensajes con un contacto en un canal. | Un asunto concreto con inicio y fin. |
| Cuántos | Uno por canal y contacto. Dura para siempre. | Muchas a lo largo del tiempo. Un cliente puede tener **varias abiertas a la vez** si son de distinto tipo (o del mismo, en tipos comerciales como Venta); ver 3.10. |
| Tiene | Mensajes, bot activo/pausado. | Tipo, etapa, categoría, responsable, equipo, próximo contacto, resultado. |
| Se cierra | No. | Sí: ganada, perdida o resuelta. |

Cuando un cliente escribe y no tiene gestión abierta, **se abre una nueva automáticamente**. Su tipo se
sugiere según el tipo de contacto (un Prospecto suele abrir una Venta) o queda **«Sin clasificar»** hasta
que el bot o el asesor la clasifique. También se pueden abrir gestiones **a mano** (p. ej. una venta por
teléfono) o **programadas** (Recompra, que aparecen el día elegido).

### 4.2 Tipo de contacto

Responde «¿quién es?». Cambia poco: **Prospecto**, **Cliente**, **Cliente frecuente**, **Inactivo**. El
primero es el que se asigna por defecto. Se ve como una etiqueta de color junto al nombre.

### 4.3 Tipos de gestión y sus piezas

| Pieza | Para qué sirve | Ejemplo |
|---|---|---|
| **Tipo de gestión** | La clase de asunto. | Venta, Postventa, Consulta, Recompra. |
| **Etapa** | En qué punto va (cada tipo tiene las suyas). Hay etapas *abiertas* y *finales*. | «Esperando pago». |
| **Etapas finales** | Cómo termina: **ganada**, **perdida** o **resuelta**. | «Pagado», «No compró», «Resuelta». |
| **Categoría** | Subtema, se elige durante la gestión (puede ser obligatoria). | «Cambio o devolución». |
| **Motivo** | Por qué terminó (ganada/perdida/resuelta). Puede ser obligatorio al cerrar. | «Precio», «Reembolso realizado». |
| **Destino** | A quién va la gestión: al responsable del contacto, a la cola del equipo del contacto o a un equipo fijo. | Postventa -> equipo fijo. |
| **Tiempos** | Objetivos: primera respuesta (minutos) y resolución (horas). Alimentan las Métricas. | — |
| **Proactiva** | Tipo que no nace de un mensaje del cliente sino de una regla o a mano; tiene fecha de próximo contacto. | Recompra. |
| **Plantilla automática** | Plantilla de WhatsApp que se envía sola cuando una gestión programada llega a su fecha. | Recordatorio de recompra. |
| **Reglas** | Qué pasa en el CRM cuando la gestión cambia (ver 4.4). | — |

### 4.4 Reglas de gestión

Viven dentro de cada tipo (Configuración → Gestiones -> [tipo] -> **Reglas**). Cada regla tiene un
**momento**, una **condición opcional** y una **acción**.

| Momento | Condición opcional | Acciones posibles |
|---|---|---|
| Al abrir · Al cambiar a una etapa · Al ganar · Al perder · Al resolver | Categoría, motivo o tipo de contacto | **Cambiar el tipo de contacto** (con «desde la vez número N», p. ej. Cliente frecuente desde la 2.ª compra) · **Programar otra gestión** (en N días, o N días antes de la fecha clave del contacto) · **Pedir la fecha clave** al cerrar (p. ej. vencimiento de membresía). |

No confundir con los flujos: las reglas ordenan el trabajo interno (días o meses); los flujos conversan con
el cliente (minutos u horas).

### 4.5 Recompra programada

Al ganar una Venta (y también una Recompra) la regla programa una gestión de **Recompra** para dentro de
**25 días**. Se crea como «programada» y el día elegido pasa a abierta y aparece en «Seguimiento hoy» del
responsable. Si el tipo tiene plantilla automática, se envía el recordatorio por WhatsApp. El asesor puede
cambiar la fecha al cerrar la venta (por ejemplo, si el cliente compró un producto que le dura más).

### 4.6 Etiquetas, campos personalizados y fecha clave

- **Etiquetas:** marcas libres en el contacto («VIP», «Satisfecho»). Los bots las agregan y quitan.
- **Campos personalizados:** datos propios del contacto (p. ej. `numero_pedido`, `producto_interes`) que el
  bot puede guardar y usar en mensajes con `{campo:slug}` o `{{...}}`.
- **Fecha clave:** una fecha importante del contacto (vencimiento, cumpleaños). Alimenta reglas y la variable
  `{{fecha_clave}}`.

---

## 5. Equipos, roles y qué ve cada uno

### 5.1 Roles

Hay dos niveles fijos (no se pueden crear roles a medida):

**En la empresa**

| Rol | Puede |
|---|---|
| **Dueño** | Todo, incluidas las claves (Zernio, IA), el correo, los canales y los datos de la empresa. Además es el único que puede **editar usuarios** (nombre, correo y rol), nombrar a otros Dueños, quitar a un Administrador o a otro Dueño, y usar **«Ver como»**. **Puede haber varios Dueños, pero siempre debe quedar al menos uno**: el último Dueño no puede dejar de serlo ni ser quitado (primero hay que nombrar a otro). |
| **Administrador** | Todo lo operativo: ver todos los chats, configurar gestiones, equipos, reparto, plantillas, flujos, difusiones, secuencias; crear usuarios nuevos (como Miembro o Administrador) y enviarles su acceso. No toca claves ni el correo, no edita usuarios existentes y no nombra Dueños. |
| **Miembro** | Lo que le den sus roles de equipo. Sin equipos, actúa como asesor de toda la empresa. |

**Dentro de un equipo** (sede, área o turno)

| Rol | Puede |
|---|---|
| **Supervisor** | Ver todos los chats, contactos y gestiones de su equipo; asignar y reasignar dentro del equipo; aprobar cierres de reclamos; ver las métricas del equipo; crear respuestas guardadas del equipo; recibe los avisos de atrasos. |
| **Asesor** | Atiende sus gestiones. Lo que más ve depende de la regla de visibilidad (5.2). |

### 5.2 Qué ve un asesor (Configuración -> Atención)

| Opción | Efecto |
|---|---|
| **Solo sus gestiones** (recomendada) | Ve únicamente lo que le asignaron. No ve la cola ni toma gestiones por su cuenta. |
| **Las suyas y las sin asignar de su equipo** | Además ve la cola de su equipo y puede tomar. |
| **Todas las de su equipo** | Ve todo su equipo. |

El supervisor siempre ve todo su equipo; el administrador, todo. Sin equipos, la regla se aplica a toda la
empresa. Importante: estos permisos los aplica la **base de datos** (no solo la pantalla), así que lo que no
se puede ver, no se puede ver ni por error.

### 5.3 Resumen de permisos

| Acción | Dueño / Admin | Supervisor | Asesor |
|---|---|---|---|
| Ver chats y gestiones | Todos | Su equipo | Según 5.2 |
| Responder | Sí | Su equipo | Sus gestiones |
| Tomar una gestión sin asignar | Sí | Su equipo | Solo con la opción 2 de 5.2 |
| Asignar o transferir | A cualquiera | Dentro de su equipo | Devolver a la cola (si está permitido) |
| Mover de paso (barra de pasos o Tablero), etiquetas, notas, próximo contacto | Sí | Su equipo | Sus gestiones (con el orden estricto, solo los pasos permitidos) |
| Editar usuarios del equipo, nombrar Dueños, «Ver como» | Solo Dueño | No | No |
| Eliminar contactos | Sí | No | No |
| Exportar datos | Sí | Su equipo | No |
| Difusiones, Secuencias, Flujos, Canales | Sí | No | No |
| Configuración (gestiones, equipos, horarios...) | Sí | No | No (solo contraseña, respuestas, diccionario) |
| Métricas | Todas | Su equipo | Las suyas |

### 5.4 Equipos

Un equipo es una **sede, área o turno**. Cada uno tiene miembros (con rol supervisor o asesor), **qué tipos
de gestión atiende cada miembro** (por defecto todos), un **modo de reparto**, un **horario propio**
(opcional) y la casilla «el supervisor no recibe chats». Uno puede ser el **equipo por defecto**, adonde
caen los contactos sin sede. Una persona puede estar en varios equipos. Todo es opcional: sin equipos la
empresa entera actúa como un solo equipo.

### 5.5 Editar un usuario del equipo

Configuración → **Equipo** lista a las personas con su rol. **Solo un Dueño** ve el botón **Editar** en cada
fila; abre la ventana **«Editar usuario»** con tres datos:

| Dato | Detalle |
|---|---|
| **Nombre** | El nombre con el que se ve a la persona en toda la app. |
| **Correo** | Es el correo con el que inicia sesión. Si lo cambias, entrará con el nuevo y se le envía a esa dirección un enlace de acceso (si el correo de la app está configurado; si no, se avisa). No puede ser un correo que ya tenga otra cuenta. |
| **Rol** | **Miembro**, **Administrador** o **Dueño**. Al elegir Dueño pide confirmar con «Hacer Dueño», porque ese rol ve y cambia todo, incluidas las claves. |

Reglas que conviene saber:

- **Siempre queda al menos un Dueño.** Si eres el único, el rol Dueño aparece bloqueado con el aviso «Eres el
  único Dueño: no puedes dejar de serlo ni ser eliminado. Primero nombra a otro Dueño.»
- Quien también pertenece a otro espacio de trabajo no puede subir a Administrador ni a Dueño aquí.
- Debajo del formulario se ven los **equipos** de la persona y el enlace «Cambiar en Equipos»: el rol de
  supervisor o asesor se cambia en Configuración → Equipos, no aquí.
- Cada cambio de nombre, correo o rol queda anotado en el historial de configuración.

**Volver a agregar a alguien que se quitó.** «Crear usuario» con el correo de una cuenta que ya existía (por
ejemplo, una persona a la que se quitó del equipo) no crea una cuenta nueva: la **vuelve a agregar** con el rol
elegido y **le envía un enlace para restablecer su contraseña**, porque la anterior ya no se considera segura
(si nunca había activado su cuenta, recibe el correo de activación). Si el correo de la app no está configurado,
la fila avisa y el enlace se envía después desde ella con «Enviar enlace para restablecer contraseña». No se
puede agregar así a quien es Dueño o Administrador de otro espacio.

### 5.6 «Ver como»: mirar la app con los ojos de otro

**Solo los Dueños.** Sirve para comprobar qué ve y qué puede hacer un administrador, un supervisor, un asesor o
una persona concreta, sin pedirle su pantalla. En la franja de arriba, a la derecha, el Dueño ve
**«Vista: Dueño (tú)»**; al pulsarlo se abre el selector **«Ver como…»**:

- **Por rol:** Administrador, o Supervisor / Asesor de un equipo. Está siempre disponible, aunque todavía nadie
  tenga ese rol.
- **Por persona:** una lista con buscador (por nombre, rol o equipo).

Mientras dura la vista:

- Una franja ámbar dice a quién estás mirando y **«Solo lectura»**. Los botones de la franja son **Cambiar
  vista** y **Salir**.
- **Es solo lectura:** no se puede cambiar nada (mover pasos, enviar mensajes, configurar...). Cualquier intento
  avisa «Solo lectura…» y no se guarda.
- **No deja huella en la otra persona:** no marca chats como leídos ni cambia su estado Disponible/Ausente.
  Sí queda un registro de **quién miró**, para que se pueda saber después.
- **Dura 30 minutos.** Al terminar aparece la capa «La vista terminó» («Pasaron 30 minutos y «Ver como» se
  cerró. No se guardó ningún cambio») para volver a tu vista.
- Quien ve la vista no puede abrir Configuración → Registro de «Ver como», ni descargar el código.

El **registro** está en Configuración → **Registro de «Ver como»** (solo Dueño): Fecha y hora, Quién miró, A
quién miró, Qué abrió y Duración, con filtros por persona y por periodo.

## 6. Cómo se reparte un chat nuevo

Como un asesor (con la opción recomendada) solo ve lo asignado, **ninguna gestión debe quedarse esperando
a que alguien la tome**. Al llegar a su destino se asigna sola, en este orden:

1. **Equipo de destino.** Si la gestión ya tiene equipo se respeta; si no, según el tipo: *equipo fijo*, el
   equipo del contacto o el equipo por defecto.
2. **Responsable del contacto.** Si el tipo de gestión va «Al responsable del contacto» y el contacto ya tiene
   asesor **disponible** que atiende ese tipo, la gestión va a él.
3. **Elegibles.** Los miembros del equipo que atienden ese tipo y están **Disponibles** (los marcados
   «Ausente» se saltan). Sin equipos: los miembros de la empresa con rol Miembro.
4. **Modo de reparto** (se elige por equipo, o en Atención si no hay equipos):

| Modo | Cómo reparte |
|---|---|
| **Por turnos** (round robin) | Al que lleva más tiempo sin recibir una gestión, uno a uno. |
| **Al de menor carga** | Al que tenga menos gestiones abiertas en ese momento. |
| **Manual** | No asigna: queda «Sin asignar» hasta que un supervisor o administrador la asigne. |

Si no hay nadie elegible y disponible, queda sin asignar. El bot puede disparar este reparto con el nodo
**Repartir a asesor** (ver guía de flujos).

## 7. Automatizaciones del día a día

### 7.1 Horarios de atención

Configuración -> Horarios. Hay un horario de la empresa y uno opcional por equipo, más **feriados**. Se usa
para: la respuesta fuera de horario, contar las horas hábiles (plazos de Postventa, reasignación por espera)
y la condición «Dentro de horario» de los flujos. Todo se mide en **hora de Lima**.

### 7.2 Respuesta fuera de horario

Configuración -> Atención. Si está activa, cuando el cliente escribe fuera de horario recibe un texto
automático con variables `{nombre}`, `{empresa}` y `{apertura}` (la próxima apertura, p. ej. «lunes 9:00»).
Se envía una sola vez por gestión, o con un mínimo de horas entre mensajes si se indica.

### 7.3 Reasignación por espera

Opcional (Atención). Si el cliente espera más de N minutos **hábiles** a un asesor que no responde, la
gestión vuelve a la cola y se reparte a **otra persona** (se avisa al supervisor y al asesor anterior). Si
no hay otra persona disponible, no se la quita: solo se avisa al supervisor.

### 7.4 Gestiones atrasadas

Métricas -> **Atrasados** lista las gestiones abiertas con próximo contacto vencido o que llevan demasiados
días en la misma etapa (los días se fijan en Atención).

### 7.5 Inactividad automática

Una vez al día, los contactos cuya **última venta ganada** fue hace más de N días pasan al tipo «Inactivo»
(por defecto 90 días; se cambia en Configuración -> Tipos de contacto). No se toca a quien nunca compró, ni a
quien una persona corrigió a mano dentro del plazo. Si vuelve a comprar, las reglas de venta lo devuelven a
Cliente o Cliente frecuente.

### 7.6 Pausa y reanudación del bot

El bot se pausa cuando una persona responde y vuelve **solo 24 h después del último mensaje humano si el
contacto no tiene gestiones abiertas ni programadas**. Detalle en la guía de flujos.

### 7.7 Tareas programadas (cron)

Un reloj interno corre cada minuto (`app/api/cron`, configurado en `vercel.json`) y ejecuta: gestiones
programadas que llegan a su fecha, plantillas automáticas, detección de «cliente sin responder», reasignación
por espera, plazos de Postventa, reanudación del bot, inactividad y envío de secuencias y difusiones
programadas.

## 8. Un día típico

### 8.1 Asesor

1. Entra a **Bandeja** (abre en **Míos**) y mira **Por responder**: son los clientes esperando.
2. Abre un chat: lee la tarjeta y la **guía** de la etapa («Saluda y pregunta qué producto busca»).
3. Responde (con `/` para respuestas guardadas; revisa lo que marca el corrector). Si pasaron 24 h usa
   **Usar plantilla**.
4. Avanza la etapa con el botón principal de la tarjeta («Pasar a …») o tocando un paso de la barra mientras la
   venta progresa («Asesorando» -> «Pedido o enlace de pago enviado»). Si te equivocas, tienes 10 segundos
   para pulsar **Deshacer**. Si el bot tiene un flujo en esa etapa, enviará solo los datos de pago.
5. Si el cliente no puede seguir hoy: **próximo contacto** con fecha y nota.
6. Cierra la venta como **Pagado** (elige motivo si lo pide). Revisa la fecha de recompra.
7. Al final del día: **Seguimiento hoy** muestra a quién escribirle de nuevo.
8. Si se ausenta, se marca **Ausente** para no recibir reparto.

### 8.2 Supervisor

1. Mira **Sin asignar** (gestiones que el reparto no pudo asignar) y asigna.
2. Revisa **Equipo** y **Por responder** para ver a quién le falta contestar.
3. Atiende los **pedidos de cierre** de Postventa (aprobar o rechazar con nota) y los avisos de plazo
   vencido.
4. Revisa **Métricas -> Asesores / Cumplimiento / Atrasados** y empuja lo atrasado.
5. Reasigna si un asesor se ausenta o está saturado.

### 8.3 Administrador

Mantiene la configuración (tipos, etapas, guías, reglas, equipos, horarios), crea usuarios (editarlos y nombrar Dueños es solo del Dueño), ajusta los
flujos del bot con ayuda de las Métricas y la Analítica del bot, y aprueba palabras del diccionario.

---

## 9. La configuración actual de la tienda

Foto tomada de la base de datos de Muscle Shop (sin datos personales). Parte de la plantilla de negocio
**E-commerce** (`lib/business-templates.ts`) y puede haberse editado.

### 9.1 Tipos de contacto

**Prospecto** (por defecto), **Cliente**, **Cliente frecuente**, **Inactivo**.

### 9.2 Tipos de gestión

| Tipo | Destino | Proactiva | Motivo obligatorio | Otros |
|---|---|---|---|---|
| **Venta** | Al responsable del contacto | No | Sí | — |
| **Postventa** | **Equipo fijo** | No | Sí (y categoría obligatoria) | **Protegida**: plazo de solución 24 h, reapertura 7 días |
| **Consulta** | Al responsable del contacto | No | No | — |
| **Recompra** | Al responsable del contacto | **Sí** | Sí | — |

Cuando se tomó la foto, ningún tipo tenía orden estricto activado ni objetivos de tiempo (primera respuesta/resolución); se activan por tipo en Configuración → Gestiones.

### 9.3 Etapas y textos de la guía

**Venta**

| Etapa | Tipo | Guía |
|---|---|---|
| Nuevo interesado | abierta | «Saluda y pregunta qué producto busca.» |
| Asesorando | abierta | «Recomienda el producto y confirma sabor, tamaño y dirección.» |
| Pedido o enlace de pago enviado | abierta | «Confirma que el cliente recibió el enlace y cómo va a pagar.» |
| Esperando pago | abierta | «Espera la confirmación del pago (Yape, Plin o transferencia).» |
| Pagado | ganada | — |
| No compró | perdida | — |

**Postventa**

| Etapa | Tipo | Guía | Exige |
|---|---|---|---|
| Nueva | abierta | «Pregunta qué pasó y elige la categoría.» | Elegir categoría |
| En gestión | abierta | «Registra la solución antes del plazo y coordina con almacén o courier.» | Registrar solución |
| Esperando al cliente | abierta | «Espera la respuesta del cliente; si no responde, recuérdale.» | — |
| Esperando almacén o courier | abierta | «Haz seguimiento al almacén o courier y avisa al cliente.» | — |
| Resuelta | resuelta | — | — |
| Sin solución | perdida | — | — |

**Consulta:** Abierta («Responde la consulta.») -> Resuelta.

**Recompra:** Recordatorio enviado («Espera su respuesta; si no contesta, insiste una vez.») -> Interesado
(«Arma el pedido como en una venta.») -> **Compró** (ganada) / **No compró** (perdida).

### 9.4 Categorías y motivos

| Tipo | Categorías | Motivos |
|---|---|---|
| Venta | — | Precio, Sin stock, Costo o demora del envío, Solo consultaba, Dejó de responder, Compró en otro lado (todos de «perdida») |
| Postventa | Estado de pedido, Cambio o devolución, Producto dañado, Comprobante, **Reclamo** (prioridad alta) | Resuelta: Cambio o reposición entregada, Reembolso realizado, Pedido entregado, Comprobante enviado, Información o asesoría brindada. Perdida: Cliente no respondió, No procede según la política, Cliente desistió |
| Consulta | — | — |
| Recompra | — | Los mismos motivos de perdida que Venta |

### 9.5 Reglas de gestión activas

| Tipo | Momento | Acción |
|---|---|---|
| Venta | Al ganar | Contacto pasa a **Cliente** |
| Venta | Al ganar | Contacto pasa a **Cliente frecuente** desde la 2.ª venta ganada |
| Venta | Al ganar | **Programar Recompra a los 25 días** |
| Recompra | Al ganar | Las mismas tres reglas |

### 9.6 Equipos

Hoy existen dos equipos de prueba: **Ventas (Prueba)** (por defecto, reparto por turnos) y **Atención
(Prueba)** (reparto al de menor carga). Postventa está configurada con destino «equipo fijo». Los nombres
dicen «Prueba»: son para ensayar y se pueden cambiar.

### 9.7 Bots publicados

Hay **10 flujos publicados** (y un borrador vacío «Flujo sin título»). Están descritos uno por uno en la
sección 10 de [`GUIA-FLUJOS.md`](GUIA-FLUJOS.md).

---

## 10. Preguntas frecuentes

**¿Cuántas gestiones puede tener un cliente?** Muchas a lo largo del tiempo, y varias abiertas a la vez si son
de distinto tipo (por ejemplo una Venta y una Postventa). El chat muestra una pestaña por gestión y la Bandeja
una línea por gestión (ver 3.10). Lo que no se puede es tener dos «Sin clasificar» abiertas: se clasifica la que
ya existe.

**Un cliente escribió y no aparece en «Míos».** Aún no se le asignó, o se asignó a otra persona. Pide a un
supervisor mirar **Sin asignar**, o revisa que tu estado no sea «Ausente».

**¿Por qué no veo «Todos» ni «Equipo»?** Esas pestañas son solo para administradores (Todos) y
administradores/supervisores (Equipo).

**El cuadro de escribir está bloqueado.** Pasaron más de 24 h desde el último mensaje del cliente en
WhatsApp. Usa «Usar plantilla».

**El bot respondió encima de mí / no responde.** Si una persona respondió, el bot se pausa. Se reanuda a mano
desde la cabecera, o solo después de 24 h si no quedan gestiones abiertas.

**¿Qué diferencia hay entre cerrar el chat y cerrar la gestión?** En el CRM se cierra la **gestión** (con
resultado). El chat sigue existiendo.

**¿Se pierde algo si cambio una etapa o un tipo en Configuración?** Los tipos y etapas se **archivan**, no se
borran; las gestiones viejas conservan su historial. Aplicar una plantilla de negocio solo agrega lo que
falta y nunca borra.

**¿Dónde veo quién hizo qué?** En el historial de la gestión («Qué se hizo en esta gestión») y en la línea de
tiempo del contacto: cambios de etapa, asignaciones, cierres y pausas del bot quedan registrados con fecha y
autor.

**¿Los datos de los clientes viajan en el ZIP?** No. El ZIP lleva solo el código; ni claves ni datos.

**¿Puedo probar sin escribir a clientes reales?** Sí: los canales de prueba muestran la etiqueta «Prueba», y
los bots se prueban en el Laboratorio sin enviar nada (ver guía de flujos).

## 11. Glosario

| Término | Significado |
|---|---|
| **Asesor** | Persona que atiende chats. |
| **Bandeja** | Pantalla de chats. |
| **Canal** | Cuenta conectada (un número de WhatsApp, una cuenta de Instagram). |
| **Categoría** | Subtema de una gestión. |
| **Chat / conversación** | Hilo de mensajes con un contacto en un canal. |
| **Cron** | Tarea que corre sola cada cierto tiempo. |
| **Destino** | A qué equipo/persona va una gestión. |
| **Difusión** | Mensaje masivo a un segmento. |
| **Disparador (trigger)** | Lo que activa un flujo (palabra clave, evento de gestión...). |
| **Etapa** | Punto del recorrido de una gestión. |
| **Fecha clave** | Fecha importante del contacto (p. ej. vencimiento). |
| **Flujo** | Bot: diagrama de pasos automáticos. |
| **Gestión** | Un asunto con inicio y fin (venta, reclamo...). |
| **Guía de la gestión** | Texto ("Ahora"), "Para avanzar" y botones de siguiente paso por etapa. |
| **Motivo** | Razón de un cierre. |
| **Nodo** | Un paso dentro de un flujo. |
| **Orden estricto** | Obliga al asesor a seguir los pasos configurados (candados en la barra de pasos); un supervisor puede saltar. |
| **Ver como** | Vista de solo lectura que permite al Dueño ver la app como otro rol o persona, 30 minutos. |
| **Barra de pasos** | Línea de la tarjeta de gestión con todas las etapas; se toca un paso para moverse. |
| **Nodo roto** | Nodo de un flujo que usa una etapa, tipo, equipo o tipo de contacto archivado o borrado. |
| **Plantilla de WhatsApp** | Mensaje pre-aprobado por WhatsApp para escribir fuera de las 24 h. |
| **Plantilla de negocio** | Configuración inicial (E-commerce, Gimnasio, General, En blanco). |
| **Postback** | Lo que envía un botón al pulsarlo. |
| **Proactiva** | Gestión creada por el CRM, no por un mensaje del cliente. |
| **RLS** | Reglas de seguridad de la base de datos que limitan qué filas ve cada usuario. |
| **Secuencia** | Serie de mensajes automáticos espaciados en el tiempo. |
| **Segmento** | Grupo de contactos definido por filtros. |
| **Supervisor** | Responsable de un equipo. |
| **Tipo de contacto** | Quién es el cliente (Prospecto, Cliente...). |
| **Tipo de gestión** | La clase de asunto (Venta, Postventa...). |
| **Ventana de 24 h** | Tiempo en que WhatsApp permite mensajes libres tras el último mensaje del cliente. |
| **Webhook** | Aviso que Zernio envía al CRM cuando llega un mensaje. |
| **Zernio** | Servicio que conecta el CRM con WhatsApp, Instagram y otras redes. |
