-- Laboratorio de flujos: correcciones del motor de flujos de gestiones.
--
-- 1. triggers.type: agrega 'case_opened' (Gestión nueva). config:
--    { only_unclassified?: boolean, contact_type_ids?: uuid[], case_type_id? }.
-- 2. cases_pending_no_reply: "cliente sin responder" ya no exige
--    waiting_since null. Basta con que el último mensaje saliente (de bot o de
--    persona) sea posterior al último entrante y tenga p_older_than o más de
--    antigüedad. waiting_since sigue significando "el cliente espera una
--    respuesta humana" y no se toca. Un evento por umbral y por mensaje
--    saliente (no_reply_event_outbound_at / no_reply_event_minutes).
-- 3. Índice de apoyo para esa función (reemplaza al de 00021, que exigía
--    waiting_since null).

-- ============================================================
-- 1. Disparador "Gestión nueva"
-- ============================================================

alter table public.triggers drop constraint if exists triggers_type_check;
alter table public.triggers
  add constraint triggers_type_check check (type in (
    'keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword',
    'case_opened', 'case_stage_changed', 'case_closed', 'client_no_reply'
  ));

-- ============================================================
-- 2. Candidatas a client_no_reply (cron)
-- ============================================================

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

-- ============================================================
-- 3. Índice
-- ============================================================

drop index if exists public.idx_cases_open_awaiting_reply;
create index if not exists idx_cases_open_with_outbound
  on public.cases(workspace_id, id)
  where status = 'open' and last_outbound_at is not null;
