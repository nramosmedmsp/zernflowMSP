# Laboratorio de conversaciones: motor de simulación

Simula una conversación completa como la viviría el sistema real, con **todos** los flujos publicados (o una selección), **sin escribir en la base ni enviar mensajes**. Es solo el motor: las pantallas lo usan a través de esta API.

- Todo el estado es **JSON** (se puede guardar en `localStorage`).
- Cada acción recibe `(catalog, state, ...)` y devuelve `{ state, trace }`. **El estado y el catálogo que recibe no se modifican.**
- Si una acción no se puede aplicar (por ejemplo, cambiar la etapa sin gestión abierta) devuelve el estado igual y `trace.error` con el motivo en español.
- No importa nada de servidor (ni Supabase, ni `next/server`) salvo `load-catalog.ts`, así que `lib/flow-lab/index.ts` se puede usar en el navegador.

```ts
import { advanceTime, agentReplies, buildSampleProfiles, clientSays, createLabState } from "@/lib/flow-lab";
import { loadLabCatalog } from "@/lib/flow-lab/load-catalog"; // solo servidor

const catalog = await loadLabCatalog(workspaceId);          // servidor: lee con el cliente del usuario
const [prospecto] = buildSampleProfiles(catalog);            // perfiles de ejemplo
let state = createLabState(catalog, { profile: prospecto, channel: "whatsapp" });

let r = clientSays(catalog, state, { kind: "text", text: "Hola, ¿precio de la proteína?" });
state = r.state;                                             // r.trace: qué pasó, paso a paso
r = advanceTime(catalog, state, 120);                        // pasan 2 horas
```

## Archivos

| Archivo | Qué hay |
| --- | --- |
| `types.ts` | Tipos: catálogo, estado, entrada de las acciones y traza |
| `actions.ts` | Las acciones públicas |
| `index.ts` | Reexporta lo anterior más `buildSampleProfiles`, `createLabState`, etc. |
| `load-catalog.ts` | `loadLabCatalog(workspaceId, { db?, memberNames? })` (servidor, solo lectura) |
| `from-templates.ts` | `buildCatalogFromTemplates(...)`: catálogo con las plantillas de negocio y de flujos (pruebas, desarrollo) |
| `catalog.ts` | `deriveTriggers`, `normalizeCatalog`, `activeTriggers`, `describeTrigger`, nombres |
| `profiles.ts` | Perfiles iniciales de ejemplo |
| `state.ts` | Crear y copiar el estado, consultas (`currentCase`...) |
| `flows.ts`, `cases.ts`, `cron.ts`, `run.ts` | Internos: flujos y sesiones, gestiones, paso del tiempo, contexto de una acción |

## Entrada: el catálogo (`LabCatalog`)

Es la configuración del espacio que se simula (JSON):

- `flows`: `{ id, name, status, nodes, edges }` (publicados y borradores, en el formato del lienzo).
- `triggers`: derivados de los nodos con `buildDesiredTriggers`, la misma función que usa la publicación (`deriveTriggers`). Se derivan también de los borradores; la simulación decide cuáles están activos.
- `caseTypes`: cada uno con `stages`, `categories`, `reasons`, `rules` (filas de `case_rules`), `routing`, `autoTemplate`...
- `contactTypes`, `teams` (con `businessHours`), `members`, `teamMembers`, `holidays`, `workspaceHours`, `offHoursReply`, `reassignAfterMinutes`, `globalKeywords`, `customFields`, `tags`.

`loadLabCatalog` lo arma desde la base. La base no guarda nombres de personas: pasa `memberNames` (`{ [userId]: nombre }`) o saldrán "Asesor 1", "Asesor 2"... En pruebas o sin base: `buildCatalogFromTemplates({ business, flowTemplates, teams, ... })` o `normalizeCatalog({ flows, ... })` a mano.

## Estado (`LabState`)

| Campo | Qué es |
| --- | --- |
| `clock` | Reloj simulado (ISO). Solo `advanceTime` lo mueve |
| `channel` | `whatsapp` \| `instagram` \| `facebook` (`setChannel(state, channel)` lo cambia) |
| `enabledFlowIds` | `null` = todos los publicados; si no, los elegidos (también borradores). `setEnabledFlows(state, ids)` |
| `contact` | `name`, `phone`, `contactTypeId`, `tags`, `customFields`, `subscribed`, `ownerId`, `teamId`, `keyDate`, `existed` |
| `cases` | Todas las gestiones del contacto (abiertas, programadas y cerradas): tipo, etapa, categoría, `status`, `assigneeId`, `teamId`, sellos de tiempo (`lastInboundAt`, `lastOutboundAt`, `waitingSince`, `firstResponseAt`, `closedAt`...), `notes` |
| `sessions` | Sesiones de flujo: `status` (`active`/`completed`/`cancelled`/`expired`), `currentNodeId`, `waitingForInput`, `waitingUntil`, `variables` |
| `jobs` | Reanudaciones pendientes de los nodos Espera |
| `messages` | La conversación: `author` (`client`/`bot`/`agent`), `text` (tal como lo recibe el cliente en ese canal), `buttons`, `quickReplies`, `carousel`, `attachment`, `template`, `adaptation`, `flowId`/`nodeId` |
| `automationPaused` | Bot en pausa en la conversación |
| `members` | Disponibilidad y último reparto de cada miembro |
| `events` | Registro de eventos (los últimos 1000): una línea por paso de traza |

`contact.existed = false` hace que el primer mensaje cuente como "primer mensaje del contacto" (dispara la bienvenida y la gestión se abre con el tipo de contacto por defecto), igual que el webhook. Después de ese mensaje pasa a `true`.

`createLabState(catalog, { channel?, clock?, profile?, contact?, enabledFlowIds? })`: sin `clock` usa la hora actual. Las gestiones del perfil traen ids `case-N`; los nuevos siguen la numeración.

## Acciones

Todas devuelven `LabResult = { state, trace }`.

| Acción | Qué hace |
| --- | --- |
| `clientSays(catalog, state, input, options?)` | `input` = `{ kind: "text", text }` o `{ kind: "button", payload, title?, buttonType? }` (`postback` por defecto o `quick_reply`; `title` es el texto que llega). Mismo orden que `lib/inbound-pipeline.ts`: ① guardar el mensaje ② abrir/reutilizar/reabrir la gestión, sellar, repartir y, fuera de horario, respuesta automática ③ si el bot está en pausa, se corta (la gestión sí se actualiza; los flujos de eventos de gestión del paso ⑧ corren igual) ④ palabras clave globales (baja/alta) ⑤ si hay una sesión que espera respuesta y no venció, la retoma sin buscar disparador; si el cliente contesta con un número ("1", "2.") o con el texto exacto de una opción del último menú del bot (botones o respuestas rápidas, también la lista numerada de WhatsApp), el mensaje se reemplaza por el título del botón y su carga (`menu-reply.ts`) ⑥ elegir disparador (botón > respuesta rápida > palabra clave > bienvenida > por defecto) ⑦ ejecutar el flujo ⑧ ejecutar los eventos de gestión que eso provocó (incluye «Gestión nueva» si se abrió una gestión) |
| `advanceTime(catalog, state, minutes, options?)` | Avanza el reloj y procesa, **en orden y en el instante exacto en que vencen**, lo que haría el cron cada minuto: esperas de los nodos Espera, activación de gestiones programadas (con plantilla automática si el tipo la tiene; fuera de horario pasan a la próxima apertura), reparto de las abiertas sin responsable cuando abre el equipo, `client_no_reply` (cuando el último mensaje saliente, de bot o de persona, lleva N minutos sin respuesta, aunque el cliente siga esperando a una persona), y deja en la traza cuándo vence una espera de respuesta y cuándo se cierra la ventana de 24 h |
| `agentReplies(catalog, state, text, { agentId? })` | El asesor responde: sella `last_outbound_at`, termina la espera del cliente, sella la primera respuesta y **pausa el bot** |
| `changeStage(catalog, state, stageId, { caseId? })` | Cambia la etapa de la gestión abierta (solo etapas abiertas). Emite `case_stage_changed` y corre las reglas `on_stage` |
| `classify(catalog, state, caseTypeId, { caseId? })` | Cambia el tipo: primera etapa del tipo nuevo, sin categoría; puede cambiar el equipo y repartir de nuevo |
| `setCategory(catalog, state, categoryId \| null, { caseId? })` | Categoría de la gestión |
| `assign(catalog, state, memberId \| null, { caseId?, enforceTeam? })` | Asigna a una persona o devuelve a la cola |
| `closeCase(catalog, state, { kind \| stageId, outcomeReasonId?, categoryId?, keyDate?, note?, scheduleOverride?: { scheduleAt?, skip? }, caseId? })` | Cierra con las mismas validaciones que el motor real (etapa final, motivo, categoría, fecha clave si una regla la pide) y aplica las reglas: tipo de contacto y gestión programada (Recompra a 25 días, Renovación 7 días antes de la fecha clave). Emite `case_stage_changed` y `case_closed`. El cierre reanuda el bot si no queda otra gestión abierta |
| `previewClose(catalog, state, input)` | Vista previa del cierre (qué se programaría, si hay que pedir la fecha clave). No cambia nada; devuelve `{ ok: true, preview }` o `{ error }` |
| `setContact(catalog, state, partial)` | Edita datos del contacto |
| `setMemberAvailability(catalog, state, memberId, "available" \| "away")` | Para probar el reparto |
| `setBotPaused(catalog, state, paused)` | Equivale al botón «Pausar bot» / «Reanudar bot» de la cabecera del chat en la bandeja (en el CRM real, `setConversationBotPaused` de `lib/actions/cases.ts`, que además valida el permiso y lo registra en `activity`) |

`options` (`LabOptions`): `random` (función 0..1 para las pruebas A/B; por defecto `Math.random`) y `httpResponses` (`{ [nodeId]: respuesta }` para que un nodo Solicitud HTTP tenga una respuesta de prueba; sin ella el nodo no hace nada y avisa).

Las acciones de asesor que cambian la gestión (`changeStage`, `classify`, `closeCase`) emiten los eventos de gestión y ejecutan los flujos que escuchan `case_stage_changed` y `case_closed`, **con la misma protección contra bucles** que el motor real: un flujo no corre dos veces en la misma cadena y la cadena tiene como máximo 3 flujos. Los flujos que cambian la etapa o clasifican arrastran su cadena.

## Traza (`LabTrace`)

```ts
interface LabTrace {
  action: string;          // "clientSays", "advanceTime", "closeCase"...
  title: string;           // "El cliente escribe: «hola»"
  startedAt: string; endedAt: string;   // reloj simulado
  steps: TraceStep[];      // en orden
  visited: { flowId: string; nodeId: string; step: number }[]; // nodos recorridos, para iluminar el mapa
  messages: LabMessage[];  // mensajes nuevos de esta acción (cliente, bot y asesor)
  warnings: string[];      // lo que no se pudo hacer o se hizo distinto
  error?: string;          // la acción no se aplicó; el estado quedó igual
}

interface TraceStep {
  n: number; at: string;   // orden y reloj simulado
  kind: TraceKind; level: "info" | "ok" | "warning" | "error";
  text: string;            // frase en español, lista para mostrar
  flowId?; flowName?; nodeId?; nodeLabel?; caseId?; messageId?;
  data?: Record<string, unknown>;   // detalle según el tipo (abajo)
}
```

`visited` incluye el nodo disparador del flujo y cada nodo que se ejecuta (también los de flujos a los que se salta o que arrancan por un evento). Los pasos `kind: "node"` y los que llevan `nodeId` permiten agrupar los efectos de cada nodo (mensajes, etiquetas, cambios de la gestión...).

### Tipos de paso (`kind`) y su `data`

| `kind` | Cuándo | `data` |
| --- | --- | --- |
| `client_message` | El cliente escribe o pulsa un botón | `{ channel, payload? }` |
| `agent_message` | El asesor responde | — |
| `case_opened` / `case_reused` / `case_reopened` | Gestión nueva, reutilizada o reabierta (< 24 h). Solo la nueva emite el evento «Gestión nueva» que dispara flujos | `{ caseTypeId, stageId }` (solo en `case_opened`) |
| `case_classified` | Cambia el tipo | `{ from, to }` |
| `case_stage_changed` | Cambia la etapa | `{ from, to }` |
| `case_assigned` / `case_unassigned` | Reparto, asignación a mano, cola, fuera de horario | `{ assigneeId, via, teamId }` / `{ reason: "off_hours" \| "manual" \| "no_eligible" }` |
| `case_team_changed`, `case_category_changed`, `case_note` | Equipo, categoría, nota interna | `{ from, to }` |
| `case_closed` | Cierre | `{ outcome, stageId, outcomeReasonId }` |
| `case_scheduled` | Gestión programada o movida | `{ to, from?, rescheduled?, reason? }` |
| `case_activated` | El cron activó una programada | — |
| `contact_changed` | Tipo de contacto, responsable, edición | `{ field }` o `{ fields }` |
| `rule_applied` | Una regla del tipo cambió el contacto | `{ field, to }` |
| `bot_paused` / `bot_resumed` | Pausa del bot | — |
| `global_keyword` | Palabra clave global | `{ keyword, action? }` |
| `trigger_evaluation` | Qué disparador coincidió y por qué (o por qué ninguno) | `{ matched, triggerId?, reason?, isFirstMessage, candidates: TriggerCandidateTrace[] }` |
| `case_event` | Se emitió un evento de gestión y qué flujos lo escuchan | `{ event, candidates: TriggerCandidateTrace[], minutes? }` |
| `flow_started` / `flow_completed` / `flow_waiting` / `flow_resumed` / `flow_cancelled` | Vida de una sesión | `{ sessionId }`, `{ until }` |
| `node` | Se entra a un nodo | `{ nodeKind, goToFlowId?, path?, weight? }` |
| `condition` | Resultado de una condición | `{ conditions: [{ description, result }], logic, passed, path: "yes" \| "no" }` |
| `variable_set`, `tag_changed`, `custom_field_set`, `subscription_changed` | Efectos de los nodos | `{ variable }`, `{ tag, change }`, `{ slug, value }`, `{ subscribed }` |
| `message_sent` | Mensaje del bot o plantilla (con `messageId`) | `{ template?, params? }` |
| `message_skipped` | No se envió ("la ventana de 24 h está cerrada y el nodo no tiene plantilla") | `{ reason: "window_closed" \| "no_content" }` |
| `off_hours_reply`, `auto_template` | Respuesta fuera de horario, plantilla automática de una proactiva | `{ template?, params?, reason?, error? }` |
| `time_advanced`, `window_closed`, `session_expired` | Paso del tiempo | `{ minutes, from, to }` |
| `info` / `warning` / `error` | Explicaciones, avisos (también en `trace.warnings`) y errores. Un `info` con `menuChoice` indica que la respuesta del cliente se interpretó como una opción del menú | según el caso (`windowOpen`, `lastInboundAt`, `firstResponseSeconds`, `menuChoice`, `original`...) |

`TriggerCandidateTrace`: `{ triggerId, flowId, flowName, type, description, outcome: "matched" | "not_matched", why, nodeId? }`. Con `trigger_evaluation`, cada disparador activo de mensajes aparece con el motivo ("Ninguna de sus palabras clave aparece en el mensaje", "Habría coincidido, pero ganó «X» por orden de prioridad"...). Con `case_event`, cada disparador de ese tipo de evento ("Solo aplica cuando pasa a «Esperando pago»", "Coincide, pero este flujo ya corrió en la cadena...").

### Mensajes del bot (`LabMessage`)

Se adaptan al canal con `adaptMessage` (el mismo del motor real): en WhatsApp más de 3 botones, botones con enlace y carruseles pasan a **texto con opciones numeradas** (y `adaptation` lo explica); Instagram y Messenger los conservan. `kind: "template"` es una plantilla de WhatsApp (ventana de 24 h cerrada o plantilla automática); `template` trae nombre, idioma y variables, y `text` la vista previa. Una plantilla que no se pudo enviar queda con `failed`.

## Perfiles de ejemplo

`buildSampleProfiles(catalog, nowIso?)` devuelve cuatro `LabProfile` (se pasan a `createLabState({ profile })`), armados por **nombre** con el catálogo; lo que no se encuentra queda en `profile.notices` y el perfil se arma con lo que haya:

1. **Prospecto nuevo**: no existe como contacto; su primer mensaje dispara la bienvenida.
2. **Cliente recurrente con etiquetas**: tipo "Cliente frecuente" (o "Cliente"), etiquetas "Cliente frecuente" y "VIP", producto de interés, y una Venta ganada hace 12 días.
3. **Cliente con venta en «Esperando pago»**: Venta abierta, datos de pago enviados hace 2,5 h sin respuesta (avanza 35 min para ver el recordatorio).
4. **Socio con vencimiento en 5 días**: "Socio activo" con `keyDate` a 5 días y su Renovación abierta en «Por vencer» (necesita el catálogo de gimnasio).

## Qué se reutiliza del motor real

Se llama a las mismas funciones puras: `selectTrigger` / `findKeywordMatch` (disparadores), `resolveGlobalKeyword`, `matchesCaseEvent` / `selectCaseTriggers` / protección contra bucles (también «Gestión nueva», `case_opened`, con `only_unclassified` y `contact_type_ids`), `applyWaitingMenuReply` / `recordMenu` (respuestas a menús, `menu-reply.ts`), `evaluateConditionNode` (condiciones de contacto y de gestión), `interpolateVariables`, `nodeKind` / `persistsSessionVariables`, `selectNextEdge` / `chooseABPath` / `delayDurationMs`, `adaptMessage`, `decideSendMode` / `computeFlowWindowOpen` / `messageHasContent` / `parseNodeTemplate`, `smartDelayTimeoutMs`, `buildDesiredTriggers`, y de `lib/cases`: `decideAssignment` / `resolveTargetTeamId` / `pickAssignee`, `validateClose` / `planRules` / `parseRule` / `needsKeyDate`, `inboundPatch` / `humanOutboundPatch` / `botOutboundPatch`, `shouldReopen`, `parseScheduleAt`, `isOpenAt` / `nextOpeningFor` / `buildHoursInfo`, `buildAutoTemplateParams`, `renderOffHoursReply`, `offHoursReplyDue`, `isPendingNoReply` / `nextNoReplyThreshold`, y las decisiones de `decisions.ts`.

Se extrajeron del motor real (y el motor real las usa también): `selectTrigger` y `findKeywordMatch` (`trigger-matcher.ts`), `resolveGlobalKeyword` (`global-keywords.ts`), `selectNextEdge`, `chooseABPath`, `delayDurationMs` (`graph.ts`), `evaluateConditionNode` (`condition-eval.ts`), `messageHasContent` y `computeFlowWindowOpen` (`send-mode.ts`), `persistsSessionVariables` (`node-kind.ts`), `buildCaseConditionSnapshot` (`case-conditions.ts`), `pickSuggestedCaseTypeId`, `resolveReopenStageId`, `nextAutoTemplateStageId`, `planActivation` (`lib/cases/decisions.ts`), y las partes puras de la plantilla automática, la respuesta fuera de horario y "cliente sin responder" (`auto-template-params.ts`, `off-hours-text.ts`, `no-reply-rules.ts`, que los módulos originales reexportan).

`equivalence.test.ts` ejecuta los mismos mensajes y acciones en la simulación y en el motor real sobre la base en memoria de las pruebas (`lib/cases/fake-db.test-helper.ts`, a la que se añadieron `upsert`, `or` y filtros por relación) y compara tras cada paso las gestiones, el contacto, la pausa del bot, las sesiones y los mensajes del bot.

## Diferencias entre la simulación y la realidad

- **Una sola conversación y un solo contacto.** No hay otras gestiones en el espacio: el reparto "por menor carga" solo cuenta las gestiones de este contacto, y no se simulan la reasignación por espera (`reassignAfterMinutes`, solo avisa), las notificaciones, los próximos contactos vencidos ni los SLA.
- **El cron corre en el instante exacto en que algo vence**, no cada minuto. En el motor real puede pasar hasta un minuto después.
- **Los eventos de gestión se ejecutan después de la acción** en orden de llegada (en el real, tras responder la solicitud con `after`). Un evento que provoca otro se encola detrás.
- **No se simulan** las solicitudes HTTP (salvo `httpResponses`), la IA (la variable `ai_response` queda con un texto de ejemplo y no se envía nada), las secuencias, las respuestas a comentarios ni las difusiones. Cada uno avisa en la traza.
- **Plantillas de WhatsApp:** no se consulta a Zernio si la plantilla existe o está aprobada. El texto de la vista previa es el de las plantillas de prueba (`lib/demo.ts`) o `Plantilla: nombre (valores)`. La plantilla automática de una proactiva solo se envía si el canal simulado es WhatsApp y el contacto tiene teléfono.
- **Orden de los disparadores con la misma prioridad:** el real lo deja a la base de datos; aquí gana el primero del catálogo.
- **Flujos fuera de la selección:** un nodo "Ir a otro flujo" solo salta a flujos activos en la simulación (en producción, a cualquier publicado).
- **Nombres de personas:** la base no los guarda (ver `memberNames`).
- **Datos de contacto:** `existed` y `phone` son del laboratorio. Las etiquetas y campos se guardan por nombre y no se comprueba que existan en el espacio (los campos sí: guardar un campo inexistente avisa, como el motor real que no guarda nada).
- **`setMemberAvailability`** es un control del laboratorio sin equivalente directo en el CRM (allí cada asesor cambia la suya). `setBotPaused` equivale al botón de la bandeja, sin la validación de permisos.
- **Orden de entradas y salidas en el mismo instante.** El reloj no avanza entre acciones, así que un mensaje del cliente y la respuesta del bot caen en el mismo instante; el CRM real los distingue por milésimas. Para «cliente sin responder» el laboratorio guarda un contador de orden (`inboundOrder` / `outboundOrder` en cada gestión) y, con el mismo instante, manda quién ocurrió después.

## Hallazgos sobre el sistema real (que el laboratorio dejó ver) y cómo se resolvieron

Salieron de ejecutar las plantillas de E-commerce; eran comportamientos del motor real, no de la simulación. Los cuatro están corregidos en el sistema real y en la simulación (`equivalence.test.ts` los cubre):

1. **Bot en pausa y flujos de gestión.** Antes, `runCaseEventFlows` no ejecutaba nada en una conversación pausada, así que «Datos de pago» y «Recordatorio de pago» no corrían si un asesor ya había respondido. Ahora los flujos de eventos de gestión (`case_opened`, `case_stage_changed`, `case_closed`, `client_no_reply`) corren aunque el bot esté en pausa (los configuró la empresa para ese cambio). Los mensajes del cliente con el bot en pausa siguen sin activar palabras clave, bienvenida ni retomar esperas. La bandeja tiene un botón «Pausar bot» / «Reanudar bot» (quien puede editar la gestión; `setConversationBotPaused`, queda en `activity` como `automation_paused` / `automation_resumed`); en el laboratorio es `setBotPaused`.
2. **«Cliente sin responder».** Antes exigía `waiting_since` nulo, que solo limpia una respuesta humana. Ahora basta con que el último mensaje saliente (de bot o de persona) sea posterior al último entrante y tenga N minutos (migración 00022, `cases_pending_no_reply`). `waiting_since` sigue significando «el cliente espera respuesta humana» y no se toca; el evento se emite una vez por mensaje saliente y umbral.
3. **Cliente que vuelve sin clasificar.** Nuevo disparador «Gestión nueva» (`case_opened`), con opciones «solo sin clasificar» y «solo ciertos tipos de contacto»: se emite al abrirse una gestión entrante nueva (no al reabrir una cerrada hace menos de 24 h). La plantilla «Bienvenida y clasificación» lo usa («Gestión nueva sin clasificar») en vez de «Primer mensaje». Ojo: un prospecto nuevo se abre ya como Venta (clasificada), así que esa plantilla no lo saluda; para saludarlo hay que desmarcar «solo sin clasificar» o publicar «Bienvenida simple».
4. **Respuestas numéricas a menús.** El nodo Enviar mensaje deja el menú del último mensaje (`__menu`) en la sesión; al retomar la espera, «1», «2.» o el texto exacto de la opción (sin importar mayúsculas ni tildes) se interpretan como esa opción (`lib/flow-engine/menu-reply.ts`, función pura que usan el motor real y la simulación).
