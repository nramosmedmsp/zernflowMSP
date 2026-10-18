-- Fase 2, tanda 1: horarios, feriados y automatización de gestiones
-- (docs/FASE-2-TECNICO.md 1).
--
-- 1. is_valid_business_hours: formato de los horarios (lo usan los checks).
-- 2. teams.business_hours y workspaces.settings (business_hours,
--    off_hours_reply, reassign_after_minutes): horario por equipo / empresa.
-- 3. holidays: feriados de la empresa o de un equipo.
-- 4. case_types.auto_template: plantilla que se envía al activarse una
--    gestión proactiva.
-- 5. cases: sellos de la respuesta fuera de horario, de la plantilla
--    automática, de la reasignación por espera (reassigned_count,
--    assigned_at, wait_alerted_at) y del disparador client_no_reply.
-- 6. triggers.type: 'case_stage_changed', 'case_closed' y 'client_no_reply'.
-- 7. import_batches: historial de importaciones de contactos.
-- 8. cases_pending_no_reply: candidatas a client_no_reply para el cron.
--
-- Todo es opcional: sin configurar, el CRM se comporta como en la fase 1.
-- Idempotente: se puede volver a ejecutar. La hora de los horarios es la de
-- Lima (la interpreta el código, no la base). Requiere Postgres 15 o superior
-- (índice único con nulls not distinct en holidays).

-- ============================================================
-- 1. Formato de business_hours
-- ============================================================
-- { "mon": [["09:00","13:00"],["14:00","19:00"]], ..., "sun": [] }
-- Inicio HH:MM (00:00 a 23:59); fin HH:MM o "24:00"; inicio distinto de fin
-- (si el fin es menor, el tramo cruza la medianoche). Hasta 6 tramos por día.
-- null (o JSON null) es válido: significa "sin horario" (24 horas).

create or replace function public.is_valid_business_hours(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  v jsonb;
  r jsonb;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return true;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  for k, v in select key, value from jsonb_each(p) loop
    if k not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then
      return false;
    end if;
    if jsonb_typeof(v) = 'null' then
      continue;
    end if;
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 6 then
      return false;
    end if;
    for r in select value from jsonb_array_elements(v) loop
      if jsonb_typeof(r) <> 'array' or jsonb_array_length(r) <> 2 then
        return false;
      end if;
      if jsonb_typeof(r -> 0) <> 'string' or jsonb_typeof(r -> 1) <> 'string' then
        return false;
      end if;
      if (r ->> 0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or (r ->> 1) !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
         or (r ->> 0) = (r ->> 1) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- ============================================================
-- 2. Horarios de equipos y de la empresa
-- ============================================================

alter table public.teams
  add column if not exists business_hours jsonb;

alter table public.teams drop constraint if exists teams_business_hours_check;
alter table public.teams
  add constraint teams_business_hours_check
  check (business_hours is null or public.is_valid_business_hours(business_hours));

-- workspaces.settings: { agent_visibility, assignment_mode, business_template,
-- key_date_label, business_hours, off_hours_reply, reassign_after_minutes }
alter table public.workspaces drop constraint if exists workspaces_settings_check;
alter table public.workspaces
  add constraint workspaces_settings_check check (
    jsonb_typeof(settings) = 'object'
    and coalesce(settings->>'agent_visibility', 'own') in ('own', 'own_and_unassigned', 'team')
    and coalesce(settings->>'assignment_mode', 'round_robin') in ('round_robin', 'least_load', 'manual')
    and coalesce(settings->>'business_template', 'blank') in ('ecommerce', 'gym', 'general', 'blank')
    and public.is_valid_business_hours(settings->'business_hours')
    and coalesce(jsonb_typeof(settings->'off_hours_reply'), 'object') in ('object', 'null')
    and coalesce(jsonb_typeof(settings->'reassign_after_minutes'), 'number') in ('number', 'null')
  );

-- ============================================================
-- 3. Feriados
-- ============================================================
-- team_id null = toda la empresa. Único por (espacio, equipo, fecha); los
-- null cuentan como iguales.

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  date date not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_holidays_workspace_team_date
  on public.holidays(workspace_id, team_id, date) nulls not distinct;
create index if not exists idx_holidays_workspace_date on public.holidays(workspace_id, date);

-- El equipo de un feriado pertenece a su mismo espacio.
create or replace function public.check_holiday_team_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.team_id is not null and not exists (
    select 1 from public.teams t where t.id = new.team_id and t.workspace_id = new.workspace_id
  ) then
    raise exception 'team_not_in_workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.check_holiday_team_workspace() from public, anon, authenticated;

drop trigger if exists check_holiday_team_workspace on public.holidays;
create trigger check_holiday_team_workspace
  before insert or update on public.holidays
  for each row execute function public.check_holiday_team_workspace();

alter table public.holidays enable row level security;
drop policy if exists holidays_select on public.holidays;
drop policy if exists holidays_insert on public.holidays;
drop policy if exists holidays_update on public.holidays;
drop policy if exists holidays_delete on public.holidays;
create policy holidays_select on public.holidays
  for select using (public.is_workspace_member(workspace_id));
create policy holidays_insert on public.holidays
  for insert with check (public.is_ws_admin(workspace_id));
create policy holidays_update on public.holidays
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy holidays_delete on public.holidays
  for delete using (public.is_ws_admin(workspace_id));

-- ============================================================
-- 4. Plantilla automática de las gestiones proactivas
-- ============================================================
-- { template_name, language, params: ["{nombre}", "{fecha_clave}", ...] }

alter table public.case_types
  add column if not exists auto_template jsonb;

alter table public.case_types drop constraint if exists case_types_auto_template_check;
alter table public.case_types
  add constraint case_types_auto_template_check
  check (auto_template is null or jsonb_typeof(auto_template) = 'object');

-- ============================================================
-- 5. Sellos en las gestiones
-- ============================================================

alter table public.cases
  add column if not exists off_hours_reply_sent_at timestamptz,
  add column if not exists auto_template_sent_at timestamptz,
  add column if not exists reassigned_count integer not null default 0,
  -- Cuándo se asignó al responsable actual (lo mantiene el trigger de abajo).
  add column if not exists assigned_at timestamptz,
  -- Último aviso de espera excedida sin a quién reasignar.
  add column if not exists wait_alerted_at timestamptz,
  -- client_no_reply: last_outbound_at y umbral (minutos) del último evento.
  add column if not exists no_reply_event_outbound_at timestamptz,
  add column if not exists no_reply_event_minutes integer;

alter table public.cases drop constraint if exists cases_reassigned_count_check;
alter table public.cases
  add constraint cases_reassigned_count_check check (reassigned_count >= 0);

-- assigned_at sigue al responsable: se sella al asignar y se limpia al quitarlo.
create or replace function public.set_case_assigned_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null and new.assigned_at is null then
      new.assigned_at := now();
    end if;
  elsif new.assignee_id is distinct from old.assignee_id then
    new.assigned_at := case when new.assignee_id is null then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists set_case_assigned_at on public.cases;
create trigger set_case_assigned_at
  before insert or update of assignee_id on public.cases
  for each row execute function public.set_case_assigned_at();

-- Reasignación por espera: abiertas con responsable y cliente esperando.
create index if not exists idx_cases_open_assigned_waiting
  on public.cases(workspace_id, waiting_since)
  where status = 'open' and assignee_id is not null and waiting_since is not null;

-- client_no_reply: abiertas con el último mensaje saliente sin respuesta.
create index if not exists idx_cases_open_awaiting_reply
  on public.cases(workspace_id, id)
  where status = 'open' and waiting_since is null and last_outbound_at is not null;

-- ============================================================
-- 6. Disparadores de flujos por eventos de gestión
-- ============================================================
-- El check de 00001 no tiene nombre explícito: Postgres lo llamó
-- triggers_type_check. config: { case_type_id?, stage_id?, outcome?, minutes? }

alter table public.triggers drop constraint if exists triggers_type_check;
alter table public.triggers
  add constraint triggers_type_check check (type in (
    'keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword',
    'case_stage_changed', 'case_closed', 'client_no_reply'
  ));

-- ============================================================
-- 7. Importaciones de contactos
-- ============================================================

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  file_name text not null default '',
  total integer not null default 0,
  created integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_import_batches_workspace on public.import_batches(workspace_id, created_at desc);

alter table public.import_batches enable row level security;
drop policy if exists import_batches_select on public.import_batches;
drop policy if exists import_batches_insert on public.import_batches;
drop policy if exists import_batches_update on public.import_batches;
drop policy if exists import_batches_delete on public.import_batches;
create policy import_batches_select on public.import_batches
  for select using (public.is_workspace_member(workspace_id));
create policy import_batches_insert on public.import_batches
  for insert with check (public.is_ws_admin(workspace_id));
create policy import_batches_update on public.import_batches
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy import_batches_delete on public.import_batches
  for delete using (public.is_ws_admin(workspace_id));

-- ============================================================
-- 8. Candidatas a client_no_reply (cron)
-- ============================================================
-- Gestiones abiertas del espacio cuyo último mensaje saliente (humano o bot)
-- es de p_older_than o antes, es posterior al último entrante y no tiene
-- espera del cliente (waiting_since null), y a las que aún les falta algún
-- umbral: no se emitió ninguno para ese mensaje, o el último emitido es menor
-- que p_max_minutes. Paginado por id. Solo service_role.

create or replace function public.cases_pending_no_reply(
  p_workspace_id uuid,
  p_older_than timestamptz,
  p_max_minutes integer,
  p_after_id uuid,
  p_limit integer
)
returns table (
  id uuid,
  workspace_id uuid,
  contact_id uuid,
  case_type_id uuid,
  stage_id uuid,
  last_outbound_at timestamptz,
  no_reply_event_outbound_at timestamptz,
  no_reply_event_minutes integer
)
language sql
stable
set search_path = public
as $$
  select c.id, c.workspace_id, c.contact_id, c.case_type_id, c.stage_id,
         c.last_outbound_at, c.no_reply_event_outbound_at, c.no_reply_event_minutes
  from public.cases c
  where c.workspace_id = p_workspace_id
    and c.status = 'open'
    and c.waiting_since is null
    and c.last_outbound_at is not null
    and c.last_outbound_at <= p_older_than
    and (c.last_inbound_at is null or c.last_inbound_at < c.last_outbound_at)
    and (
      c.no_reply_event_outbound_at is distinct from c.last_outbound_at
      or coalesce(c.no_reply_event_minutes, 0) < p_max_minutes
    )
    and (p_after_id is null or c.id > p_after_id)
  order by c.id
  limit greatest(coalesce(p_limit, 100), 1);
$$;

revoke all on function public.cases_pending_no_reply(uuid, timestamptz, integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.cases_pending_no_reply(uuid, timestamptz, integer, uuid, integer) to service_role;
