-- Memories: things a pet learns about its friend while talking. At the end of
-- each talk session the server summarises the conversation into short facts
-- (name, birthday, favourite things…), reads them back into the next chat's
-- instructions, and lists them in the account sheet where the owner can
-- forget any of them.
create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 300),
  pet_id text,
  pet_name text,
  created_at timestamptz not null default now()
);
create index if not exists user_memories_user_idx
  on public.user_memories (user_id, created_at desc);
alter table public.user_memories enable row level security;

drop policy if exists "own memories read" on public.user_memories;
create policy "own memories read" on public.user_memories
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "own memories insert" on public.user_memories;
create policy "own memories insert" on public.user_memories
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "own memories delete" on public.user_memories;
create policy "own memories delete" on public.user_memories
  for delete to authenticated using (auth.uid() = user_id);
