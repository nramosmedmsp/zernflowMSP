-- Prueba de permisos de la fase 1 (docs/FASE-1-TECNICO.md 2.1 y 2.2).
--
-- Cómo usarla: aplicar antes la migración 00019 y pegar este archivo completo
-- en el editor SQL de Supabase (rol postgres). Es un único bloque DO que
-- termina SIEMPRE con RAISE EXCEPTION, así que Postgres revierte todo: no
-- quedan usuarios, espacios, contactos ni cambios de configuración. Se puede
-- ejecutar en producción.
--
-- El resultado llega como mensaje de error:
--   RESULTADO: N comprobaciones, 0 fallos. TODO OK
-- o la lista de fallos con lo esperado y lo obtenido.
--
-- Escenario (espacio con equipos A y B):
--   Dueño, Administrador, supA (supervisor de A), agA (asesor de A),
--   agB (asesor de B).
--   Contactos (equipo del contacto / gestiones):
--     A1  A  abierta asignada a agA (equipo A)
--     A2  A  abierta sin asignar (equipo A)
--     A3  A  sin gestiones
--     B1  B  abierta asignada a agB (equipo B)
--     B2  B  responsable (owner_id) = agA, sin gestiones
--     B3  B  ganada (cerrada) asignada a agA
--     B4  B  programada asignada a agA
--     F1  B  abierta sin asignar enviada al equipo A (destino fijo)
--     N1  -  abierta sin asignar sin equipo
-- Segundo espacio sin equipos, con agA como miembro:
--     X1  abierta asignada a agA, X2 abierta sin asignar, X3 sin gestiones.

do $$
declare
  v_ws uuid := gen_random_uuid();
  v_ws2 uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  u_sup_a uuid := gen_random_uuid();
  u_ag_a uuid := gen_random_uuid();
  u_ag_b uuid := gen_random_uuid();
  v_team_a uuid := gen_random_uuid();
  v_team_b uuid := gen_random_uuid();
  v_channel uuid := gen_random_uuid();
  v_channel2 uuid := gen_random_uuid();
  v_case_type uuid := gen_random_uuid();
  c_a1 uuid := gen_random_uuid();
  c_a2 uuid := gen_random_uuid();
  c_a3 uuid := gen_random_uuid();
  c_b1 uuid := gen_random_uuid();
  c_b2 uuid := gen_random_uuid();
  c_b3 uuid := gen_random_uuid();
  c_b4 uuid := gen_random_uuid();
  c_f1 uuid := gen_random_uuid();
  c_n1 uuid := gen_random_uuid();
  c_x1 uuid := gen_random_uuid();
  c_x2 uuid := gen_random_uuid();
  c_x3 uuid := gen_random_uuid();
  k_a1 uuid := gen_random_uuid();
  k_b1 uuid := gen_random_uuid();
  v_inviter uuid;
  v_conv_b1 uuid;
  v_user record;
  v_mode text;
  r record;
  v_got text;
  v_got_conv text;
  v_got_cases text;
  n integer;
  v_total integer := 0;
  v_fail integer := 0;
  v_errors text := '';
  v_all_contacts constant text := 'A1,A2,A3,B1,B2,B3,B4,F1,N1';
  v_all_cases constant text := 'A1,A2,B1,B3,B4,F1,N1';
begin
  -- ----------------------------------------------------------------
  -- Usuarios de prueba. handle_new_user (00017) rechaza registros sin
  -- invitación, así que primero se crean invitaciones pendientes.
  -- ----------------------------------------------------------------
  -- workspace_invites.invited_by exige un usuario existente: se usa el más
  -- antiguo de la base (solo para firmar las invitaciones, que se revierten).
  select u.id into v_inviter from auth.users u order by u.created_at limit 1;
  if v_inviter is null then
    raise exception 'La base no tiene usuarios en auth.users; esta prueba necesita al menos uno para firmar las invitaciones.';
  end if;

  insert into public.workspaces (id, name, slug) values
    (v_ws, 'Prueba RLS fase 1', 'prueba-rls-' || substr(v_ws::text, 1, 8)),
    (v_ws2, 'Prueba RLS sin equipos', 'prueba-rls-' || substr(v_ws2::text, 1, 8));

  for v_user in
    select * from (values
      (u_owner, 'dueno'), (u_admin, 'admin'), (u_sup_a, 'supa'), (u_ag_a, 'aga'), (u_ag_b, 'agb')
    ) as x(id, tag)
  loop
    insert into public.workspace_invites (workspace_id, email, role, invited_by, status)
    values (v_ws, format('rls-%s-%s@fase1.invalid', v_user.tag, substr(v_user.id::text, 1, 8)),
            'member', v_inviter, 'pending');

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user.id, 'authenticated', 'authenticated',
      format('rls-%s-%s@fase1.invalid', v_user.tag, substr(v_user.id::text, 1, 8)), '', now(),
      '{}'::jsonb, jsonb_build_object('full_name', 'Prueba ' || v_user.tag), now(), now()
    );
  end loop;

  insert into public.workspace_members (workspace_id, user_id, role) values
    (v_ws, u_owner, 'owner'),
    (v_ws, u_admin, 'admin'),
    (v_ws, u_sup_a, 'member'),
    (v_ws, u_ag_a, 'member'),
    (v_ws, u_ag_b, 'member'),
    (v_ws2, u_ag_a, 'member');

  insert into public.teams (id, workspace_id, name) values
    (v_team_a, v_ws, 'Equipo A'),
    (v_team_b, v_ws, 'Equipo B');

  insert into public.team_members (team_id, user_id, role) values
    (v_team_a, u_sup_a, 'supervisor'),
    (v_team_a, u_ag_a, 'agent'),
    (v_team_b, u_ag_b, 'agent');

  insert into public.channels (id, workspace_id, platform, late_account_id) values
    (v_channel, v_ws, 'whatsapp', 'rls-' || v_channel::text),
    (v_channel2, v_ws2, 'whatsapp', 'rls-' || v_channel2::text);

  insert into public.contacts (id, workspace_id, display_name, team_id, owner_id) values
    (c_a1, v_ws, 'A1', v_team_a, null),
    (c_a2, v_ws, 'A2', v_team_a, null),
    (c_a3, v_ws, 'A3', v_team_a, null),
    (c_b1, v_ws, 'B1', v_team_b, null),
    (c_b2, v_ws, 'B2', v_team_b, u_ag_a),
    (c_b3, v_ws, 'B3', v_team_b, null),
    (c_b4, v_ws, 'B4', v_team_b, null),
    (c_f1, v_ws, 'F1', v_team_b, null),
    (c_n1, v_ws, 'N1', null, null),
    (c_x1, v_ws2, 'X1', null, null),
    (c_x2, v_ws2, 'X2', null, null),
    (c_x3, v_ws2, 'X3', null, null);

  -- Una conversación por contacto; la vista previa lleva la etiqueta.
  insert into public.conversations (workspace_id, channel_id, contact_id, platform, last_message_preview)
  select c.workspace_id,
         case when c.workspace_id = v_ws then v_channel else v_channel2 end,
         c.id, 'whatsapp', c.display_name
  from public.contacts c
  where c.workspace_id in (v_ws, v_ws2);

  -- Gestiones; next_action_note lleva la etiqueta del contacto.
  insert into public.cases (id, workspace_id, contact_id, status, team_id, assignee_id, origin,
                            scheduled_for, opened_at, closed_at, next_action_note) values
    (k_a1, v_ws, c_a1, 'open', v_team_a, u_ag_a, 'inbound', null, now(), null, 'A1'),
    (default, v_ws, c_a2, 'open', v_team_a, null, 'inbound', null, now(), null, 'A2'),
    (k_b1, v_ws, c_b1, 'open', v_team_b, u_ag_b, 'inbound', null, now(), null, 'B1'),
    (default, v_ws, c_b3, 'won', v_team_b, u_ag_a, 'inbound', null, now(), now(), 'B3'),
    (default, v_ws, c_b4, 'scheduled', v_team_b, u_ag_a, 'proactive', now() + interval '1 day', null, null, 'B4'),
    (default, v_ws, c_f1, 'open', v_team_a, null, 'inbound', null, now(), null, 'F1'),
    (default, v_ws, c_n1, 'open', null, null, 'inbound', null, now(), null, 'N1'),
    (default, v_ws2, c_x1, 'open', null, u_ag_a, 'inbound', null, now(), null, 'X1'),
    (default, v_ws2, c_x2, 'open', null, null, 'inbound', null, now(), null, 'X2');

  insert into public.case_types (id, workspace_id, name) values (v_case_type, v_ws, 'Venta');

  insert into public.workspace_secrets (workspace_id, late_api_key)
  values (v_ws, 'clave-de-prueba')
  on conflict (workspace_id) do update set late_api_key = excluded.late_api_key;

  insert into public.notifications (workspace_id, user_id, type, title) values
    (v_ws, u_ag_a, 'test', 'Para agA'),
    (v_ws, u_ag_b, 'test', 'Para agB');

  insert into public.broadcasts (workspace_id, name) values (v_ws, 'Difusión de prueba');

  -- ----------------------------------------------------------------
  -- 1. Visibilidad de contactos, conversaciones y gestiones (2.1)
  -- ----------------------------------------------------------------
  foreach v_mode in array array['own', 'own_and_unassigned', 'team'] loop
    update public.workspaces
      set settings = jsonb_build_object('agent_visibility', v_mode)
      where id in (v_ws, v_ws2);

    for r in
      select * from (values
        ('*', 'Dueño', u_owner, v_ws, v_all_contacts, v_all_cases),
        ('*', 'Administrador', u_admin, v_ws, v_all_contacts, v_all_cases),
        ('*', 'supA', u_sup_a, v_ws, 'A1,A2,A3,F1', 'A1,A2,F1'),
        ('own', 'agA', u_ag_a, v_ws, 'A1,B2,B4', 'A1,B4'),
        ('own_and_unassigned', 'agA', u_ag_a, v_ws, 'A1,A2,B2,B4,F1', 'A1,A2,B4,F1'),
        ('team', 'agA', u_ag_a, v_ws, 'A1,A2,A3,B2,B4,F1', 'A1,A2,B4,F1'),
        ('own', 'agB', u_ag_b, v_ws, 'B1', 'B1'),
        ('own_and_unassigned', 'agB', u_ag_b, v_ws, 'B1', 'B1'),
        ('team', 'agB', u_ag_b, v_ws, 'B1,B2,B3,B4,F1', 'B1,B3,B4,F1'),
        ('own', 'agA sin equipos', u_ag_a, v_ws2, 'X1', 'X1'),
        ('own_and_unassigned', 'agA sin equipos', u_ag_a, v_ws2, 'X1,X2', 'X1,X2'),
        ('team', 'agA sin equipos', u_ag_a, v_ws2, 'X1,X2,X3', 'X1,X2'),
        -- agB no es miembro del segundo espacio: no ve nada.
        ('*', 'agB en espacio ajeno', u_ag_b, v_ws2, '', '')
      ) as x(mode, persona, uid, ws, exp_contacts, exp_cases)
      where x.mode = '*' or x.mode = v_mode
    loop
      perform set_config('request.jwt.claim.sub', r.uid::text, true);
      perform set_config('request.jwt.claims',
        json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';

      execute 'select coalesce(string_agg(display_name, '','' order by display_name), '''')
               from public.contacts where workspace_id = $1'
        into v_got using r.ws;
      execute 'select coalesce(string_agg(last_message_preview, '','' order by last_message_preview), '''')
               from public.conversations where workspace_id = $1'
        into v_got_conv using r.ws;
      execute 'select coalesce(string_agg(next_action_note, '','' order by next_action_note), '''')
               from public.cases where workspace_id = $1'
        into v_got_cases using r.ws;

      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '', true);

      v_total := v_total + 3;
      if v_got is distinct from r.exp_contacts then
        v_fail := v_fail + 1;
        v_errors := v_errors || format(E'\n- [%s] %s, contactos: esperado {%s}, obtuvo {%s}',
          v_mode, r.persona, r.exp_contacts, v_got);
      end if;
      if v_got_conv is distinct from r.exp_contacts then
        v_fail := v_fail + 1;
        v_errors := v_errors || format(E'\n- [%s] %s, conversaciones: esperado {%s}, obtuvo {%s}',
          v_mode, r.persona, r.exp_contacts, v_got_conv);
      end if;
      if v_got_cases is distinct from r.exp_cases then
        v_fail := v_fail + 1;
        v_errors := v_errors || format(E'\n- [%s] %s, gestiones: esperado {%s}, obtuvo {%s}',
          v_mode, r.persona, r.exp_cases, v_got_cases);
      end if;
    end loop;
  end loop;

  update public.workspaces set settings = jsonb_build_object('agent_visibility', 'own')
    where id in (v_ws, v_ws2);

  -- ----------------------------------------------------------------
  -- 2. Nadie lee workspace_secrets (ni el dueño con su sesión)
  -- ----------------------------------------------------------------
  v_total := v_total + 2;
  if has_table_privilege('authenticated', 'public.workspace_secrets', 'select')
     or has_table_privilege('anon', 'public.workspace_secrets', 'select') then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- anon o authenticated tienen SELECT sobre workspace_secrets';
  end if;
  if exists (
    select 1 from public.workspaces
    where late_api_key_encrypted is not null or ai_api_key is not null or webhook_secret is not null
  ) then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- quedan secretos en las columnas viejas de workspaces';
  end if;

  for r in
    select * from (values ('Dueño', u_owner), ('Administrador', u_admin), ('agA', u_ag_a))
      as x(persona, uid)
  loop
    v_total := v_total + 1;
    perform set_config('request.jwt.claim.sub', r.uid::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
    begin
      execute 'set local role authenticated';
      execute 'select count(*) from public.workspace_secrets' into n;
      v_fail := v_fail + 1;
      v_errors := v_errors || format(E'\n- %s pudo leer workspace_secrets (%s filas)', r.persona, n);
    exception when insufficient_privilege then
      null; -- esperado
    end;
    execute 'reset role';
  end loop;

  -- ----------------------------------------------------------------
  -- 3. Escrituras del asesor agA (modo 'own')
  -- ----------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', u_ag_a::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_ag_a, 'role', 'authenticated')::text, true);

  -- 3.1 No puede actualizar case_types (RLS filtra: 0 filas).
  v_total := v_total + 1;
  execute 'set local role authenticated';
  execute 'update public.case_types set name = ''Hackeado'' where id = $1' using v_case_type;
  get diagnostics n = row_count;
  execute 'reset role';
  if n <> 0 or (select name from public.case_types where id = v_case_type) <> 'Venta' then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA pudo actualizar case_types';
  end if;

  -- 3.2 No puede crear case_types.
  v_total := v_total + 1;
  begin
    execute 'set local role authenticated';
    execute 'insert into public.case_types (workspace_id, name) values ($1, ''Otro'')' using v_ws;
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA pudo crear case_types';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  -- 3.3 No puede crear contactos.
  v_total := v_total + 1;
  begin
    execute 'set local role authenticated';
    execute 'insert into public.contacts (workspace_id, display_name) values ($1, ''Z9'')' using v_ws;
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA pudo crear contactos';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  -- 3.4 No puede cambiarse el rol.
  v_total := v_total + 1;
  begin
    execute 'set local role authenticated';
    execute 'update public.workspace_members set role = ''admin'' where workspace_id = $1 and user_id = $2'
      using v_ws, u_ag_a;
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA pudo cambiarse el rol';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  -- 3.5 Sí puede cambiar su disponibilidad.
  v_total := v_total + 1;
  execute 'set local role authenticated';
  execute 'update public.workspace_members set availability = ''away'' where workspace_id = $1 and user_id = $2'
    using v_ws, u_ag_a;
  get diagnostics n = row_count;
  execute 'reset role';
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA no pudo cambiar su disponibilidad';
  end if;

  -- 3.6 No puede cambiar la disponibilidad de otro.
  v_total := v_total + 1;
  execute 'set local role authenticated';
  execute 'update public.workspace_members set availability = ''away'' where workspace_id = $1 and user_id = $2'
    using v_ws, u_ag_b;
  get diagnostics n = row_count;
  execute 'reset role';
  if n <> 0 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA cambió la disponibilidad de agB';
  end if;

  -- 3.7 No puede cambiar el responsable de un contacto que sí ve.
  v_total := v_total + 1;
  begin
    execute 'set local role authenticated';
    execute 'update public.contacts set owner_id = $1 where id = $2' using u_ag_a, c_a1;
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA pudo cambiar el responsable de un contacto';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  -- 3.8 Nota interna en una gestión que ve: sí. En una que no ve: no.
  v_total := v_total + 2;
  execute 'set local role authenticated';
  execute 'insert into public.case_notes (workspace_id, case_id, contact_id, author_id, body)
           values ($1, $2, $3, $4, ''Nota de prueba'')'
    using v_ws, k_a1, c_a1, u_ag_a;
  get diagnostics n = row_count;
  execute 'reset role';
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA no pudo escribir una nota en su gestión';
  end if;
  begin
    execute 'set local role authenticated';
    execute 'insert into public.case_notes (workspace_id, case_id, contact_id, author_id, body)
             values ($1, $2, $3, $4, ''Nota ajena'')'
      using v_ws, k_b1, c_b1, u_ag_a;
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA escribió una nota en una gestión que no ve';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  -- 3.9 Solo ve sus notificaciones.
  v_total := v_total + 1;
  execute 'set local role authenticated';
  execute 'select count(*) from public.notifications where workspace_id = $1' into n using v_ws;
  execute 'reset role';
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- agA ve %s notificaciones (esperado 1)', n);
  end if;

  -- 3.10 No puede crear trabajos programados (los ejecuta el cron con la clave de servicio).
  v_total := v_total + 1;
  begin
    execute 'set local role authenticated';
    execute 'insert into public.scheduled_jobs (type, payload, run_at) values (''resume_flow'', ''{}''::jsonb, now())';
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA pudo crear scheduled_jobs';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  -- 3.11 No puede llamar a los contadores security definer.
  v_total := v_total + 1;
  select id into v_conv_b1 from public.conversations where contact_id = c_b1;
  begin
    execute 'set local role authenticated';
    execute 'select public.increment_unread($1, ''x'')' using v_conv_b1;
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- agA pudo llamar a increment_unread';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  -- ----------------------------------------------------------------
  -- 4. Difusiones y configuración: solo administración
  -- ----------------------------------------------------------------
  v_total := v_total + 3;

  perform set_config('request.jwt.claim.sub', u_sup_a::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_sup_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select count(*) from public.broadcasts where workspace_id = $1' into n using v_ws;
  execute 'reset role';
  if n <> 0 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- supA ve difusiones';
  end if;

  perform set_config('request.jwt.claim.sub', u_admin::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select count(*) from public.broadcasts where workspace_id = $1' into n using v_ws;
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || format(E'\n- el Administrador ve %s difusiones (esperado 1)', n);
  end if;
  execute 'update public.case_types set color = ''#000000'' where id = $1' using v_case_type;
  get diagnostics n = row_count;
  if n <> 1 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- el Administrador no pudo actualizar case_types';
  end if;
  -- El Administrador no puede tocar la fila del Dueño.
  v_total := v_total + 1;
  execute 'update public.workspace_members set availability = ''away'' where workspace_id = $1 and user_id = $2'
    using v_ws, u_owner;
  get diagnostics n = row_count;
  execute 'reset role';
  if n <> 0 then
    v_fail := v_fail + 1;
    v_errors := v_errors || E'\n- el Administrador modificó la fila del Dueño';
  end if;

  -- ----------------------------------------------------------------
  -- Resultado (y reversión de todo)
  -- ----------------------------------------------------------------
  raise exception 'RESULTADO: % comprobaciones, % fallos.%', v_total, v_fail,
    case when v_fail = 0 then ' TODO OK (todo se revirtió).' else v_errors end;
end;
$$;
