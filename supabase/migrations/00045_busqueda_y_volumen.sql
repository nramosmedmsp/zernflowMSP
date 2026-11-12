-- Tanda 4 (volumen y mejoras de uso): búsqueda sin tildes ni formato de
-- teléfono hecha en la base, y conteos agregados para Analítica y Métricas.
--
-- QUÉ HACE
--   1. Extensión `unaccent` y tres funciones inmutables de normalización:
--        f_unaccent(texto)       quita tildes (ñ -> n)
--        f_norm(texto)           minúsculas, sin tildes ("Peña" -> "pena")
--        f_phone_digits(texto)   solo los dígitos ("+51 987 654 321" -> "51987654321")
--   2. Índices GIN trigram sobre esas expresiones (nombre, correo y teléfono de
--      contactos; vista previa del último mensaje de los chats) y un índice de
--      eventos de analítica por (espacio, tipo, fecha).
--   3. Funciones de búsqueda (devuelven filas completas de la tabla, así que la
--      app puede seguir encadenando filtros, orden, página y conteo):
--        search_contacts(espacio, texto)  -> contactos
--        search_cases(espacio, texto)     -> gestiones de los contactos que coinciden
--        search_inbox(espacio, texto, n)  -> chats (por contacto o por último mensaje)
--   4. Conteos agregados (SECURITY INVOKER: corren con los permisos de quien
--      llama, la RLS decide qué cuenta):
--        analytics_flow_stats   inicios y terminaciones por flujo
--        analytics_daily        enviados / fallidos / contactos nuevos por día (hora de Lima)
--        metrics_inbound_hourly mensajes entrantes por hora y canal
--
-- POR QUÉ LAS BÚSQUEDAS SON SECURITY DEFINER (razón escrita)
--   Con RLS, Postgres evalúa la política (can_see_contact_row) ANTES que un
--   `ilike` del usuario, porque `ilike` no es "leakproof"; por eso el índice
--   trigram NO se usa si se busca con la tabla directa (medido: lectura
--   secuencial de toda la tabla, con can_see_contact_row en cada fila: 0,6 s
--   para un administrador y 1,5 s para un asesor con solo 40 000 contactos, y
--   crece linealmente). Las funciones buscan primero por índice y aplican DESPUÉS,
--   solo a las filas que coinciden, el MISMO permiso que la política:
--   can_see_contact_row(...) (que lee auth.uid(), así que "Ver como" funciona
--   igual) y exigen ser miembro del espacio. Un asesor no recibe por la función
--   nada que no vea por la tabla. El ayudante crm_private.contact_match vive en
--   un esquema que la API no expone y nadie puede ejecutarlo directamente.
--
-- ÍNDICES NUEVOS FRENTE A LOS DE LA 00042 (no se borra ninguno)
--   idx_contacts_display_name_trgm / _email_trgm / _phone_trgm (00042) indexan el
--   texto crudo y sirven para `ilike` con la tabla directa. Los nuevos
--   (idx_contacts_name_norm_trgm, _email_norm_trgm, _phone_digits_trgm) indexan
--   el texto normalizado y son los que usa la búsqueda desde ahora. En la
--   práctica los de la 00042 quedan sin uso (la app ya no hace `ilike` directo
--   sobre esas columnas): se pueden retirar con calma tras 2-4 semanas
--   mirando pg_stat_user_indexes, en otra migración.
--
-- BLOQUEOS Y DURACIÓN
--   CREATE INDEX (sin CONCURRENTLY, por la transacción) bloquea las ESCRITURAS
--   de la tabla mientras se construye. Con decenas de miles de contactos son
--   segundos. Con lock_timeout de 10 s: si hay una transacción larga, falla
--   limpio y se vuelve a ejecutar. Los índices sobre conversations penalizan un
--   poco cada mensaje nuevo (la vista previa cambia): es el costo de buscar por
--   texto del mensaje con índice.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar el código. Es aditiva e
-- idempotente y no cambia nada para el código anterior (que no usa estas
-- funciones). El código nuevo, si la migración falta, no encuentra las
-- funciones: la búsqueda muestra un aviso en vez de resultados.

set local lock_timeout = '10s';

-- ============================================================
-- 1. unaccent y normalización
-- ============================================================

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'unaccent';
  if v_schema is null then
    v_schema := case when exists (select 1 from pg_namespace where nspname = 'extensions')
                     then 'extensions' else 'public' end;
    execute format('create extension if not exists unaccent with schema %I', v_schema);
  end if;

  -- El envoltorio fija el diccionario por nombre completo: así es inmutable y se puede indexar.
  execute format($f$
    create or replace function public.f_unaccent(p text)
    returns text
    language sql
    immutable
    parallel safe
    strict
    as $body$ select %1$I.unaccent('%1$I.unaccent'::regdictionary, p) $body$
  $f$, v_schema);
end $$;

create or replace function public.f_norm(p text)
returns text
language sql
immutable
parallel safe
as $$ select lower(public.f_unaccent(coalesce(p, ''))) $$;

create or replace function public.f_phone_digits(p text)
returns text
language sql
immutable
parallel safe
as $$ select regexp_replace(coalesce(p, ''), '\D', '', 'g') $$;

-- ============================================================
-- 2. Índices de texto sobre lo normalizado (+ eventos de analítica)
-- ============================================================

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';
  if v_schema is null then
    v_schema := case when exists (select 1 from pg_namespace where nspname = 'extensions')
                     then 'extensions' else 'public' end;
    execute format('create extension if not exists pg_trgm with schema %I', v_schema);
  end if;

  execute format('create index if not exists idx_contacts_name_norm_trgm on public.contacts using gin ((public.f_norm(display_name)) %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists idx_contacts_email_norm_trgm on public.contacts using gin ((public.f_norm(email)) %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists idx_contacts_phone_digits_trgm on public.contacts using gin ((public.f_phone_digits(phone)) %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists idx_conversations_preview_norm_trgm on public.conversations using gin ((public.f_norm(last_message_preview)) %I.gin_trgm_ops)', v_schema);
end $$;

-- Conteos de Analítica y Métricas por espacio, tipo y fecha.
create index if not exists idx_analytics_events_ws_type_created
  on public.analytics_events (workspace_id, event_type, created_at);

-- ============================================================
-- 3. Búsqueda
-- ============================================================

-- Ayudante interno: contactos del espacio que coinciden Y que la persona puede ver.
-- Texto: nombre o correo sin tildes; si parece un teléfono (solo dígitos, espacios,
-- + - . ( )), también por los dígitos del teléfono guardado.
create or replace function crm_private.contact_match(p_workspace uuid, p_q text)
returns table (id uuid)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_q text := public.f_norm(btrim(coalesce(p_q, '')));
  v_digits text := public.f_phone_digits(p_q);
  v_pat text;
  v_dpat text;
  v_phoneish boolean;
begin
  if v_q = '' or p_workspace is null or auth.uid() is null then
    return;
  end if;
  -- Debe ser miembro del espacio (can_see_contact_row también lo exige, pero así
  -- ni siquiera se busca).
  if not public.is_workspace_member(p_workspace) then
    return;
  end if;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_phoneish := p_q ~ '^[0-9+()\s.-]+$' and length(v_digits) >= 3;
  v_dpat := '%' || v_digits || '%';

  -- Primero los candidatos por índice (un SELECT por columna, cada uno con su índice
  -- trigram) y SOLO a ellos se les aplica el permiso: así el costo no depende del
  -- tamaño de la tabla sino del número de coincidencias.
  return query
    with cand as materialized (
      select c.id, c.workspace_id, c.owner_id, c.team_id
      from public.contacts c
      where c.workspace_id = p_workspace and public.f_norm(c.display_name) like v_pat
      union
      select c.id, c.workspace_id, c.owner_id, c.team_id
      from public.contacts c
      where c.workspace_id = p_workspace and public.f_norm(c.email) like v_pat
      union
      select c.id, c.workspace_id, c.owner_id, c.team_id
      from public.contacts c
      where v_phoneish and c.workspace_id = p_workspace and public.f_phone_digits(c.phone) like v_dpat
    )
    select k.id
    from cand k
    where public.can_see_contact_row(k.workspace_id, k.id, k.owner_id, k.team_id);
end;
$$;
revoke all on function crm_private.contact_match(uuid, text) from public, anon, authenticated;

create or replace function public.search_contacts(p_workspace uuid, p_q text)
returns setof public.contacts
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select c.*
  from public.contacts c
  where c.id in (select m.id from crm_private.contact_match(p_workspace, p_q) m);
$$;

create or replace function public.search_cases(p_workspace uuid, p_q text)
returns setof public.cases
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select k.*
  from public.cases k
  where k.workspace_id = p_workspace
    and k.contact_id in (select m.id from crm_private.contact_match(p_workspace, p_q) m);
$$;

-- Chats: por nombre/correo/teléfono del contacto o por el último mensaje. Los más recientes primero.
create or replace function public.search_inbox(p_workspace uuid, p_q text, p_limit integer default 100)
returns setof public.conversations
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_q text := public.f_norm(btrim(coalesce(p_q, '')));
  v_pat text;
begin
  if v_q = '' or p_workspace is null or auth.uid() is null
     or not public.is_workspace_member(p_workspace) then
    return;
  end if;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select v.*
    from public.conversations v
    where v.id in (
      select cv.id from public.conversations cv
      where cv.workspace_id = p_workspace
        and cv.contact_id in (select m.id from crm_private.contact_match(p_workspace, p_q) m)
      union
      select cv.id from public.conversations cv
      where cv.workspace_id = p_workspace
        and public.f_norm(cv.last_message_preview) like v_pat
        and public.can_see_contact(cv.contact_id)
    )
    order by v.last_message_at desc nulls last, v.id
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke all on function public.search_contacts(uuid, text) from public, anon;
revoke all on function public.search_cases(uuid, text) from public, anon;
revoke all on function public.search_inbox(uuid, text, integer) from public, anon;
grant execute on function public.search_contacts(uuid, text) to authenticated, service_role;
grant execute on function public.search_cases(uuid, text) to authenticated, service_role;
grant execute on function public.search_inbox(uuid, text, integer) to authenticated, service_role;

-- ============================================================
-- 4. Conteos agregados (SECURITY INVOKER: la RLS de quien llama decide)
-- ============================================================

-- Inicios y terminaciones de cada flujo en el rango [p_from, p_to].
create or replace function public.analytics_flow_stats(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (flow_id uuid, starts bigint, completions bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select e.flow_id,
         count(*) filter (where e.event_type = 'flow_started'),
         count(*) filter (where e.event_type = 'flow_completed')
  from public.analytics_events e
  where e.workspace_id = p_workspace
    and e.event_type in ('flow_started', 'flow_completed')
    and e.flow_id is not null
    and e.created_at >= p_from and e.created_at <= p_to
  group by e.flow_id;
$$;

-- Mensajes enviados / fallidos y contactos nuevos por día (hora de Lima) en el rango.
create or replace function public.analytics_daily(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (day date, sent bigint, failed bigint, new_contacts bigint)
language sql
stable
security invoker
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
    where e.workspace_id = p_workspace
      and e.event_type in ('message_sent', 'message_failed')
      and e.created_at >= p_from and e.created_at <= p_to
    union all
    select (c.created_at at time zone 'America/Lima')::date, 0, 0, 1
    from public.contacts c
    where c.workspace_id = p_workspace
      and c.created_at >= p_from and c.created_at <= p_to
  ) d
  group by d.day
  order by d.day;
$$;

-- Mensajes entrantes por hora (UTC, que coincide con la hora de Lima: UTC-5 fijo) y canal.
create or replace function public.metrics_inbound_hourly(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (hour_start timestamptz, platform text, n bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select date_trunc('hour', e.created_at),
         e.metadata->>'platform',
         count(*)
  from public.analytics_events e
  where e.workspace_id = p_workspace
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

notify pgrst, 'reload schema';
