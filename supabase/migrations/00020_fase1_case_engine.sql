-- Fase 1, tanda 2: motor de gestiones (docs/FASE-1-TECNICO.md 3).
--
-- 1. cases.next_action_notified_at: el cron avisa una sola vez cada próximo
--    contacto vencido (se vuelve a null al cambiar la fecha).
-- 2. open_inbound_case: abre la gestión entrante de un contacto sin duplicarla
--    cuando llegan dos mensajes a la vez (bloqueo por contacto).
-- 3. assign_case_pick: reparto atómico. Bajo un bloqueo por espacio elige
--    entre los candidatos (por turnos o menor carga), asigna la gestión y
--    sella last_assigned_at, para que dos mensajes simultáneos no asignen dos
--    veces seguidas a la misma persona. La misma regla de orden está en
--    TypeScript (lib/cases/routing.ts, pickAssignee) para las pruebas.
-- 4. check_case_refs: contacto, equipo, responsable, tipo, etapa, categoría y
--    motivo de una gestión pertenecen a su mismo espacio (no hay FK
--    compuestas). El motor ya lo valida en código; esto es la red de seguridad.
--
-- Las funciones solo las ejecuta service_role (el motor corre en el servidor
-- con el cliente de servicio después de validar permisos en código).
-- Idempotente: se puede volver a ejecutar.

-- ============================================================
-- 1. Aviso único de próximo contacto vencido
-- ============================================================

alter table public.cases
  add column if not exists next_action_notified_at timestamptz;

create index if not exists idx_cases_next_action_pending
  on public.cases(next_action_at)
  where status = 'open' and next_action_at is not null and next_action_notified_at is null;

-- Cola sin asignar (reintento del reparto en el cron).
create index if not exists idx_cases_open_unassigned
  on public.cases(workspace_id, id)
  where status = 'open' and assignee_id is null;

-- ============================================================
-- 2. Apertura de la gestión entrante
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

  insert into public.cases (
    workspace_id, contact_id, case_type_id, stage_id, status, origin,
    opened_at, last_inbound_at, waiting_since
  )
  values (
    p_workspace_id, p_contact_id, p_case_type_id, p_stage_id, 'open', 'inbound',
    v_at, v_at, v_at
  )
  returning id into v_case_id;

  return jsonb_build_object('case_id', v_case_id, 'created', true);
end;
$$;

revoke all on function public.open_inbound_case(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.open_inbound_case(uuid, uuid, uuid, uuid, timestamptz) to service_role;

-- ============================================================
-- 3. Reparto atómico
-- ============================================================
-- p_candidates: elegibles ya filtrados en código (equipo, tipo que atienden,
-- rol). Aquí se vuelve a exigir que sean miembros del espacio y estén
-- disponibles. Orden:
--   round_robin: last_assigned_at más antiguo (null primero), luego user_id;
--   least_load:  menos gestiones 'open' asignadas, luego lo mismo.
-- Devuelve { status: 'assigned' | 'already_assigned' | 'no_candidate' |
-- 'not_assignable' | 'not_found', assignee_id? }.

create or replace function public.assign_case_pick(
  p_case_id uuid,
  p_candidates uuid[],
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_status text;
  v_assignee uuid;
  v_pick uuid;
begin
  if p_mode is null or p_mode not in ('round_robin', 'least_load') then
    raise exception 'invalid_assignment_mode' using errcode = '22023';
  end if;

  select c.workspace_id into v_workspace_id
  from public.cases c
  where c.id = p_case_id;

  if v_workspace_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Un reparto a la vez por espacio hasta el fin de la transacción.
  perform pg_advisory_xact_lock(hashtextextended('assign_case:' || v_workspace_id::text, 0));

  -- Relee bajo el bloqueo: otra llamada pudo asignarla mientras esperábamos.
  select c.status, c.assignee_id into v_status, v_assignee
  from public.cases c
  where c.id = p_case_id
  for update;

  if v_status is null or v_status not in ('open', 'scheduled') then
    return jsonb_build_object('status', 'not_assignable');
  end if;

  if v_assignee is not null then
    return jsonb_build_object('status', 'already_assigned', 'assignee_id', v_assignee);
  end if;

  if p_candidates is null or cardinality(p_candidates) = 0 then
    return jsonb_build_object('status', 'no_candidate');
  end if;

  select wm.user_id into v_pick
  from public.workspace_members wm
  left join lateral (
    select count(*) as open_count
    from public.cases oc
    where oc.workspace_id = wm.workspace_id
      and oc.assignee_id = wm.user_id
      and oc.status = 'open'
  ) load on p_mode = 'least_load'
  where wm.workspace_id = v_workspace_id
    and wm.user_id = any(p_candidates)
    and wm.availability = 'available'
  order by
    coalesce(load.open_count, 0) asc,
    wm.last_assigned_at asc nulls first,
    wm.user_id asc
  limit 1;

  if v_pick is null then
    return jsonb_build_object('status', 'no_candidate');
  end if;

  update public.cases set assignee_id = v_pick where id = p_case_id;

  update public.workspace_members
    set last_assigned_at = now()
    where workspace_id = v_workspace_id and user_id = v_pick;

  return jsonb_build_object('status', 'assigned', 'assignee_id', v_pick);
end;
$$;

revoke all on function public.assign_case_pick(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.assign_case_pick(uuid, uuid[], text) to service_role;

-- ============================================================
-- 4. Referencias de una gestión dentro de su espacio
-- ============================================================
-- Solo revisa las columnas que cambian. Si el tipo es null (gestión sin
-- clasificar o tipo borrado) no revisa etapa, categoría ni motivo: así los
-- "on delete set null" de las FK nunca fallan.

create or replace function public.check_case_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insert boolean := tg_op = 'INSERT';
  v_type_changed boolean;
begin
  if v_insert
     or new.contact_id is distinct from old.contact_id
     or new.workspace_id is distinct from old.workspace_id then
    if not exists (
      select 1 from public.contacts c
      where c.id = new.contact_id and c.workspace_id = new.workspace_id
    ) then
      raise exception 'case_contact_other_workspace' using errcode = '23514';
    end if;
  end if;

  if new.team_id is not null and (v_insert or new.team_id is distinct from old.team_id) then
    if not exists (
      select 1 from public.teams t
      where t.id = new.team_id and t.workspace_id = new.workspace_id
    ) then
      raise exception 'case_team_other_workspace' using errcode = '23514';
    end if;
  end if;

  if new.assignee_id is not null and (v_insert or new.assignee_id is distinct from old.assignee_id) then
    if not exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = new.workspace_id and wm.user_id = new.assignee_id
    ) then
      raise exception 'case_assignee_not_member' using errcode = '23514';
    end if;
  end if;

  if new.case_type_id is null then
    return new;
  end if;

  v_type_changed := v_insert or new.case_type_id is distinct from old.case_type_id;

  if v_type_changed and not exists (
    select 1 from public.case_types ct
    where ct.id = new.case_type_id and ct.workspace_id = new.workspace_id
  ) then
    raise exception 'case_type_other_workspace' using errcode = '23514';
  end if;

  if new.stage_id is not null
     and (v_type_changed or new.stage_id is distinct from old.stage_id)
     and not exists (
       select 1 from public.case_stages s
       where s.id = new.stage_id and s.case_type_id = new.case_type_id
     ) then
    raise exception 'case_stage_other_type' using errcode = '23514';
  end if;

  if new.category_id is not null
     and (v_type_changed or new.category_id is distinct from old.category_id)
     and not exists (
       select 1 from public.case_categories cc
       where cc.id = new.category_id and cc.case_type_id = new.case_type_id
     ) then
    raise exception 'case_category_other_type' using errcode = '23514';
  end if;

  if new.outcome_reason_id is not null
     and (v_type_changed or new.outcome_reason_id is distinct from old.outcome_reason_id)
     and not exists (
       select 1 from public.case_outcome_reasons r
       where r.id = new.outcome_reason_id and r.case_type_id = new.case_type_id
     ) then
    raise exception 'case_outcome_reason_other_type' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.check_case_refs() from public, anon, authenticated;

drop trigger if exists check_case_refs on public.cases;
create trigger check_case_refs
  before insert or update on public.cases
  for each row execute function public.check_case_refs();
