-- Tanda 5 (previa a producción): difusiones que se pueden pausar, reanudar y
-- cancelar, y que una difusión grande no frene lo demás.
--
-- QUÉ HACE (todo aditivo e idempotente)
--   1. broadcasts.status admite un valor nuevo, 'paused' (En pausa). La
--      restricción se vuelve a crear con la lista completa:
--        draft, scheduled, sending, paused, completed, cancelled.
--   2. broadcasts: columnas para explicar una pausa y llevar la cuenta de fallos
--      seguidos (el corte automático cuando Zernio o WhatsApp fallan en serie):
--        paused_at              cuándo se pausó
--        paused_reason          'manual' (la pausó una persona) o 'auto_failures'
--                               (se pausó sola por fallos seguidos)
--        pause_note             la frase en español que ve el equipo
--        consecutive_failures   envíos fallidos seguidos (se pone en 0 con cada
--                               envío bueno y al reanudar)
--        cancelled_at           cuándo se canceló
--   3. broadcast_recipients.claimed_at: cuándo el cron tomó al destinatario para
--      enviarle. Permite reconocer un envío que se quedó "enviando" porque la
--      función se cortó (pasa a fallido con el aviso de revisar el chat, igual
--      que antes), y un índice parcial para encontrarlos rápido.
--      El estado de destinatario 'cancelled' (cancelado) no necesita cambio: la
--      columna status es texto libre.
--
-- CÓMO ENVÍA AHORA EL CRON
--   Ya no hay un trabajo por destinatario en scheduled_jobs: cada pasada del
--   cron (cada minuto) toma de la tabla broadcast_recipients un lote de los
--   'pending' de las difusiones en estado 'sending'. Pausar y cancelar son un
--   cambio de estado de la difusión: la siguiente pasada ya no envía.
--   Los trabajos 'send_broadcast' que pudieran quedar de antes se siguen
--   procesando con las mismas reglas (no hay ninguno en producción todavía).
--
-- BLOQUEOS
--   Cambiar la restricción de broadcasts toma un candado breve sobre una tabla
--   pequeña (una fila por difusión). El índice parcial sobre broadcast_recipients
--   no incluye filas hoy en producción. Con lock_timeout de 10 s: si hubiera una
--   transacción larga, falla limpio y se vuelve a ejecutar.
--
-- ORDEN DE DESPLIEGUE: aplicar esta migración ANTES de desplegar el código. Es
-- segura con el código anterior (que no conoce 'paused', ni 'cancelled' en
-- destinatarios, ni estas columnas). Si el código nuevo corre sin la migración,
-- pausar falla con el aviso "No se pudo completar la operación" y el cron no
-- puede leer las columnas nuevas (la pasada de difusiones se omite y queda en el
-- registro); nada se envía de más.
-- Es idempotente: se puede volver a ejecutar.

set local lock_timeout = '10s';

-- ============================================================
-- 1. Estado 'paused'
-- ============================================================

alter table public.broadcasts drop constraint if exists broadcasts_status_check;
alter table public.broadcasts
  add constraint broadcasts_status_check
  check (status in ('draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled'));

-- ============================================================
-- 2. Columnas de la difusión
-- ============================================================

alter table public.broadcasts add column if not exists paused_at timestamptz;
alter table public.broadcasts add column if not exists paused_reason text;
alter table public.broadcasts add column if not exists pause_note text;
alter table public.broadcasts add column if not exists consecutive_failures integer not null default 0;
alter table public.broadcasts add column if not exists cancelled_at timestamptz;

-- ============================================================
-- 3. Destinatarios
-- ============================================================

alter table public.broadcast_recipients add column if not exists claimed_at timestamptz;

create index if not exists idx_broadcast_recipients_sending
  on public.broadcast_recipients (claimed_at)
  where status = 'sending';

notify pgrst, 'reload schema';
