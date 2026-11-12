-- Tanda 1A (previa a producción): no perder mensajes entrantes y poder vigilar
-- que el sistema esté vivo.
--
-- Qué hace (dos temas, todo aditivo):
--
-- 1. webhook_events deja de ser solo una lista de ids vistos y pasa a ser la
--    BANDEJA DE ENTRADA DURABLE de los mensajes de Zernio (CONF-06 / CONF-07):
--      * status: 'received' (llegó, aún sin guardar contacto y chat),
--        'stored' (contacto y chat guardados; falta el trabajo posterior:
--        gestión, reparto, bot), 'processed' (todo hecho) o 'failed' (se agotaron
--        los intentos; los administradores reciben un aviso).
--      * payload: el cuerpo YA VERIFICADO (firma correcta), reducido a lo
--        necesario para reprocesar (texto, remitente, ids). No guarda fotos,
--        enlaces de archivos ni la foto de perfil. Se pone en NULL en cuanto el
--        evento queda 'processed' (no se conservan datos personales de lo que
--        ya se hizo); solo permanece en los pendientes o fallidos.
--      * attempts / last_error / locked_until: reintentos con tope y un candado
--        corto para que dos ejecuciones no procesen a la vez.
--      * contact_id / conversation_id / is_first_message / cases_ok_at /
--        flows_started_at: avance guardado, para que un reintento NO repita lo
--        ya hecho (no duplica chat, gestión ni respuesta del bot).
--    Filas anteriores a esta migración (y las que escriba el código anterior,
--    que solo manda event_id) quedan como 'processed' sin payload: el barrido
--    las ignora. Poda: 'processed' a las 48 h (como hasta ahora) y cualquier
--    otra a los 7 días.
--
-- 2. cron_runs: una fila por tarea automática (jobs, sequences, media_cleanup)
--    con su último inicio, último fin correcto, último error y duración. La
--    escribe cada cron y la lee /api/health y la tarjeta "Estado del sistema"
--    de Configuración. RLS activada SIN políticas y sin permisos para usuarios
--    ni anónimos: solo el servidor (service_role), como view_as_sessions.
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código.
-- Es segura con el código anterior: todas las columnas nuevas tienen valor por
-- defecto o admiten NULL, y el código anterior solo usa event_id / received_at
-- (sus filas nuevas quedan 'processed'). Es idempotente: se puede volver a
-- ejecutar. El código nuevo, si la migración aún no está, sigue procesando los
-- mensajes sin la bandeja durable (pierde la recuperación, no el mensaje).
--
-- Reprocesar a mano un evento fallido (dentro de los 7 días que se conserva):
--   update public.webhook_events
--      set status = 'received', attempts = 0, locked_until = null, last_error = null
--    where event_id = '<id>' and status = 'failed' and payload is not null;
-- El barrido del cron lo retoma en la siguiente pasada.

-- ============================================================
-- 1. webhook_events: bandeja de entrada durable
-- ============================================================

alter table public.webhook_events
  add column if not exists status text not null default 'processed',
  add column if not exists event_type text,
  add column if not exists channel_id uuid,
  add column if not exists payload jsonb,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error text,
  add column if not exists locked_until timestamptz,
  add column if not exists contact_id uuid,
  add column if not exists conversation_id uuid,
  add column if not exists is_first_message boolean,
  add column if not exists cases_ok_at timestamptz,
  add column if not exists flows_started_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'webhook_events_status_check'
      and conrelid = 'public.webhook_events'::regclass
  ) then
    alter table public.webhook_events
      add constraint webhook_events_status_check
      check (status in ('received', 'stored', 'processed', 'failed'));
  end if;
end $$;

-- El barrido del cron mira solo los pendientes; los fallidos se listan en Configuración.
create index if not exists webhook_events_pending_idx
  on public.webhook_events (received_at)
  where status in ('received', 'stored');
create index if not exists webhook_events_failed_idx
  on public.webhook_events (received_at)
  where status = 'failed';

comment on column public.webhook_events.status is
  'received = llegó sin guardar; stored = contacto y chat guardados, falta el trabajo posterior; processed = hecho; failed = se agotaron los intentos.';
comment on column public.webhook_events.payload is
  'Cuerpo verificado y reducido para reprocesar. NULL en cuanto el evento queda processed.';

-- Sin permisos para usuarios ni anónimos (ya tenía RLS sin políticas).
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from public, anon, authenticated;
grant select, insert, update, delete on public.webhook_events to service_role;

-- ============================================================
-- 2. cron_runs: señal de vida de las tareas automáticas
-- ============================================================

create table if not exists public.cron_runs (
  name text primary key,
  last_started_at timestamptz,
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  last_duration_ms integer,
  -- Conteos pequeños de la última pasada (sin datos de personas).
  last_stats jsonb,
  updated_at timestamptz not null default now()
);

alter table public.cron_runs enable row level security;
-- Sin políticas a propósito. Sin permisos para usuarios ni anónimos.
revoke all on public.cron_runs from public, anon, authenticated;
grant select, insert, update, delete on public.cron_runs to service_role;

comment on table public.cron_runs is
  'Última ejecución de cada tarea automática (jobs, sequences, media_cleanup). La lee /api/health y Configuración > Estado del sistema.';

notify pgrst, 'reload schema';
