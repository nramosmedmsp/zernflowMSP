-- Tanda 10: "Guía de la gestión" en el chat.
--
-- Reemplaza el selector libre de etapas de la tarjeta de gestión por una guía
-- que dice qué hacer ahora y ofrece el siguiente paso. Todo es configurable por
-- tipo de gestión y por etapa en Configuración → Gestiones:
--
--   case_stages.guide_text  texto "Ahora:" de la etapa (hasta 200 caracteres).
--   case_stages.next_steps  pasos siguientes permitidos, en orden: arreglo JSON de
--                           { "stage_id": uuid, "label": texto opcional } (etapa
--                           abierta o final) o { "action": "remind_tomorrow",
--                           "label": texto } (ayuda: fija el próximo contacto
--                           para mañana sin cambiar la etapa). NULL o vacío =
--                           predeterminado: la siguiente etapa abierta + todas
--                           las etapas finales.
--   case_stages.requires    lo que se pide en la etapa antes de avanzar:
--                           NULL | 'category' | 'solution' | 'note'.
--   case_types.strict_order "Orden estricto para asesores" (predeterminado NO).
--                           Si está activo, un asesor solo puede pasar a los pasos
--                           siguientes configurados o volver un paso; lo exige el
--                           servidor. Supervisores, administradores y la
--                           automatización (flujos, reglas, cron) quedan exentos.
--
-- Aditiva: solo agrega columnas opcionales (o con valor predeterminado) y rellena
-- los textos y pasos de la tienda por NOMBRE de tipo y de etapa; donde un nombre
-- no existe (p. ej. el gimnasio) no hace nada. No pisa lo que ya tenga contenido.
--
-- RLS: sin cambios. case_stages y case_types ya permiten leer según el espacio y
-- escribir solo a administradores; las columnas nuevas heredan esas políticas.
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código. Es
-- segura con el código anterior (las columnas nuevas son opcionales y el código
-- viejo no las lee). Si el código se desplegara primero, la tarjeta de gestión
-- seguiría funcionando (lee las etapas con select *), pero Configuración no
-- podría guardar textos, pasos ni el orden estricto hasta migrar.

alter table public.case_stages
  add column if not exists guide_text text,
  add column if not exists next_steps jsonb,
  add column if not exists requires text;

alter table public.case_stages drop constraint if exists case_stages_guide_text_len;
alter table public.case_stages
  add constraint case_stages_guide_text_len
  check (guide_text is null or char_length(guide_text) <= 200);

alter table public.case_stages drop constraint if exists case_stages_requires_check;
alter table public.case_stages
  add constraint case_stages_requires_check
  check (requires is null or requires in ('category', 'solution', 'note'));

alter table public.case_stages drop constraint if exists case_stages_next_steps_array;
alter table public.case_stages
  add constraint case_stages_next_steps_array
  check (next_steps is null or jsonb_typeof(next_steps) = 'array');

alter table public.case_types
  add column if not exists strict_order boolean not null default false;

-- ── Relleno de la tienda: por nombre de tipo y de etapa ──────────────────────
-- Cada elemento: tipo, etapa, texto, requires y pasos [{ to: nombre de etapa,
-- label: texto opcional }] o [{ action: 'remind_tomorrow', label }].
do $seed$
declare
  seeds jsonb := $json$[
    {"type":"Venta","stage":"Nuevo interesado","guide":"Saluda y pregunta qué producto busca.","requires":null,
     "steps":[{"to":"Asesorando","label":"Ya sé qué busca"}]},
    {"type":"Venta","stage":"Asesorando","guide":"Recomienda el producto y confirma sabor, tamaño y dirección.","requires":null,
     "steps":[{"to":"Pedido o enlace de pago enviado","label":"Ya envié el pedido o enlace de pago"},{"to":"No compró"}]},
    {"type":"Venta","stage":"Pedido o enlace de pago enviado","guide":"Confirma que el cliente recibió el enlace y cómo va a pagar.","requires":null,
     "steps":[{"to":"Esperando pago"}]},
    {"type":"Venta","stage":"Esperando pago","guide":"Espera la confirmación del pago (Yape, Plin o transferencia).","requires":null,
     "steps":[{"to":"Pagado","label":"Pagó"},{"action":"remind_tomorrow","label":"Aún no, recordarle mañana"},{"to":"No compró"}]},
    {"type":"Postventa","stage":"Nueva","guide":"Pregunta qué pasó y elige la categoría.","requires":"category",
     "steps":[{"to":"En gestión"}]},
    {"type":"Postventa","stage":"En gestión","guide":"Registra la solución antes del plazo y coordina con almacén o courier.","requires":"solution",
     "steps":[{"to":"Esperando al cliente"},{"to":"Esperando almacén o courier"},{"to":"Resuelta"}]},
    {"type":"Postventa","stage":"Esperando al cliente","guide":"Espera la respuesta del cliente; si no responde, recuérdale.","requires":null,
     "steps":[{"to":"En gestión"},{"to":"Resuelta"},{"to":"Sin solución"}]},
    {"type":"Postventa","stage":"Esperando almacén o courier","guide":"Haz seguimiento al almacén o courier y avisa al cliente.","requires":null,
     "steps":[{"to":"En gestión"},{"to":"Resuelta"}]},
    {"type":"Recompra","stage":"Recordatorio enviado","guide":"Espera su respuesta; si no contesta, insiste una vez.","requires":null,
     "steps":[{"to":"Interesado"},{"to":"No compró"}]},
    {"type":"Recompra","stage":"Interesado","guide":"Arma el pedido como en una venta.","requires":null,
     "steps":[{"to":"Compró"},{"to":"No compró"}]},
    {"type":"Consulta","stage":"Abierta","guide":"Responde la consulta.","requires":null,
     "steps":[{"to":"Resuelta"}]}
  ]$json$::jsonb;
  seed jsonb;
  st record;
  step jsonb;
  steps jsonb;
  target uuid;
begin
  for seed in select * from jsonb_array_elements(seeds) loop
    for st in
      select s.id, s.case_type_id
        from public.case_stages s
        join public.case_types t on t.id = s.case_type_id
       where lower(btrim(t.name)) = lower(seed->>'type')
         and lower(btrim(s.name)) = lower(seed->>'stage')
         and s.archived_at is null
         and s.guide_text is null
         and s.next_steps is null
         and s.requires is null
    loop
      steps := '[]'::jsonb;
      for step in select * from jsonb_array_elements(seed->'steps') loop
        if step ? 'action' then
          steps := steps || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'action', step->>'action',
            'label', step->>'label')));
        else
          select x.id into target
            from public.case_stages x
           where x.case_type_id = st.case_type_id
             and x.archived_at is null
             and lower(btrim(x.name)) = lower(step->>'to')
           order by x.position
           limit 1;
          if target is not null then
            steps := steps || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
              'stage_id', target,
              'label', step->>'label')));
          end if;
        end if;
        target := null;
      end loop;

      update public.case_stages
         set guide_text = seed->>'guide',
             requires = seed->>'requires',
             next_steps = case when jsonb_array_length(steps) > 0 then steps else null end
       where id = st.id;
    end loop;
  end loop;
end
$seed$;
