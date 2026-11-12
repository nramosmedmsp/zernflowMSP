# Cómo crear flujos del chat (bots) en el CRM de Muscle Shop

Un **flujo** es un diagrama de pasos automáticos: el bot saluda, pregunta, clasifica, etiqueta, reparte al
asesor, etc. Esta guía enseña a leerlos, crearlos, probarlos y publicarlos, y cómo pedirle a Claude que
te diseñe uno. Para entender el resto del CRM (gestiones, equipos, roles) lee antes
[`GUIA-FUNCIONAL.md`](GUIA-FUNCIONAL.md).

> Quién puede: solo **Dueño** y **Administradores** ven el menú **Flujos**.

## Índice

1. [Cómo piensa un flujo](#1-cómo-piensa-un-flujo)
2. [El editor](#2-el-editor)
3. [Disparadores](#3-disparadores)
4. [Los nodos de la paleta](#4-los-nodos-de-la-paleta)
5. [Variables, condiciones y campos personalizados](#5-variables-condiciones-y-campos-personalizados)
6. [Esperas, menús y botones en WhatsApp](#6-esperas-menús-y-botones-en-whatsapp)
7. [Ventana de 24 h y plantillas](#7-ventana-de-24-h-y-plantillas)
8. [Atención humana y pausa del bot](#8-atención-humana-y-pausa-del-bot)
9. [Prioridad de palabras clave y choques](#9-prioridad-de-palabras-clave-y-choques)
10. [Los 10 flujos publicados de la tienda](#10-los-10-flujos-publicados-de-la-tienda)
11. [Antes de usar los flujos con clientes reales](#11-antes-de-usar-los-flujos-con-clientes-reales)
12. [Las plantillas de flujos](#12-las-plantillas-de-flujos)
13. [Publicar, versiones y restaurar](#13-publicar-versiones-y-restaurar)
14. [Probar un flujo](#14-probar-un-flujo)
15. [Buenas prácticas y errores comunes](#15-buenas-prácticas-y-errores-comunes)
16. [Diseñar un flujo con ayuda de Claude](#16-diseñar-un-flujo-con-ayuda-de-claude)
17. [Para técnicos: formato de las plantillas de flujo](#17-para-técnicos-formato-de-las-plantillas-de-flujo)

---

## 1. Cómo piensa un flujo

- Un flujo tiene **un disparador** (lo que lo activa) y una cadena de **nodos** unidos por flechas.
- Se ejecuta de arriba hacia abajo. Una **Condición** parte el camino en «Sí» y «No».
- Algunos nodos **pausan** el flujo y lo retoman después: «Espera» (por tiempo) y «Espera inteligente» (hasta
  que el cliente responda).
- El flujo puede **actuar sobre la gestión** (clasificarla, cambiar etapa, asignar equipo, repartir) además de
  escribirle al cliente.
- Un flujo en **borrador** no hace nada. Solo los **publicados** responden a clientes.
- Si una persona ya está atendiendo el chat, el bot está **pausado** y no responde a mensajes del cliente
  (sección 8).

Dos familias de disparadores:

| Familia | Se activa cuando... | Ejemplo |
|---|---|---|
| **Mensaje del cliente** | El cliente escribe o pulsa un botón. | «precio» -> catálogo |
| **Evento de gestión** | Algo pasa con la gestión (se abre, cambia de etapa, se cierra, el cliente no responde). | Pasa a «Esperando pago» -> enviar datos de pago |

## 2. El editor

Menú **Flujos** -> lista de flujos. Botones útiles: **crear flujo**, **Plantillas** (instalar uno hecho),
**Laboratorio**, **Escenarios**, y enlaces al **Explorador** y al **Mapa**. Al abrir un flujo ves:

| Zona | Qué hace |
|---|---|
| **Paleta de nodos** (izquierda) | Lista de nodos; se **arrastran** al lienzo. |
| **Lienzo** (centro) | Los nodos y flechas. Conecta arrastrando desde el punto de salida de un nodo al de entrada de otro. |
| **Panel del nodo** (derecha) | Al hacer clic en un nodo se abre su configuración. |
| **Barra superior** | Nombre del flujo, estado (Borrador / Publicado / Archivado), **Probar**, **Historial de versiones**, **Publicar**. |

Los nodos con problema se marcan en rojo al intentar publicar.

### 2.1 Aviso de «nodos rotos»

Un **nodo roto** es un nodo que apunta a algo de la configuración que **ya no sirve**: una **etapa**, un **tipo
de gestión**, un **equipo** o un **tipo de contacto** que se archivó o se borró después de armar el flujo. Se
revisan los nodos *Clasificar gestión* (tipo y etapa), *Cambiar etapa*, *Asignar a equipo* (solo en modo
fijo), los disparadores de gestión y las condiciones que comparan tipo de contacto, tipo, etapa o equipo. Un
campo que se dejó vacío no cuenta como roto (eso lo avisa la revisión al publicar).

**Por qué importa:** el bot no se detiene ni avisa a nadie; ese paso **falla en silencio** y la gestión queda
sin clasificar, sin cambiar de etapa o sin equipo. Por eso el CRM lo hace visible:

- En la lista de **Flujos**, arriba, una franja ámbar: «Un flujo publicado tiene nodos rotos» (o «N flujos
  publicados tienen nodos rotos»), con enlaces a cada flujo. En la tarjeta de cada flujo aparece la insignia
  «N nodos rotos»; al pasar el cursor por encima se lee qué usa cada nodo, por ejemplo «Cambiar etapa» usa la
  etapa «Esperando pago», que está archivada.
- Dentro del **editor**, una franja ámbar: «Un nodo está roto» / «Hay nodos rotos» (marcados en ámbar), con una
  línea por nodo («...que está archivada» o «...que ya no existe»).

**Cómo se arregla:** abre el flujo, haz clic en el nodo marcado en ámbar, **elige otra opción** (otra etapa,
otro tipo, otro equipo...) en su panel y pulsa **Publicar**. Si la opción archivada era la correcta, se puede
restaurar en Configuración y el aviso desaparece solo. Mientras no se publique, el bot sigue usando la versión
anterior (sección 13).

## 3. Disparadores

El nodo **Disparador de palabra clave** de la paleta es el punto de partida; en su panel eliges el **tipo**:

| Tipo (como aparece) | Se activa cuando | Opciones |
|---|---|---|
| **Palabra clave** | El mensaje del cliente coincide con alguna palabra. | Lista de palabras; cada una con modo: **Coincidencia exacta**, **Contiene** o **Empieza con**. |
| **Botón (postback)** | El cliente pulsa un botón concreto. | La «carga» (payload) del botón. |
| **Respuesta rápida** | El cliente elige una respuesta rápida concreta. | La carga. |
| **Bienvenida** | Es el primer mensaje del contacto en ese canal. | — |
| **Por defecto** | Ningún otro disparador coincide. | — |
| **Palabra clave en comentario** | Alguien comenta una publicación con la palabra. | Palabras, y «También coincidir en DM». |
| **Gestión nueva** (`case_opened`) | Se abre una gestión entrante nueva (primer mensaje de un cliente nuevo, o de uno que vuelve sin gestión abierta). No se activa en gestiones manuales/programadas ni en las situaciones de la nota de abajo. | «Solo gestiones sin clasificar» y «Tipos de contacto (opcional)». |
| **Cambio de etapa** (`case_stage_changed`) | Una gestión cambia de etapa (por persona, bot, cierre o regla). | Tipo de gestión y **etapa nueva** (opcionales). |
| **Gestión cerrada** (`case_closed`) | Se gana, pierde o resuelve. | Tipo de gestión y **resultado**: Ganada / Perdida / Resuelta (opcionales). |
| **Cliente sin responder** (`client_no_reply`) | Le escribiste y el cliente no contesta en N minutos (lo detecta el reloj interno). | **Minutos sin respuesta** y tipo de gestión. |

Notas importantes:

- Los disparadores de **evento de gestión** (cambio de etapa, gestión cerrada, cliente sin responder) corren
  **aunque el bot esté pausado** (la empresa los configuró a propósito para ese evento). Los de **mensaje del
  cliente** no, ni tampoco **Gestión nueva** (ver la nota siguiente).
- **El disparador «Gestión nueva» es más prudente:** para que el bot no hable encima de una persona ni repita
  el saludo, **no corre** si (1) el bot de esa conversación está **en pausa**, (2) la gestión es una
  **reapertura** de una cerrada hace poco, (3) un **asesor escribió** en esa conversación en las últimas
  **24 horas**, o (4) **ese mismo flujo ya corrió** para el contacto en las últimas **24 horas**. En esos casos
  no pasa nada y queda solo una nota técnica en el registro del servidor.
- **«Solo gestiones sin clasificar»** (casilla del disparador «Gestión nueva»): si la marcas, el flujo solo corre
  cuando la gestión nace **sin tipo**. Una gestión nace sin tipo cuando ningún tipo se sugiere para el tipo de
  contacto del cliente (por ejemplo, un cliente que vuelve a escribir). Un **prospecto nuevo entra ya como
  «Venta»**, así que con la casilla marcada **no recibe ese flujo**. Si dejas la casilla sin marcar, corre con
  cualquier gestión nueva, clasificada o no. Atención: el flujo publicado *Bienvenida y clasificación*
  (sección 10) tiene la casilla marcada.
- Si un disparador de gestión no tiene tipo o etapa elegidos, el editor avisa: se activaría con **cualquier**
  gestión o cambio de etapa.
- Un flujo puede tener varios disparadores, pero lo normal es uno.
- En un flujo por evento de gestión, los nodos de gestión actúan sobre **la gestión que provocó el evento** (si ya se cerró, sobre la abierta más reciente del contacto).

## 4. Los nodos de la paleta

La paleta (`components/flow-builder/node-palette.tsx`) agrupa así. «Nodo» = tarjeta del lienzo.

### 4.1 Mensajes

| Nodo | Qué hace | Ajustes principales |
|---|---|---|
| **Enviar mensaje** | Envía uno o varios mensajes al cliente. | Cada mensaje: **texto**, **imagen**, **respuestas rápidas**, **botones** (máximo **3** por mensaje; de tipo «postback» o «URL») o **carrusel** de tarjetas (título, subtítulo, imagen, botones). Admite `{{variables}}`. Opcional: **plantilla de WhatsApp** para cuando la ventana de 24 h esté cerrada (sección 7). |
| **Respuesta con IA** | Un modelo de IA redacta la respuesta usando el historial reciente. | **Modelo** (formato `proveedor/modelo`, p. ej. `openai/gpt-4o-mini`), **instrucciones** (system prompt), temperatura, máximo de tokens, cuántos mensajes previos leer, y **«enviar directamente»**. Si lo desactivas, solo guarda el texto en `{{ai_response}}` para usarlo en un «Enviar mensaje» posterior. Necesita la clave de IA configurada en Configuración -> General. Si falla, el flujo se detiene para no enviar un `{{ai_response}}` vacío. |

### 4.2 Lógica

| Nodo | Qué hace | Ajustes principales |
|---|---|---|
| **Condición** | Divide el camino en **Sí** y **No**. | Una o varias condiciones unidas con **Y** / **O**. Cada una: campo + operador (**es igual a, no es igual a, contiene, existe, es mayor que, es menor que**) + valor. Campos en la sección 5. La comparación ignora mayúsculas y tildes. |
| **Espera** | Pausa un tiempo fijo y sigue sola. | Duración y unidad (segundos, minutos, horas, días). Atajos: 30 s, 5 min, 1 hora, 1 día, 3 días. |
| **Prueba A/B** | Reparte a los clientes entre caminos al azar según pesos. | Caminos con nombre y peso; cada nombre es una salida. Sirve para comparar dos mensajes. |
| **Espera inteligente** | Pausa **hasta que el cliente responda** (o venza el tiempo máximo). | Tiempo máximo (por defecto 30 minutos; minutos, horas o días). Ver sección 6. |

### 4.3 Gestiones (actúan sobre la gestión abierta del contacto)

| Nodo | Qué hace | Ajustes |
|---|---|---|
| **Clasificar gestión** | Fija el **tipo** de la gestión (Venta, Postventa...) y opcionalmente su **etapa** y **categoría**. Si el contacto no tiene gestión abierta, la abre. | Tipo, etapa (opcional), categoría (opcional; si no pertenece al tipo, se ignora). |
| **Cambiar etapa** | Mueve la gestión a otra etapa **abierta** de su tipo. | Etapa. |
| **Asignar a equipo** | Envía la gestión a un equipo. Si no tiene responsable, aplica el reparto de ese equipo. | Modo **fijo** (equipo elegido) o **recalcular** (según tipo de gestión y contacto). |
| **Repartir a asesor** | Aplica el reparto del equipo actual y asigna a una persona. | «Repartir de nuevo aunque ya tenga responsable» (opcional). |

Estos nodos pasan por las mismas reglas que las acciones de un asesor: quedan en el historial y disparan las
reglas de gestión y los flujos por evento (con protección contra bucles). Los nodos de gestión **no** están
sujetos al «orden estricto» de la guía de la gestión.

### 4.4 Acciones

| Nodo | Qué hace | Ajustes |
|---|---|---|
| **Agregar etiqueta** / **Quitar etiqueta** | Pone o saca una etiqueta del contacto. | Nombre de la etiqueta (obligatorio). |
| **Asignar campo** | Guarda un valor en un campo personalizado del contacto. | `fieldSlug` y valor (admite `{{message}}`, etc.). |
| **Ir a flujo** | Termina este flujo y continúa en otro. | Flujo destino. No vuelve al original. Protegido contra bucles (un flujo no puede repetirse en la misma cadena). |
| **Atención humana** | Pasa el chat a una persona: **pausa el bot** en la conversación. | Nota interna opcional para el asesor (se guarda en la gestión; admite variables). Ver sección 8. |
| **Suscribir** / **Desuscribir** | Marca al contacto como suscrito o no a difusiones y mensajes automáticos. | — |
| **Inscribir en secuencia** | Mete al contacto en una Secuencia. | Secuencia (obligatorio). |

> «Solicitud HTTP» (llamar a una dirección externa) ya no se ofrece al agregar nodos nuevos, pero los flujos
> antiguos que la usan siguen funcionando. Tampoco hay nodos propios para «Responder comentario» o
> «Respuesta privada»: los flujos de comentarios los usan internamente.

## 5. Variables, condiciones y campos personalizados

### 5.1 Variables dentro de los mensajes

Se escriben con **doble llave**: `{{nombre}}`.

| Variable | Valor |
|---|---|
| `{{message}}` | El **último mensaje** del cliente (o el título del botón que eligió). Es lo que usas para guardar respuestas libres: «¿Cuál es tu número de pedido?» -> `{{message}}`. |
| `{{nombre}}` | Primer nombre del contacto (vacío si solo se conoce un teléfono o correo). |
| `{{fecha_clave}}` | La fecha clave del contacto (p. ej. vencimiento). |
| `{{empresa}}` | Nombre de la empresa. |
| `{{ai_response}}` | Texto generado por una «Respuesta con IA» sin envío directo. |
| `{{variable.ruta}}` | Datos de una solicitud HTTP antigua (admite rutas con puntos). |

Una variable desconocida se envía **vacía** (el texto se limpia: «Hola {{nombre}}, ...» sin nombre queda «Hola, ...»),
pero el editor lo avisa con una advertencia al publicar. Las llaves **simples** `{nombre}`, `{sede}`,
`{fecha_clave}`, `{empresa}` y `{campo:slug}` son las de las **plantillas de WhatsApp** y de las respuestas
guardadas, no las de los mensajes de flujo.

### 5.2 Campos de una Condición

| Campo (como aparece) | Evalúa |
|---|---|
| **Etiqueta** | Si el contacto tiene la etiqueta (valor Sí/No). |
| **Campo personalizado** | El valor de un campo del contacto (por su slug, p. ej. `numero_pedido`). |
| **Plataforma** | whatsapp, instagram, facebook, etc. |
| **Variable** | Una variable del flujo (típico: `message`, para saber qué respondió el cliente). |
| **Está suscrito** | Si recibe difusiones. |
| **Tipo de contacto** | Prospecto, Cliente, etc. |
| **Tipo de gestión** | Venta, Postventa... |
| **Etapa de la gestión** | Una etapa concreta. |
| **Equipo de la gestión** | A qué equipo pertenece. |
| **Tiene responsable** | Sí/No. |
| **Dentro de horario** | Sí/No según el horario del equipo o de la empresa (hora de Lima, con feriados). |

Patrón más usado para menús: condición `Variable message` **contiene** «comprar» -> Sí: camino de ventas.

### 5.3 Campos personalizados

Son datos propios del contacto (p. ej. `numero_pedido`, `producto_interes`) y se ven en su ficha. Se crean
cuando se instala una plantilla de flujo que los necesita (o los da de alta un administrador). El nodo **Asignar campo** los llena con
lo que el cliente escribió y las condiciones o respuestas guardadas los leen después.

## 6. Esperas, menús y botones en WhatsApp

### 6.1 Espera inteligente

Cuando el flujo llega a una **Espera inteligente**, se queda esperando. El siguiente mensaje del cliente
**retoma la espera directamente, sin buscar disparadores**: por eso respuestas como «1» o «Sede 2» no necesitan
una palabra clave. Si pasa el tiempo máximo, la espera **vence** y un mensaje nuevo ya no la retoma (se trata
como mensaje nuevo y puede activar otro flujo).

El patrón completo para preguntar algo y guardar la respuesta es:

```
Enviar mensaje ("¿Cuál es tu número de pedido?") -> Espera inteligente -> Asignar campo (numero_pedido = {{message}}) -> ...
```

### 6.2 Botones y listas numeradas

| Canal | Qué ve el cliente |
|---|---|
| **Instagram / Facebook** | Botones y respuestas rápidas nativos y carruseles. |
| **WhatsApp** | Hasta **3** botones o respuestas rápidas como botones nativos. Si hay **más de 3**, o algún botón es de **enlace (URL)**, o es un **carrusel**, el mensaje se convierte en **texto con lista numerada** (`1. Opción`, `2. Opción`...; los enlaces van escritos con su dirección). |
| **Telegram** | Teclado en pantalla. |
| **X, Bluesky, Reddit** | Lista numerada en texto. |

Cuando el cliente responde **«1»**, **«2.»** o escribe el texto exacto de la opción (sin importar mayúsculas ni
tildes) a un mensaje con opciones, el bot lo interpreta como esa opción (el mensaje pasa a ser el título del
botón, y se envía su carga). Las opciones de enlace no se pueden elegir respondiendo. El menú se recuerda
mientras el flujo espera, así que funciona aunque WhatsApp haya convertido los botones en lista.

**Consejo:** no pongas más de 3 botones por mensaje, ni mezcles botones de enlace con otros; si necesitas más
opciones, usa una lista numerada a propósito o divide en dos pasos.

## 7. Ventana de 24 h y plantillas

WhatsApp solo deja enviar mensajes libres hasta 24 h después del último mensaje del cliente. En un nodo
«Enviar mensaje» el bot decide así:

| Situación | Qué envía |
|---|---|
| Canal que no es WhatsApp | El texto (no hay ventana). |
| WhatsApp, ventana **abierta**, hay texto | El texto. |
| WhatsApp, ventana **cerrada**, el nodo tiene **plantilla** | La plantilla aprobada. |
| WhatsApp, ventana **cerrada**, **sin plantilla** | **No envía** y lo anota («La ventana de 24 h de WhatsApp está cerrada y el nodo no tiene una plantilla configurada»). |

Un flujo nacido de un **mensaje del cliente** siempre tiene la ventana abierta. Un flujo de **evento de
gestión** o una espera que se reanuda mira el último mensaje entrante de las gestiones del contacto. Por eso
los flujos de recordatorio (cliente sin responder, visita no asistida) **deben** llevar plantilla.

La plantilla se configura dentro del nodo: **nombre**, **idioma** (p. ej. `es`) y **parámetros** (los
`{1}`, `{2}` de la plantilla), que admiten `{nombre}`, `{fecha_clave}`, `{empresa}`, `{sede}` y `{campo:slug}`.
La plantilla debe estar **creada y aprobada en WhatsApp** antes (ver Configuración -> Plantillas de
WhatsApp). Si el nombre no coincide con una aprobada, el envío falla.

## 8. Atención humana y pausa del bot

| Situación | Efecto |
|---|---|
| El flujo pasa por **Atención humana** | El bot se **pausa** en esa conversación, queda registrado en el historial, y la sesión del flujo termina. |
| **Una persona responde** desde la Bandeja | El bot se pausa solo. |
| Alguien lo **pausa o reanuda a mano** (cabecera del chat) | Pausar también corta lo que el bot dejó esperando. |
| **Reanudación automática** | Si el bot está pausado porque una persona escribió y el contacto **no tiene ninguna gestión abierta ni programada**, vuelve solo **24 h después del último mensaje humano**. Una pausa manual sin mensajes humanos no se toca. |
| Con el bot **pausado** y el cliente escribe | No se activan palabras clave, bienvenida ni se retoman esperas, y tampoco corre el flujo de **Gestión nueva**. Los flujos de los demás **eventos de gestión** (cambio de etapa, cierre, cliente sin responder) sí corren. |
| Palabras clave **globales** (Configuración -> General, p. ej. «baja») | Van **primero**, antes que cualquier flujo: coincidencia exacta, y desuscriben o suscriben al contacto. |

Orden en que el CRM decide qué hacer con un mensaje del cliente:

1. ¿Bot pausado? -> no hace nada (salvo los eventos de gestión de cambio de etapa, cierre y cliente sin responder).
2. ¿Es una palabra clave global (baja/alta)? -> la aplica y termina.
3. ¿Hay una **espera inteligente** vigente? -> retoma ese flujo.
4. Si no, busca un **disparador** (sección 9).

## 9. Prioridad de palabras clave y choques

Cuando no hay espera pendiente, el mensaje se compara con los disparadores de los flujos publicados en este
orden:

1. **Botón (postback)** con esa carga exacta.
2. **Respuesta rápida** con esa carga.
3. **Palabra clave** (si coinciden varias, desempata: mayor prioridad del disparador; luego la coincidencia
   más precisa **exacta > empieza con > contiene**; luego la **palabra más larga**).
4. **Bienvenida**, si es el primer mensaje del contacto en el canal.
5. **Por defecto**.

Solo responde **un** flujo por mensaje. Reglas prácticas:

- Antes de publicar, el editor avisa si una palabra clave **también la usa otro flujo publicado**
  («...solo responderá uno de los dos»).
- Palabras muy cortas o comunes con «Contiene» (p. ej. «persona», «lista», «pedido») chocan fácil. Usa
  «Coincidencia exacta» o «Empieza con» cuando puedas.
- Ejemplo real: «persona» (flujo *Hablar con un asesor*) y «pedido» (*Estado de pedido*): «quiero hablar con
  una persona sobre mi pedido» coincide con ambos; gana el más preciso/largo, no necesariamente el que querías.
- La prioridad numérica de un disparador existe en el motor pero **no se edita desde el panel**.

## 10. Los 10 flujos publicados de la tienda

Foto de la base de Muscle Shop (todos *publicados*). Además hay un borrador vacío «Flujo sin título».

| # | Flujo | Disparador | Qué hace |
|---|---|---|---|
| 1 | **Bienvenida y clasificación** | Gestión nueva (`case_opened`), solo sin clasificar | Saluda y ofrece tres opciones. Según la elección **clasifica** la gestión (Venta, Postventa o Consulta); en una venta pregunta qué producto busca y lo guarda en un campo; al final **reparte a un asesor**. |
| 2 | **Catálogo y precios** | Palabras: precio, precios, catálogo, catalogo (contiene) y «lista» (empieza con) | Envía el enlace del catálogo con respuestas rápidas y pasa la venta a «Asesorando». **Con enlace de relleno** (sección 11). |
| 3 | **Darse de baja** | Palabras: baja y stop (exactas); «no más mensajes», «darme de baja», «dar de baja» (contienen) | Desuscribe al contacto y confirma. |
| 4 | **Datos de pago** | Cambio de etapa (a «Pedido o enlace de pago enviado») | Envía los datos de Yape, Plin y transferencia, pide la captura y pasa la venta a «Esperando pago». **Con datos de relleno** (sección 11). |
| 5 | **Encuesta de satisfacción** | Gestión cerrada (Postventa resuelta) | Pregunta del 1 al 5; etiqueta «Satisfecho» o «Insatisfecho»; si la nota es 1 o 2, pasa a **atención humana**. |
| 6 | **Estado de pedido** | Palabras: pedido, envío, envio, tracking, seguimiento (contienen) | Clasifica como Postventa/«Estado de pedido», pide el número de pedido y lo guarda en un campo. Trae un nodo «Asignar a equipo» llamado «Asignar al equipo Atención» **sin equipo elegido** (hoy no hace nada; ver sección 11). |
| 7 | **Gracias por tu compra** | Gestión cerrada (Venta ganada) | Agradece, informa tiempos de envío (Lima y provincia) y cómo consultar el pedido. **Con tiempos de relleno** (sección 11). |
| 8 | **Hablar con un asesor** | Palabras: asesor, humano, persona, agente (contienen) | Avisa que lo comunica, **reparte** la gestión y **detiene el bot** para que lo atienda una persona. |
| 9 | **Recompra interesada** | Cambio de etapa (Recompra -> «Interesado») | Envía el enlace para volver a comprar y ofrece hablar con un asesor. **Con enlace de relleno** (sección 11). |
| 10 | **Recordatorio de pago** | Cliente sin responder (2 horas) | Si la venta sigue en «Esperando pago», envía un recordatorio amable; con la ventana cerrada usa la plantilla de WhatsApp `recordatorio_pago` (debe existir aprobada; sección 11). |

Cómo trabajan juntos: **1** abre y clasifica; **2** mueve a «Asesorando»; el asesor avanza la etapa y **4**
manda los datos de pago; **10** recuerda si no pagan; al cerrar la venta, **7** agradece y se programa la
Recompra (regla de gestión), cuyo avance a «Interesado» dispara **9**. En Postventa, **6** clasifica y **5**
mide la satisfacción. **3** y **8** atienden pedidos de baja y de hablar con una persona.

## 11. Antes de usar los flujos con clientes reales

Los 10 flujos publicados se verificaron (cada rama, con el motor real y canales de prueba) y funcionan. Pero
vienen de plantillas con **datos de ejemplo**, y hay cuatro cosas que **hay que completar o confirmar** antes de
confiar en ellos con clientes reales. Si no, el cliente recibiría textos como `[REEMPLAZA: https://tutienda.pe/catalogo]`.

### 11.1 Textos de relleno `[REEMPLAZA: …]`

Cuatro flujos publicados tienen mensajes con marcas `[REEMPLAZA: …]`. Esas marcas **se envían tal cual al
cliente** hasta que se cambien por los datos reales de la tienda:

| Flujo | Qué hay que reemplazar |
|---|---|
| **Catálogo y precios** | El enlace del catálogo: `[REEMPLAZA: https://tutienda.pe/catalogo]`. |
| **Datos de pago** | Siete datos de pago de ejemplo: números de Yape y Plin, banco, cuenta, CCI y titulares. |
| **Gracias por tu compra** | Los tiempos de envío: `[REEMPLAZA: 1 a 2 días hábiles / 3 a 5 días hábiles]` (Lima y provincia). |
| **Recompra interesada** | El enlace para volver a comprar: `[REEMPLAZA: https://tutienda.pe/recompra]`. |

**Cómo hacerlo:** Flujos -> abre el flujo -> clic en el nodo **Enviar mensaje** que trae la marca -> cambia el
texto por el real -> **Publicar** (sección 13). Busca en todo el flujo: puede haber más de un nodo con marcas. Luego
pruébalo en el Laboratorio o con un número propio.

### 11.2 Plantilla de WhatsApp del Recordatorio de pago

El flujo **Recordatorio de pago** corre cuando el cliente lleva 2 horas sin responder, y muchas veces ya pasaron
las 24 horas de WhatsApp. En ese caso usa la plantilla de WhatsApp llamada **`recordatorio_pago`** (idioma `es`).
Esa plantilla **debe existir y estar aprobada** en el WhatsApp real (Configuración -> Plantillas de WhatsApp);
si no, el recordatorio fuera de las 24 horas **no se envía**. Dentro de las 24 horas el flujo sí envía su texto
normal. Esto no se pudo comprobar en las pruebas porque depende de la aprobación de WhatsApp.

### 11.3 Recompra: falta la plantilla automática

La **Recompra** se programa sola 25 días después de una venta ganada y, ese día, pasa a «Recordatorio enviado»,
se asigna y avisa «Recompra para hoy» al responsable. Pero el tipo **Recompra no tiene definida una plantilla
automática**, así que el CRM **no le escribe nada al cliente**: el asesor tiene que escribirle a mano (y pasadas
24 horas, con una plantilla aprobada). Para que el recordatorio salga solo, hay que crear y aprobar una
plantilla de WhatsApp para recompra y elegirla en Configuración -> Gestiones -> Recompra -> pestaña General -> «Plantilla al activarse».

### 11.4 «Asignar a equipo» sin equipo en Estado de pedido

En **Estado de pedido**, el nodo «Asignar a equipo» (llamado «Asignar al equipo Atención») **no tiene ningún
equipo elegido**, así que no hace nada. Hoy no se nota porque Postventa ya reparte al equipo fijo de su tipo y
la gestión llega a las personas correctas. Para evitar sorpresas: abre el flujo, elige el equipo en ese nodo y
publica, o quita el nodo.

### 11.5 Dos comportamientos por decidir

Quedaron anotados como decisiones del negocio (no son errores del bot):

- **La respuesta a la Encuesta de satisfacción reabre la Postventa.** Cualquier mensaje del cliente dentro de
  los 7 días siguientes a la resolución reabre la gestión, avisa a los supervisores y reinicia el plazo, aunque
  solo esté contestando la nota.
- **Saludo y palabra clave juntos.** Si el primer mensaje trae una palabra clave («precio de la creatina»), el
  cliente recibe el catálogo y también el saludo de bienvenida.

También conviene saber que los prospectos nuevos (que entran ya como Venta) no reciben el saludo de *Bienvenida y
clasificación* mientras esté marcada la casilla «Solo gestiones sin clasificar» (ver sección 3).

## 12. Las plantillas de flujos

Menú Flujos -> **Plantillas**. Es una biblioteca de flujos hechos; al instalar uno, el CRM cambia los
nombres de tipos, etapas y equipos por los de tu empresa (lo que no exista queda sin configurar y se avisa),
crea los campos personalizados que necesite y lo deja en **borrador** para que lo revises. Cada plantilla
lista qué debes **ajustar** (datos de ejemplo marcados `[REEMPLAZA: ...]`, enlaces, plantillas de WhatsApp).
Hay **21** (el filtro del negocio muestra las del negocio más las generales).

**E-commerce (8)**

| Plantilla | Disparador | Qué hace |
|---|---|---|
| Bienvenida y clasificación | Gestión nueva sin clasificar | Saluda, 3 opciones, clasifica y reparte. |
| Catálogo y precios | Palabras: precio, catálogo, lista... | Envía el catálogo y pasa a «Asesorando». |
| Datos de pago | Cambio de etapa | Envía Yape/Plin/transferencia y pasa a «Esperando pago». |
| Recordatorio de pago | Cliente sin responder 2 h | Recuerda el pago; plantilla si la ventana cerró. |
| Gracias por tu compra | Venta ganada | Agradece y explica envíos. |
| Estado de pedido | Palabras: pedido, envío, tracking... | Clasifica Postventa, pide número de pedido, asigna a Atención. |
| Encuesta de satisfacción | Postventa resuelta | Nota 1-5, etiquetas, humano si es baja. |
| Recompra interesada | Recompra -> «Interesado» | Enlace para volver a comprar. |

**Gimnasio (7)**

| Plantilla | Disparador | Qué hace |
|---|---|---|
| Bienvenida y sede | Bienvenida (primer mensaje) | Saluda, clasifica (Venta de membresía / Atención al socio), pregunta la sede y asigna al equipo. |
| Agendar visita o clase de prueba | Palabras: visita, clase de prueba, agendar... | Pide día y hora, pasa a «Visita o clase de prueba agendada» y avisa que un asesor confirmará. |
| Recordatorio de visita no asistida | Cliente sin responder 24 h | Pregunta si quiere reprogramar (plantilla de WhatsApp). |
| Bienvenida al nuevo socio | Venta de membresía ganada | Da la bienvenida con reglas y horarios. |
| Congelamiento | Palabras: congelar, congelamiento, pausar | Clasifica, pide motivo y fechas, pasa a humano. |
| Renovación interesada | Renovación -> «Contactado» | Envía planes y medios de pago. |
| Horarios de la sede | Palabras: horario, horarios, atienden | Responde el horario de la sede (o de todas). |

**General (6)**

| Plantilla | Disparador | Qué hace |
|---|---|---|
| Bienvenida simple | Bienvenida | Saluda, espera 1 minuto y hace seguimiento. |
| Hablar con un asesor | Palabras: asesor, humano, persona, agente | Reparte y detiene el bot. |
| Respuesta cuando ningún flujo aplica | Por defecto | Si no hay responsable, reparte a un asesor. |
| Darse de baja | Palabras: baja, stop... | Desuscribe y confirma. |
| Preguntas frecuentes | Palabras: ayuda, preguntas, faq | Menú de temas y respuestas frecuentes. |
| Captura de clientes potenciales | Palabras: me interesa, más información... | Pide nombre y correo paso a paso, los guarda y etiqueta como potencial. |

## 13. Publicar, versiones y restaurar

1. Pulsa **Publicar**. Antes, el CRM **revisa** el flujo:
   - **Errores** (impiden publicar): falta el disparador; palabra clave vacía; botón sin carga; disparador sin
     conexión; «Enviar mensaje» sin mensajes o con uno vacío; «Ir a flujo» sin destino; «Inscribir en
     secuencia» sin secuencia; etiqueta sin nombre; solicitud HTTP sin dirección.
   - **Avisos** (permiten «Publicar de todos modos»): disparador de gestión sin tipo/etapa; «Ir a flujo» que
     apunta a sí mismo; nodos no conectados al disparador (nunca se ejecutarán); variables `{{...}}` que el
     bot no llena; palabra clave que usa otro flujo publicado; flujos de comentario con más de un mensaje (solo
     el primero sale como respuesta privada).
2. Al publicar, el CRM guarda una **versión** y actualiza los disparadores que el bot lee. El flujo empieza a
   responder de inmediato.
3. **Historial de versiones** (barra superior): lista de versiones con fecha. **Restaurar** reemplaza el
   lienzo por esa versión. Si el flujo estaba publicado, **sigue publicado y usa esa versión de inmediato**
   (queda como versión nueva); si era borrador, solo reemplaza el borrador. Los cambios sin publicar se pierden.
4. Los cambios que haces en un flujo **ya publicado** no afectan al bot hasta que vuelvas a publicar.
5. El estado puede ser Borrador, Publicado o Archivado. La lista de flujos también permite importar y exportar un flujo como archivo JSON.

## 14. Probar un flujo

| Herramienta | Dónde | Para qué |
|---|---|---|
| **Panel de prueba** | Botón **Probar** dentro del flujo | Simula ese flujo paso a paso: eliges el disparador, escribes lo que diría el cliente y ves cada nodo ejecutarse (mensajes, condiciones, esperas, clasificación). No envía nada ni escribe en la base. |
| **Laboratorio de conversaciones** | Flujos -> **Laboratorio** | Simula una conversación completa con **todos** los flujos publicados (o los que elijas), un perfil de cliente de ejemplo (prospecto, cliente recurrente...), un canal, el paso del tiempo (p. ej. «pasan 2 horas»), y respuestas de asesores. Sin enviar mensajes ni tocar datos. Muestra qué flujo respondió y por qué. |
| **Escenarios** | Flujos -> **Escenarios** | Conversaciones de prueba **guardadas**: las corres todas con un clic para ver si algún cambio rompió algo (con el último resultado de cada una). |
| **Explorador de caminos** | Flujos -> Explorador | Genera **todos los caminos posibles** de un flujo para revisar que ninguno termine mal. |
| **Mapa de flujos** | Flujos -> Mapa | Vista general de cómo se conectan los flujos entre sí (conexiones por «Ir a flujo» y eventos de gestión) con un panel de **Avisos** (choques, flujos sueltos). |

Orden recomendado: Panel de prueba mientras construyes -> Laboratorio con el perfil real -> Escenarios antes
de publicar cambios grandes -> publicar -> probar con un número propio en un canal de prueba.

## 15. Buenas prácticas y errores comunes

**Buenas prácticas**

- **Un objetivo por flujo.** Varios flujos chicos se enlazan con «Ir a flujo» o con eventos de gestión.
- **Nombra cada nodo** (el campo `label`): te ahorra horas al revisar.
- **Siempre una salida para «No»** en las condiciones, o decide conscientemente que el flujo termine.
- **Mensajes cortos**, uno por idea; máximo 3 botones.
- **Pide los datos de uno en uno**: pregunta -> Espera inteligente -> guarda -> siguiente.
- **Deja siempre una salida a una persona** («escribe *asesor*»), y revisa que el flujo de asesor esté publicado.
- **Usa plantillas de WhatsApp** en todo flujo que pueda correr pasadas 24 h.
- **Prueba con el Laboratorio** antes de publicar y vuelve a correr los Escenarios después.
- **Primero la gestión, luego el mensaje:** clasifica y asigna antes de conversar, así el asesor recibe el chat
  ya ordenado.

**Errores comunes**

| Error | Consecuencia | Cómo evitarlo |
|---|---|---|
| Palabra clave «Contiene» muy genérica | Dos flujos compiten o responde el equivocado. | Usa «exacta» o «empieza con»; lee los avisos al publicar. |
| Olvidar la Espera inteligente tras una pregunta | El flujo sigue sin esperar la respuesta; `{{message}}` guarda el mensaje anterior. | Pregunta -> Espera inteligente -> usar `{{message}}`. |
| Esperar demasiado poco | La espera vence y la respuesta del cliente activa otro flujo. | Tiempo máximo realista (horas, no minutos). |
| Más de 3 botones o botón de enlace en WhatsApp | Sale como lista numerada. | Es válido, pero redáctalo pensando en «1, 2, 3». |
| Mensaje sin plantilla en un flujo que corre tras 24 h | El mensaje **no se envía** (solo queda anotado). | Agrega plantilla al nodo. |
| Disparador de gestión sin tipo o etapa | Se activa con **cualquier** gestión. | Elige el tipo y la etapa. |
| Cambiar etapa que causa otro flujo que cambia la etapa... | Bucle. | El motor corta las cadenas largas, pero diseña sin ciclos. |
| «Atención humana» demasiado pronto | El bot se calla y el cliente queda esperando. | Reparte antes (Repartir a asesor) y avisa al cliente. |
| Editar un flujo publicado y no publicar | El bot sigue con la versión anterior. | Pulsa Publicar; revisa el Historial. |
| Variables mal escritas (`{{Nombre}}`, `{{nombre}` ) | Salen vacías. | Usa exactamente `{{nombre}}`, `{{message}}`, `{{empresa}}`, `{{fecha_clave}}`. |
| Nombres de etapa o equipo que cambiaron | Al reinstalar una plantilla quedan sin configurar. | Revisa los avisos tras instalar. |
| Archivar una etapa, tipo, equipo o tipo de contacto que usa un flujo | El nodo queda **roto** y falla en silencio. | Mira el aviso de «nodos rotos» en la lista de Flujos (2.1) y elige otra opción. |
| Publicar con textos `[REEMPLAZA: …]` | El cliente recibe la marca tal cual. | Sigue la sección 11. |

---

## 16. Diseñar un flujo con ayuda de Claude

Puedes pedirle a Claude (con este ZIP cargado) que **diseñe** el flujo, y luego tú lo armas en el editor
arrastrando nodos, o un técnico lo convierte en una plantilla de código (sección 17).

### 16.1 Prompt para copiar y pegar

> Lee `docs/GUIA-FUNCIONAL.md`, `docs/GUIA-FLUJOS.md` y, para ver ejemplos reales, `lib/flow-templates/templates/`.
> Eres diseñador de bots para el CRM de Muscle Shop. Diséñame un flujo del chat con este objetivo:
>
> **Objetivo:** [qué quiero lograr, p. ej. «Cuando alguien pregunte por envíos a provincia, responder con costos y tiempos y ofrecer pasar con un asesor»]
> **Canal:** [WhatsApp / Instagram / ambos]
> **¿Cuándo debe activarse?** [palabras clave exactas / cuando se abre una gestión nueva / cuando una Venta pasa a la etapa X / cuando el cliente no responde en N horas / ...]
> **Datos que debe pedir al cliente:** [ninguno / nombre / número de pedido / ...]
> **Qué debe hacer en el CRM:** [clasificar como Venta o Postventa / cambiar etapa a ... / asignar al equipo ... / repartir a un asesor / etiquetar como ...]
> **Textos:** [yo los escribo / propónlos tú con el tono de Muscle Shop: cercano, claro, en español de Perú]
> **Cuándo pasa a una persona:** [siempre al final / si dice «asesor» / si la nota es baja / nunca]
>
> Respóndeme con: (1) un resumen de una línea; (2) el disparador exacto; (3) la lista de pasos en el
> formato «Lista de pasos» de la sección 16.2 de `docs/GUIA-FLUJOS.md`; (4) las palabras clave que podrían
> chocar con los flujos publicados de la sección 10; (5) si algún mensaje puede enviarse con la ventana de 24 h
> cerrada y por tanto necesita plantilla de WhatsApp; (6) los tipos de gestión, etapas, categorías, equipos,
> etiquetas y campos personalizados que deben existir (usa los de la sección 9 de `docs/GUIA-FUNCIONAL.md`);
> (7) cómo probarlo en el Laboratorio. No inventes nodos que no estén en la paleta.

### 16.2 Formato «Lista de pasos» (cómo expresar un flujo para poder construirlo)

Escribe un paso por línea, numerado, con **el nombre del nodo** tal como aparece en la paleta y sus datos.
Las ramas se indican con «Sí:» / «No:» (o con el nombre de cada camino en una Prueba A/B) y «Ir al paso N».

```
FLUJO: <nombre>
DISPARADOR: <tipo>; <opciones>
  Ejemplo: Palabra clave; palabras: "envío a provincia" (contiene), "provincia" (exacta)
  Ejemplo: Cambio de etapa; tipo: Venta; etapa nueva: Esperando pago
  Ejemplo: Cliente sin responder; minutos: 120; tipo de gestión: Venta
PASOS:
1. Clasificar gestión — tipo: Postventa; etapa: Nueva; categoría: Estado de pedido
2. Enviar mensaje — "Hola {{nombre}}, ¿cuál es tu número de pedido?"
3. Espera inteligente — máximo: 1 día
4. Asignar campo — campo: numero_pedido; valor: {{message}}
5. Condición — variable message contiene "urgente"
   Sí: Ir al paso 6
   No: Ir al paso 7
6. Atención humana — nota: "Cliente urgente, pedido {{message}}"
7. Enviar mensaje — texto: "..."; botones: [Sí, quiero | No, gracias]; plantilla de respaldo: nombre, idioma, parámetros
8. Asignar a equipo — equipo: Atención
9. Fin
```

Reglas del formato:

- Usa **solo** estos nodos: Disparador, Enviar mensaje, Respuesta con IA, Condición, Espera, Prueba A/B,
  Espera inteligente, Clasificar gestión, Cambiar etapa, Asignar a equipo, Repartir a asesor, Agregar
  etiqueta, Quitar etiqueta, Asignar campo, Ir a flujo, Atención humana, Suscribir, Desuscribir, Inscribir en
  secuencia.
- Después de cada pregunta al cliente va una **Espera inteligente**.
- Cada Condición lleva **Sí** y **No** (o dice «No: fin»).
- Indica los textos completos entre comillas y las variables con `{{...}}`.
- Cuando algo debe existir previamente (etapa, equipo, plantilla de WhatsApp, campo), anótalo en una sección
  **REQUISITOS** al final.

### 16.3 Cómo construirlo en el editor a partir de la lista

1. Flujos -> **crear flujo** (o instala una plantilla parecida y modifícala).
2. Arrastra el **Disparador** y configúralo como dice la lista.
3. Arrastra cada nodo en el orden de los pasos; conecta con flechas (las condiciones tienen salida Sí y No).
4. Completa cada nodo en su panel. Pon un **nombre** claro a cada uno.
5. **Probar** -> revisa cada rama. Luego Laboratorio.
6. **Publicar**, lee los avisos, y prueba en un canal de prueba.

## 17. Para técnicos: formato de las plantillas de flujo

Las plantillas viven en `lib/flow-templates/templates/*.ts`. Se escriben con el constructor `FlowBuilder`
(`lib/flow-templates/builder.ts`), que genera los nodos en el **mismo formato que guarda el lienzo**
(`flows.nodes` y `flows.edges`), y se registran en `lib/flow-templates/index.ts` (lista `FLOW_TEMPLATES`).
Los tipos están en `lib/flow-templates/types.ts`.

**Tipo `FlowTemplate`** (campos principales): `id`, `name`, `description`, `business`
(`"ecommerce" | "gym" | "general"`), `category`, `adjust` (texto de lo que hay que ajustar), `requires?`
(ids de otras plantillas), `customFields?` (`{slug, name}`), `allowedOpenEnds?` (condiciones cuya salida «No»
puede quedar sin conectar) y `graph` (nodos y aristas). Los nodos pueden llevar `refs` para referenciar por
**nombre** tipos de gestión, etapas, categorías, equipos y tipos de contacto; el instalador (`resolve.ts`)
los cambia por los ids reales de la empresa.

**Métodos del `FlowBuilder`**

| Grupo | Métodos |
|---|---|
| Disparadores | `welcomeTrigger`, `newCaseTrigger`, `defaultTrigger`, `keywordTrigger`, `stageTrigger`, `closedTrigger`, `noReplyTrigger` |
| Mensajes y lógica | `message(label, {text, buttons?, quickReplies?}, plantilla?)`, `wait` (Espera inteligente), `condition`, `replyContains`, `delay` |
| Acciones | `tag`, `setField`, `classify`, `changeStage`, `assignTeam`, `distribute`, `takeover`, `unsubscribe` |
| Conexiones | `link`, `chain(a, b, c...)`, `yes(cond, to)`, `no(cond, to)`, `build()` |

**Ejemplo completo y corto** (`lib/flow-templates/templates/ecommerce-recordatorio-pago.ts`): si el cliente
no responde en 2 horas y la venta sigue en «Esperando pago», envía un recordatorio (con plantilla de WhatsApp
de respaldo).

```ts
import { FlowBuilder } from "../builder";
import type { FlowTemplate } from "../types";

const f = new FlowBuilder();

const trigger = f.noReplyTrigger({
  caseType: "Venta",
  minutes: 120,
  label: "El cliente no responde en 2 horas",
});
const enEspera = f.condition("¿Sigue esperando el pago?", [
  {
    field: "case_stage",
    operator: "equals",
    ref: { kind: "stage", name: "Esperando pago", caseType: "Venta" },
  },
]);
const recordatorio = f.message(
  "Recordatorio amable de pago",
  {
    text: "Hola, ¿pudiste realizar el pago de tu pedido? Si necesitas ayuda con los medios de pago o tienes alguna duda, escríbenos y te ayudamos con gusto.",
  },
  { template_name: "recordatorio_pago", language: "es", params: ["{nombre}"] },
);

f.chain(trigger, enEspera);
f.yes(enEspera, recordatorio);

export const ecommerceRecordatorioPago: FlowTemplate = {
  id: "ecommerce-recordatorio-pago",
  name: "Recordatorio de pago",
  description: "Si el cliente no responde en 2 horas y la venta sigue en \"Esperando pago\", le envía un recordatorio amable. ...",
  business: "ecommerce",
  category: "Pagos",
  adjust: [
    "Crea y aprueba en WhatsApp una plantilla llamada \"recordatorio_pago\" (idioma es) ...",
    "Ajusta los minutos de espera en el disparador si prefieres otro tiempo.",
  ],
  allowedOpenEnds: [enEspera],
  graph: f.build(),
};
```

**Para añadir una plantilla:** crea el archivo en `templates/`, expórtala, agrégala a `FLOW_TEMPLATES` en
`lib/flow-templates/index.ts` y corre `npm test` (las pruebas `flow-templates.test.ts` y
`validate-templates.test.ts` comprueban que el grafo sea válido, con disparador y sin nodos sueltos). No
olvides que `gym-sedes.ts` no es una plantilla sino una lista de sedes de ejemplo.

**Piezas de código relacionadas:** el motor está en `lib/flow-engine` (`engine.ts` ejecuta nodos;
`trigger-matcher.ts` elige el disparador; `menu-reply.ts` interpreta «1», «2»; `platform-adapter.ts` convierte
botones por canal; `send-mode.ts` decide texto o plantilla; `validate.ts` hace la revisión previa a publicar;
`case-triggers.ts` dispara flujos por eventos de gestión; `nodes/case-actions.ts` implementa los nodos de
gestión); el laboratorio en `lib/flow-lab` (con un `README.md` propio); y el editor en `components/flow-builder`.
