-- Tanda 2 (previa a producción): defensa y abuso.
--
-- Qué hace (tres temas, todo aditivo e idempotente):
--
-- 1. Topes de frecuencia por usuario (SEG-01). Las funciones de Vercel no
--    comparten memoria, así que el contador vive en la base:
--      * rate_limit_hits: una fila por (clave, ventana). La clave la arma el
--        servidor ("message_send:min:<usuario>"); no guarda correos ni datos
--        personales (los correos se mezclan con un hash antes de llegar aquí).
--      * rate_limit_hit(clave, tope, segundos): suma 1 en la ventana fija actual
--        de forma ATÓMICA (insert ... on conflict do update) y devuelve si aún
--        está dentro del tope, cuántos van y cuántos segundos faltan para que
--        la ventana se reinicie. Solo la puede ejecutar el servidor (service_role).
--      La poda de filas viejas la hace el cron diario (media-cleanup).
--
-- 2. media_uploads (SEG-10): registro de los enlaces de subida que se entregaron
--    (chat o respuesta guardada). Sirve para (a) poner un tope de subidas sin
--    enviar por usuario y (b) que el cron diario borre del bucket los archivos
--    que nadie llegó a enviar ni a guardar en una respuesta. Se marca used_at
--    cuando el archivo se usa; el cron además comprueba message_media y
--    saved_replies antes de borrar nada.
--
-- 3. revoke_user_sessions (SEG-09): cierra TODAS las sesiones abiertas de una
--    persona (borra sus filas de auth.sessions y de auth.refresh_tokens). La
--    API de administración de supabase-js 2.95 solo sabe cerrar la sesión de un
--    JWT concreto (auth.admin.signOut(jwt)), no la de un usuario por id; esta
--    función es la forma de hacerlo sin conocer su token. Solo service_role.
--
-- RLS activada SIN políticas y sin permisos para anon/authenticated en las dos
-- tablas, como cron_runs (00041): solo el servidor las toca.
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código. Es
-- segura con el código anterior (solo agrega objetos nuevos que ese código no
-- usa). Si el código nuevo corre sin la migración, los topes de frecuencia
-- "dejan pasar" (y lo registran), el registro de subidas no se anota y el cierre
-- de sesiones se omite con un aviso en el log: nada se bloquea.
-- Es idempotente: se puede volver a ejecutar.

-- ============================================================
-- 1. Topes de frecuencia
-- ============================================================

create table if not exists public.rate_limit_hits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- La poda diaria borra por antigüedad de la ventana.
create index if not exists rate_limit_hits_window_idx
  on public.rate_limit_hits (window_start);

alter table public.rate_limit_hits enable row level security;
-- Sin políticas a propósito. Sin permisos para usuarios ni anónimos.
revoke all on public.rate_limit_hits from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limit_hits to service_role;

comment on table public.rate_limit_hits is
  'Contadores de ventana fija para los topes de frecuencia (lib/rate-limit.ts). Se podan a diario desde /api/cron/media-cleanup.';

create or replace function public.rate_limit_hit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, current_hits integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start timestamptz;
  v_hits integer;
begin
  if p_bucket is null or length(p_bucket) = 0 or length(p_bucket) > 200 then
    raise exception 'rate_limit_invalid_bucket';
  end if;
  if p_limit is null or p_limit < 1 or p_window_seconds is null
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate_limit_invalid_args';
  end if;

  -- Ventana fija alineada al reloj (epoch): todos los servidores coinciden.
  v_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  -- Un solo enunciado: dos peticiones simultáneas nunca leen el mismo valor.
  insert into public.rate_limit_hits as r (bucket, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  allowed := v_hits <= p_limit;
  current_hits := v_hits;
  retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - v_now)))::integer
  );
  return next;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ============================================================
-- 2. Subidas pendientes (SEG-10)
-- ============================================================

create table if not exists public.media_uploads (
  path text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Sin llave foránea: si se borra la cuenta, el cron igual debe poder limpiar el archivo.
  user_id uuid not null,
  source text not null check (source in ('chat', 'reply')),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

-- Tope por usuario (subidas sin usar recientes) y limpieza por antigüedad.
create index if not exists media_uploads_pending_user_idx
  on public.media_uploads (user_id, created_at)
  where used_at is null;
create index if not exists media_uploads_pending_age_idx
  on public.media_uploads (created_at)
  where used_at is null;

alter table public.media_uploads enable row level security;
revoke all on public.media_uploads from public, anon, authenticated;
grant select, insert, update, delete on public.media_uploads to service_role;

comment on table public.media_uploads is
  'Enlaces de subida entregados (chat o respuesta guardada). used_at se llena al enviar o guardar; el cron borra del bucket lo que sigue sin usar pasadas 48 h.';

-- ============================================================
-- 3. Cerrar las sesiones de una persona (SEG-09)
-- ============================================================

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'revoke_user_sessions_invalid_user';
  end if;

  -- Borrar la sesión impide renovar el token (refresh) y hace que Auth rechace
  -- el token de acceso restante cuando se le consulta. Los tokens de refresco
  -- caen en cascada; el segundo delete es un cinturón por si no hubiera cascada.
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;

  begin
    delete from auth.refresh_tokens where user_id::text = p_user_id::text;
  exception when others then
    null; -- esquema distinto de Auth: la sesión ya se borró, que es lo que importa
  end;

  return v_count;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

notify pgrst, 'reload schema';
