# Fase 2 — Especificación técnica

Automatización, horarios, importación y preparación del gimnasio. Complementa `docs/PLAN-CRM.md`
(versión 2) y `docs/FASE-1-TECNICO.md`. Todo texto visible en español (tuteo), fechas con
`lib/format.ts`, hora de Lima. Todo es opcional: sin configurar, el CRM se comporta como en la
fase 1.

## 0. Hechos que condicionan el diseño

- Las difusiones y secuencias envían con `sendInboxMessage`, que exige una conversación ya
  existente. Las plantillas de WhatsApp se envían con `createInboxConversation` hacia el teléfono
  (ver `app/api/v1/templates/send/route.ts`), así que llegan también a contactos importados que
  nunca escribieron.
- Fuera de la ventana de 24 h, WhatsApp solo acepta plantillas. Todo envío automático que pueda
  caer fuera de la ventana (proactivas, difusiones, pasos de secuencia) debe poder usar plantilla.
- Los tipos de disparador de flujos tienen un check en la base (00001): hay que ampliarlo.
- Feriados de Perú: tomar la lista fija y los de Semana Santa de Nexo
  (`nramosmedmsp/nexo-muscleshop`, `server/calendar.js`; leer con `gh api`).

## 1. Modelo de datos (migración 00021)

```
workspaces.settings  + business_hours        -- horario de la empresa si no hay equipos
                     + off_hours_reply: { enabled, text, min_hours_between }   -- respuesta fuera de horario
                     + reassign_after_minutes: int | null                      -- reasignación por espera
teams                + business_hours jsonb null   -- null = usa el de la empresa
                     -- formato: { "mon": [["09:00","13:00"],["14:00","19:00"]], ..., "sun": [] }
holidays             id, workspace_id, team_id null (null = toda la empresa), date, name,
                     created_at; único (workspace_id, team_id, date)
case_types           + auto_template jsonb null
                     -- { template_name, language, params: ["{nombre}", "{fecha_clave}", ...] }
                     -- se envía al activarse una gestión proactiva (Recompra, Renovación)
cases                + off_hours_reply_sent_at timestamptz null
                     + auto_template_sent_at timestamptz null
                     + reassigned_count int default 0
triggers.type        + 'case_stage_changed', 'case_closed', 'client_no_reply'
                     -- config: { case_type_id?, stage_id?, outcome?: 'won'|'lost'|'resolved', minutes? }
import_batches       id, workspace_id, created_by, file_name, total, created, updated, skipped,
                     errors jsonb, options jsonb, created_at
```

`broadcasts.message_content` y los pasos de `sequences.steps` (jsonb) admiten además
`{ kind: 'template', template_name, language, params: [...] }`. Sin migración: es jsonb.

Políticas: `holidays` y `import_batches` leen miembros, escriben administradores (como `teams`).

## 2. Horarios (`lib/business-hours.ts`, puro y probado)

- `isWithinHours(at, hours, holidays)`, `nextOpening(at, hours, holidays)` y
  `businessMinutesBetween(a, b, hours, holidays)` en hora de Lima. Sin horario configurado =
  24 horas todos los días.
- Horario efectivo de una gestión: el de su equipo; si no tiene, el de la empresa.
- `PERU_HOLIDAYS(year)`: feriados nacionales fijos más Jueves y Viernes Santo.

## 3. Motor (`lib/cases/**`, cron)

1. **Reparto en horario**: fuera del horario del equipo, la gestión queda sin asignar y el cron la
   reparte al abrir. Las proactivas que se activan fuera de horario esperan igual.
2. **Respuesta fuera de horario**: si está activa y llega un mensaje fuera de horario, se envía el
   texto (dentro de la ventana de 24 h, así que es texto libre) una vez por gestión, o de nuevo si
   pasaron `min_hours_between`. Se sella `off_hours_reply_sent_at`. Variables: `{nombre}`,
   `{empresa}`, `{apertura}` (próxima apertura, ej. "lunes 9:00").
3. **Reasignación por espera**: si `reassign_after_minutes` está definido, una gestión asignada con
   `waiting_since` más antiguo que ese tiempo **en minutos hábiles** vuelve a la cola, se reparte a
   otra persona (excluyendo a la anterior), se registra `unassigned` + `assigned` con motivo
   `espera`, sube `reassigned_count` y se avisa al supervisor y a la persona anterior.
4. **Plantilla automática en proactivas**: al activarse una gestión `scheduled` de un tipo con
   `auto_template`, si el contacto tiene teléfono de WhatsApp se envía la plantilla con sus
   variables reemplazadas (`{nombre}`, `{fecha_clave}`, `{empresa}`, campos personalizados), se
   sella `auto_template_sent_at`, se registra en `activity` y la gestión pasa a la segunda etapa
   abierta ("Recordatorio enviado" / "Contactado"). Si falla, queda en la primera etapa y se avisa
   al responsable.
5. **Sellado de salidas automáticas**: difusiones y secuencias llaman a `stampBotOutbound`.
6. **Eventos para flujos**: el motor emite eventos `case_stage_changed` y `case_closed` y el cron
   detecta `client_no_reply` (la gestión espera respuesta del cliente: último mensaje saliente sin
   respuesta durante N minutos). Contrato: `lib/flow-engine/case-triggers.ts` exporta
   `runCaseEventFlows(service, event: CaseFlowEvent)`, donde
   `CaseFlowEvent = { type: 'case_stage_changed' | 'case_closed' | 'client_no_reply'; workspaceId; caseId; contactId; caseTypeId: string | null; stageId: string | null; outcome?: 'won' | 'lost' | 'resolved'; }`.
   El motor la llama sin esperar su resultado para no frenar la acción del usuario, y captura errores.
7. **Fecha clave al importar**: exportar `scheduleCasesForKeyDate(service, workspaceId, contactId)`
   que aplica las reglas `schedule_case` con `days_before_key_date` de todos los tipos (crea o mueve
   la gestión programada). La usa la importación.

## 4. Flujos (`lib/flow-engine/**`, `components/flow-builder/**`)

Nodos nuevos (con panel de configuración y en el simulador):
- **Clasificar gestión**: tipo de gestión (y etapa opcional) para la gestión abierta del contacto.
- **Cambiar etapa**: etapa del tipo actual.
- **Asignar a equipo**: equipo fijo; re-ruteo y reparto.
- **Repartir a asesor**: aplica el reparto del equipo actual.

Condiciones nuevas en el nodo Condición: tipo de contacto, tipo de gestión, etapa, equipo, tiene
responsable, dentro de horario.

Disparadores nuevos: cambio de etapa (tipo y etapa), gestión cerrada (tipo y resultado), cliente
sin responder (minutos). Solo envían texto libre si la ventana de 24 h está abierta; si está
cerrada, el nodo Enviar mensaje puede usar una plantilla (agregar esa opción al nodo).

Todas las acciones de los nodos pasan por `lib/cases/**` (registran en `activity` con actor null).

## 5. Difusiones y secuencias

- Difusión: elegir **Texto** (solo contactos con conversación y ventana abierta; se advierte cuántos
  quedarán fuera) o **Plantilla de WhatsApp** (cualquier contacto con teléfono de WhatsApp, con
  variables por contacto). Segmentos existentes + filtros nuevos por tipo de contacto, equipo,
  responsable y fecha clave (rango).
- Paso de secuencia: **Mensaje** o **Plantilla**; si toca un mensaje con la ventana cerrada y el
  paso tiene plantilla alternativa, usa la plantilla; si no, se marca fallido con motivo claro.
- Ambos sellan la salida en la gestión abierta (`stampBotOutbound`).

## 6. Importación de contactos (`/dashboard/contacts/import`, administradores)

1. Subir CSV (UTF-8 o Latin-1, separador coma o punto y coma). Plantilla descargable.
2. Mapear columnas: nombre, teléfono, correo, tipo de contacto, sede (equipo), responsable (correo
   del miembro), fecha clave (dd/mm/aaaa o aaaa-mm-dd), etiquetas (separadas por `|`), y cualquier
   campo personalizado.
3. Vista previa con validación fila por fila: teléfono normalizado a formato internacional (Perú
   +51 por defecto si tiene 9 dígitos que empiezan en 9), duplicados dentro del archivo y contra la
   base (por teléfono, luego correo), valores desconocidos (tipo, sede, responsable) marcados.
4. Opciones: actualizar existentes o saltarlos; crear etiquetas que no existan; canal de WhatsApp
   al que vincular el teléfono (crea `contact_channels` con el teléfono como `platform_sender_id`);
   **programar gestiones según la fecha clave** (usa `scheduleCasesForKeyDate`).
5. Proceso por lotes en el servidor, resultado con contadores y archivo de errores descargable;
   queda en `import_batches` y en `activity` (`config_changed` no; usar `contacts_imported`).

## 7. Contactos a escala

La lista de contactos filtra y pagina en el servidor (búsqueda por nombre, teléfono o correo; filtros
por tipo, responsable, equipo, etiqueta, fecha clave), con conteo total. Quita el límite de 500.

## 8. Pantallas de configuración

- **Horarios** (`settings/hours`): horario de la empresa y, si hay equipos, de cada equipo
  ("usar el de la empresa" por defecto); feriados con botón "Cargar feriados de Perú del año".
- **Atención**: respuesta fuera de horario (activar, texto con variables, horas mínimas entre
  envíos) y reasignación por espera (minutos hábiles, vacío = desactivada).
- **Gestiones → tipo → General**: "Plantilla al activarse" para tipos proactivos (elegir plantilla
  aprobada y mapear sus variables), solo si hay WhatsApp conectado.

## 9. Trabajo en paralelo

| Tanda | Agente | Alcance |
|---|---|---|
| 1 | Opus | Migración 00021, `lib/business-hours.ts`, cambios del motor 3.1 a 3.7 y cron, tipos de la base |
| 2 | Opus | Flujos (sección 4) |
| 2 | Sonnet | Difusiones y secuencias (sección 5) |
| 2 | Sonnet | Importación y contactos a escala (secciones 6 y 7) |
| 2 | Sonnet | Pantallas de configuración (sección 8) |

## 10. Instalación del gimnasio (operación, con el dueño)

Cuando el código de la fase 2 esté publicado:
1. Proyecto Supabase nuevo **CRM Gimnasio B2** (no reutilizar la base del sistema del gimnasio) y
   aplicar 00001 a 00021 con ensayo en seco.
2. Proyecto Vercel `crm-gimnasio-b2` desde el mismo repositorio, con sus variables.
3. Primera cuenta con `npm run crear-admin`, plantilla **Gimnasio**, sedes como equipos,
   supervisores y asesores, horarios por sede.
4. Clave de Zernio del gimnasio y su número de WhatsApp; flujo de bienvenida que pregunta la sede.
5. Importar socios con fecha de vencimiento y programar Renovaciones.
