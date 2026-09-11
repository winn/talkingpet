-- Admin-managed AI provider keys plus a shared library of background music
-- and sound effects generated with ElevenLabs (same shape as Story in the Air).

-- ---------------------------------------------------------------------------
-- Runtime settings (provider API keys). Only admins can read or write; the
-- server functions act with the admin's own session, so a key never reaches
-- a browser through the app UI.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.app_settings enable row level security;
drop policy if exists "admin manages settings" on public.app_settings;
create policy "admin manages settings" on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Background music
-- ---------------------------------------------------------------------------
create table if not exists public.bgm_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  prompt text not null,
  mood text not null default '',
  storage_path text not null,
  duration_ms integer not null check (duration_ms > 0),
  model_id text not null,
  tags text[] not null default '{}',
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bgm_tracks_active_created_idx on public.bgm_tracks (active, created_at desc);
alter table public.bgm_tracks enable row level security;
drop policy if exists "read active music" on public.bgm_tracks;
create policy "read active music" on public.bgm_tracks
  for select to authenticated using (active = true or public.is_admin());
drop policy if exists "admin manages music" on public.bgm_tracks;
create policy "admin manages music" on public.bgm_tracks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Sound effects. `cue` is a short id such as meow or purr for use in prompts.
-- ---------------------------------------------------------------------------
create table if not exists public.sfx_clips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  prompt text not null,
  cue text not null,
  storage_path text not null,
  duration_ms integer not null check (duration_ms > 0),
  model_id text not null,
  tags text[] not null default '{}',
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sfx_clips_cue_format check (cue ~ '^[a-z][a-z0-9_]{0,31}$')
);
create unique index if not exists sfx_clips_cue_uidx on public.sfx_clips (cue);
create index if not exists sfx_clips_active_created_idx on public.sfx_clips (active, created_at desc);
alter table public.sfx_clips enable row level security;
drop policy if exists "read active sfx" on public.sfx_clips;
create policy "read active sfx" on public.sfx_clips
  for select to authenticated using (active = true or public.is_admin());
drop policy if exists "admin manages sfx" on public.sfx_clips;
create policy "admin manages sfx" on public.sfx_clips
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists bgm_tracks_touch on public.bgm_tracks;
create trigger bgm_tracks_touch before update on public.bgm_tracks
  for each row execute function public.touch_updated_at();
drop trigger if exists sfx_clips_touch on public.sfx_clips;
create trigger sfx_clips_touch before update on public.sfx_clips
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Storage: public-read buckets, admin-only writes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bgm', 'bgm', true, 52428800, array['audio/mpeg'])
on conflict (id) do update set public = true;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sfx', 'sfx', true, 10485760, array['audio/mpeg'])
on conflict (id) do update set public = true;

drop policy if exists "audio public read" on storage.objects;
create policy "audio public read" on storage.objects
  for select to anon, authenticated using (bucket_id in ('bgm', 'sfx'));
drop policy if exists "admin uploads audio" on storage.objects;
create policy "admin uploads audio" on storage.objects
  for insert to authenticated with check (bucket_id in ('bgm', 'sfx') and public.is_admin());
drop policy if exists "admin updates audio" on storage.objects;
create policy "admin updates audio" on storage.objects
  for update to authenticated using (bucket_id in ('bgm', 'sfx') and public.is_admin());
drop policy if exists "admin deletes audio" on storage.objects;
create policy "admin deletes audio" on storage.objects
  for delete to authenticated using (bucket_id in ('bgm', 'sfx') and public.is_admin());
