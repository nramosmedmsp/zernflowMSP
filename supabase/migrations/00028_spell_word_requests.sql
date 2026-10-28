-- Diccionario de la tienda: solo el Dueño o un Administrador agrega palabras.
-- Los demás miembros piden agregarlas ("pending"); un administrador las aprueba
-- (pasan a "approved") o las rechaza (se borran). El corrector solo usa las
-- aprobadas.
--
-- Aplicar en cada base (tienda y gimnasio).

alter table public.spell_words
  add column if not exists status text not null default 'approved' check (status in ('approved', 'pending'));
alter table public.spell_words add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.spell_words add column if not exists approved_at timestamptz;

create index if not exists idx_spell_words_pending on public.spell_words(workspace_id) where status = 'pending';

-- Miembros: solo pedidos a su nombre. Administradores: también aprobadas.
drop policy if exists spell_words_insert on public.spell_words;
create policy spell_words_insert on public.spell_words
  for insert with check (
    public.is_workspace_member(workspace_id)
    and added_by = auth.uid()
    and (status = 'pending' or public.is_ws_admin(workspace_id))
  );

-- Aprobar: solo administradores.
drop policy if exists spell_words_update on public.spell_words;
create policy spell_words_update on public.spell_words
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
