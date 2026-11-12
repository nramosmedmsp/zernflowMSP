-- Tanda 1B (rendimiento): índices que faltan y políticas RLS que evalúan
-- auth.uid() una sola vez por consulta (informe de base de datos BD-6, BD-5, BD-18).
--
-- 1. Índices de claves foráneas y de consulta (BD-6). Hoy las tablas son
--    pequeñas y no se nota, pero con volumen cada una de estas búsquedas se
--    vuelve una lectura secuencial:
--      * conversations(contact_id): Bandeja, Gestiones, Métricas y cada borrado
--        de contacto (cascada). El único índice con contact_id empieza por
--        channel_id y no sirve para buscar solo por contacto.
--      * sequence_enrollments(next_step_at) parcial: el cron de secuencias
--        (cada minuto) filtra status = 'active' y next_step_at <= ahora.
--      * Claves foráneas sin índice que usan las pantallas, los crons y los
--        borrados en cascada / "set null" (contactos, usuarios, flujos, etiquetas).
--    Todos con `create index if not exists`. NO se borra ningún índice.
--
-- 2. Búsqueda de texto de Contactos (BD-6): la búsqueda usa
--    `display_name/email/phone ilike '%texto%'` (contactos y Gestiones). Un
--    índice normal no ayuda con el comodín al inicio; sí uno trigram (GIN).
--    Se instala la extensión pg_trgm (viene incluida en Supabase; es una
--    extensión "de confianza", sin permisos especiales) en el esquema
--    `extensions` si existe, y si no en `public`. Solo agrega un tipo de índice;
--    no cambia ninguna consulta ni resultado.
--
-- 3. Políticas RLS con `auth.uid()` (BD-5): 11 políticas lo llamaban una vez
--    POR FILA; envuelto en `(select auth.uid())` Postgres lo evalúa una sola
--    vez por consulta (recomendación oficial de Supabase, "initplan"). El
--    significado de la política no cambia: auth.uid() es estable dentro de la
--    consulta, y también bajo "Ver como" (el pre-request fija el sub antes de
--    la consulta). El bloque NO reescribe las políticas a mano: lee el texto
--    actual de cada una en pg_policies, cambia únicamente `auth.uid()` por
--    `(select auth.uid())` y usa ALTER POLICY (mismo nombre, misma orden, mismos
--    roles). Antes de tocar nada comprueba que existen exactamente las 11
--    esperadas, y al final comprueba que (a) siguen siendo 11, (b) orden,
--    tipo y roles son los mismos, (c) el texto, deshaciendo el envoltorio, es
--    idéntico al de antes y (d) ya no queda ningún auth.uid() suelto. Si algo
--    no cuadra, lanza una excepción y la migración entera se revierte (el
--    bloque es una sola sentencia atómica).
--
-- Aditiva e idempotente: se puede volver a ejecutar (los índices ya existen y
-- las políticas ya envueltas se omiten).
--
-- Qué NO hace: no borra índices. Los "sin uso" (30) lo están porque la base es
-- diminuta; los redundantes por prefijo para revisar tras 2-4 semanas de uso
-- real, SIN tocarlos aquí: idx_contacts_workspace (cubierto por
-- idx_contacts_last_interaction), idx_conversations_workspace frente a
-- idx_conversations_status, idx_cases_next_action frente al parcial
-- idx_cases_next_action_pending e idx_comment_logs_channel_id frente al único
-- (channel_id, platform_comment_id).
--
-- Bloqueos y duración: CREATE INDEX (sin CONCURRENTLY, porque se ejecuta en una
-- transacción) toma un bloqueo que ESPERA a las escrituras en curso y bloquea
-- las nuevas escrituras de esa tabla mientras se construye (las lecturas
-- siguen). Con tablas de miles de filas cada índice tarda milisegundos; el
-- conjunto completo, del orden de 1-5 s. ALTER POLICY toma un bloqueo breve
-- sobre cada tabla. Aplicada como UNA transacción (apply_migration o el editor
-- SQL de Supabase) lleva lock_timeout = 10 s: si una transacción larga lo
-- impidiera, falla sin dejar nada a medias en vez de colgar la aplicación, y
-- basta con volver a ejecutarla. Si en el futuro hubiera tablas con millones de
-- filas, crear estos índices a mano con CONCURRENTLY.
--
-- Orden de despliegue: independiente del código (no cambia ninguna consulta ni
-- función). Se puede aplicar antes o después de desplegar; lo recomendable es
-- aplicarla en una hora de poco tráfico.

set local lock_timeout = '10s';

-- ============================================================
-- 1. Índices de claves foráneas y consultas frecuentes (BD-6)
-- ============================================================

-- El más importante: conversaciones de un contacto (Bandeja, Gestiones, Métricas, borrado en cascada).
create index if not exists idx_conversations_contact
  on public.conversations (contact_id);

-- Cron de secuencias (cada minuto): solo las inscripciones activas, por fecha del próximo paso.
create index if not exists idx_sequence_enrollments_due
  on public.sequence_enrollments (next_step_at)
  where status = 'active';

-- Borrado de contacto (cascada) y consultas por contacto.
create index if not exists idx_sequence_enrollments_contact
  on public.sequence_enrollments (contact_id);
create index if not exists idx_analytics_events_contact
  on public.analytics_events (contact_id);
create index if not exists idx_broadcast_recipients_contact
  on public.broadcast_recipients (contact_id);
-- El que existe (idx_flow_sessions_contact_active) es parcial: status = 'active'.
create index if not exists idx_flow_sessions_contact
  on public.flow_sessions (contact_id);
-- Borrar un flujo / analítica por flujo.
create index if not exists idx_flow_sessions_flow
  on public.flow_sessions (flow_id);
-- La clave primaria de contact_tags empieza por contact_id: faltaba por etiqueta (filtrar y borrar etiquetas).
create index if not exists idx_contact_tags_tag
  on public.contact_tags (tag_id);

-- Historial de actividad por conversación y por autor.
create index if not exists idx_activity_conversation
  on public.activity (conversation_id);
create index if not exists idx_activity_actor
  on public.activity (actor_id);

-- Autor del mensaje (al borrar un usuario se pone en null).
create index if not exists idx_messages_sent_by_user
  on public.messages (sent_by_user_id);

-- Quién creó / cerró / resolvió una gestión (al borrar un usuario se pone en null).
create index if not exists idx_cases_created_by
  on public.cases (created_by);
create index if not exists idx_cases_closed_by
  on public.cases (closed_by);
create index if not exists idx_cases_solution_by
  on public.cases (solution_by);

-- ============================================================
-- 2. Búsqueda de texto con ilike '%texto%' en contactos (BD-6)
-- ============================================================

do $$
declare
  v_schema text;
begin
  -- Si ya está instalada se respeta su esquema; si no, `extensions` (Supabase) o `public`.
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if v_schema is null then
    v_schema := case when exists (select 1 from pg_namespace where nspname = 'extensions')
                     then 'extensions' else 'public' end;
    execute format('create extension if not exists pg_trgm with schema %I', v_schema);
  end if;

  execute format(
    'create index if not exists idx_contacts_display_name_trgm on public.contacts using gin (display_name %I.gin_trgm_ops)',
    v_schema);
  execute format(
    'create index if not exists idx_contacts_email_trgm on public.contacts using gin (email %I.gin_trgm_ops)',
    v_schema);
  execute format(
    'create index if not exists idx_contacts_phone_trgm on public.contacts using gin (phone %I.gin_trgm_ops)',
    v_schema);
end $$;

-- ============================================================
-- 3. Políticas RLS: auth.uid() -> (select auth.uid()) (BD-5)
-- ============================================================

do $$
declare
  -- Las 11 políticas que el asesor de rendimiento marcó (auth_rls_initplan).
  v_expected constant text[] := array[
    'workspace_members.workspace_members_select',
    'workspace_members.workspace_members_update',
    'workspace_members.workspace_members_delete',
    'case_notes.case_notes_insert',
    'notifications.notifications_select',
    'notifications.notifications_update',
    'saved_replies.saved_replies_select',
    'saved_replies.saved_replies_insert',
    'saved_replies.saved_replies_update',
    'saved_replies.saved_replies_delete',
    'spell_words.spell_words_insert'
  ];
  -- Texto de la expresión ya envuelta, tal como lo devuelve Postgres.
  c_wrapped constant text := '( SELECT auth.uid() AS uid)';
  c_mark constant text := '@@UID_ENVUELTO@@';
  r record;
  v_n int;
  v_qual text;
  v_check text;
  v_sql text;
  v_changed int := 0;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
begin
  -- Comprobación previa: exactamente las 11 esperadas.
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and (tablename || '.' || policyname) = any (v_expected);
  if v_n <> 11 then
    raise exception '00042: se esperaban 11 políticas y hay % (revisar a mano antes de continuar)', v_n;
  end if;

  -- Estado "antes": orden, tipo, roles y texto normalizado (sin el envoltorio).
  select coalesce(jsonb_agg(jsonb_build_object(
           'p', tablename || '.' || policyname,
           'cmd', cmd,
           'permissive', permissive,
           'roles', roles::text,
           'qual', replace(coalesce(qual, ''), c_wrapped, 'auth.uid()'),
           'chk', replace(coalesce(with_check, ''), c_wrapped, 'auth.uid()'))
         order by tablename, policyname), '[]'::jsonb)
    into v_before
  from pg_policies
  where schemaname = 'public' and (tablename || '.' || policyname) = any (v_expected);

  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public' and (tablename || '.' || policyname) = any (v_expected)
    order by tablename, policyname
  loop
    -- Se protegen los ya envueltos (idempotencia) y se envuelven los sueltos.
    v_qual := replace(replace(replace(coalesce(r.qual, ''), c_wrapped, c_mark),
                      'auth.uid()', '(select auth.uid())'), c_mark, c_wrapped);
    v_check := replace(replace(replace(coalesce(r.with_check, ''), c_wrapped, c_mark),
                       'auth.uid()', '(select auth.uid())'), c_mark, c_wrapped);

    if v_qual = coalesce(r.qual, '') and v_check = coalesce(r.with_check, '') then
      continue; -- ya estaba envuelta
    end if;

    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then
      v_sql := v_sql || ' using (' || v_qual || ')';
    end if;
    if r.with_check is not null then
      v_sql := v_sql || ' with check (' || v_check || ')';
    end if;
    execute v_sql;
    v_changed := v_changed + 1;
  end loop;

  -- Comprobación final: mismo número, mismas órdenes/roles, mismo texto esencial, sin auth.uid() suelto.
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and (tablename || '.' || policyname) = any (v_expected);
  if v_n <> 11 then
    raise exception '00042: tras el cambio hay % políticas y se esperaban 11; se revierte todo', v_n;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'p', tablename || '.' || policyname,
           'cmd', cmd,
           'permissive', permissive,
           'roles', roles::text,
           'qual', replace(coalesce(qual, ''), c_wrapped, 'auth.uid()'),
           'chk', replace(coalesce(with_check, ''), c_wrapped, 'auth.uid()'))
         order by tablename, policyname), '[]'::jsonb)
    into v_after
  from pg_policies
  where schemaname = 'public' and (tablename || '.' || policyname) = any (v_expected);

  if v_after is distinct from v_before then
    raise exception '00042: el texto, la orden o los roles de alguna política cambiaron; se revierte todo';
  end if;

  select count(*) into v_n
  from pg_policies
  where schemaname = 'public'
    and (tablename || '.' || policyname) = any (v_expected)
    and (replace(coalesce(qual, ''), c_wrapped, '') like '%auth.uid()%'
         or replace(coalesce(with_check, ''), c_wrapped, '') like '%auth.uid()%');
  if v_n <> 0 then
    raise exception '00042: % políticas aún tienen auth.uid() sin envolver; se revierte todo', v_n;
  end if;

  raise notice '00042: % políticas reescritas con (select auth.uid())', v_changed;
end $$;
