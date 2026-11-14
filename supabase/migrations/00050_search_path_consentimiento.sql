-- search_path fijo en el trigger de consentimiento (aviso del revisor de Supabase).
-- Aditiva e idempotente: solo fija un ajuste de una función; no cambia su código ni datos.
--
-- POR QUÉ
--   El revisor de seguridad de Supabase avisa "function_search_path_mutable" para
--   public.sync_contact_consent(): sin search_path fijo, quien llama podría cambiarlo y
--   hacer que un nombre sin calificar apunte a otro objeto.
--
-- QUÉ HACE
--   Fija search_path = '' en la función del trigger. Es seguro porque la función solo usa
--   auth.uid() (ya calificado) y funciones y operadores de pg_catalog (now(), coalesce,
--   <>, is distinct from), que Postgres siempre resuelve aunque el search_path esté vacío
--   (ver 00044_consentimiento.sql). El trigger sync_contact_consent y su comportamiento no
--   cambian.
--
-- NO SE TOCAN f_unaccent, f_norm ni f_phone_digits, a propósito: sus cuerpos ya van
--   calificados, y un SET en la función le quitaría el "inline" a Postgres y encarecería
--   las búsquedas que las usan.
--
-- SEGURIDAD DE APLICARLA
--   ALTER FUNCTION toma un bloqueo breve sobre la función, no sobre la tabla contacts;
--   con lock_timeout de 10 s, si algo lo impidiera falla limpio y se reintenta. No cambia
--   datos, políticas ni permisos. Se puede volver a ejecutar sin efecto.

set local lock_timeout = '10s';

alter function public.sync_contact_consent() set search_path = '';

notify pgrst, 'reload schema';
