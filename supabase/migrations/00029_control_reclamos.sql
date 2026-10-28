-- Control de reclamos (Postventa): tipos protegidos, plazo para registrar la
-- solución, pedido de cierre con aprobación, detector de reclamos sin
-- clasificar y ventana de reapertura por tipo.
--
-- Todo es opcional y genérico por tipo de gestión: con las columnas en sus
-- valores por defecto (protected = false y plazos vacíos) nada cambia. Las
-- escrituras siguen pasando por las acciones del servidor (cliente de
-- servicio), como el resto del motor; las políticas RLS existentes de
-- case_types, cases y conversations cubren las columnas nuevas.
--
-- Aplicar en cada base (tienda y gimnasio).

-- ---------- case_types ----------
-- protected: solo el supervisor del equipo (o un administrador) cambia el tipo
--   de la gestión o la cierra como perdida; un asesor pide la aprobación.
-- solution_deadline_hours: horas desde que se abre para cerrarla como
--   resuelta/ganada o registrar una "solución en proceso". null = sin plazo.
-- reopen_window_days: días tras el cierre en que un mensaje del cliente
--   reabre la gestión. null = 24 horas (comportamiento anterior).
alter table public.case_types
  add column if not exists protected boolean not null default false;
alter table public.case_types
  add column if not exists solution_deadline_hours integer;
alter table public.case_types
  add column if not exists reopen_window_days integer;

alter table public.case_types drop constraint if exists case_types_solution_deadline_hours_check;
alter table public.case_types
  add constraint case_types_solution_deadline_hours_check
  check (solution_deadline_hours is null or solution_deadline_hours between 1 and 720);

alter table public.case_types drop constraint if exists case_types_reopen_window_days_check;
alter table public.case_types
  add constraint case_types_reopen_window_days_check
  check (reopen_window_days is null or reopen_window_days between 1 and 365);

-- ---------- cases ----------
-- solution_status: 'in_progress' cuando alguien registró la solución en curso
--   (null = nada registrado). solution_note / solution_at / solution_by: qué
--   se está haciendo, cuándo y quién lo registró. La fecha compromiso es
--   next_action_at.
-- solution_clock_at: desde cuándo corre el plazo (null = opened_at); la
--   reapertura lo reinicia.
-- deadline_alerted_at: el cron ya avisó a los supervisores que venció el plazo.
-- commitment_alerted_at: el cron ya avisó que venció la fecha compromiso
--   (setNextAction lo vuelve a null cuando cambia la fecha).
-- close_request: pedido de cierre "sin solución" de un asesor, a la espera de
--   un supervisor: { stage_id, reason_id, note, category_id?, requested_by,
--   requested_at }.
alter table public.cases
  add column if not exists solution_status text;
alter table public.cases drop constraint if exists cases_solution_status_check;
alter table public.cases
  add constraint cases_solution_status_check check (solution_status is null or solution_status in ('in_progress'));
alter table public.cases add column if not exists solution_note text;
alter table public.cases add column if not exists solution_at timestamptz;
alter table public.cases add column if not exists solution_by uuid references auth.users(id) on delete set null;
alter table public.cases add column if not exists solution_clock_at timestamptz;
alter table public.cases add column if not exists deadline_alerted_at timestamptz;
alter table public.cases add column if not exists commitment_alerted_at timestamptz;
alter table public.cases add column if not exists close_request jsonb;

-- Apoyo del cron: gestiones abiertas, sin solución y sin alertar, por tipo y antigüedad.
create index if not exists idx_cases_solution_deadline_pending
  on public.cases(case_type_id, opened_at)
  where status = 'open'
    and solution_status is null
    and deadline_alerted_at is null;

-- Apoyo del cron: compromisos vencidos sin avisar.
create index if not exists idx_cases_commitment_pending
  on public.cases(next_action_at)
  where status = 'open'
    and solution_status = 'in_progress'
    and commitment_alerted_at is null;

-- Pedidos de cierre pendientes (lista y avisos).
create index if not exists idx_cases_close_request_pending
  on public.cases(workspace_id)
  where close_request is not null;

-- ---------- conversations ----------
-- Detector de reclamos: el webhook marca la conversación cuando el cliente
-- escribe algo que parece un reclamo y no hay una gestión protegida abierta.
alter table public.conversations add column if not exists complaint_flagged_at timestamptz;
alter table public.conversations add column if not exists complaint_excerpt text;
alter table public.conversations add column if not exists complaint_alerted_at timestamptz;
alter table public.conversations add column if not exists complaint_dismissed_at timestamptz;

-- Apoyo del cron: marcadas y sin avisar.
create index if not exists idx_conversations_complaint_pending
  on public.conversations(complaint_flagged_at)
  where complaint_flagged_at is not null
    and complaint_alerted_at is null;
