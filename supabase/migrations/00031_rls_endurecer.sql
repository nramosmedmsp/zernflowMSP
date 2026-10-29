-- ============================================================
-- 00031: endurecer las reglas de la base (revisión de seguridad, tanda 1)
-- ============================================================
-- Hallazgos A-1, A-2, A-3, A-4, M-1 y B-1 a B-4 de la revisión general.
--
-- Principio: los usuarios (anon y authenticated, o sea quien escribe desde el
-- navegador con su sesión) conservan solo los permisos de escritura que la app
-- usa de verdad con su cliente. Todo lo demás lo escribe el servidor con la
-- clave de servicio (service_role, que no pasa por RLS ni por estos permisos),
-- después de validar el rol en código.
--
-- Lo que SÍ escribe el navegador hoy (revisado con grep en components/ y app/):
--   * conversations.unread_count (poner en 0 al abrir el chat).
--   * Tablas de configuración de administradores (flows, channels.is_active,
--     triggers, broadcasts...): no se tocan aquí, siguen con sus políticas.
--   * Subida de archivos al bucket chat-media con enlace firmado (no usa
--     políticas de storage.objects; ver el comentario al final).
--
-- No borra ni modifica datos, salvo que el índice único de canales (A-4)
-- detecte duplicados: en ese caso la migración se detiene con un mensaje claro
-- para resolverlos a mano. En producción hay 2 canales demo y ningún duplicado.
-- Se puede volver a ejecutar sin errores (idempotente).

-- ------------------------------------------------------------
-- Helper: ¿supervisor de algún equipo activo de este espacio?
-- ------------------------------------------------------------
-- La usa analytics_events (B-2): administradores y supervisores leen los
-- eventos (las Métricas de supervisor cuentan mensajes entrantes); asesores no.
create or replace function public.is_ws_supervisor(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.workspace_members wm
      on wm.workspace_id = t.workspace_id and wm.user_id = tm.user_id
    where t.workspace_id = ws
      and tm.user_id = auth.uid()
      and tm.role = 'supervisor'
      and t.archived_at is null
  );
$$;

revoke all on function public.is_ws_supervisor(uuid) from public, anon;
grant execute on function public.is_ws_supervisor(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- A-1: contact_channels, nadie mueve un número de WhatsApp/Instagram de contacto
-- ------------------------------------------------------------
-- Ninguna pantalla actualiza esta tabla. Crear y borrar siguen siendo del
-- administrador (políticas de 00019); el servidor usa la clave de servicio.
drop policy if exists contact_channels_update on public.contact_channels;
revoke update on public.contact_channels from anon, authenticated;

-- ------------------------------------------------------------
-- A-3: conversations, el usuario solo puede poner en cero "no leídos"
-- ------------------------------------------------------------
-- Se quita el UPDATE de toda la tabla y se concede solo la columna unread_count
-- (inbox-view.tsx). Asignación, reclamo, contacto, espacio, bot pausado, etc.
-- pasan por las acciones del servidor.
-- Crear conversaciones lo hace el servidor (webhook y sincronización de la
-- bandeja con la clave de servicio): se quita el INSERT de usuarios.
drop policy if exists conversations_insert on public.conversations;
revoke insert, update on public.conversations from anon, authenticated;
grant update (unread_count) on public.conversations to authenticated;

-- ------------------------------------------------------------
-- M-1: messages, solo el servidor registra mensajes
-- ------------------------------------------------------------
-- messages_insert (00026) dejaba a cualquiera que ve el chat crear filas con
-- cualquier dirección, estado y id de plataforma. Los mensajes los escribe el
-- servidor (lib/outbound-log.ts, webhook, demo, secuencias); el navegador solo
-- lee (y recibe por Realtime, que usa la política de lectura).
drop policy if exists messages_insert on public.messages;
revoke insert, update, delete on public.messages from anon, authenticated;

-- ------------------------------------------------------------
-- B-1: contacts, el usuario no edita contactos por la base
-- ------------------------------------------------------------
-- Las acciones del servidor (lib/actions/contacts.ts, cases.ts, import.ts, el
-- webhook) escriben con la clave de servicio y validan permisos en código.
-- Crear y borrar siguen siendo del administrador (políticas de 00019).
drop policy if exists contacts_update on public.contacts;
revoke update on public.contacts from anon, authenticated;

-- Etiquetas y campos personalizados del contacto: solo administradores por la
-- base (la pantalla ya los cambia por acciones del servidor).
drop policy if exists contact_tags_insert on public.contact_tags;
drop policy if exists contact_tags_update on public.contact_tags;
drop policy if exists contact_tags_delete on public.contact_tags;
create policy contact_tags_insert on public.contact_tags
  for insert with check (
    exists (
      select 1
      from public.contacts c
      join public.tags t on t.workspace_id = c.workspace_id
      where c.id = contact_tags.contact_id
        and t.id = contact_tags.tag_id
        and public.is_ws_admin(c.workspace_id)
    )
  );
create policy contact_tags_delete on public.contact_tags
  for delete using (
    exists (
      select 1 from public.contacts c
      where c.id = contact_tags.contact_id and public.is_ws_admin(c.workspace_id)
    )
  );
revoke update on public.contact_tags from anon, authenticated;

drop policy if exists contact_custom_fields_insert on public.contact_custom_fields;
drop policy if exists contact_custom_fields_update on public.contact_custom_fields;
drop policy if exists contact_custom_fields_delete on public.contact_custom_fields;
create policy contact_custom_fields_insert on public.contact_custom_fields
  for insert with check (
    exists (
      select 1
      from public.contacts c
      join public.custom_field_definitions f on f.workspace_id = c.workspace_id
      where c.id = contact_custom_fields.contact_id
        and f.id = contact_custom_fields.field_id
        and public.is_ws_admin(c.workspace_id)
    )
  );
create policy contact_custom_fields_update on public.contact_custom_fields
  for update
  using (
    exists (
      select 1 from public.contacts c
      where c.id = contact_custom_fields.contact_id and public.is_ws_admin(c.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from public.contacts c
      join public.custom_field_definitions f on f.workspace_id = c.workspace_id
      where c.id = contact_custom_fields.contact_id
        and f.id = contact_custom_fields.field_id
        and public.is_ws_admin(c.workspace_id)
    )
  );
create policy contact_custom_fields_delete on public.contact_custom_fields
  for delete using (
    exists (
      select 1 from public.contacts c
      where c.id = contact_custom_fields.contact_id and public.is_ws_admin(c.workspace_id)
    )
  );

-- ------------------------------------------------------------
-- A-2: saved_replies, el archivo adjunto solo lo escribe el servidor
-- ------------------------------------------------------------
-- Un usuario podía poner como adjunto de su respuesta personal la ruta de
-- cualquier archivo del bucket; al borrarla, la app borraba ese archivo, y al
-- abrirla, lo entregaba. Ahora:
--  1) con sesión de usuario no se puede crear ni cambiar ninguna columna
--     attachment_* (las escribe el servidor con la clave de servicio, que
--     antes valida la ruta y que el archivo exista);
--  2) la ruta debe ser {espacio de la fila}/replies/{uuid}.{ext};
--  3) un mismo archivo no lo puede usar más de una respuesta.
create or replace function public.guard_saved_reply_attachment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Clave de servicio o conexión directa: sin usuario.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.attachment_url is not null
       or new.attachment_name is not null
       or new.attachment_mime is not null
       or new.attachment_size is not null then
      raise exception 'saved_reply_attachment_server_only'
        using errcode = '42501',
              hint = 'El archivo de una respuesta guardada solo lo registra el servidor.';
    end if;
  elsif (new.attachment_url, new.attachment_name, new.attachment_mime, new.attachment_size)
        is distinct from
        (old.attachment_url, old.attachment_name, old.attachment_mime, old.attachment_size) then
    raise exception 'saved_reply_attachment_server_only'
      using errcode = '42501',
            hint = 'El archivo de una respuesta guardada solo lo registra el servidor.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_saved_reply_attachment() from public, anon, authenticated;

drop trigger if exists guard_saved_reply_attachment on public.saved_replies;
create trigger guard_saved_reply_attachment
  before insert or update on public.saved_replies
  for each row execute function public.guard_saved_reply_attachment();

-- NOT VALID: las filas que ya existen no se revisan al agregarla (no se
-- bloquea la migración); abajo se intenta validar y, si alguna fila vieja no
-- cumple, solo se avisa.
alter table public.saved_replies drop constraint if exists saved_replies_attachment_path_check;
alter table public.saved_replies
  add constraint saved_replies_attachment_path_check
  check (
    attachment_url is null
    or attachment_url ~ ('^' || workspace_id::text || '/replies/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$')
  ) not valid;

do $$
begin
  alter table public.saved_replies validate constraint saved_replies_attachment_path_check;
exception when check_violation then
  raise notice 'saved_replies: hay respuestas con una ruta de adjunto fuera de {espacio}/replies/; revisarlas a mano (la regla ya aplica a lo nuevo).';
end $$;

create unique index if not exists saved_replies_attachment_url_key
  on public.saved_replies(attachment_url)
  where attachment_url is not null;

-- ------------------------------------------------------------
-- A-4: un identificador de cuenta de Zernio, un solo canal en toda la base
-- ------------------------------------------------------------
-- El webhook identifica el canal por late_account_id. Hasta ahora era único
-- solo dentro de un espacio, así que otro espacio podía registrar el mismo.
-- Los canales de prueba ("demo-...", lib/demo.ts) se crean en cada espacio con
-- el mismo id y no existen en Zernio: quedan fuera del índice global.
do $$
declare
  v_dups text;
begin
  select string_agg(late_account_id || ' (' || n || ' canales)', ', ')
    into v_dups
  from (
    select late_account_id, count(*) n
    from public.channels
    where late_account_id is not null and late_account_id not like 'demo-%'
    group by late_account_id
    having count(*) > 1
  ) d;

  if v_dups is not null then
    raise exception 'channels: cuentas de Zernio repetidas en varios canales: %. Quedarse con un canal por cuenta (borrar o cambiar los demás) y volver a ejecutar esta migración.', v_dups
      using errcode = '23505';
  end if;
end $$;

create unique index if not exists channels_late_account_id_real_key
  on public.channels(late_account_id)
  where late_account_id is not null and late_account_id not like 'demo-%';

-- ------------------------------------------------------------
-- B-2: analytics_events y comment_logs, solo el servidor escribe
-- ------------------------------------------------------------
-- Los eventos los escribe el servidor (motor de flujos, webhook, cron). Leen
-- administradores y supervisores (Métricas); los comentarios procesados, solo
-- administradores (pantalla Crecimiento).
drop policy if exists "Users can insert analytics in their workspaces" on public.analytics_events;
drop policy if exists "Users can view analytics in their workspaces" on public.analytics_events;
drop policy if exists "Users can manage analytics in their workspaces" on public.analytics_events;
drop policy if exists analytics_events_select on public.analytics_events;
create policy analytics_events_select on public.analytics_events
  for select using (public.is_ws_admin(workspace_id) or public.is_ws_supervisor(workspace_id));
revoke insert, update, delete on public.analytics_events from anon, authenticated;

drop policy if exists "Users can view comment logs in their workspace" on public.comment_logs;
drop policy if exists comment_logs_select on public.comment_logs;
create policy comment_logs_select on public.comment_logs
  for select using (public.is_ws_admin(workspace_id));
revoke insert, update, delete on public.comment_logs from anon, authenticated;

-- ------------------------------------------------------------
-- B-3: workspace_invites, solo administradores leen; las maneja el servidor
-- ------------------------------------------------------------
-- La política de update (00006) comparaba el correo del invitado y no tenía
-- with check: un invitado podía cambiar su propia invitación (rol, espacio).
-- Las invitaciones las crean, aceptan y borran las acciones del servidor
-- (lib/actions/team.ts, trigger handle_new_user).
drop policy if exists workspace_invites_update on public.workspace_invites;
drop policy if exists workspace_invites_select on public.workspace_invites;
drop policy if exists workspace_invites_insert on public.workspace_invites;
drop policy if exists workspace_invites_delete on public.workspace_invites;
create policy workspace_invites_select on public.workspace_invites
  for select using (public.is_ws_admin(workspace_id));
create policy workspace_invites_insert on public.workspace_invites
  for insert with check (public.ws_role(workspace_id) = 'owner' and role <> 'owner');
create policy workspace_invites_delete on public.workspace_invites
  for delete using (public.ws_role(workspace_id) = 'owner');
revoke update on public.workspace_invites from anon, authenticated;

-- ------------------------------------------------------------
-- Higiene de permisos de las tablas tocadas aquí
-- ------------------------------------------------------------
-- anon (sin sesión) no usa ninguna de estas tablas desde el navegador.
-- TRUNCATE, REFERENCES y TRIGGER no los usa nadie con su sesión (y TRUNCATE no
-- pasa por RLS).
revoke all on public.conversations, public.contact_channels, public.contacts,
  public.messages, public.saved_replies, public.analytics_events,
  public.comment_logs, public.workspace_invites,
  public.contact_tags, public.contact_custom_fields
  from anon;
revoke truncate, references, trigger on public.conversations, public.contact_channels,
  public.contacts, public.messages, public.saved_replies, public.analytics_events,
  public.comment_logs, public.workspace_invites,
  public.contact_tags, public.contact_custom_fields
  from authenticated;

-- ------------------------------------------------------------
-- B-4: funciones security definer, permisos mínimos y ruta fija
-- ------------------------------------------------------------
-- Las funciones auxiliares de las políticas las usa quien tiene sesión; anon
-- y public no las necesitan (los lints 0028/0029 de Supabase). authenticated
-- y service_role las conservan: las políticas se evalúan con el permiso de
-- quien consulta.
revoke all on function public.can_see_contact(uuid) from public, anon;
revoke all on function public.can_see_contact_row(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.is_team_member(uuid) from public, anon;
revoke all on function public.is_team_supervisor(uuid) from public, anon;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_ws_admin(uuid) from public, anon;
revoke all on function public.ws_has_teams(uuid) from public, anon;
revoke all on function public.ws_role(uuid) from public, anon;
grant execute on function public.can_see_contact(uuid) to authenticated, service_role;
grant execute on function public.can_see_contact_row(uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.is_team_member(uuid) to authenticated, service_role;
grant execute on function public.is_team_supervisor(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.is_ws_admin(uuid) to authenticated, service_role;
grant execute on function public.ws_has_teams(uuid) to authenticated, service_role;
grant execute on function public.ws_role(uuid) to authenticated, service_role;

-- Trigger de alta de usuarios: lo dispara auth.users, nadie lo llama.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Contadores (ya restringidos a service_role en 00019): ruta de búsqueda fija.
alter function public.increment_unread(uuid, text) set search_path = public;
alter function public.increment_broadcast_sent(uuid) set search_path = public;
alter function public.increment_broadcast_failed(uuid) set search_path = public;

-- Funciones de trigger / validación sin ruta fija.
alter function public.update_updated_at() set search_path = public;
alter function public.set_case_assigned_at() set search_path = public;
alter function public.is_valid_business_hours(jsonb) set search_path = public;

-- rls_auto_enable existe en la base de producción (la creó la plataforma) y no
-- estaba en el repo. Es el disparador de eventos que activa RLS en cada tabla
-- nueva de public. Se deja la misma definición, solo para que las bases
-- nuevas la tengan, y se le quita el permiso de ejecución a los usuarios: la
-- ejecuta el motor al crear tablas, nadie debe llamarla.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
  tbl name;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public')
       and cmd.schema_name not in ('pg_catalog', 'information_schema')
       and cmd.schema_name not like 'pg_toast%' and cmd.schema_name not like 'pg_temp%' then
      begin
        select c.relname into tbl from pg_catalog.pg_class c where c.oid = cmd.objid;
        execute format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$$;

revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;

-- El disparador ya existe en producción (ensure_rls). Si falta en otra base se
-- crea; si el rol que aplica la migración no puede crear disparadores de
-- eventos, solo se avisa.
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
exception when insufficient_privilege then
  raise notice 'No se pudo crear el disparador ensure_rls (falta permiso); crearlo con un rol con permisos.';
end $$;

-- ------------------------------------------------------------
-- storage.objects (chat-media)
-- ------------------------------------------------------------
-- El bucket chat-media es privado y storage.objects no tiene ninguna política
-- de acceso para usuarios (comprobado en producción: 0 políticas, RLS activo),
-- así que un usuario no puede listar, leer, escribir ni borrar archivos por la
-- API de storage. Las subidas usan enlace firmado (uploadToSignedUrl) y las
-- lecturas, enlaces firmados que crea el servidor tras revisar la RLS de
-- message_media / saved_replies. No se agrega ninguna política: no crear una
-- es la protección. El hueco real era la ruta guardada en saved_replies
-- (arriba) y el código que borraba o entregaba archivos sin validarla
-- (lib/actions/saved-replies.ts y app/api/v1/media/reply/[id]/route.ts).
