-- Control de la bandeja (docs/PLAN-BANDEJA-CHAT.md, etapa D): quién envió cada
-- mensaje y su estado de entrega en vivo.
--
-- Cada envío de un asesor (mensaje o plantilla) queda en `messages` con su
-- autor y el id de la plataforma; el webhook de Zernio (message.delivered,
-- message.read, message.failed) actualiza su estado y la bandeja lo recibe por
-- Realtime (messages ya está en la publicación supabase_realtime).
--
-- Aplicar en cada base (tienda y gimnasio).

alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in ('pending', 'sent', 'delivered', 'read', 'failed'));

alter table public.messages add column if not exists client_message_id text;
alter table public.messages add column if not exists status_at timestamptz;
alter table public.messages add column if not exists error_code integer;
alter table public.messages add column if not exists error_text text;

-- Búsqueda por id de plataforma (unir con la lista de Zernio y el webhook).
create index if not exists idx_messages_platform_id
  on public.messages(conversation_id, platform_message_id)
  where platform_message_id is not null;

-- Nadie puede registrar un mensaje a nombre de otra persona.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    (sent_by_user_id is null or sent_by_user_id = auth.uid())
    and exists (
      select 1 from public.conversations conv
      where conv.id = messages.conversation_id and public.can_see_contact(conv.contact_id)
    )
  );
