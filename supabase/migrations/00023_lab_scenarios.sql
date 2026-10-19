-- Laboratorio de flujos: escenarios guardados.
--
-- Un escenario es una conversación de prueba (pasos del simulador) con lo que
-- debe cumplirse (expectativas), para volver a probar todos los flujos de un clic
-- después de editarlos. Se corre en el navegador con el catálogo actual; aquí solo
-- se guarda la definición y el último resultado.
--
-- definition: JSON del escenario (lib/flow-lab/scenarios/types.ts), con tipos de
--   gestión, etapas, motivos, equipos, miembros y flujos POR NOMBRE.
-- last_result: JSON con el resultado de la última corrida (sin trazas).
--
-- Permisos: leen los miembros del espacio; crean, editan y borran el Dueño y los
-- Administradores (is_ws_admin, 00019).
--
-- Idempotente: se puede volver a ejecutar sin romper nada.

create table if not exists public.lab_scenarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  definition jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_result jsonb
);

create index if not exists idx_lab_scenarios_workspace on public.lab_scenarios(workspace_id, created_at);

-- Un nombre por espacio (sin importar mayúsculas ni espacios de los bordes).
create unique index if not exists uq_lab_scenarios_name
  on public.lab_scenarios(workspace_id, lower(btrim(name)));

alter table public.lab_scenarios enable row level security;

drop policy if exists lab_scenarios_select on public.lab_scenarios;
create policy lab_scenarios_select on public.lab_scenarios
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists lab_scenarios_insert on public.lab_scenarios;
create policy lab_scenarios_insert on public.lab_scenarios
  for insert with check (public.is_ws_admin(workspace_id));

drop policy if exists lab_scenarios_update on public.lab_scenarios;
create policy lab_scenarios_update on public.lab_scenarios
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));

drop policy if exists lab_scenarios_delete on public.lab_scenarios;
create policy lab_scenarios_delete on public.lab_scenarios
  for delete using (public.is_ws_admin(workspace_id));

drop trigger if exists set_updated_at on public.lab_scenarios;
create trigger set_updated_at before update on public.lab_scenarios
  for each row execute function update_updated_at();
