-- Tanda 10 (cierre): una sola gestión "Sin clasificar" activa por contacto.
--
-- La acción manual de "Nueva gestión" ya bloquea crear una gestión sin tipo
-- (case_type_id nulo) si el contacto tiene otra abierta o programada, pero
-- la comprobación y el insert no son atómicos: dos pedidos simultáneos (doble
-- clic, dos asesores) podían crear dos "Sin clasificar". Esta migración cierra
-- el hueco en la base:
--
-- 1. Índice único parcial en public.cases sobre (contact_id) para las gestiones
--    sin tipo que están abiertas o programadas. No lleva workspace_id: un
--    contacto pertenece a un solo espacio (check_case_refs lo garantiza), así
--    que contact_id ya basta. Las gestiones con tipo y las cerradas quedan
--    fuera del índice, y no cambia nada para ellas (se pueden seguir abriendo
--    varias del mismo tipo cuando el tipo lo permite).
--    Un segundo insert sin tipo para el mismo contacto falla con 23505
--    (unique_violation) y el código lo traduce: la acción manual devuelve
--    "Ya tiene una gestión abierta: clasifícala en vez de crear otra.".
--
-- 2. open_inbound_case (00020, única versión vigente) se redefine igual que
--    antes más un manejo de 23505: la función serializa a los mensajes entrantes
--    con un bloqueo por contacto, pero no a una apertura manual simultánea.
--    Si el insert choca con el índice, devuelve la gestión sin clasificar que
--    ya existe ({ created: false }) en vez de fallar, como cuando la encuentra
--    al principio. Misma firma y mismos permisos (solo service_role).
--
-- Aditiva e idempotente: se puede volver a ejecutar. Crear el índice falla si
-- ya hubiera dos gestiones sin tipo activas del mismo contacto; en producción
-- se revisó y no hay duplicados. Para comprobarlo antes:
--   select contact_id, count(*) from public.cases
--    where case_type_id is null and status in ('open','scheduled')
--    group by 1 having count(*) > 1;
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código; es
-- segura con el código anterior (solo puede hacer fallar un insert que ya era
-- un duplicado que el código nuevo bloquea).

-- ============================================================
-- 1. Una sola "Sin clasificar" activa por contacto
-- ============================================================

create unique index if not exists uq_cases_one_unclassified_active
  on public.cases (contact_id)
  where case_type_id is null and status in ('open', 'scheduled');

-- ============================================================
-- 2. open_inbound_case: reutiliza la sin clasificar si otra apertura se adelanta
-- ============================================================

create or replace function public.open_inbound_case(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_case_type_id uuid,
  p_stage_id uuid,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case_id uuid;
  v_at timestamptz := coalesce(p_at, now());
begin
  if not exists (
    select 1 from public.contacts c
    where c.id = p_contact_id and c.workspace_id = p_workspace_id
  ) then
    raise exception 'contact_not_in_workspace' using errcode = '23514';
  end if;

  -- Serializa por contacto hasta el fin de la transacción: el segundo mensaje
  -- espera y, al seguir, ya ve la gestión que abrió el primero.
  perform pg_advisory_xact_lock(hashtextextended('open_inbound_case:' || p_contact_id::text, 0));

  select c.id into v_case_id
  from public.cases c
  where c.contact_id = p_contact_id and c.status = 'open'
  order by c.opened_at desc nulls last, c.created_at desc
  limit 1;

  if v_case_id is not null then
    return jsonb_build_object('case_id', v_case_id, 'created', false);
  end if;

  begin
    insert into public.cases (
      workspace_id, contact_id, case_type_id, stage_id, status, origin,
      opened_at, last_inbound_at, waiting_since
    )
    values (
      p_workspace_id, p_contact_id, p_case_type_id, p_stage_id, 'open', 'inbound',
      v_at, v_at, v_at
    )
    returning id into v_case_id;
  exception when unique_violation then
    -- Una apertura manual sin clasificar se coló entre el select y el insert
    -- (no toma el bloqueo de arriba): se usa esa gestión.
    select c.id into v_case_id
    from public.cases c
    where c.contact_id = p_contact_id
      and c.case_type_id is null
      and c.status in ('open', 'scheduled')
    order by c.opened_at desc nulls last, c.created_at desc
    limit 1;
    if v_case_id is null then
      raise; -- otra violación única: no es la que se sabe resolver
    end if;
    return jsonb_build_object('case_id', v_case_id, 'created', false);
  end;

  return jsonb_build_object('case_id', v_case_id, 'created', true);
end;
$$;

revoke all on function public.open_inbound_case(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.open_inbound_case(uuid, uuid, uuid, uuid, timestamptz) to service_role;
