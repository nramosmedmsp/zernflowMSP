-- Creación segura de espacios de trabajo y registro solo por invitación.
--
-- 1. create_workspace(p_name): crear un segundo espacio desde el selector
--    fallaba porque `workspaces` no tiene política INSERT y la política INSERT
--    de `workspace_members` exige ser dueño de un espacio que aún no existe.
--    La función lo hace todo en una transacción, como el usuario autenticado.
-- 2. handle_new_user(): el registro deja de crear un espacio para cualquiera.
--    Solo se permite crear una cuenta si hay una invitación pendiente y
--    vigente para ese correo, o si es la primera persona de la instalación.
-- 3. auth_user_exists(p_email): para que la página de invitación sepa si
--    ofrecer "Iniciar sesión" o "Crea tu cuenta". Solo service_role.
--
-- Aplicar en cada base (tienda y gimnasio).

-- ------------------------------------------------------------
-- 1. create_workspace
-- ------------------------------------------------------------
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

  -- Si el slug ya existe se agrega un sufijo numérico (-2, -3, ...). El
  -- bloque con excepción también cubre dos creaciones simultáneas.
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

revoke all on function public.create_workspace(text) from public;
revoke all on function public.create_workspace(text) from anon;
grant execute on function public.create_workspace(text) to authenticated;

-- ------------------------------------------------------------
-- 2. handle_new_user: registro solo por invitación
-- ------------------------------------------------------------
create index if not exists idx_workspace_invites_pending_email_lower
  on public.workspace_invites (lower(email))
  where status = 'pending';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
  user_name text;
  workspace_slug text;
begin
  -- a) Persona invitada: no se crea espacio propio. La membresía la agrega el
  --    flujo de invitación (/invite/<id>) con el rol de la invitación.
  if exists (
    select 1
    from public.workspace_invites wi
    where lower(wi.email) = lower(new.email)
      and wi.status = 'pending'
      and wi.expires_at > now()
  ) then
    return new;
  end if;

  -- b) Primera persona de la instalación: se crea su espacio y queda de dueña.
  --    El bloqueo evita que dos registros simultáneos pasen ambos este control.
  perform pg_advisory_xact_lock(hashtext('public.handle_new_user:first_workspace'));

  if not exists (select 1 from public.workspaces) then
    user_name := coalesce(
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      split_part(new.email, '@', 1)
    );
    workspace_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g'))
      || '-' || substr(new.id::text, 1, 8);

    insert into public.workspaces (name, slug)
    values ('Espacio de ' || user_name, workspace_slug)
    returning id into ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, new.id, 'owner');

    return new;
  end if;

  -- c) Cualquier otro caso: se rechaza el registro. Sin bloque EXCEPTION a
  --    propósito, para que el error llegue a Supabase Auth y la cuenta no se
  --    cree. (Auth suele responder "Database error saving new user".)
  raise exception 'signup_requires_invite'
    using errcode = 'P0001',
          hint = 'El registro es solo por invitación.';
end;
$$;

-- El trigger on_auth_user_created (00001) ya apunta a esta función; create or
-- replace la actualiza sin tener que recrearlo.

-- ------------------------------------------------------------
-- 3. auth_user_exists (solo service_role)
-- ------------------------------------------------------------
create or replace function public.auth_user_exists(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(btrim(coalesce(p_email, '')))
  );
$$;

revoke all on function public.auth_user_exists(text) from public;
revoke all on function public.auth_user_exists(text) from anon;
revoke all on function public.auth_user_exists(text) from authenticated;
grant execute on function public.auth_user_exists(text) to service_role;
