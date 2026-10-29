-- Tanda 7B: secuencias robustas (R2-B1, R2-B3).
--
-- Cada paso de una secuencia pasa a tener un id estable (dentro del JSON de
-- `sequences.steps`), y la inscripción guarda el id del paso en el que va.
-- Así, editar los pasos de una secuencia activa (agregar, quitar o reordenar)
-- no desordena a quienes ya están dentro. Aditiva: no borra nada. Las
-- inscripciones que ya existan quedan con NULL y siguen usando el número de paso.
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código de la
-- tanda 7B (el código escribe esta columna; sin ella, las inscripciones y los
-- avances de paso fallan). Es segura de aplicar con el código anterior.

alter table public.sequence_enrollments
  add column if not exists current_step_id text;
