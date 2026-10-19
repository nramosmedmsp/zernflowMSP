# Fase 3 — Especificación técnica: métricas

Complementa `docs/PLAN-CRM.md` (sección 7.10) y las fases 1 y 2. Todo texto visible en español
(tuteo), fechas con `lib/format.ts`, hora de Lima. Respeta los permisos: cada consulta se hace con
el cliente de Supabase de la persona (RLS), así un asesor ve lo suyo, el supervisor su equipo y el
administrador todo. Nunca usar la clave de servicio para leer métricas de la pantalla.

## 0. Qué datos ya existen

- `cases`: `opened_at`, `first_response_at`, `waiting_since`, `closed_at`, `status`
  (`scheduled|open|won|lost|resolved|cancelled`), `origin`, `case_type_id`, `stage_id`, `team_id`,
  `assignee_id`, `outcome_reason_id`, `next_action_at`, `scheduled_for`.
- `activity` (con RLS): `case_opened` (meta.origin), `case_scheduled`, `case_activated`,
  `stage_changed` (from_value → to_value = ids de etapa), `case_closed` (to_value = won|lost|resolved),
  `first_response` (meta.seconds, meta.waiting_since), `assigned`, `contact_type_changed`, etc.
- `case_types.sla_first_response_minutes` y `sla_resolution_hours` (ya editables en
  Configuración → Gestiones → tipo → Tiempos).
- `analytics_events` (del proyecto base): `message_sent`, `message_failed`, `flow_started`…
- Horarios: `lib/business-hours.ts` (`businessMinutesBetween`) y `lib/cases/hours.ts`.

## 1. Datos nuevos (migración 00024, agente A)

```
cases  + sla_first_response_breached_at timestamptz null
       + sla_resolution_breached_at     timestamptz null
```

Registro de actividad nuevo (sin migración, `activity.type` es texto libre):

- `human_reply`: cada vez que una persona responde y había una espera del cliente
  (`waiting_since` no nulo), incluida la primera. `meta = { seconds, business_seconds,
  waiting_since }`. Se registra en el mismo lugar donde hoy se sella `first_response`
  (`lib/cases/inbound.ts`, sellado de salida humana). El bot no cuenta.
- `sla_breached`: `meta = { kind: 'first_response' | 'resolution' }`.

Volumen de mensajes entrantes: `analytics_events` con `event_type = 'message_received'`
(`workspace_id`, `contact_id`, `created_at`, `metadata.platform`) desde `lib/inbound-pipeline.ts`,
una vez por mensaje entrante (no por comentarios). Ver cómo se inserta hoy `message_sent`.

## 2. Alertas por objetivo (agente A, cron)

En el cron de gestiones (`lib/cases/cron.ts`):
- **Primera respuesta**: gestión `open` con `first_response_at` nulo, `waiting_since` no nulo, tipo
  con `sla_first_response_minutes`, y minutos hábiles desde `waiting_since` (horario efectivo de la
  gestión) mayores al objetivo, y `sla_first_response_breached_at` nulo → sellar, registrar
  `sla_breached` y notificar (tabla `notifications`, tipo `sla_breached`) al responsable y a los
  supervisores del equipo (si no hay equipo, a los administradores). Título: "Gestión fuera de
  tiempo", cuerpo con nombre del contacto y tipo, enlace a la gestión.
- **Resolución**: igual con `sla_resolution_hours` contra `opened_at` (horas hábiles) para gestiones
  abiertas sin cerrar.
- Una sola vez por gestión y tipo de alerta. Pruebas con el fake-db existente.

## 3. Cálculo (`lib/metrics/**`, agente B, funciones puras y probadas)

Entrada: filas ya leídas (cases, activity de esas gestiones, etapas, tipos, motivos, miembros,
equipos, analytics_events de volumen). Salida: objetos listos para la pantalla. Funciones:

| Métrica | Definición |
|---|---|
| Primera respuesta | De `first_response` (meta.seconds y business_seconds si existe): promedio, mediana, p90. Usar `human_reply` si `first_response` no está. |
| Tiempo de respuesta | Todas las `human_reply`: promedio y mediana. |
| Resolución | `closed_at - opened_at` de gestiones cerradas en el periodo (sin `cancelled`). |
| Tiempo en cada etapa | Reconstruir la línea de tiempo con `case_opened` + `stage_changed` + cierre; por tipo y etapa: promedio y mediana. |
| Embudo | Por tipo de gestión: cuántas gestiones pasaron por cada etapa abierta en orden y cuántas terminaron ganadas, perdidas o resueltas; % de paso entre etapas. |
| Resultados | Ganadas, perdidas, resueltas por periodo y por motivo. |
| Recompra y renovación | Para tipos `is_proactive`: activadas en el periodo vs. ganadas. |
| Atrasados | Abiertas con `next_action_at` vencido, o más de N días en la misma etapa (N = `workspaces.settings.stale_stage_days`, por defecto 7, editable en Configuración → Atención). |
| Volumen | Mensajes entrantes (`message_received`) y gestiones nuevas por día y por hora (matriz día de semana × hora, hora de Lima). |
| Cumplimiento | % de primeras respuestas dentro de `sla_first_response_minutes` y % de resoluciones dentro de `sla_resolution_hours` (solo tipos con objetivo). |

Tiempos: mostrar los dos, "reloj" y "en horario" (minutos hábiles) cuando haya horario
configurado; por defecto "en horario".

Cortes (filtros): periodo (hoy, 7, 30, 90 días, personalizado), tipo de gestión, equipo, asesor,
canal, origen, tipo de contacto. Canal: plataforma de la conversación del contacto (la más reciente
si tiene varias). Asesor y equipo solo aparecen como filtro para supervisores y administradores.

## 4. Pantalla `/dashboard/metrics` (agente B)

- Menú lateral: **Métricas** (icono de gráfico). La analítica actual del proyecto base pasa a
  llamarse **Bot** dentro de Métricas (pestaña) o queda como está, pero sin duplicar nombres.
- Pestañas: **Resumen** (tarjetas: primera respuesta mediana, tiempo de respuesta mediano,
  resolución mediana, cumplimiento, ganadas/perdidas/resueltas, gestiones nuevas, atrasados),
  **Asesores** (tabla por asesor: gestiones atendidas, primera respuesta, respuesta, resolución,
  ganadas, tasa de cierre, cumplimiento; supervisores y administradores), **Embudo** (por tipo de
  gestión, barras horizontales por etapa con % de paso y tiempo en etapa), **Resultados** (por
  periodo y motivos, tasas de recompra y renovación), **Atrasados** (lista con enlace a la gestión),
  **Volumen** (mapa de calor día × hora y serie diaria).
- Cada tabla con **Exportar CSV** (UTF-8 con BOM, separador `;`, fechas dd/mm/aaaa).
- Estados vacíos claros ("Aún no hay gestiones cerradas en este periodo").
- Gráficos: usar lo que ya use `app/(dashboard)/dashboard/analytics` (no agregar librerías nuevas
  si se puede evitar).
- Carga en el servidor con el cliente de la persona; límite razonable (p. ej. 5.000 gestiones del
  periodo) con aviso si se supera.

## 5. Trabajo

| Agente (Sonnet, medio) | Alcance | Archivos |
|---|---|---|
| A | Secciones 1 y 2: migración 00024 (ensayo en seco lo hace el modelo principal), `human_reply`, `message_received`, alertas, tipos en `lib/types/database.ts`, pruebas | `supabase/migrations/00024_*`, `ALL_MIGRATIONS.sql`, `lib/cases/**`, `lib/inbound-pipeline.ts`, `lib/types/database.ts` |
| B | Secciones 3 y 4 y `stale_stage_days` en Configuración → Atención | `lib/metrics/**`, `app/(dashboard)/dashboard/metrics/**`, menú lateral, pantalla de Atención |

Los dos trabajan a la vez en la misma copia: no tocan archivos del otro. B lee `human_reply`,
`message_received` y las columnas nuevas como datos que pueden no existir aún (tipos locales en
`lib/metrics/types.ts`). Ninguno hace commit: el modelo principal revisa, prueba y publica.
