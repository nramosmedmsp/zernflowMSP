-- Registro de cambios (pantalla de Configuración, solo Dueño y Administrador).
-- Aditiva e idempotente: solo crea un índice.
--
-- POR QUÉ
--   `activity` guarda el historial normal de los contactos (etapas, asignaciones,
--   notas...), que crece sin parar, y además unas pocas filas "de auditoría"
--   (config_changed, importaciones, correcciones/descargas/borrado de datos de
--   clientes y cambios de permiso de publicidad hechos por una persona). La pantalla
--   pide solo estas últimas, de la más reciente a la más antigua, 50 por página, con
--   paginación por clave (created_at, id). Con idx_activity_workspace_created
--   (espacio, fecha) Postgres tendría que recorrer TODO el historial del espacio
--   filtrando por tipo hasta juntar 50 filas.
--
-- QUÉ HACE
--   Un índice parcial (espacio, fecha desc, id desc) solo con esas filas. La consulta de
--   la app repite exactamente este mismo filtro de tipos (lib/audit-labels.ts,
--   AUDIT_ROW_FILTER); si cambias uno, cambia el otro.
--
-- SEGURIDAD DE APLICARLA
--   Crear un índice sobre `activity` toma un bloqueo que frena las ESCRITURAS mientras
--   se construye (las lecturas siguen). La tabla es pequeña y el índice parcial es
--   diminuto; con lock_timeout de 10 s, si hubiera una transacción larga abierta falla
--   limpio y se reintenta. No cambia datos ni políticas.

set local lock_timeout = '10s';

create index if not exists idx_activity_audit_log
  on public.activity (workspace_id, created_at desc, id desc)
  where type in (
      'config_changed', 'contacts_imported', 'contact_data_corrected', 'contact_data_exported',
      'contact_data_erased', 'contact_data_erase_files_retried'
    )
    or (type in ('contact_subscribed', 'contact_unsubscribed') and actor_id is not null);

notify pgrst, 'reload schema';
