# Plan del CRM (ZernFlow adaptado para Muscle Shop y Gimnasio B2)

Versión 2 · 18 oct 2026 · Estado: propuesta para revisión

Este documento describe cómo debe funcionar el CRM, qué se va a construir, qué no, y en qué orden.
El mismo código sirve para dos instalaciones separadas: la tienda (Muscle Shop) y el gimnasio
(Gimnasio B2). Todo debe funcionar igual de bien con una sola persona, con un equipo pequeño sin
sedes o con muchas sedes con asesores y supervisores.

Cambios respecto a la versión 1: la etapa deja de vivir en el contacto y pasa a cada **gestión**;
se agregan **tipos de contacto**, **plantillas de negocio**, gestiones **proactivas** (Recompra y
Renovación) y el **destino por tipo de gestión**. Desaparecen los "ciclos" y los "seguimientos"
como piezas aparte.

---

## 1. Principios de diseño

1. **Todo es opcional y tiene un valor por defecto que funciona solo.** Nadie está obligado a crear
   equipos, tipos de gestión, horarios ni reglas. Si una función está apagada, su pantalla y sus
   controles no aparecen y el resto del CRM sigue funcionando.
2. **Un número de WhatsApp por empresa.** También una cuenta por red social. El reparto nunca depende
   del número al que escribe el cliente, sino de reglas, del bot o de una persona.
3. **Tres conceptos separados.** Quién es la persona (tipo de contacto), por qué escribe hoy
   (gestión) y en qué punto va ese asunto (etapa). Mezclarlos ensucia la medición.
4. **La sede y el asesor responsable viven en el contacto.** Si el cliente escribe por WhatsApp y por
   Instagram, ambos chats son de la misma persona y del mismo responsable.
5. **Los permisos se aplican en la base de datos.** La interfaz solo refleja lo que la base permite.
6. **Medir desde el primer día.** Cada cambio de etapa, asignación, respuesta y cierre queda
   registrado con fecha y autor, aunque los reportes lleguen después.
7. **Mismo código, distinta configuración.** La tienda y el gimnasio se diferencian por la plantilla
   de negocio que eligen y lo que configuran después, nunca por código separado.
8. **No reemplazar otros sistemas.** Pedidos y pagos siguen en la tienda; membresías en el sistema del
   gimnasio; tareas internas en Nexo. El CRM los consulta y los muestra.

---

## 2. Cómo se comporta según el tamaño

| Escenario | Qué se configura | Cómo funciona |
|---|---|---|
| **Una persona** | Nada, o la plantilla "General" | Ve y atiende todo. Cada chat es una gestión que se abre y se resuelve. |
| **Varios asesores, sin sedes** (tienda) | Miembros, plantilla E-commerce y, si quiere, quién atiende cada tipo de gestión | La empresa entera actúa como un solo equipo implícito. |
| **Varias sedes** (gimnasio) | Plantilla Gimnasio, equipos por sede, supervisores y asesores | Cada sede ve solo sus contactos. El supervisor ve su sede entera. El administrador ve todas. |

Pasar de un escenario al siguiente no requiere migrar nada: basta con crear el primer equipo.

---

## 3. Tipos de contacto, gestiones y etapas

### 3.1 Los tres conceptos

| Concepto | Responde a | Dónde vive | Ejemplo |
|---|---|---|---|
| **Tipo de contacto** | ¿Quién es? | En el contacto, cambia poco | Prospecto, Cliente, Socio activo |
| **Gestión** | ¿Por qué escribe o le escribimos ahora? | Cada atención por separado | Venta, Postventa, Renovación |
| **Etapa** | ¿En qué punto va? | Dentro de la gestión | Esperando pago |

Cada tipo de gestión tiene sus propias etapas, categorías, motivos de resultado, equipo de destino y
objetivos de tiempo. Cada gestión termina como **ganada**, **perdida** o **resuelta**.

### 3.2 Plantillas de negocio

Al crear la empresa, un asistente pregunta qué tipo de negocio es y carga la configuración inicial:

- **E-commerce**
- **Gimnasio**
- **General**: un solo tipo de gestión, Abierta y Resuelta. El CRM se comporta como hoy.
- **En blanco**: para armar todo desde cero.

La plantilla solo **precarga** datos. Después todo se edita en Configuración: renombrar, agregar,
ordenar o quitar. Aplicar una plantilla a una empresa que ya tiene datos solo agrega lo que falta;
nunca borra ni reemplaza.

Así la tienda y el gimnasio funcionan distinto con el mismo código: el motor es uno solo, y lo que
cambia son los tipos, etapas, motivos, reglas y destinos que cada uno tiene cargados.

### 3.3 Plantilla E-commerce

**Tipos de contacto:** Prospecto, Cliente, Cliente frecuente, Inactivo.

| Gestión | Etapas | Resultados | Categorías o motivos |
|---|---|---|---|
| **Venta** | Nuevo interesado, Asesorando, Pedido o enlace de pago enviado, Esperando pago | Pagado (ganada), No compró (perdida) | Precio, sin stock, costo o demora del envío, solo consultaba, dejó de responder, compró en otro lado |
| **Postventa** | Nueva, En gestión, Esperando al cliente, Esperando almacén o courier | Resuelta, Sin solución | Estado de pedido, cambio o devolución, producto dañado, comprobante, reclamo |
| **Consulta** | Sin etapas intermedias | Resuelta | Opcionales |
| **Recompra** (proactiva) | Recordatorio enviado, Interesado | Compró (ganada), No compró (perdida) | Motivos como en Venta |

**Reglas precargadas:**

- Una Venta ganada pasa el contacto a Cliente; desde la segunda, a Cliente frecuente.
- Una Venta ganada programa una Recompra para dentro de 25 días (editable o desactivable).
- Una Recompra ganada cuenta igual que una Venta para el tipo de contacto.

### 3.4 Plantilla Gimnasio

**Tipos de contacto:** Prospecto, Socio activo, Socio congelado, Ex socio.

| Gestión | Etapas | Resultados | Categorías o motivos |
|---|---|---|---|
| **Venta de membresía** | Nuevo interesado, Asesorando, Visita o clase de prueba agendada, Visitó la sede | Inscrito (ganada), No se inscribió (perdida) | Precio, ubicación u horario, eligió otro gimnasio, no asistió a la visita, solo consultaba, dejó de responder |
| **Atención al socio** | Nueva, En gestión, Esperando al socio | Resuelta | Congelamiento, cambio de plan o sede, pagos, horarios y clases, baja, reclamo |
| **Renovación** (proactiva) | Por vencer, Contactado | Renovó (ganada), No renovó (perdida) | Precio, se muda, lesión o salud, poco uso, eligió otro gimnasio |

**Reglas precargadas:**

- Una Venta de membresía ganada pasa el contacto a Socio activo y pide la fecha de vencimiento.
- Siete días antes del vencimiento se abre una Renovación (editable).
- Una Renovación perdida pasa el contacto a Ex socio. Una ganada actualiza la fecha de vencimiento.

### 3.5 Cómo se abre una gestión

- **Entrante:** alguien escribe y no tiene una gestión abierta. Se abre una nueva.
  - Su tipo se sugiere según el tipo de contacto: un Prospecto abre Venta; un Cliente o Socio queda
    "Sin clasificar" hasta que el bot o el asesor lo clasifique.
  - Un menú del bot ("¿Quieres comprar, consultar tu pedido u otra cosa?") puede clasificarla antes
    de que llegue a una persona.
- **Proactiva:** creada por una regla (Recompra, Renovación), por importación o a mano. Tiene una
  fecha de próximo contacto y aparece ese día en la lista **Para hoy** de su responsable.
- **Manual:** el asesor abre una gestión desde la ficha del contacto, por ejemplo para registrar una
  venta hecha por teléfono.

Por defecto hay **una gestión abierta por contacto**. Si hace falta, se abre una segunda en paralelo
(por ejemplo, el cliente espera su pedido y además quiere comprar otra cosa). El chat muestra cuál
está activa.

### 3.6 Cómo avanza y se cierra

- El asesor cambia la etapa desde el chat. El bot también puede hacerlo con un nodo de flujo.
- **Cambiar el tipo** de una gestión la lleva a la primera etapa del tipo nuevo y la reenvía a su
  equipo de destino si es distinto.
- **Próximo contacto:** cualquier gestión abierta puede tener una fecha y una nota ("llamar el
  jueves"). Reemplaza los recordatorios sueltos.
- **Cerrar:** al cerrar el chat o la gestión se elige el resultado y, si el tipo lo pide, el motivo.
  Eso dispara las reglas: cambio de tipo de contacto y gestiones programadas.
- **Reclamos formales:** si el cliente presenta un reclamo en el Libro de Reclamaciones, la gestión
  lleva la fecha límite legal de respuesta (15 días hábiles) y una cuenta regresiva.

### 3.7 Reglas de gestión (dónde vive la configuración de Recompra y Renovación)

Las reglas que dicen "qué pasa en el CRM cuando una gestión cambia" se configuran **dentro de cada
tipo de gestión**, en Configuración → Gestiones → [tipo] → **Reglas**. No van en los flujos.

| | Flujos (ya existen) | Reglas de gestión (nuevas) |
|---|---|---|
| Para qué | Conversar con el cliente: bot, menús, respuestas automáticas | Ordenar el trabajo interno del CRM |
| Se activan | Cuando el cliente escribe o comenta | Cuando una gestión se abre, cambia de etapa o se cierra |
| Ejemplo | "Si escribe 'precios', enviar el catálogo" | "Si la Venta se gana, programar una Recompra en 25 días" |
| Duración | Minutos u horas, mientras dura la conversación | Días o meses |

Programar una recompra a 25 días dentro de un flujo sería frágil: el flujo depende de una conversación
activa y la regla quedaría escondida en un diagrama. En el tipo de gestión queda a la vista, en un
solo lugar, y la edita un administrador sin tocar el bot.

Cada regla tiene un momento, una condición opcional y una acción:

- **Momento:** al abrir, al cambiar a una etapa, al ganar, al perder o al resolver.
- **Condición opcional:** categoría, motivo, tipo de contacto o equipo.
- **Acciones:**
  - Cambiar el tipo de contacto (con "desde la segunda vez" para Cliente frecuente).
  - Programar otra gestión en N días, o N días antes de una fecha del contacto (vencimiento).
  - Pedir un dato al cerrar (por ejemplo, la fecha de vencimiento de la membresía).
  - Enviar una plantilla de WhatsApp cuando la gestión programada llegue a su fecha (fase 2).

**Ajuste por caso.** Al cerrar una Venta, el asesor ve la fecha de Recompra calculada (hoy + 25 días)
y puede cambiarla para ese cliente, por ejemplo si compró un pote de 5 kg que le dura más. Cuando se
integre WooCommerce, los días podrán salir del producto comprado.

### 3.8 Etiquetas

Siguen existiendo para atributos que no son etapas: producto de interés, objetivo de entrenamiento,
sede preferida. Se pueden editar a mano.

---

## 4. Organización, roles y permisos

### 4.1 Piezas

- **Empresa.** Es el espacio de trabajo. En cada instalación habrá normalmente una sola.
- **Equipos (opcional).** Una sede, un área o un turno. Una persona puede estar en varios equipos.
- **Equipo por defecto (opcional).** Si existe, los contactos sin sede caen ahí. Si no, solo los
  administradores los ven hasta que el bot o alguien los reparta.

### 4.2 Roles

Dos niveles fijos. No habrá constructor de roles a medida.

**En la empresa:**

| Rol | Puede |
|---|---|
| Dueño | Todo, incluidas claves de Zernio, canales y eliminar la empresa. |
| Administrador | Todo lo operativo: ver todos los chats, configurar gestiones, equipos, reparto, plantillas, respuestas compartidas, flujos y difusiones. No toca claves ni elimina la empresa. |
| Miembro | Lo que le den sus roles de equipo. Si no hay equipos, actúa como asesor de toda la empresa. |

**Dentro de cada equipo:**

| Rol | Puede |
|---|---|
| Supervisor | Ver todos los chats, contactos y gestiones de su equipo, asignar y reasignar dentro del equipo, ver sus métricas, crear respuestas guardadas del equipo. |
| Asesor | Atender sus gestiones y, según la regla de visibilidad, las sin asignar o todas las del equipo. |

**Qué tipos de gestión atiende cada miembro.** En cada equipo se marca qué tipos atiende cada
persona. Por defecto, todos. Así, dentro de una misma sede, los asesores comerciales reciben Ventas y
la recepción recibe Atención al socio.

### 4.3 Qué ve un asesor

Configuración de la empresa, con tres opciones:

1. **Solo las suyas** (por defecto, decidido). El asesor ve únicamente las gestiones asignadas a él.
   No ve la cola ni puede tomar leads por su cuenta: los leads se reparten por regla (sección 5.2)
   o los asigna un supervisor o administrador.
2. **Las suyas y las sin asignar de su equipo,** con botón para tomar.
3. **Todas las de su equipo.**

Sin equipos, la regla aplica sobre toda la empresa. Con la opción 3 y sin equipos, el CRM se comporta
como hoy. El supervisor siempre ve todo su equipo, y el administrador todo.

### 4.4 Matriz de permisos

| Acción | Dueño / Admin | Supervisor | Asesor |
|---|---|---|---|
| Ver chats y gestiones | Todos | Su equipo | Según la regla 4.3 |
| Responder | Sí | Su equipo | Sus gestiones |
| Tomar una gestión sin asignar | Sí | Su equipo | No, salvo que la empresa elija la opción 2 de 4.3 |
| Asignar o transferir | A cualquiera | Dentro de su equipo o devolver a la cola | Devolver a la cola o pedir transferencia |
| Etapas, etiquetas, notas, próximo contacto | Sí | Su equipo | Sus gestiones |
| Eliminar contactos | Sí | No | No |
| Exportar datos | Sí | Su equipo | No |
| Difusiones | Todas | A contactos de su equipo | No |
| Configuración, flujos, canales, plantillas, equipos | Sí | No | No |
| Respuestas guardadas | De la empresa | Del equipo | Personales |
| Métricas | Todas | Su equipo | Las suyas |

---

## 5. Destino y reparto de cada gestión

### 5.1 Destino

Cada tipo de gestión define a dónde va. Tres opciones:

1. **Al responsable del contacto** (por defecto). Si el contacto ya tiene asesor, la gestión va a él.
   Si no tiene, va a la cola de su equipo.
2. **A la cola del equipo del contacto**, repartida solo entre quienes atienden ese tipo. En el
   gimnasio: Atención al socio va a la recepción de la sede del socio.
3. **A un equipo fijo**, por ejemplo "Atención al cliente" central de la tienda.

Hoy la tienda puede dejar todo en la opción 1 y pasar Postventa a la opción 3 cuando defina su equipo
de atención. Es un cambio de configuración, no de código.

### 5.2 Regla de reparto

Como los asesores solo ven lo asignado, ninguna gestión puede quedarse esperando a que alguien la
tome. Al llegar a su destino, se asigna sola:

1. **Responsable fijo.** Si el contacto ya tiene asesor y está disponible, la gestión va a él. Si está
   ausente, va a otra persona disponible del equipo y el responsable del contacto no cambia.
2. **Si no hay responsable,** se elige entre las personas del equipo de destino que atienden ese tipo
   de gestión, están **Disponibles** y no llegaron a su **tope de gestiones abiertas** (opcional).
   Modo configurable por equipo:
   - **Por turnos** (por defecto): uno a uno, en orden.
   - **Al de menor carga:** a quien tenga menos gestiones abiertas.
   - **Manual:** solo el supervisor o el administrador asigna.
3. **Si nadie cumple las condiciones,** la gestión queda en **Sin asignar**, visible para supervisores
   y administradores con aviso, y se asigna sola apenas alguien quede disponible.

Supervisores y administradores pueden reasignar a mano en cualquier momento. Cada asignación queda
registrada para las métricas.

---

## 6. Recorrido completo

1. **Entra.** Alguien escribe. Se crea o reconoce el contacto, se abre una gestión y se guarda el
   origen: canal, enlace de campaña, palabra clave o anuncio cuando Zernio lo informe.
2. **Se clasifica (opcional).** El bot pregunta el motivo y, en el gimnasio, la sede.
3. **Se dirige.** La gestión va a su destino (sección 5) y se reparte dentro del equipo según el modo
   elegido, respetando disponibilidad, horario y tope de chats.
4. **Se atiende.** El asesor usa respuestas guardadas, deja notas internas, mueve la etapa y fija el
   próximo contacto si hace falta.
5. **Ventana de 24 horas.** Si el cliente no escribió en 24 horas, WhatsApp solo acepta plantillas.
   La caja de texto se bloquea y ofrece las aprobadas.
6. **Se cierra** con resultado y motivo. Se disparan las reglas del tipo.
7. **Se programa lo siguiente.** Por ejemplo, la Recompra a los 25 días o la Renovación 7 días antes
   del vencimiento.
8. **Se escala (opcional).** Si una gestión espera más de X minutos sin respuesta, se avisa al
   supervisor y, si así se configura, se reasigna.

---

## 7. Módulos y pantallas

### 7.1 Bandeja

- **Vistas:** Mis gestiones y Para hoy para todos; Sin asignar y Mi equipo para supervisores;
  Todas para administradores. Solo aparecen las vistas que el rol puede usar.
- **Filtros:** tipo de gestión, etapa, estado, equipo, asesor, canal, etiqueta, tipo de contacto,
  "esperando respuesta" y "fuera de la ventana de 24 horas".
- **Orden por espera,** con color según el objetivo de respuesta si está configurado.
- **Tarjeta de gestión** en la cabecera del chat: tipo, etapa, categoría, responsable, próximo
  contacto y botones para cambiar etapa, transferir, cerrar o abrir otra gestión.
- **Notas internas** en amarillo, con menciones que notifican.
- **Respuestas guardadas** escribiendo "/".
- **Plantillas** cuando el chat está fuera de la ventana de 24 horas.
- **Tomar el control del bot:** ya existe; asignar una gestión a un humano pausa el bot.

### 7.2 Gestiones

Nueva sección del menú con todas las gestiones (no solo las que tienen chat activo):

- Lista con filtros y, en la fase 4, tablero kanban por tipo.
- **Para hoy:** proactivas y próximos contactos que vencen hoy o están atrasados.
- Crear una gestión a mano.

### 7.3 Contactos y ficha

- Tipo de contacto, responsable, equipo, etiquetas, campos personalizados, origen y teléfono.
- **Línea de tiempo:** gestiones con su resultado, cambios de etapa, asignaciones y notas.
- Fecha de vencimiento de la membresía o de la última compra, mientras no haya integración.

### 7.4 Respuestas guardadas

- Título, atajo (`/precios`), texto y archivo adjunto opcional.
- Variables: `{nombre}`, `{asesor}`, `{sede}`, `{empresa}` y campos personalizados.
- Alcances: empresa, equipo y personal. Opcionalmente, ligadas a un tipo de gestión para que salgan
  primero.
- Se pegan en la caja de texto para revisarlas; no se envían solas.

### 7.5 Plantillas de WhatsApp

Zernio ya las soporta; el CRM no. Se agrega:

- Pantalla en Configuración con las plantillas de la cuenta, su estado de aprobación en Meta y
  creación de nuevas.
- Selector en la bandeja con sus variables.
- Envío automático opcional al vencer una gestión proactiva (por ejemplo, el recordatorio de Recompra).
- Paso de plantilla en difusiones y secuencias.

### 7.6 Notificaciones

- En la app, con campana y sonido: gestión asignada, mención, próximo contacto vencido, gestión que
  supera el tiempo objetivo (supervisores).
- Notificaciones del navegador opcionales. Cada persona elige cuáles recibe.

### 7.7 Horarios y objetivos de tiempo

- Horario de atención por equipo o de la empresa, en hora de Lima, con feriados.
- Fuera de horario: respuesta automática opcional y el reparto espera al día siguiente.
- Objetivos por tipo de gestión: primera respuesta y resolución. Sin objetivo no hay alertas.

### 7.8 Automatización

Nodos nuevos para el constructor de flujos:

- **Abrir o clasificar gestión**, **Cambiar etapa**, **Asignar a equipo**, **Repartir a asesor**.
- **Condiciones:** tipo de contacto, tipo y etapa de la gestión, equipo, tiene asesor, en horario.
- **Disparadores:** cambio de etapa, gestión cerrada, gestión sin respuesta durante X tiempo.

### 7.9 Configuración

| Sección | Qué se define |
|---|---|
| Plantilla de negocio | Asistente inicial y opción de agregar lo que falte de otra plantilla |
| Tipos de contacto | Nombres, colores y orden |
| Gestiones | Por cada tipo: etapas, categorías, motivos, destino, objetivos de tiempo, si es proactiva y sus **Reglas** (sección 3.7) |
| Equipos | Sedes o áreas, miembros, rol, qué tipos atiende cada uno, horario, modo de reparto, tope de gestiones |
| Atención | Visibilidad del asesor, reasignación por espera |
| Respuestas guardadas | De la empresa |
| Plantillas de WhatsApp | Visible solo con WhatsApp conectado |

#### Pantalla Configuración → Gestiones

Es el módulo donde se administran los tipos de gestión y sus etapas. Solo lo ven dueño y
administradores.

- **Columna izquierda:** la lista de tipos de gestión (Venta, Postventa, Consulta, Recompra…) con su
  color, ordenables arrastrando. Botones **Nuevo tipo** y **Agregar desde plantilla**. Un filtro
  muestra también los tipos archivados.
- **Panel derecho, con pestañas, para el tipo elegido:**
  - **General:** nombre, color, ícono, si es proactiva y para qué tipos de contacto es el tipo
    sugerido al abrir.
  - **Etapas:** lista ordenable; cada etapa con nombre, color y clase (abierta, ganada, perdida o
    resuelta). Se agregan, renombran, reordenan y archivan.
  - **Categorías y motivos:** las categorías del tipo y los motivos de resultado, y si son
    obligatorios al cerrar.
  - **Destino y reparto:** a dónde va (sección 5) y qué equipo, si aplica.
  - **Tiempos:** objetivos de primera respuesta y de resolución.
  - **Reglas:** las de la sección 3.7.
- **Vista previa:** cómo se verá el embudo con esas etapas.

**Configuración → Tipos de contacto** es una pantalla más simple: lista ordenable con nombre y color.

#### Cambiar la configuración en cualquier momento

Todo se puede modificar con la empresa funcionando. Para no romper el historial ni las métricas, el
CRM aplica estas reglas:

| Cambio | Qué pasa |
|---|---|
| Renombrar un tipo, etapa, categoría o motivo | Inmediato. El historial muestra el nombre nuevo. |
| Reordenar etapas | Inmediato. Cambia el orden del embudo. |
| Agregar un tipo o una etapa | Inmediato. Disponible para gestiones nuevas y abiertas. |
| Quitar una etapa con gestiones abiertas | Pide a qué etapa moverlas antes de quitarla. |
| Quitar una etapa o un tipo con historial | Se **archiva**: deja de ofrecerse, pero el historial y las métricas pasadas se conservan. Se puede reactivar. |
| Quitar algo que nunca se usó | Se borra de verdad. |
| Cambiar la clase de una etapa (por ejemplo, de abierta a ganada) | Avisa que cambia cómo se cuentan las métricas desde ese momento. |
| Agregar desde otra plantilla de negocio | Suma los tipos, etapas y motivos que falten. Nunca borra ni reemplaza lo existente. |
| Cambiar el tipo de una gestión concreta | Lo hace el asesor desde el chat; la gestión pasa a la primera etapa del tipo nuevo. |

Cada cambio de configuración queda registrado con quién y cuándo lo hizo.

### 7.10 Métricas

Tablero que respeta los permisos: cada quien ve lo suyo, el supervisor su equipo, el administrador
todo. Todo se puede filtrar por tipo de gestión.

| Métrica | Definición |
|---|---|
| Primera respuesta | Desde el primer mensaje del cliente en la gestión hasta la primera respuesta de una persona. El bot no cuenta. |
| Tiempo de respuesta | Promedio y mediana de cada espera del cliente. |
| Resolución | Desde que se abre hasta que se cierra la gestión. |
| Tiempo en cada etapa | Promedio y mediana por tipo de gestión. |
| Embudo | Cuántas gestiones pasan de cada etapa a la siguiente y dónde se caen. |
| Resultados | Ganadas, perdidas y resueltas por periodo, con motivos. |
| Tasa de recompra y de renovación | Proactivas ganadas sobre programadas. |
| Atrasados | Gestiones con próximo contacto vencido o demasiados días en la misma etapa. |
| Volumen | Mensajes y gestiones nuevas por hora y día. |
| Cumplimiento | Porcentaje dentro del objetivo de tiempo. |

Cortes: asesor, equipo, canal, origen, tipo de contacto y periodo. Exportación a CSV.

### 7.11 Integraciones (fase final)

- **Tienda (WooCommerce):** pedidos del cliente en su ficha y fecha de última compra automática, que
  alimenta Recompra e Inactivo.
- **Gimnasio:** membresía, sede y vencimiento desde el sistema de Gimnasio B2, que alimenta
  Renovación y los tipos de socio.
- **Nexo:** crear una tarea interna desde una gestión.
- **Meta Ads:** anuncio de origen si Zernio entrega ese dato.
- **Duplicados:** detectar y fusionar a la misma persona que escribió por dos canales.

---

## 8. Lo que no vamos a construir

- **Varios números de WhatsApp por empresa** ni reparto por número.
- **Constructor de roles a medida.**
- **Pedidos, pagos, cotizaciones o inventario dentro del CRM.**
- **Productos y montos dentro de la gestión.** Se evaluará solo si hace falta medir ingresos por chat.
- **Correo, SMS o llamadas como canales.**
- **WhatsApp no oficial.**
- **Rankings públicos entre asesores.**
- **Tareas internas propias.** Para eso está Nexo.
- **Puntuación automática de leads e inteligencia artificial avanzada,** hasta tener datos reales.

---

## 9. Correcciones al proyecto base

1. **La interfaz está en inglés.** Se traduce al español. Las mejoras del proyecto original se traerán
   selectivamente.
2. **Nombre y logo de ZernFlow fijos.** Pasan a variables de entorno, distintos en cada instalación.
3. **Crear un segundo espacio de trabajo falla** por las reglas de la base. Se arregla con una función
   segura.
4. **Las invitaciones no llegan a nadie.** Se agrega envío por correo y botón para copiar el enlace.
5. **Correo saliente.** El de Supabase permite muy pocos envíos por hora. Hace falta un SMTP propio.
6. **"Miembro" y "Administrador" hoy no se diferencian.** Se definen según la sección 4.
7. **Fechas y horas** en hora de Lima.

---

## 10. Fases de construcción

| Fase | Contenido | Resultado |
|---|---|---|
| **0. Preparación** | Todo el punto 9 salvo el correo propio (queda para después; mientras tanto, las invitaciones se comparten copiando el enlace) y conectar el primer canal | El equipo entra en español |
| **1. Bandeja con gestiones** | Plantillas de negocio, tipos de contacto, gestiones con etapas, categorías y motivos, reglas de gestión (incluidas Recompra y Renovación con días configurables), lista Para hoy, equipos opcionales, roles y permisos en la base, destino por tipo, **reparto automático** (por turnos, menor carga o manual, con disponibilidad y tope), asignar y transferir, notas internas, respuestas guardadas, etiquetas a mano, plantillas de WhatsApp en la bandeja, registro de actividad, notificaciones en la app | La tienda trabaja con asesores que solo ven lo suyo, atiende ventas y postventa por separado, hace recompra y acumula datos medibles |
| **2. Automatización y gimnasio** | Horarios, fuera de horario, reasignación por espera, nodos de flujo, envío automático de plantilla en proactivas, plantillas en difusiones y secuencias, importación de contactos con fechas por CSV | Se instala el gimnasio con sus sedes e importa sus socios para Renovación |
| **3. Métricas** | Tablero por rol, objetivos de tiempo, embudo, resultados, tasas de recompra y renovación, alertas, exportación | Se mide lo pedido: tiempos de respuesta, de cierre y entre etapas |
| **4. Ventas e integraciones** | Kanban, WooCommerce, sistema del gimnasio, Nexo, origen de anuncios, duplicados | El asesor tiene todo el contexto sin salir del CRM |

Los permisos van en la fase 1 aunque la tienda no tenga sedes: cambiar las reglas de seguridad
después, con datos y personas trabajando, es riesgoso.

---

## 11. Cambios técnicos previstos

**Tablas nuevas**

- `contact_types`: nombre, color, orden.
- `case_types` (tipos de gestión): nombre, color, orden, destino, equipo fijo, si es proactiva,
  objetivos de tiempo, reglas al cerrar (cambiar tipo de contacto, programar otra gestión).
- `case_stages`: tipo de gestión, nombre, orden, clase (abierta, ganada, perdida, resuelta).
- `case_categories` y `case_outcome_reasons`: por tipo de gestión.
- `cases` (gestiones): contacto, tipo, etapa, categoría, estado, equipo, responsable, origen, abierta
  en, primera respuesta humana en, esperando desde, cerrada en, resultado, motivo, próximo contacto,
  nota, fecha límite legal.
- `teams` y `team_members` (con los tipos de gestión que atiende cada miembro).
- `saved_replies`, `activity` (línea de tiempo y base de métricas) y `notifications`.
- `business_templates`: las plantillas de negocio como datos, para agregar otras sin programar.

**Columnas nuevas**

- `contacts`: tipo de contacto, equipo, responsable, origen, teléfono, fecha de vencimiento o última
  compra.
- `messages`: gestión a la que pertenece y marca de nota interna.
- `workspace_members`: disponibilidad.
- `workspaces`: configuración de atención y visibilidad.

**Seguridad.** Una función única decide si una persona puede ver un contacto y sus gestiones según
la sección 4. Reemplaza las reglas actuales de contactos, conversaciones, mensajes y relacionadas.
El receptor de mensajes de Zernio sigue usando la clave de servicio.

**Migraciones.** Cada cambio se aplica en las dos bases: tienda y gimnasio.

---

## 12. Decisiones

**Tomadas**

- Instalación separada para el gimnasio, mismo repositorio de GitHub.
- Un número de WhatsApp por empresa.
- Tipos de contacto, gestiones y etapas de las secciones 3.3 y 3.4 como punto de partida.
- Postventa y Atención al socio irán a un equipo aparte; mientras se define, quedan en el destino
  por defecto (el responsable del contacto).
- Recompra y Renovación desde la fase 1.
- Los asesores solo ven las gestiones asignadas a ellos; el supervisor ve todo su equipo. Por eso
  el reparto automático entra en la fase 1.
- Los días de Recompra y de Renovación se configuran en las Reglas de cada tipo de gestión, no en los
  flujos, y se pueden ajustar por cliente al cerrar. Valor inicial: 25 días.
- El correo propio (SMTP) queda para después.

**Pendientes para la fase 0 y 1**

1. Modo de reparto inicial de la tienda. Propuesta: por turnos.
2. Si se usa tope de gestiones abiertas por asesor y cuánto.

**Pendientes para el gimnasio (fase 2)**

4. Sedes, supervisores, asesores y quién atiende Atención al socio en cada sede.
5. Horario de cada sede.
6. Días de anticipación para la Renovación. Propuesta: 7.
7. De dónde salen las fechas de vencimiento de los socios actuales: importación inicial y luego
   integración con el sistema del gimnasio.
8. Cuentas de Vercel, Supabase y Zernio del gimnasio.
