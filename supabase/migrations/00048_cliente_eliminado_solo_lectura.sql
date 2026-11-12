-- Cliente eliminado = ficha solo de lectura, también por la API de datos.
-- Aditiva e idempotente.
--
-- QUÉ HACE
--   Cuando se eliminan los datos de un cliente (erase_contact_data, migración 00044) el
--   contacto queda como cascarón (contacts.erased_at con fecha). La app ya rechaza
--   cualquier cambio sobre él, pero una persona con sesión podría escribir directo por la
--   API de datos (PostgREST) etiquetas, canales, campos personalizados o notas internas
--   y volver a dejar datos personales en un registro que se eliminó a pedido del cliente.
--   Este trigger lo impide: si el contacto está eliminado (erased_at no es nulo), rechaza
--   INSERT, UPDATE y DELETE hechos por una persona con sesión sobre
--     contact_tags, contact_channels, contact_custom_fields y case_notes.
--   (contacts ya no permite UPDATE a las personas, y messages no permite INSERT.)
--
-- QUÉ NO CAMBIA
--   Las escrituras del servidor de la app (clave de servicio, auth.uid() es nulo) y de
--   erase_contact_data pasan igual: el borrado sigue funcionando y los procesos
--   automáticos (webhook, cron) no cambian. Si el código anterior corre contra esta
--   migración, nada se rompe: solo se rechaza escribir sobre un cliente eliminado.
--
-- Es segura de ejecutar varias veces.

set local lock_timeout = '10s';

create or replace function public.block_write_on_erased_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact uuid;
begin
  -- Servidor de la app (clave de servicio) y funciones internas: sin sesión de persona.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  v_contact := case when tg_op = 'DELETE' then old.contact_id else new.contact_id end;
  if v_contact is not null and exists (
    select 1 from public.contacts c where c.id = v_contact and c.erased_at is not null
  ) then
    raise exception 'Los datos de este cliente se eliminaron. La ficha es solo de lectura.'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.block_write_on_erased_contact() from public, anon, authenticated;

drop trigger if exists block_write_on_erased_contact on public.contact_tags;
create trigger block_write_on_erased_contact
  before insert or update or delete on public.contact_tags
  for each row execute function public.block_write_on_erased_contact();

drop trigger if exists block_write_on_erased_contact on public.contact_channels;
create trigger block_write_on_erased_contact
  before insert or update or delete on public.contact_channels
  for each row execute function public.block_write_on_erased_contact();

drop trigger if exists block_write_on_erased_contact on public.contact_custom_fields;
create trigger block_write_on_erased_contact
  before insert or update or delete on public.contact_custom_fields
  for each row execute function public.block_write_on_erased_contact();

drop trigger if exists block_write_on_erased_contact on public.case_notes;
create trigger block_write_on_erased_contact
  before insert or update or delete on public.case_notes
  for each row execute function public.block_write_on_erased_contact();

notify pgrst, 'reload schema';
