-- Parte 1 de "Ver como": varios Dueños por espacio, y siempre al menos uno.
--
-- Hasta ahora cada espacio tenía un solo Dueño (role = 'owner' en
-- workspace_members) y el código lo daba por hecho. Ahora un Dueño puede
-- nombrar a otros Dueños y quitarles el rol (Configuración → Equipo → Editar).
-- La regla "nunca queda un espacio sin Dueño" no puede depender solo de la
-- pantalla ni de la acción del servidor: dos Dueños que se degradan o se quitan
-- a la vez pasarían ambos la comprobación y dejarían el espacio sin Dueño. Por
-- eso la regla vive en la base:
--
-- Un trigger BEFORE UPDATE/DELETE en public.workspace_members (función
-- guard_last_workspace_owner) rechaza, con el error 'last_owner_required'
-- (errcode 23514), cualquier cambio que deje a un espacio sin Dueño:
--   - quitar a un Dueño (delete),
--   - cambiarle el rol a otro distinto de 'owner',
--   - moverlo a otro espacio o a otro usuario (cambiar workspace_id o user_id).
-- Aplica a todos los clientes (también al de servicio): es la regla de datos.
--
-- Atomicidad: antes de contar los otros Dueños, la función toma un bloqueo
-- consultivo por espacio (pg_advisory_xact_lock) hasta el fin de la
-- transacción. De dos Dueños que se degradan a la vez, el segundo espera al
-- primero, ve que ya no queda otro Dueño y falla.
--
-- No rompe los borrados en cascada:
--   - Borrar un espacio: cuando se borran sus miembros, la fila de
--     public.workspaces ya no existe en la transacción, y la función lo deja
--     pasar.
--   - Borrar un usuario de Auth (auth.users): cuando se borra su membresía, el
--     usuario ya no existe, y la función lo deja pasar. Es una operación
--     deliberada de quien administra la base; la app nunca borra cuentas con
--     membresía (solo revierte una cuenta que acaba de crear). Si un espacio
--     se queda sin Dueño por esta vía, hay que nombrar uno con SQL o con
--     scripts/crear-admin.mjs.
--   - Crear un espacio (create_workspace de 00017/00030, handle_new_user) solo
--     inserta al Dueño: los inserts no se tocan.
--
-- Revisión de lo que suponía "un solo Dueño": las políticas de claves y de
-- invitaciones (00002, 00006, 00031) usan "existe una fila con rol owner" y
-- funcionan igual con varios; create_workspace comprueba "es Dueño de algún
-- espacio" (exists). Ninguna función SQL usa select ... into sobre el Dueño.
--
-- guard_workspace_member_update (00019) no cambia: con el cliente del usuario
-- sigue prohibido tocar roles de/hacia 'owner'; los cambios de rol los hace el
-- servidor (cliente de servicio) tras comprobar que quien llama es Dueño.
--
-- Aditiva e idempotente: se puede volver a ejecutar. No cambia datos. Si algún
-- espacio ya estuviera sin Dueño, esta migración no lo arregla ni lo bloquea
-- (la regla solo mira cambios nuevos); para revisarlo:
--   select w.id, w.name from public.workspaces w
--    where not exists (select 1 from public.workspace_members m
--                      where m.workspace_id = w.id and m.role = 'owner');
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código. Es
-- segura con el código anterior (que nunca quita ni degrada a un Dueño).

create or replace function public.guard_last_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_others integer;
begin
  -- Solo importa si la fila que se cambia o se borra es de un Dueño.
  if old.role is distinct from 'owner' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Update que lo deja igual de Dueño en el mismo espacio y con el mismo usuario.
  if tg_op = 'UPDATE'
     and new.role = 'owner'
     and new.workspace_id is not distinct from old.workspace_id
     and new.user_id is not distinct from old.user_id then
    return new;
  end if;

  -- Borrado en cascada de un espacio: ya no existe, no hay Dueño que proteger.
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Borrado en cascada de una cuenta de Auth: la cuenta ya no existe.
  if tg_op = 'DELETE'
     and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;

  -- Serializa los cambios de Dueños de este espacio hasta el fin de la
  -- transacción: el segundo en llegar espera y cuenta con el cambio del primero.
  perform pg_advisory_xact_lock(hashtextextended('workspace_owners:' || old.workspace_id::text, 0));

  select count(*) into v_others
  from public.workspace_members m
  where m.workspace_id = old.workspace_id
    and m.role = 'owner'
    and m.user_id <> old.user_id;

  if v_others = 0 then
    raise exception 'last_owner_required'
      using errcode = '23514',
            hint = 'Siempre debe quedar al menos un Dueño en el espacio de trabajo.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_last_workspace_owner() from public, anon, authenticated;

drop trigger if exists guard_last_workspace_owner on public.workspace_members;
create trigger guard_last_workspace_owner
  before update of role, workspace_id, user_id or delete on public.workspace_members
  for each row execute function public.guard_last_workspace_owner();
