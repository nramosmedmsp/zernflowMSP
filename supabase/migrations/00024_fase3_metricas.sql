-- Fase 3: métricas. Sellos de alerta por objetivo de tiempo (SLA).
--
-- El cron de gestiones sella la columna la primera vez que una gestión abierta
-- supera el objetivo (primera respuesta o resolución) para avisar una sola vez
-- por gestión y tipo de alerta.

alter table public.cases
  add column if not exists sla_first_response_breached_at timestamptz;
alter table public.cases
  add column if not exists sla_resolution_breached_at timestamptz;

-- Apoyo del cron: gestiones abiertas aún sin alertar, por tipo y antigüedad.
create index if not exists idx_cases_sla_first_response_pending
  on public.cases(case_type_id, waiting_since)
  where status = 'open'
    and first_response_at is null
    and waiting_since is not null
    and sla_first_response_breached_at is null;

create index if not exists idx_cases_sla_resolution_pending
  on public.cases(case_type_id, opened_at)
  where status = 'open'
    and opened_at is not null
    and sla_resolution_breached_at is null;
