-- Tanda 3 (previa a producción): consentimiento de publicidad y datos del cliente.
--
-- Qué hace (todo aditivo e idempotente):
--
-- 1. Consentimiento de publicidad en `contacts` (PRIV-01). Cinco columnas nuevas:
--      marketing_status      'unknown' (sin registrar) | 'accepted' (aceptó) | 'opted_out' (baja)
--      marketing_status_at   cuándo se anotó el estado actual
--      marketing_source      de dónde salió: 'manual' (un asesor), 'keyword' (palabra clave de
--                            Configuración), 'import' (declaración al importar), 'flow' (un flujo),
--                            'legacy' (ya estaba de baja antes de esta migración), 'erased'
--      marketing_set_by      quién lo anotó (null = el propio cliente o el sistema)
--      marketing_note        nota libre o versión del texto que aceptó
--    Los contactos existentes pasan a 'unknown', salvo los que ya tenían
--    is_subscribed = false, que pasan a 'opted_out' (origen 'legacy').
--
-- 2. Convivencia con `is_subscribed` (que mucho código y los flujos siguen usando).
--    Regla: is_subscribed = (marketing_status <> 'opted_out'), es decir "no se dio de
--    baja". Un trigger BEFORE INSERT/UPDATE (sync_contact_consent) lo mantiene siempre
--    coherente, venga el cambio de donde venga:
--      * Código nuevo: cambia marketing_status y el trigger ajusta is_subscribed.
--      * Código anterior o flujos: cambian is_subscribed = false -> baja ('flow');
--        is_subscribed = true sobre una baja -> 'accepted' (origen 'flow', el cliente
--        pidió el alta). Poner true sobre quien no estaba de baja no cambia nada.
--    Así el código anterior sigue funcionando con la migración aplicada.
--    La publicidad (difusiones, secuencias, plantillas de publicidad) pide
--    marketing_status = 'accepted'; is_subscribed solo dice "no está de baja".
--
-- 3. Borrado de los datos de un cliente (PRIV-06 / BD-10, solo contacto):
--      * contact_erasures: registro de cada borrado (quién, cuándo, qué se quitó y qué
--        archivos faltan por borrar del almacenamiento). Los administradores lo leen;
--        escribe solo el servidor.
--      * erase_contact_data(espacio, contacto, quien): UNA transacción que anonimiza el
--        contacto y borra mensajes, archivos (filas), notas, canales, campos, etiquetas,
--        sesiones de flujo, inscripciones, destinatarios de difusión y avisos del
--        cliente. Conserva la fila del contacto SIN datos personales ("Cliente
--        eliminado", de baja) y sus gestiones sin texto libre (los reclamos conservan
--        además la solución escrita). Devuelve la lista de archivos del almacenamiento
--        para que la app los borre y, si falla, quede pendiente y se pueda reintentar.
--      * Se quita el borrado directo de contactos para usuarios (contacts_delete): un
--        borrado por la API dejaba archivos huérfanos y sin registro. La app no lo usa
--        (sus borrados internos van con la clave de servicio).
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código. Es segura
-- con el código anterior (solo agrega columnas con valor por defecto, un trigger que
-- mantiene is_subscribed y objetos nuevos que ese código no usa). Si el código nuevo
-- corriera SIN la migración, las pantallas de contactos y las difusiones fallarían
-- (consultan las columnas nuevas): por eso va primero.
-- Es idempotente: se puede volver a ejecutar.

set local lock_timeout = '10s';

-- ============================================================
-- 1. Columnas de consentimiento
-- ============================================================

alter table public.contacts
  add column if not exists marketing_status text not null default 'unknown',
  add column if not exists marketing_status_at timestamptz,
  add column if not exists marketing_source text,
  add column if not exists marketing_set_by uuid references auth.users(id) on delete set null,
  add column if not exists marketing_note text,
  add column if not exists erased_at timestamptz,
  add column if not exists erased_by uuid references auth.users(id) on delete set null;

alter table public.contacts drop constraint if exists contacts_marketing_status_check;
alter table public.contacts
  add constraint contacts_marketing_status_check
  check (marketing_status in ('unknown', 'accepted', 'opted_out'));

alter table public.contacts drop constraint if exists contacts_marketing_note_check;
alter table public.contacts
  add constraint contacts_marketing_note_check
  check (marketing_note is null or char_length(marketing_note) <= 500);

comment on column public.contacts.marketing_status is
  'Consentimiento de publicidad: unknown (sin registrar), accepted (aceptó), opted_out (baja). is_subscribed = (marketing_status <> ''opted_out'') lo mantiene el trigger sync_contact_consent.';
comment on column public.contacts.marketing_source is
  'Origen del estado: manual, keyword, import, flow, legacy, erased.';
comment on column public.contacts.erased_at is
  'Cuándo se borraron los datos personales del cliente (la fila queda anónima). Ver erase_contact_data.';

-- Contactos que ya estaban de baja antes de esta migración.
update public.contacts
   set marketing_status = 'opted_out',
       marketing_status_at = now(),
       marketing_source = 'legacy'
 where is_subscribed = false
   and marketing_status = 'unknown';

-- Apoyo del filtro de Contactos y del cálculo de destinatarios.
create index if not exists idx_contacts_marketing_status
  on public.contacts (workspace_id, marketing_status);

-- ============================================================
-- 2. Trigger de convivencia con is_subscribed
-- ============================================================

create or replace function public.sync_contact_consent()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Código anterior que crea un contacto ya dado de baja.
    if new.is_subscribed is false and new.marketing_status = 'unknown' then
      new.marketing_status := 'opted_out';
      new.marketing_status_at := coalesce(new.marketing_status_at, now());
      new.marketing_source := coalesce(new.marketing_source, 'legacy');
    end if;
    new.is_subscribed := (new.marketing_status <> 'opted_out');
    return new;
  end if;

  if new.marketing_status is distinct from old.marketing_status then
    -- Cambio hecho con el modelo nuevo: gana marketing_status.
    if new.marketing_status_at is not distinct from old.marketing_status_at then
      new.marketing_status_at := now();
    end if;
    new.is_subscribed := (new.marketing_status <> 'opted_out');
  elsif new.is_subscribed is distinct from old.is_subscribed then
    -- Cambio hecho con el código anterior o por un flujo (baja o alta).
    if new.is_subscribed is false then
      new.marketing_status := 'opted_out';
      new.marketing_source := 'flow';
      new.marketing_set_by := null;
      new.marketing_note := null;
      new.marketing_status_at := now();
    elsif old.marketing_status = 'opted_out' then
      new.marketing_status := 'accepted';
      new.marketing_source := 'flow';
      new.marketing_set_by := null;
      new.marketing_note := null;
      new.marketing_status_at := now();
    else
      -- Ya no estaba de baja: is_subscribed vuelve a decir lo que corresponde.
      new.is_subscribed := true;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_contact_consent() from public, anon, authenticated;

drop trigger if exists sync_contact_consent on public.contacts;
create trigger sync_contact_consent
  before insert or update on public.contacts
  for each row execute function public.sync_contact_consent();

-- ============================================================
-- 3. Registro de borrados y borrado de un cliente
-- ============================================================

create table if not exists public.contact_erasures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Sin llave foránea a propósito: es solo la constancia; la fila anónima del contacto sigue existiendo.
  contact_id uuid not null,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  -- Cuántas cosas se quitaron y qué se conservó (solo números, sin datos personales).
  summary jsonb not null default '{}'::jsonb,
  -- Archivos del almacenamiento que faltan por borrar (vacío = todo borrado).
  files_pending text[] not null default '{}',
  files_total integer not null default 0,
  files_done_at timestamptz,
  last_file_error text,
  file_attempts integer not null default 0
);

create index if not exists idx_contact_erasures_contact on public.contact_erasures (contact_id, requested_at desc);
create index if not exists idx_contact_erasures_workspace on public.contact_erasures (workspace_id, requested_at desc);

alter table public.contact_erasures enable row level security;
drop policy if exists contact_erasures_select on public.contact_erasures;
create policy contact_erasures_select on public.contact_erasures
  for select using (public.is_ws_admin(workspace_id));
revoke all on public.contact_erasures from public, anon, authenticated;
grant select on public.contact_erasures to authenticated;
grant select, insert, update, delete on public.contact_erasures to service_role;

comment on table public.contact_erasures is
  'Constancia de cada borrado de datos de un cliente y de los archivos que faltan por quitar del almacenamiento (lib/contact-erase.ts).';

create or replace function public.erase_contact_data(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.contacts%rowtype;
  v_paths text[];
  v_extra text[];
  v_erasure uuid;
  v_conversations integer;
  v_messages integer;
  v_files integer;
  v_notes integer;
  v_cases integer;
  v_claims integer;
begin
  select * into v_contact
    from public.contacts
   where id = p_contact_id and workspace_id = p_workspace_id
   for update;
  if not found then
    raise exception 'contact_not_found' using errcode = 'P0002';
  end if;
  if v_contact.erased_at is not null then
    return jsonb_build_object('already_erased', true);
  end if;

  -- Archivos: los que registran las filas de message_media y cualquier otro que haya
  -- quedado en la carpeta de sus chats (por ejemplo un archivo subido y nunca enviado).
  select coalesce(array_agg(distinct mm.storage_path) filter (where mm.storage_path is not null), '{}')
    into v_paths
    from public.message_media mm
    join public.conversations c on c.id = mm.conversation_id
   where c.contact_id = p_contact_id;

  -- Los archivos sueltos son un extra: si el almacenamiento no se puede consultar desde aquí,
  -- se sigue solo con los que registra message_media (nunca se aborta el borrado por esto).
  if to_regclass('storage.objects') is not null then
    begin
      execute $q$
        select coalesce(array_agg(distinct o.name), '{}')
          from storage.objects o
          join public.conversations c
            on o.name like $1 || '/conv/' || c.id::text || '/%'
         where o.bucket_id = 'chat-media'
           and c.contact_id = $2
      $q$ into v_extra using p_workspace_id::text, p_contact_id;
      select coalesce(array_agg(distinct p), '{}') into v_paths
        from unnest(v_paths || coalesce(v_extra, '{}')) as p;
    exception when others then
      raise warning 'erase_contact_data: no se pudo listar el almacenamiento (%)', sqlerrm;
    end;
  end if;

  select count(*) into v_conversations from public.conversations where contact_id = p_contact_id;
  select count(*) into v_messages
    from public.messages m join public.conversations c on c.id = m.conversation_id
   where c.contact_id = p_contact_id;
  select count(*) into v_files
    from public.message_media mm join public.conversations c on c.id = mm.conversation_id
   where c.contact_id = p_contact_id;
  select count(*) into v_notes from public.case_notes where contact_id = p_contact_id;
  select count(*) into v_cases from public.cases where contact_id = p_contact_id;
  select count(*) into v_claims
    from public.cases ca join public.case_types ct on ct.id = ca.case_type_id
   where ca.contact_id = p_contact_id and ct.protected;

  -- Mensajes y archivos (las conversaciones quedan vacías, sin vínculo con la plataforma).
  delete from public.message_media
   where conversation_id in (select id from public.conversations where contact_id = p_contact_id);
  delete from public.messages
   where conversation_id in (select id from public.conversations where contact_id = p_contact_id);
  update public.conversations
     set late_conversation_id = null,
         last_message_preview = null,
         complaint_excerpt = null,
         status = 'closed',
         unread_count = 0
   where contact_id = p_contact_id;

  -- Notas internas (texto libre).
  delete from public.case_notes where contact_id = p_contact_id;

  -- Gestiones: se conservan con su tipo, pasos, fechas y resultado, sin texto libre.
  -- En los reclamos (tipos protegidos) se conserva además la solución escrita.
  update public.cases c
     set next_action_note = null,
         close_request = null,
         outcome_note = case
           when coalesce((select ct.protected from public.case_types ct where ct.id = c.case_type_id), false)
           then c.outcome_note end,
         solution_note = case
           when coalesce((select ct.protected from public.case_types ct where ct.id = c.case_type_id), false)
           then c.solution_note end
   where c.contact_id = p_contact_id;

  -- Historial: el que no es de una gestión se borra; el de las gestiones pierde el texto libre.
  delete from public.activity where contact_id = p_contact_id and case_id is null;
  update public.activity
     set meta = meta - 'text' - 'name' - 'comment' - 'excerpt' - 'params' - 'error' - 'keyword' - 'note'
   where contact_id = p_contact_id and case_id is not null;

  -- Identificadores, campos, etiquetas y todo lo que ligue a la persona.
  delete from public.contact_channels where contact_id = p_contact_id;
  delete from public.contact_custom_fields where contact_id = p_contact_id;
  delete from public.contact_tags where contact_id = p_contact_id;
  delete from public.flow_sessions where contact_id = p_contact_id;
  delete from public.sequence_enrollments where contact_id = p_contact_id;
  delete from public.broadcast_recipients where contact_id = p_contact_id;
  delete from public.notifications where link like '%' || p_contact_id::text || '%';
  delete from public.scheduled_jobs where status = 'pending' and payload::text like '%' || p_contact_id::text || '%';
  update public.analytics_events set contact_id = null where contact_id = p_contact_id;

  -- El contacto queda anónimo y de baja de publicidad para siempre.
  update public.contacts
     set display_name = 'Cliente eliminado',
         email = null,
         phone = null,
         avatar_url = null,
         metadata = null,
         source = jsonb_build_object('erased', true),
         key_date = null,
         is_subscribed = false,
         marketing_status = 'opted_out',
         marketing_status_at = now(),
         marketing_source = 'erased',
         marketing_set_by = p_actor_id,
         marketing_note = null,
         erased_at = now(),
         erased_by = p_actor_id
   where id = p_contact_id;

  insert into public.contact_erasures (workspace_id, contact_id, requested_by, summary, files_pending, files_total)
  values (
    p_workspace_id,
    p_contact_id,
    p_actor_id,
    jsonb_build_object(
      'conversations', v_conversations,
      'messages', v_messages,
      'files', v_files,
      'notes', v_notes,
      'cases_kept', v_cases,
      'claims_kept', v_claims
    ),
    v_paths,
    coalesce(array_length(v_paths, 1), 0)
  )
  returning id into v_erasure;

  -- Si no había archivos, el borrado ya está completo.
  update public.contact_erasures set files_done_at = now()
   where id = v_erasure and files_total = 0;

  insert into public.activity (workspace_id, contact_id, type, actor_id, meta)
  values (
    p_workspace_id,
    p_contact_id,
    'contact_data_erased',
    p_actor_id,
    jsonb_build_object('erasure_id', v_erasure, 'cases_kept', v_cases, 'claims_kept', v_claims)
  );

  return jsonb_build_object(
    'already_erased', false,
    'erasure_id', v_erasure,
    'paths', to_jsonb(v_paths),
    'summary', jsonb_build_object(
      'conversations', v_conversations,
      'messages', v_messages,
      'files', v_files,
      'notes', v_notes,
      'cases_kept', v_cases,
      'claims_kept', v_claims
    )
  );
end;
$$;

revoke all on function public.erase_contact_data(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.erase_contact_data(uuid, uuid, uuid) to service_role;

-- ============================================================
-- 4. Sin borrado directo de contactos para usuarios
-- ============================================================
-- El borrado de un cliente se hace con erase_contact_data (deja constancia y borra los
-- archivos). El administrador ya no puede borrar contactos por la API de datos.
drop policy if exists contacts_delete on public.contacts;
revoke delete on public.contacts from anon, authenticated;
