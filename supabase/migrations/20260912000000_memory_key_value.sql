-- Memories become key/value records ("birthday" → "19 March") so a fact can
-- be updated in place, listed as a table, and added by hand. One row per
-- (account, key). Owners may also update their rows (manual edits).
alter table public.user_memories rename column content to value;
alter table public.user_memories add column if not exists key text;
update public.user_memories set key = 'note' where key is null or key = '';
alter table public.user_memories alter column key set not null;
alter table public.user_memories
  add constraint user_memories_key_len check (char_length(key) between 1 and 60);
alter table public.user_memories add column if not exists updated_at timestamptz not null default now();
create unique index if not exists user_memories_user_key_idx
  on public.user_memories (user_id, key);

drop policy if exists "own memories update" on public.user_memories;
create policy "own memories update" on public.user_memories
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
