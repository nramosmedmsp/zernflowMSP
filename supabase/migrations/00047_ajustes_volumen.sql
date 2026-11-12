-- Ajustes de volumen hallados al medir con 50 000 contactos, 20 000 chats, 30 000
-- gestiones y 300 000 eventos (verificación previa a producción). Aditiva e idempotente.
--
-- QUÉ HACE
--   1. Índices con el MISMO orden que piden las pantallas. Las que ya existían
--      (idx_contacts_last_interaction, idx_conversations_workspace) ordenan DESC con
--      NULLS FIRST (lo que da Postgres por omisión), pero la app pide
--      `order by ... desc nulls last, id`; con ese orden Postgres no podía usar el
--      índice y leía y ordenaba toda la tabla en cada página (Contactos: 0,8 s el dueño,
--      3-4 s un asesor; Bandeja "Todos": 0,9-2,2 s). Con el índice a la medida, la
--      primera página lee solo las filas que muestra.
--        contacts       (espacio, última interacción desc nulls last, id)
--        contacts       (espacio, nombre asc nulls last, id)  y  (… desc nulls last, id)
--        contacts       (espacio, fecha clave asc nulls last, id)
--        contacts       (espacio, creación desc, id)
--        conversations  (espacio, último mensaje desc nulls last, id)
--        cases          (espacio, creación desc, id)   <- lectura por páginas de Métricas,
--                                                         Por cliente y Tablero
--      No se borra ninguno de los anteriores.
--   2. Las tres funciones de Analítica y Métricas (analytics_flow_stats,
--      analytics_daily, metrics_inbound_hourly) pasan de SECURITY INVOKER a SECURITY
--      DEFINER con la comprobación de permiso HECHA UNA VEZ. Motivo medido: la política
--      de analytics_events (is_ws_admin OR is_ws_supervisor) se evaluaba FILA POR FILA
--      sobre las 100 000 a 300 000 filas del rango (≈ 40 µs cada una): 3 s el dueño,
--      7-13 s un supervisor y hasta 12 s un asesor que no ve ninguna (superando los 8 s de
--      statement_timeout de `authenticated`: la pantalla de Métricas fallaba). Ahora la
--      función comprueba una sola vez el MISMO permiso de la política (administrador o
--      supervisor del espacio; service_role pasa, como antes con BYPASSRLS) y agrupa
--      con índice. Quien no tiene permiso recibe cero filas, igual que antes.
--      En analytics_daily, la parte de contactos nuevos sigue contando solo los
--      contactos que la persona puede ver (can_see_contact_row, el mismo permiso de la
--      política de contacts), con el atajo de que un administrador los ve todos.
--      "Ver como" funciona igual: los ayudantes leen auth.uid() / la vista activa.
--      Los ayudantes viven en crm_private (no expuesto por la API, sin permisos para
--      usuarios) y todas las funciones fijan search_path.
--
-- LO QUE NO SE ARREGLA AQUÍ (rediseño; ver informe de la verificación)
--   * Conteos exactos y listas con filtro para supervisores y asesores recorren las
--     filas con la política por fila (can_see_contact_row ≈ 20-80 µs): Contactos con
--     50 000 contactos tarda 3-4 s en contar para un asesor.
--   * Métricas lee las gestiones por páginas con OFFSET; cada página repite el trabajo.
--
-- BLOQUEOS: CREATE INDEX (sin CONCURRENTLY, por la transacción) bloquea las escrituras
-- de esa tabla mientras se construye: segundos con decenas de miles de filas. Con
-- lock_timeout de 10 s falla limpio si hubiera una transacción larga, y se reintenta.
-- ORDEN DE DESPLIEGUE: antes o después del código es indiferente; no cambia ningún
-- resultado, solo el tiempo. Es idempotente: se puede volver a ejecutar.

set local lock_timeout = '10s';

-- ============================================================
-- 1. Índices con el orden de las pantallas
-- ============================================================

create index if not exists idx_contacts_ws_last_interaction_nl
  on public.contacts (workspace_id, last_interaction_at desc nulls last, id);

create index if not exists idx_contacts_ws_name
  on public.contacts (workspace_id, display_name asc nulls last, id);

create index if not exists idx_contacts_ws_name_desc
  on public.contacts (workspace_id, display_name desc nulls last, id);

create index if not exists idx_contacts_ws_key_date_nl
  on public.contacts (workspace_id, key_date asc nulls last, id);

create index if not exists idx_contacts_ws_created
  on public.contacts (workspace_id, created_at desc, id);

create index if not exists idx_conversations_ws_last_message_nl
  on public.conversations (workspace_id, last_message_at desc nulls last, id);

create index if not exists idx_cases_ws_created
  on public.cases (workspace_id, created_at desc, id);

-- ============================================================
-- 2. Analítica y Métricas: permiso comprobado una sola vez
-- ============================================================

-- ¿Puede leer los eventos de analítica del espacio? Mismo criterio que la política
-- analytics_events_select (administrador o supervisor), más service_role.
create or replace function crm_private.can_read_analytics(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.role() = 'service_role'
      or public.is_ws_admin(p_workspace)
      or public.is_ws_supervisor(p_workspace);
$$;

-- ¿Ve todos los contactos del espacio sin mirar fila por fila? Administrador (o service_role).
create or replace function crm_private.sees_all_contacts(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.role() = 'service_role' or public.is_ws_admin(p_workspace);
$$;

revoke all on function crm_private.can_read_analytics(uuid) from public, anon, authenticated;
revoke all on function crm_private.sees_all_contacts(uuid) from public, anon, authenticated;

create or replace function public.analytics_flow_stats(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (flow_id uuid, starts bigint, completions bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.flow_id,
         count(*) filter (where e.event_type = 'flow_started'),
         count(*) filter (where e.event_type = 'flow_completed')
  from public.analytics_events e
  where (select crm_private.can_read_analytics(p_workspace))
    and e.workspace_id = p_workspace
    and e.event_type in ('flow_started', 'flow_completed')
    and e.flow_id is not null
    and e.created_at >= p_from and e.created_at <= p_to
  group by e.flow_id;
$$;

create or replace function public.analytics_daily(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (day date, sent bigint, failed bigint, new_contacts bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.day,
         coalesce(sum(d.sent), 0)::bigint,
         coalesce(sum(d.failed), 0)::bigint,
         coalesce(sum(d.new_contacts), 0)::bigint
  from (
    select (e.created_at at time zone 'America/Lima')::date as day,
           (e.event_type = 'message_sent')::int as sent,
           (e.event_type = 'message_failed')::int as failed,
           0 as new_contacts
    from public.analytics_events e
    where (select crm_private.can_read_analytics(p_workspace))
      and e.workspace_id = p_workspace
      and e.event_type in ('message_sent', 'message_failed')
      and e.created_at >= p_from and e.created_at <= p_to
    union all
    select (c.created_at at time zone 'America/Lima')::date, 0, 0, 1
    from public.contacts c
    where c.workspace_id = p_workspace
      and c.created_at >= p_from and c.created_at <= p_to
      and ((select crm_private.sees_all_contacts(p_workspace))
           or public.can_see_contact_row(c.workspace_id, c.id, c.owner_id, c.team_id))
  ) d
  group by d.day
  order by d.day;
$$;

create or replace function public.metrics_inbound_hourly(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (hour_start timestamptz, platform text, n bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select date_trunc('hour', e.created_at),
         e.metadata->>'platform',
         count(*)
  from public.analytics_events e
  where (select crm_private.can_read_analytics(p_workspace))
    and e.workspace_id = p_workspace
    and e.event_type = 'message_received'
    and e.created_at >= p_from and e.created_at < p_to
  group by 1, 2;
$$;

revoke all on function public.analytics_flow_stats(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.analytics_daily(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.metrics_inbound_hourly(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_flow_stats(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.analytics_daily(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.metrics_inbound_hourly(uuid, timestamptz, timestamptz) to authenticated, service_role;

analyze public.contacts;
analyze public.conversations;
analyze public.cases;

notify pgrst, 'reload schema';
