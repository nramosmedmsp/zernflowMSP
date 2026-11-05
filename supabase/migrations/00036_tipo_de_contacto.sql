-- Tanda 9: tipo de contacto visible y confirmado en el chat.
--
-- 1. contacts.contact_type_confirmed_at / _by: cuándo y quién confirmó el tipo
--    (una persona, al responder la pregunta del chat o al cambiarlo a mano).
--    NULL = "Sin confirmar": se asignó solo al llegar. Un cambio automático (regla,
--    inactividad, importación) NO confirma.
-- 2. contacts.contact_type_prompt_snoozed_until: "Preguntar después" (7 días).
-- 3. contact_types.description: texto corto que se muestra en el menú del chip.
-- 4. Ajuste de inactividad automática: workspaces.settings.contact_type_inactivity
--    = { "enabled": bool, "type_id": uuid, "days": int }. Se enciende solo en los
--    espacios que ya tienen un tipo activo llamado "Inactivo" (90 días); el resto
--    lo activa el dueño en Configuración → Tipos de contacto.
-- 5. Historial: se reutiliza `activity` (type = 'contact_type_changed'), que ya
--    guarda de/a (from_value/to_value), quién (actor_id, NULL = automático) y la
--    fecha. El origen y el motivo van en meta: { source, reason_text }.
--    No hay tabla nueva: su RLS (activity_select) ya sigue la visibilidad del
--    contacto y solo escribe el servidor.
-- 6. Índices para la tarea diaria de inactividad y el historial de la ficha.
--
-- Aditiva: no borra ni cambia datos existentes salvo el relleno de abajo.
-- Escrituras: solo por acciones del servidor con el cliente de servicio (00031 ya
-- retiró el UPDATE directo de contacts a los usuarios; las columnas nuevas lo heredan).
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código de la
-- tanda 9. Es segura con el código anterior: las columnas nuevas son opcionales
-- y el código viejo no las lee ni las escribe. Si el código se desplegara primero,
-- la bandeja seguiría funcionando (lee contactos con select *), pero la pregunta
-- del chat, "Preguntar después", la descripción y la inactividad automática no
-- guardarían nada hasta migrar.

alter table public.contacts
  add column if not exists contact_type_confirmed_at timestamptz,
  add column if not exists contact_type_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists contact_type_prompt_snoozed_until timestamptz;

alter table public.contact_types
  add column if not exists description text;

alter table public.contact_types
  drop constraint if exists contact_types_description_len;
alter table public.contact_types
  add constraint contact_types_description_len
  check (description is null or char_length(description) <= 200);

-- Tarea diaria de inactividad: gestiones ganadas por fecha de cierre.
create index if not exists idx_cases_won_closed
  on public.cases(workspace_id, closed_at)
  where status = 'won';

-- Historial del tipo por contacto (últimos cambios en la ficha).
create index if not exists idx_activity_contact_type_changes
  on public.activity(contact_id, created_at desc)
  where type = 'contact_type_changed';

-- Relleno: quien ya compró (gestión ganada) o ya tiene un tipo distinto del de
-- por defecto, queda confirmado. La fecha es la de su última venta ganada (o
-- la del alta), NO la de hoy: así la inactividad automática no queda frenada
-- por este relleno. confirmed_by queda NULL (no hay una persona detrás).
update public.contacts c
   set contact_type_confirmed_at = coalesce(
         (select max(k.closed_at) from public.cases k where k.contact_id = c.id and k.status = 'won'),
         c.created_at
       )
 where c.contact_type_confirmed_at is null
   and (
     exists (select 1 from public.cases k where k.contact_id = c.id and k.status = 'won')
     or (
       c.contact_type_id is not null
       and not exists (
         select 1 from public.contact_types t
          where t.id = c.contact_type_id and t.is_default
       )
     )
   );

-- Inactividad automática: encendida solo donde ya existe el tipo "Inactivo".
update public.workspaces w
   set settings = coalesce(w.settings, '{}'::jsonb) || jsonb_build_object(
         'contact_type_inactivity',
         jsonb_build_object('enabled', true, 'type_id', t.id, 'days', 90)
       )
  from (
    select distinct on (workspace_id) workspace_id, id
      from public.contact_types
     where archived_at is null and lower(btrim(name)) = 'inactivo'
     order by workspace_id, position
  ) t
 where t.workspace_id = w.id
   and not (coalesce(w.settings, '{}'::jsonb) ? 'contact_type_inactivity');
