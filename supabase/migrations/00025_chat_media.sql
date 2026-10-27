-- Fotos, PDF, audios y videos del chat (docs/PLAN-BANDEJA-CHAT.md, etapa C).
--
-- Los archivos van a un bucket privado sin políticas de acceso directo: el
-- servidor comprueba que la persona ve el chat (RLS de message_media o de
-- saved_replies) y recién entonces entrega un enlace firmado de pocos minutos.
-- Las subidas también pasan por el servidor (enlace de subida firmado).
--
-- Los archivos de los chats se borran a los 2 meses (cron
-- /api/cron/media-cleanup, decisión del dueño); los de las respuestas guardadas
-- se conservan mientras exista la respuesta.
--
-- Aplicar en cada base (tienda y gimnasio).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  26214400, -- 25 MB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'video/mp4', 'video/3gpp', 'video/quicktime',
    'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/webm'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Un archivo de un mensaje, enviado o recibido. platform_message_id es el id de
-- la plataforma (wamid, mid), el mismo que devuelve la lista de Zernio.
create table if not exists public.message_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  platform_message_id text not null,
  attachment_index smallint not null default 0,
  direction text not null check (direction in ('inbound', 'outbound')),
  kind text not null check (kind in ('image', 'video', 'audio', 'file', 'sticker')),
  storage_path text,
  mime_type text,
  file_name text,
  size_bytes bigint,
  status text not null default 'stored' check (status in ('stored', 'too_large', 'failed', 'expired')),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint message_media_message_unique unique (conversation_id, platform_message_id, attachment_index)
);

create index if not exists idx_message_media_conversation on public.message_media(conversation_id, created_at desc);
-- Apoyo de la limpieza de los 2 meses.
create index if not exists idx_message_media_stored_age on public.message_media(created_at) where status = 'stored';

alter table public.message_media enable row level security;
drop policy if exists message_media_select on public.message_media;
create policy message_media_select on public.message_media
  for select using (
    exists (
      select 1 from public.conversations conv
      where conv.id = message_media.conversation_id and public.can_see_contact(conv.contact_id)
    )
  );
-- Sin políticas de escritura: solo el servidor (clave de servicio) registra archivos.

-- Archivo de una respuesta guardada: attachment_url (ya existía) guarda la ruta
-- dentro del bucket chat-media.
alter table public.saved_replies add column if not exists attachment_name text;
alter table public.saved_replies add column if not exists attachment_mime text;
alter table public.saved_replies add column if not exists attachment_size bigint;
