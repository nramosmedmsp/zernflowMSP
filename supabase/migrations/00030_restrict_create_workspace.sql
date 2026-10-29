-- ============================================================
-- 00030: solo el Dueño de un espacio (o la primera instalación) crea espacios
-- ============================================================
-- Revisión de seguridad C-1/C-2: la función create_workspace (00017) la podía
-- llamar cualquier usuario con sesión, que quedaba como Dueño de un espacio
-- propio. Ahora exige que quien llama ya sea Dueño de algún espacio, o que no
-- exista ningún espacio todavía (instalación nueva). Se mantiene
-- security definer con search_path fijo.
--
-- La tienda usa un solo espacio; el gimnasio corre como app aparte con su
-- propia base: su primer espacio nace en handle_new_user (00017, primera
-- persona de la instalación) o, si no hay ninguno, con esta función.
--
-- app_mail_settings (00018) ya tiene RLS sin políticas y sin permisos para
-- anon/authenticated: no se alcanza desde el cliente. La restricción "solo el
-- Dueño" se aplica en el servidor (lib/actions/mail.ts).

create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_ws_id uuid;
  v_try int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'workspace_name_required' using errcode = '22023';
  end if;

  if char_length(v_name) > 100 then
    raise exception 'workspace_name_too_long' using errcode = '22023';
  end if;

  -- Mismo bloqueo que handle_new_user: evita dos "primeras instalaciones"
  -- simultáneas.
  perform pg_advisory_xact_lock(hashtext('public.handle_new_user:first_workspace'));

  if not (
    exists (
      select 1 from public.workspace_members wm
      where wm.user_id = v_uid and wm.role = 'owner'
    )
    or not exists (select 1 from public.workspaces)
  ) then
    raise exception 'workspace_creation_not_allowed'
      using errcode = '42501',
            hint = 'Solo el Dueño de un espacio de trabajo puede crear otros espacios.';
  end if;

  -- Slug a partir del nombre: minúsculas, sin tildes, solo [a-z0-9-].
  v_base := translate(
    lower(v_name),
    'áàäâãéèëêíìïîóòöôõúùüûñç',
    'aaaaaeeeeiiiiooooouuuunc'
  );
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := btrim(left(btrim(v_base, '-'), 50), '-');
  if v_base = '' then
    v_base := 'espacio';
  end if;

  loop
    v_slug := case when v_try = 0 then v_base else v_base || '-' || (v_try + 1) end;
    if v_try >= 50 then
      v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    end if;

    begin
      insert into public.workspaces (name, slug)
      values (v_name, v_slug)
      returning id into v_ws_id;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 60 then
        raise;
      end if;
    end;
  end loop;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws_id, v_uid, 'owner');

  return v_ws_id;
end;
$$;

-- Solo usuarios con sesión pueden ejecutarla (la función se niega por dentro
-- si no son Dueños); anon y public no.
revoke all on function public.create_workspace(text) from public;
revoke all on function public.create_workspace(text) from anon;
grant execute on function public.create_workspace(text) to authenticated;
