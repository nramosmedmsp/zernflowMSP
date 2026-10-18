# Fase 1 — Especificación técnica

Bandeja con gestiones, equipos, permisos y reparto. Complementa `docs/PLAN-CRM.md` (versión 2):
el plan dice qué y por qué; este documento dice cómo, para que varios agentes trabajen en paralelo
sin chocar. Todo texto visible va en español (tuteo) y las fechas con `lib/format.ts`.

## 0. Hechos del código actual que condicionan el diseño

- **Los mensajes viven en Zernio.** El webhook (`app/api/webhooks/late/route.ts`) no guarda los
  mensajes entrantes en `messages`; la bandeja los pide a Zernio. Por eso:
  - las notas internas van en una tabla propia (`case_notes`) y la vista del chat las intercala
    por fecha con los mensajes de Zernio;
  - los tiempos se miden con sellos en la gestión (`cases`), no recorriendo mensajes.
- **Respuestas enviadas fuera del CRM** (desde el celular o el panel de Zernio) no generan evento:
  no cuentan como respuesta humana. Se documenta como limitación.
- **Secretos en `workspaces`.** Hoy `late_api_key_encrypted`, `ai_api_key` y `webhook_secret` están
  en `workspaces`, que cualquier miembro puede leer con `select *`. Con asesores en el sistema eso
  es una fuga: se mueven a `workspace_secrets` (sección 2.4).
- `conversations` es única por `(channel_id, contact_id)`: un chat por canal y contacto, para
  siempre. La gestión es la que tiene principio y fin.

## 1. Modelo de datos (migración 00019)

### 1.1 Configuración

```
contact_types        id, workspace_id, name, color, position, is_default bool, archived_at
case_types           id, workspace_id, name, color, icon, position,
                     is_proactive bool,
                     suggested_for_contact_type_ids uuid[]   -- tipo sugerido al abrir
                     routing text check in ('contact_owner','contact_team','fixed_team') default 'contact_owner',
                     fixed_team_id uuid null,
                     sla_first_response_minutes int null, sla_resolution_hours int null,
                     require_category bool default false, require_outcome_reason bool default false,
                     archived_at
case_stages          id, case_type_id, name, color, position,
                     kind text check in ('open','won','lost','resolved'), archived_at
case_categories      id, case_type_id, name, position, is_high_priority bool, archived_at
case_outcome_reasons id, case_type_id, name, kind text check in ('won','lost','resolved'), position, archived_at
case_rules           id, case_type_id, position, enabled bool,
                     trigger text check in ('on_open','on_stage','on_won','on_lost','on_resolved'),
                     trigger_stage_id uuid null,
                     condition jsonb default '{}',     -- { category_id?, outcome_reason_id?, contact_type_id? }
                     action text check in ('set_contact_type','schedule_case','ask_key_date'),
                     params jsonb                        -- ver 3.4
```

Todas con `workspace_id` directo o vía `case_type_id`, índices por FK y `created_at`/`updated_at`.

### 1.2 Equipos y miembros

```
teams                id, workspace_id, name, is_default bool,
                     assignment_mode text check in ('round_robin','least_load','manual') default 'round_robin',
                     archived_at
team_members         team_id, user_id, role text check in ('supervisor','agent'),
                     case_type_ids uuid[] null   -- null = atiende todos los tipos
                     primary key (team_id, user_id)
workspace_members  + availability text check in ('available','away') default 'available'
                   + last_assigned_at timestamptz null
                   + role: check in ('owner','admin','member')
workspaces         + settings jsonb default '{}'
                     -- { agent_visibility: 'own'|'own_and_unassigned'|'team'  (por defecto 'own'),
                     --   assignment_mode: 'round_robin'|'least_load'|'manual' (si no hay equipos),
                     --   business_template: 'ecommerce'|'gym'|'general'|'blank',
                     --   key_date_label: 'Última compra' | 'Vencimiento de membresía' }
```

### 1.3 Contactos, gestiones y registro

```
contacts           + contact_type_id uuid null, team_id uuid null, owner_id uuid null,
                   + source jsonb default '{}', phone text null, key_date date null
cases              id, workspace_id, contact_id,
                   case_type_id uuid null        -- null = "Sin clasificar"
                   stage_id uuid null, category_id uuid null,
                   status text check in ('scheduled','open','won','lost','resolved','cancelled'),
                   team_id uuid null, assignee_id uuid null,
                   origin text check in ('inbound','proactive','manual'),
                   scheduled_for timestamptz null   -- proactivas: se activan en esta fecha
                   opened_at timestamptz null,
                   last_inbound_at, last_outbound_at, waiting_since, first_response_at timestamptz null,
                   next_action_at timestamptz null, next_action_note text null,
                   closed_at, closed_by, outcome_reason_id, outcome_note,
                   legal_due_at timestamptz null, priority text default 'normal',
                   created_by uuid null, created_at, updated_at
case_notes         id, workspace_id, case_id, contact_id, conversation_id null, author_id,
                   body text, mentions uuid[] default '{}', created_at
activity           id bigint identity, workspace_id, contact_id null, case_id null, conversation_id null,
                   type text, actor_id uuid null (null = sistema o bot),
                   from_value text null, to_value text null, meta jsonb default '{}', created_at
notifications      id, workspace_id, user_id, type, title, body, link, read_at, created_at
saved_replies      id, workspace_id, scope text check in ('workspace','team','personal'),
                   team_id null, user_id null, case_type_id null,
                   title, shortcut text null, body text, attachment_url text null,
                   created_by, created_at, updated_at
workspace_secrets  workspace_id pk, late_api_key, ai_api_key, webhook_secret, updated_at
```

Índices: `cases(workspace_id, status)`, `cases(assignee_id, status)`, `cases(contact_id, status)`,
`cases(status, scheduled_for)`, `cases(next_action_at)`, `activity(workspace_id, created_at)`,
`activity(case_id)`, `notifications(user_id, read_at)`.

Tipos de `activity`: `case_opened`, `case_scheduled`, `case_activated`, `case_classified`,
`stage_changed`, `assigned`, `unassigned`, `transferred`, `case_closed`, `case_reopened`,
`contact_type_changed`, `owner_changed`, `team_changed`, `note_added`, `first_response`,
`next_action_set`, `config_changed`.

Realtime: agregar `cases`, `case_notes` y `notifications` a la publicación `supabase_realtime`.

## 2. Permisos (misma migración)

### 2.1 Funciones (security definer, stable, search_path = public)

- `ws_role(ws uuid) → text`: rol del usuario actual en el espacio o null.
- `is_ws_admin(ws uuid) → bool`: rol en ('owner','admin').
- `ws_has_teams(ws uuid) → bool`.
- `is_team_member(team uuid) → bool`, `is_team_supervisor(team uuid) → bool`.
- `can_see_contact(contact_id uuid) → bool`:
  1. administrador del espacio → sí;
  2. el contacto tiene una gestión no cerrada (`scheduled` u `open`) asignada a mí → sí;
  3. `owner_id = auth.uid()` → sí;
  4. supervisor del `team_id` del contacto → sí;
  5. según `settings.agent_visibility`:
     - `own`: nada más;
     - `own_and_unassigned`: además, contactos con gestión abierta sin asignar cuyo equipo es uno
       de los míos (o sin equipo si el espacio no tiene equipos);
     - `team`: además, contactos de mis equipos (o todos si el espacio no tiene equipos).

### 2.2 Políticas

| Tabla | Leer | Escribir |
|---|---|---|
| contacts, contact_channels, contact_tags, contact_custom_fields | `can_see_contact` | actualizar: `can_see_contact`; crear y borrar: administrador |
| conversations | `can_see_contact(contact_id)` | actualizar: `can_see_contact` |
| messages | vía conversación | insertar: vía conversación |
| cases, case_notes | `can_see_contact(contact_id)` | vía las acciones del servidor (ver 3); insertar notas: `can_see_contact` y autor = yo |
| activity | administrador, o `can_see_contact(contact_id)` | solo servidor |
| notifications | `user_id = auth.uid()` | marcar leída: el dueño |
| contact_types, case_types, case_stages, case_categories, case_outcome_reasons, case_rules, teams, team_members | miembros del espacio | administrador |
| saved_replies | `workspace`: miembros; `team`: miembros del equipo; `personal`: el autor | `workspace`: administrador; `team`: supervisor; `personal`: el autor |
| flows, triggers, channels, tags, custom_field_definitions | miembros | administrador |
| broadcasts, broadcast_recipients, sequences, sequence_enrollments | administrador | administrador |
| workspaces | miembros | administrador |
| workspace_members | los del propio espacio | administrador (nadie toca al dueño); cada uno su `availability` |
| workspace_secrets | nadie (solo servicio) | solo servicio |

Las acciones del motor (sección 3) se ejecutan en el servidor con el cliente de servicio, después
de validar permisos en código. Las políticas cubren las lecturas y las ediciones simples.

### 2.3 Rutas de API existentes

Revisar `app/api/v1/**`: las que usan el cliente del usuario quedan cubiertas por RLS. Las que
usan el cliente de servicio deben validar en código que el usuario puede ver el contacto o es
administrador. Flujos, canales, difusiones y secuencias: solo administrador.

### 2.4 Secretos

Mover `late_api_key_encrypted`, `ai_api_key` y `webhook_secret` a `workspace_secrets` (copiar datos
en la migración y luego vaciar las columnas viejas sin borrarlas todavía). Un helper de servidor
`getWorkspaceSecrets(workspaceId)` con el cliente de servicio. Configuración muestra "Configurada"
sin revelar la clave. Actualizar todos los lugares que hoy leen esas columnas (ver el grep de
`late_api_key_encrypted`, `ai_api_key`, `webhook_secret`).

## 3. Motor de gestiones (`lib/cases/`)

Funciones de servidor, puras donde se pueda, con pruebas vitest. Cada cambio escribe en `activity`.

### 3.1 Entrante (desde el webhook, después de guardar contacto y conversación)

`handleInbound({ workspaceId, contactId, conversationId, at })`:
1. Busca la gestión `open` más reciente del contacto. Si no hay, abre una (`origin='inbound'`):
   tipo = el sugerido para el tipo de contacto, o null (Sin clasificar); etapa = la primera
   abierta del tipo. Si el contacto no tiene tipo, se le asigna el tipo por defecto.
2. Sella `last_inbound_at`; si `waiting_since` es null, lo fija.
3. Si la gestión no tiene responsable, aplica el reparto (3.3).
4. No pausa el bot: los flujos siguen corriendo como hoy.

### 3.2 Saliente humano (desde `app/api/v1/messages` y el envío de plantillas)

`handleHumanOutbound({ caseId, userId, at })`: sella `last_outbound_at`; si `first_response_at` es
null y hubo espera, lo fija y registra `first_response` con la duración en `meta`; limpia
`waiting_since`. Además marca la conversación con `is_automation_paused = true` (el humano tomó el
chat; se reanuda al cerrar la gestión). Los envíos del bot solo sellan `last_outbound_at`.

### 3.3 Reparto

`assignCase(caseId)`:
1. **Equipo de destino** según `case_types.routing`: `contact_owner` y `contact_team` usan
   `contacts.team_id` (o el equipo por defecto, o ninguno); `fixed_team` usa `fixed_team_id`.
   Se guarda en `cases.team_id`.
2. **Responsable fijo** (`routing = contact_owner`): si `contacts.owner_id` es elegible y está
   disponible, se le asigna.
3. **Elegibles:** si hay equipo, sus `team_members` cuyo `case_type_ids` es null o contiene el tipo;
   si no hay equipos, los `workspace_members` con rol `member`. Solo `availability = 'available'`.
4. **Modo** (del equipo, o de `workspaces.settings` sin equipos): `round_robin` elige el de
   `last_assigned_at` más antiguo (null primero); `least_load` el de menos gestiones `open`
   asignadas, desempate por `last_assigned_at`; `manual` no asigna.
5. Sin elegibles: queda sin asignar y se notifica a supervisores del equipo y administradores.
6. Al asignar: actualiza `last_assigned_at`, notifica al asesor y, si el contacto no tenía
   `owner_id`, lo fija.

Usar un bloqueo (`select ... for update` o `pg_advisory_xact_lock` por espacio, vía RPC) para que
dos mensajes simultáneos no asignen a la misma persona dos veces seguidas.

### 3.4 Cambios, cierre y reglas

- `changeStage`, `classifyCase` (cambia tipo → primera etapa del tipo nuevo → re-ruteo si cambia
  el destino), `transferCase`, `assignTo`, `setNextAction`, `addNote` (con menciones que notifican).
- `closeCase({ caseId, stageId | kind, outcomeReasonId?, note?, overrides? })`: valida categoría y
  motivo si el tipo los exige; fija `status` según la clase de la etapa final, `closed_at`,
  `closed_by`; reanuda el bot de la conversación; ejecuta reglas.
- Reglas (`case_rules`), en orden de `position`, si `condition` coincide:
  - `set_contact_type` — `params: { contact_type_id, from_nth_win?: 2 }` (desde la N-ésima gestión
    ganada del contacto, para Cliente frecuente).
  - `schedule_case` — `params: { case_type_id, days_after?: 25 }` o
    `{ case_type_id, days_before_key_date?: 7 }`. Crea una gestión `scheduled` con
    `scheduled_for`. Al cerrar, la UI muestra la fecha calculada y permite cambiarla
    (`overrides.schedule_at`).
  - `ask_key_date` — `params: { label }`: la UI pide la fecha al cerrar y la guarda en
    `contacts.key_date`.
- Reabrir: si el cliente escribe y la gestión se cerró hace menos de 24 h, se reabre esa misma
  (`case_reopened`) en vez de abrir otra.

### 3.5 Tareas programadas (cron existente `/api/cron/jobs`, cada minuto)

- Activar gestiones `scheduled` con `scheduled_for <= now()` → `open`, `opened_at`, reparto,
  notificación ("Recompra para hoy: …").
- Reintentar el reparto de gestiones `open` sin asignar cuando haya elegibles.
- Notificar `next_action_at` vencidos (una sola vez por fecha).

### 3.6 Plantillas de negocio (`lib/business-templates.ts`)

Datos en código para `ecommerce`, `gym`, `general` y `blank`, con tipos de contacto, tipos de
gestión, etapas, categorías, motivos y reglas de `docs/PLAN-CRM.md` 3.3 y 3.4.
`applyBusinessTemplate(workspaceId, key)` es idempotente: agrega lo que falte por nombre y nunca
borra. La migración no carga datos: el asistente lo hace. Para la tienda actual se aplicará
`ecommerce` una vez desplegado.

## 4. Interfaz

### 4.1 Bandeja (`components/inbox/**`, `app/(dashboard)/dashboard/inbox/**`)

- Vistas: **Mis gestiones**, **Para hoy** (asignadas a mí, con `next_action_at` o activadas hoy),
  **Sin asignar** y **Mi equipo** (supervisores), **Todas** (administradores). Filtros por tipo,
  etapa, estado, asesor, canal y "esperando respuesta". Orden por `waiting_since`.
- Cada fila: contacto, canal, tipo y etapa de la gestión, responsable y tiempo esperando.
- **Tarjeta de gestión** en la cabecera del chat: tipo (clasificar), etapa, categoría,
  responsable (asignar o transferir según permisos), próximo contacto y **Cerrar** (diálogo con
  resultado, motivo, nota y, si hay reglas, la fecha de recompra o la fecha clave). Botón **Nueva
  gestión** para abrir otra en paralelo.
- **Notas internas**: se escriben desde la caja de texto con un interruptor "Nota interna"; se
  muestran en amarillo intercaladas por fecha; `@` sugiere miembros.
- **Respuestas guardadas**: escribir `/` abre el buscador (componente `SavedReplyPicker`);
  reemplaza variables `{nombre}`, `{asesor}`, `{sede}`, `{empresa}` y campos personalizados; pega
  el texto para editar.
- **Plantillas de WhatsApp**: si el chat es de WhatsApp y `last_inbound_at` tiene más de 24 h, la
  caja de texto se bloquea con el aviso y el botón "Usar plantilla" (componente `TemplatePicker`).

### 4.2 Gestiones (`app/(dashboard)/dashboard/cases/**`, menú "Gestiones")

Lista con filtros y búsqueda, pestaña **Para hoy** y **Programadas**, y "Nueva gestión" manual
(elegir contacto y tipo). Clic en una fila abre el chat del contacto en la bandeja o, si no tiene
chat, la ficha.

### 4.3 Contactos (`app/(dashboard)/dashboard/contacts/**`, `components/inbox/contact-panel.tsx`)

Tipo de contacto, responsable, equipo, fecha clave, etiquetas editables a mano y **línea de tiempo**
desde `activity` + `case_notes` + gestiones cerradas con su resultado.

### 4.4 Configuración

- **Gestiones** (`settings/cases`): lista de tipos a la izquierda; pestañas General, Etapas,
  Categorías y motivos, Destino, Tiempos y Reglas. Reglas de cambio seguro de `PLAN-CRM.md` 7.9
  (archivar si hay historial, mover gestiones abiertas al quitar una etapa, registro en
  `activity` con `config_changed`).
- **Tipos de contacto** (`settings/contact-types`) y etiqueta de la fecha clave.
- **Plantilla de negocio**: asistente que aparece si el espacio no tiene tipos de gestión, y botón
  "Agregar desde plantilla".
- **Equipos** (`settings/teams`): equipos, equipo por defecto, miembros con rol de equipo y tipos
  que atienden, modo de reparto.
- **Atención** (`settings/attention`): visibilidad del asesor y modo de reparto sin equipos.
- **Respuestas guardadas** (`settings/replies`): de la empresa; los supervisores las del equipo;
  cada persona las suyas desde el mismo selector de la bandeja.
- **Plantillas de WhatsApp** (`settings/whatsapp-templates`): lista desde Zernio con estado de
  aprobación y creación básica. Solo si hay canal de WhatsApp.

### 4.5 General

- Menú lateral según rol: los asesores ven Bandeja, Gestiones y Contactos; no ven Flujos, Canales,
  Difusiones, Secuencias, Crecimiento ni Configuración (salvo su disponibilidad y sus respuestas).
- Interruptor **Disponible / Ausente** junto al nombre en el menú.
- **Campana de notificaciones** con contador, en tiempo real.
- Página `app/not-found.tsx` en español.

## 5. Trabajo en paralelo

| Tanda | Agente | Alcance | Archivos |
|---|---|---|---|
| 1 | Opus | Migración 00019 (modelo, RLS, secretos, realtime), helper de secretos y adaptación de quienes los leen, tipos de la base | `supabase/migrations/00019_*`, `lib/types/database.ts`, `lib/workspace-secrets.ts`, archivos que leen secretos |
| 2 | Opus | Motor `lib/cases/**`, plantillas de negocio, enganche en webhook, envío de mensajes y cron, acciones de servidor | `lib/cases/**`, `lib/business-templates.ts`, `app/api/webhooks/late/route.ts`, `app/api/v1/messages/route.ts`, `app/api/cron/jobs/route.ts`, `lib/actions/cases.ts` |
| 3 | Opus | Bandeja (4.1) | `components/inbox/**`, `app/(dashboard)/dashboard/inbox/**` |
| 3 | Sonnet | Configuración de gestiones, tipos de contacto y asistente (4.4) | `app/(dashboard)/dashboard/settings/cases/**`, `settings/contact-types/**`, `components/settings/cases/**` |
| 3 | Sonnet | Equipos, Atención, menú por rol, disponibilidad, campana, 404 (4.4, 4.5) | `settings/teams/**`, `settings/attention/**`, `components/sidebar.tsx`, `components/notifications/**`, `app/not-found.tsx` |
| 3 | Sonnet | Respuestas guardadas y plantillas de WhatsApp: pantallas y componentes `SavedReplyPicker` y `TemplatePicker` con su API (la bandeja los integra) | `settings/replies/**`, `settings/whatsapp-templates/**`, `components/composer/**`, `app/api/v1/templates/**` |
| 3 | Sonnet | Gestiones (4.2) y contactos (4.3) | `app/(dashboard)/dashboard/cases/**`, `app/(dashboard)/dashboard/contacts/**` |

Las tandas 1 y 2 van en orden; la 3 en paralelo cuando la 2 esté lista y la migración aplicada.
Cada agente trabaja solo en sus archivos; si necesita algo de otro, lo pide en su reporte.

## 6. Verificación antes de publicar

- `tsc`, `eslint`, `npm test`, `npm run build`.
- Pruebas de RLS en la base dentro de bloques que se revierten: un asesor no ve contactos de otro,
  un supervisor ve su equipo y no otro, el administrador ve todo, nadie lee `workspace_secrets`.
- Prueba del reparto por turnos con varios miembros simulados (vitest sobre la función pura).
- Revisión en el navegador de bandeja, gestiones y configuración con la cuenta del dueño.
- Aplicar la plantilla `ecommerce` al espacio de la tienda.
