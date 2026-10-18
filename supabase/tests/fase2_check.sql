-- Prueba de la migración 00021 (docs/FASE-2-TECNICO.md 1).
--
-- Cómo usarla: aplicar antes la migración 00021 y pegar este archivo completo
-- en el editor SQL de Supabase (rol postgres). Es un único bloque DO que
-- termina SIEMPRE con RAISE EXCEPTION, así que Postgres revierte todo: no
-- quedan usuarios, espacios, feriados ni gestiones de prueba. Se puede
-- ejecutar en producción.
--
-- El resultado llega como mensaje de error:
--   RESULTADO: N comprobaciones, 0 fallos. TODO OK
-- o la lista de fallos con lo esperado y lo obtenido.
--
-- Comprueba:
--   - holidays e import_batches: los miembros leen, solo el Administrador
--     escribe; único por (espacio, equipo, fecha); el equipo es del espacio.
--   - triggers.type acepta los tres eventos de gestión y rechaza otros.
--   - horarios válidos e inválidos (función y checks de teams y settings).
--   - columnas nuevas de teams, case_types y cases.
--   - assigned_at sigue al responsable.
--   - cases_pending_no_reply devuelve solo las gestiones esperadas.

do $$
declare
  v_ws uuid := gen_random_uuid();
  v_ws2 uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  u_agent uuid := gen_random_uuid();
  v_team uuid := gen_random_uuid();
  v_team2 uuid := gen_random_uuid();
  v_flow uuid := gen_random_uuid();
  v_contact uuid := gen_random_uuid();
  v_contact2 uuid := gen_random_uuid();
  v_case uuid := gen_random_uuid();
  v_case2 uuid := gen_random_uuid();
  v_holiday uuid;
  v_inviter uuid;
  v_user record;
  v_state text;
  v_text text;
  v_bool boolean;
  n integer;
  v_total integer := 0;
  v_fail integer := 0;
  v_errors text := '';
begin
  -- ----------------------------------------------------------------
  -- Usuarios de prueba (handle_new_user rechaza registros sin invitación:
  -- primero se crean invitaciones pendientes, que también se revierten).
  -- ----------------------------------------------------------------
  select u.id into v_inviter from auth.users u order by u.created_at limit 1;
  if v_inviter is null then
    raise exception 'La base no tiene usuarios en auth.users; esta prueba necesita al menos uno para firmar las invitaciones.';
  end if;

  insert into public.workspaces (id, name, slug) values
    (v_ws, 'Prueba fase 2', 'prueba-f2-' || substr(v_ws::text, 1, 8)),
    (v_ws2, 'Prueba fase 2 ajeno', 'prueba-f2-' || substr(v_ws2::text, 1, 8));

  for v_user in
    select * from (values (u_admin, 'admin'), (u_agent, 'asesor')) as x(id, tag)
  loop
    insert into public.workspace_invites (workspace_id, email, role, invited_by, status)
    values (v_ws, format('f2-%s-%s@fase2.invalid', v_user.tag, substr(v_user.id::text, 1, 8)),
            'member', v_inviter, 'pending');

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user.id, 'authenticated', 'authenticated',
      format('f2-%s-%s@fase2.invalid', v_user.tag, substr(v_user.id::text, 1, 8)), '', now(),
      '{}'::jsonb, jsonb_build_object('full_name', 'Prueba ' || v_user.tag), now(), now()
    );
  end loop;

  insert into public.workspace_members (workspace_id, user_id, role) values
    (v_ws, u_admin, 'admin'),
    (v_ws, u_agent, 'member');

  insert into public.teams (id, workspace_id, name) values
    (v_team, v_ws, 'Sede A'),
    (v_team2, v_ws2, 'Sede ajena');

  insert into public.flows (id, workspace_id, name) values (v_flow, v_ws, 'Flujo de prueba');

  insert into public.contacts (id, workspace_id, display_name) values
    (v_contact, v_ws, 'Contacto 1'),
    (v_contact2, v_ws, 'Contacto 2');

  -- ----------------------------------------------------------------
  -- 1. Columnas y tablas nuevas
  -- ----------------------------------------------------------------
  for v_user in
    select * from (values
      ('teams', 'business_hours'),
      ('case_types', 'auto_template'),
      ('cases', 'off_hours_reply_sent_at'),
      ('cases', 'auto_template_sent_at'),
      ('cases', 'reassigned_count'),
      ('cases', 'assigned_at'),
      ('cases', 'wait_alerted_at'),
      ('cases', 'no_reply_event_outbound_at'),
      ('cases', 'no_reply_event_minutes'),
      ('holidays', 'id'), ('holidays', 'workspace_id'), ('holidays', 'team_id'),
      ('holidays', 'date'), ('holidays', 'name'), ('holidays', 'created_at'),
      ('import_batches', 'id'), ('import_batches', 'workspace_id'), ('import_batches', 'created_by'),
      ('import_batches', 'file_name'), ('import_batches', 'total'), ('import_batches', 'created'),
      ('import_batches', 'updated'), ('import_batches', 'skipped'), ('import_batches', 'errors'),
      ('import_batches', 'options'), ('import_batches', 'created_at')
    ) as x(tbl, col)
  loop
    v_total := v_total + 1;
    select count(*) into n from information_schema.columns
      where table_schema = 'public' and table_name = v_user.tbl and column_name = v_user.col;
    if n <> 1 then
      v_fail := v_fail + 1;
      v_errors := v_errors || format(E'\n- falta la columna %s.%s', v_user.tbl, v_user.col);
    end if;
  end loop;

  v_total := v_total + 1;
  insert into public.cases (id, workspace_id, contact_id, status, opened_at)
    values (v_case, v_ws, v_contact, 'open', now());
  select reassigned_count::text into v_text from public.cases where id = v_case;
  if v_text is distinct from '0' then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- reassigned_count por defecto: esperado 0, obtuvo %s', v_text);
  end if;

  -- ----------------------------------------------------------------
  -- 2. Formato de horarios
  -- ----------------------------------------------------------------
  for v_user in
    select * from (values
      ('null', null::jsonb, true),
      ('json null', 'null'::jsonb, true),
      ('vacío', '{}'::jsonb, true),
      ('partido', '{"mon":[["09:00","13:00"],["14:00","19:00"]],"sun":[]}'::jsonb, true),
      ('hasta 24:00', '{"tue":[["08:00","24:00"]]}'::jsonb, true),
      ('cruza medianoche', '{"fri":[["22:00","02:00"]]}'::jsonb, true),
      ('día desconocido', '{"lunes":[["09:00","13:00"]]}'::jsonb, false),
      ('hora mal escrita', '{"mon":[["9:00","13:00"]]}'::jsonb, false),
      ('inicio 24:00', '{"mon":[["24:00","23:00"]]}'::jsonb, false),
      ('inicio igual al fin', '{"mon":[["09:00","09:00"]]}'::jsonb, false),
      ('tramo con tres valores', '{"mon":[["09:00","13:00","14:00"]]}'::jsonb, false),
      ('día no es arreglo', '{"mon":"09:00-13:00"}'::jsonb, false),
      ('no es objeto', '[["09:00","13:00"]]'::jsonb, false),
      ('siete tramos', '{"mon":[["01:00","02:00"],["03:00","04:00"],["05:00","06:00"],["07:00","08:00"],["09:00","10:00"],["11:00","12:00"],["13:00","14:00"]]}'::jsonb, false)
    ) as x(caso, hours, expected)
  loop
    v_total := v_total + 1;
    v_bool := public.is_valid_business_hours(v_user.hours);
    if v_bool is distinct from v_user.expected then
      v_fail := v_fail + 1;
      v_errors := v_errors || format(E'\n- is_valid_business_hours(%s): esperado %s, obtuvo %s',
        v_user.caso, v_user.expected, v_bool);
    end if;
  end loop;

  -- El equipo acepta un horario válido y rechaza uno inválido.
  v_total := v_total + 2;
  begin
    update public.teams set business_hours = '{"mon":[["09:00","18:00"]]}'::jsonb where id = v_team;
  exception when others then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- teams.business_hours válido rechazado (%s)', sqlstate);
  end;
  v_state := null;
  begin
    update public.teams set business_hours = '{"mon":[["25:00","18:00"]]}'::jsonb where id = v_team;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '23514' then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- teams.business_hours inválido: esperado 23514, obtuvo %s', coalesce(v_state, 'sin error'));
  end if;

  -- workspaces.settings valida el horario y conserva las claves anteriores.
  v_total := v_total + 3;
  begin
    update public.workspaces
      set settings = jsonb_build_object(
        'assignment_mode', 'least_load',
        'business_hours', '{"mon":[["09:00","19:00"]]}'::jsonb,
        'off_hours_reply', jsonb_build_object('enabled', true, 'text', 'Hola', 'min_hours_between', null),
        'reassign_after_minutes', 30)
      where id = v_ws;
  exception when others then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- settings con horario, respuesta fuera de horario y reasignación rechazado (%s)', sqlstate);
  end;
  v_state := null;
  begin
    update public.workspaces set settings = jsonb_build_object('business_hours', '{"mon":"x"}'::jsonb) where id = v_ws;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '23514' then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- settings.business_hours inválido: esperado 23514, obtuvo %s', coalesce(v_state, 'sin error'));
  end if;
  v_state := null;
  begin
    update public.workspaces set settings = jsonb_build_object('assignment_mode', 'azar') where id = v_ws;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '23514' then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- settings.assignment_mode inválido: esperado 23514, obtuvo %s', coalesce(v_state, 'sin error'));
  end if;

  -- ----------------------------------------------------------------
  -- 3. Disparadores de flujos (triggers.type)
  -- ----------------------------------------------------------------
  for v_user in
    select * from (values
      ('case_stage_changed', true), ('case_closed', true), ('client_no_reply', true),
      ('keyword', true), ('comment_keyword', true),
      ('case_deleted', false), ('', false)
    ) as x(tp, ok)
  loop
    v_total := v_total + 1;
    v_state := null;
    begin
      insert into public.triggers (flow_id, type, config) values (v_flow, v_user.tp, '{}'::jsonb);
    exception when others then
      v_state := sqlstate;
    end;
    if v_user.ok and v_state is not null then
      v_fail := v_fail + 1;
      v_errors := v_errors || format(E'\n- triggers.type ''%s'' debería aceptarse (error %s)', v_user.tp, v_state);
    elsif not v_user.ok and v_state is distinct from '23514' then
      v_fail := v_fail + 1;
      v_errors := v_errors || format(E'\n- triggers.type ''%s'' debería rechazarse (obtuvo %s)', v_user.tp, coalesce(v_state, 'sin error'));
    end if;
  end loop;

  -- ----------------------------------------------------------------
  -- 4. assigned_at sigue al responsable
  -- ----------------------------------------------------------------
  v_total := v_total + 1;
  select (assigned_at is null)::text into v_text from public.cases where id = v_case;
  if v_text <> 'true' then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- assigned_at debería ser null sin responsable';
  end if;

  update public.cases set assignee_id = u_agent where id = v_case;
  v_total := v_total + 1;
  select (assigned_at is not null)::text into v_text from public.cases where id = v_case;
  if v_text <> 'true' then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- assigned_at debería sellarse al asignar';
  end if;

  update public.cases set assignee_id = null where id = v_case;
  v_total := v_total + 1;
  select (assigned_at is null)::text into v_text from public.cases where id = v_case;
  if v_text <> 'true' then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- assigned_at debería limpiarse al quitar el responsable';
  end if;

  insert into public.cases (id, workspace_id, contact_id, status, opened_at, assignee_id)
    values (v_case2, v_ws, v_contact2, 'open', now(), u_agent);
  v_total := v_total + 1;
  select (assigned_at is not null)::text into v_text from public.cases where id = v_case2;
  if v_text <> 'true' then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- assigned_at debería sellarse al crear la gestión ya asignada';
  end if;

  -- ----------------------------------------------------------------
  -- 5. cases_pending_no_reply
  -- ----------------------------------------------------------------
  -- Gestión 1: saliente hace 3 h, sin entrante, sin espera → candidata.
  update public.cases
    set last_outbound_at = now() - interval '3 hours', last_inbound_at = null, waiting_since = null,
        no_reply_event_outbound_at = null, no_reply_event_minutes = null
    where id = v_case;
  -- Gestión 2: el cliente escribió después de la saliente → no es candidata.
  update public.cases
    set last_outbound_at = now() - interval '3 hours', last_inbound_at = now() - interval '1 hour',
        waiting_since = now() - interval '1 hour'
    where id = v_case2;

  v_total := v_total + 1;
  select string_agg(p.id::text, ',') into v_text
    from public.cases_pending_no_reply(v_ws, now() - interval '60 minutes', 240, null, 10) p;
  if v_text is distinct from v_case::text then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- cases_pending_no_reply: esperado solo la gestión 1, obtuvo %s', coalesce(v_text, 'nada'));
  end if;

  -- Aún no pasan los minutos del umbral más bajo → ninguna.
  v_total := v_total + 1;
  select count(*) into n from public.cases_pending_no_reply(v_ws, now() - interval '5 hours', 240, null, 10);
  if n <> 0 then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- cases_pending_no_reply con la saliente más nueva que el corte: esperado 0, obtuvo %s', n);
  end if;

  -- Evento emitido para ese mensaje con el umbral máximo → ya no vuelve.
  update public.cases
    set no_reply_event_outbound_at = last_outbound_at, no_reply_event_minutes = 240
    where id = v_case;
  v_total := v_total + 1;
  select count(*) into n from public.cases_pending_no_reply(v_ws, now() - interval '60 minutes', 240, null, 10);
  if n <> 0 then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- cases_pending_no_reply no debe repetir el umbral máximo ya emitido (obtuvo %s)', n);
  end if;

  -- Con un umbral mayor todavía pendiente, vuelve.
  v_total := v_total + 1;
  select count(*) into n from public.cases_pending_no_reply(v_ws, now() - interval '60 minutes', 480, null, 10);
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- cases_pending_no_reply con un umbral mayor pendiente: esperado 1, obtuvo %s', n);
  end if;

  -- Un mensaje saliente nuevo reinicia la cuenta.
  update public.cases set last_outbound_at = now() - interval '2 hours' where id = v_case;
  v_total := v_total + 1;
  select count(*) into n from public.cases_pending_no_reply(v_ws, now() - interval '60 minutes', 240, null, 10);
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- cases_pending_no_reply tras un saliente nuevo: esperado 1, obtuvo %s', n);
  end if;

  -- Solo service_role ejecuta la función.
  v_total := v_total + 1;
  select has_function_privilege('authenticated', 'public.cases_pending_no_reply(uuid, timestamptz, integer, uuid, integer)', 'execute')
    into v_bool;
  if v_bool then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- authenticated puede ejecutar cases_pending_no_reply';
  end if;

  -- ----------------------------------------------------------------
  -- 6. Feriados e importaciones: permisos por rol
  -- ----------------------------------------------------------------
  insert into public.holidays (workspace_id, team_id, date, name)
    values (v_ws, null, date '2026-12-25', 'Navidad')
    returning id into v_holiday;
  insert into public.import_batches (workspace_id, created_by, file_name, total)
    values (v_ws, u_admin, 'socios.csv', 10);

  -- Único por (espacio, equipo, fecha), con null contado como igual.
  v_total := v_total + 2;
  v_state := null;
  begin
    insert into public.holidays (workspace_id, team_id, date, name) values (v_ws, null, date '2026-12-25', 'Navidad otra vez');
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '23505' then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- feriado de empresa duplicado: esperado 23505, obtuvo %s', coalesce(v_state, 'sin error'));
  end if;
  -- Mismo día para un equipo sí se permite.
  begin
    insert into public.holidays (workspace_id, team_id, date, name) values (v_ws, v_team, date '2026-12-25', 'Navidad sede');
  exception when others then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- el mismo feriado para un equipo se rechazó (%s)', sqlstate);
  end;

  -- El equipo debe ser del mismo espacio.
  v_total := v_total + 1;
  v_state := null;
  begin
    insert into public.holidays (workspace_id, team_id, date, name) values (v_ws, v_team2, date '2026-12-26', 'Equipo ajeno');
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '23514' then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- feriado con equipo de otro espacio: esperado 23514, obtuvo %s', coalesce(v_state, 'sin error'));
  end if;

  -- Asesor: lee, no escribe.
  perform set_config('request.jwt.claim.sub', u_agent::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_total := v_total + 1;
  execute 'select count(*) from public.holidays where workspace_id = $1' into n using v_ws;
  if n <> 2 then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- el asesor ve %s feriados (esperado 2)', n);
  end if;

  v_total := v_total + 1;
  execute 'select count(*) from public.import_batches where workspace_id = $1' into n using v_ws;
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- el asesor ve %s importaciones (esperado 1)', n);
  end if;

  v_total := v_total + 1;
  v_state := null;
  begin
    execute 'insert into public.holidays (workspace_id, team_id, date, name) values ($1, null, date ''2026-07-28'', ''Fiestas Patrias'')' using v_ws;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- el asesor insertó un feriado (esperado 42501, obtuvo %s)', coalesce(v_state, 'sin error'));
  end if;

  v_total := v_total + 2;
  execute 'update public.holidays set name = ''Cambiado'' where id = $1' using v_holiday;
  get diagnostics n = row_count;
  if n <> 0 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- el asesor modificó un feriado';
  end if;
  execute 'delete from public.holidays where id = $1' using v_holiday;
  get diagnostics n = row_count;
  if n <> 0 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- el asesor borró un feriado';
  end if;

  v_total := v_total + 2;
  v_state := null;
  begin
    execute 'insert into public.import_batches (workspace_id, created_by, file_name) values ($1, $2, ''x.csv'')' using v_ws, u_agent;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- el asesor insertó una importación (esperado 42501, obtuvo %s)', coalesce(v_state, 'sin error'));
  end if;
  execute 'update public.import_batches set total = 99 where workspace_id = $1' using v_ws;
  get diagnostics n = row_count;
  if n <> 0 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- el asesor modificó una importación';
  end if;

  -- Los equipos y tipos siguen sin dejarle escribir horarios ni plantilla.
  v_total := v_total + 1;
  execute 'update public.teams set business_hours = null where id = $1' using v_team;
  get diagnostics n = row_count;
  if n <> 0 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- el asesor modificó el horario de un equipo';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  -- Administrador: escribe.
  perform set_config('request.jwt.claim.sub', u_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_total := v_total + 1;
  v_state := null;
  begin
    execute 'insert into public.holidays (workspace_id, team_id, date, name) values ($1, null, date ''2026-07-28'', ''Fiestas Patrias'')' using v_ws;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is not null then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- el Administrador no pudo insertar un feriado (error %s)', v_state);
  end if;

  v_total := v_total + 2;
  execute 'update public.holidays set name = ''Navidad (editado)'' where id = $1' using v_holiday;
  get diagnostics n = row_count;
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- el Administrador no pudo modificar un feriado';
  end if;
  execute 'select count(*) from public.holidays where workspace_id = $1' into n using v_ws;
  if n <> 3 then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- el Administrador ve %s feriados (esperado 3)', n);
  end if;

  v_total := v_total + 1;
  v_state := null;
  begin
    execute 'insert into public.import_batches (workspace_id, created_by, file_name, total, created) values ($1, $2, ''nuevo.csv'', 5, 5)' using v_ws, u_admin;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is not null then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- el Administrador no pudo insertar una importación (error %s)', v_state);
  end if;

  v_total := v_total + 1;
  execute 'update public.teams set business_hours = ''{"sat":[["09:00","13:00"]]}''::jsonb where id = $1' using v_team;
  get diagnostics n = row_count;
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- el Administrador no pudo modificar el horario de un equipo';
  end if;

  v_total := v_total + 1;
  execute 'delete from public.holidays where id = $1' using v_holiday;
  get diagnostics n = row_count;
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- el Administrador no pudo borrar un feriado';
  end if;

  -- No toca los feriados de otro espacio.
  v_total := v_total + 1;
  execute 'reset role';
  insert into public.holidays (workspace_id, team_id, date, name) values (v_ws2, null, date '2026-12-25', 'Ajeno');
  perform set_config('request.jwt.claim.sub', u_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select count(*) from public.holidays where workspace_id = $1' into n using v_ws2;
  execute 'reset role';
  if n <> 0 then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- el Administrador ve %s feriados de otro espacio (esperado 0)', n);
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  -- ----------------------------------------------------------------
  -- Resultado (y reversión de todo)
  -- ----------------------------------------------------------------
  raise exception 'RESULTADO: % comprobaciones, % fallos.%', v_total, v_fail,
    case when v_fail = 0 then ' TODO OK (todo se revirtió).' else v_errors end;
end;
$$;
