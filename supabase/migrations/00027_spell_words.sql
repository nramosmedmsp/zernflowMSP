-- Diccionario de la tienda para el corrector de la Bandeja: marcas, productos
-- y palabras propias que el diccionario de español no conoce (whey, isolate,
-- Yape…). Las agrega cualquier miembro desde el chat ("Agregar al diccionario
-- de la tienda"); las quita el Dueño o un Administrador en Configuración.
--
-- Aplicar en cada base (tienda y gimnasio).

create table if not exists public.spell_words (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  word text not null check (char_length(btrim(word)) between 1 and 60),
  -- En minúsculas: "Yape" y "yape" son la misma palabra.
  normalized text not null check (normalized = lower(normalized)),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint spell_words_unique unique (workspace_id, normalized)
);

alter table public.spell_words enable row level security;

drop policy if exists spell_words_select on public.spell_words;
create policy spell_words_select on public.spell_words
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists spell_words_insert on public.spell_words;
create policy spell_words_insert on public.spell_words
  for insert with check (public.is_workspace_member(workspace_id) and added_by = auth.uid());

drop policy if exists spell_words_delete on public.spell_words;
create policy spell_words_delete on public.spell_words
  for delete using (public.is_ws_admin(workspace_id));

-- Lista inicial (added_by vacío): palabras de una tienda de suplementos.
insert into public.spell_words (workspace_id, word, normalized)
select w.id, x.word, lower(x.word)
from public.workspaces w
cross join (values
  ('whey'), ('isolate'), ('gainer'), ('scoop'), ('scoops'), ('shaker'), ('preworkout'), ('workout'),
  ('creatine'), ('protein'), ('gym'), ('fitness'), ('delivery'), ('stock'), ('ok'), ('okey'),
  ('wsp'), ('whatsapp'), ('instagram'), ('facebook'), ('link'), ('online'), ('promo'), ('promos'),
  ('combo'), ('combos'), ('Yape'), ('yapeo'), ('Plin'), ('Olva'), ('Shalom'), ('lb'), ('lbs'), ('kg'), ('mg'),
  ('kcal'), ('porfa'), ('cel'), ('celu'), ('dni'), ('ruc')
) as x(word)
on conflict (workspace_id, normalized) do nothing;
