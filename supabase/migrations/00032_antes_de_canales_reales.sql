-- Revisión general, tanda 3: antes de conectar el WhatsApp e Instagram reales.
--
-- Cambios (solo aditivos; sin ellos el código nuevo falla al leer las columnas,
-- así que se aplica ANTES de desplegar el código; el código anterior sigue
-- funcionando con la migración ya aplicada):
--
--  * conversations.last_inbound_at (A-8): fecha del último mensaje del cliente.
--    En los canales reales los mensajes los guarda Zernio, no la tabla
--    `messages`; sin esta columna la ventana de 24 h de WhatsApp (difusiones de
--    texto, secuencias) siempre sale cerrada. El webhook la sella con cada
--    mensaje entrante y la simulación de los canales de prueba también.
--  * message_media.fetch_attempts (M-13): cuántas veces se intentó copiar el
--    archivo; permite reintentar los que quedaron "fallidos" con un límite.

alter table public.conversations
  add column if not exists last_inbound_at timestamptz;

-- Relleno para lo que ya existe: el último mensaje entrante guardado (canales
-- de prueba) o, si no hay, el último mensaje entrante registrado en las
-- gestiones del contacto (cases.last_inbound_at, que sí se sella en canales reales).
update public.conversations c
set last_inbound_at = coalesce(
  (select max(m.created_at) from public.messages m
    where m.conversation_id = c.id and m.direction = 'inbound'),
  (select max(k.last_inbound_at) from public.cases k
    where k.contact_id = c.contact_id and k.workspace_id = c.workspace_id)
)
where c.last_inbound_at is null;

alter table public.message_media
  add column if not exists fetch_attempts smallint not null default 1;
