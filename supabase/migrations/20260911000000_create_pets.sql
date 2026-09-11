-- Pets table for Paint Momo. Each row holds one saved pet as JSON, scoped to
-- the browser that created it through the x-device-id request header.
create table if not exists public.pets (
  id text not null,
  device_id text not null,
  data jsonb not null,
  created_at bigint not null,
  updated_at bigint not null,
  primary key (device_id, id)
);

-- The header is set by the app's Supabase client. It stands in for a user
-- session because the app has no accounts.
create or replace function public.request_device_id()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-device-id',
    ''
  );
$$;

alter table public.pets enable row level security;

drop policy if exists "device can read own pets" on public.pets;
create policy "device can read own pets"
  on public.pets for select
  to anon
  using (device_id = public.request_device_id());

drop policy if exists "device can insert own pets" on public.pets;
create policy "device can insert own pets"
  on public.pets for insert
  to anon
  with check (device_id = public.request_device_id());

drop policy if exists "device can update own pets" on public.pets;
create policy "device can update own pets"
  on public.pets for update
  to anon
  using (device_id = public.request_device_id())
  with check (device_id = public.request_device_id());

drop policy if exists "device can delete own pets" on public.pets;
create policy "device can delete own pets"
  on public.pets for delete
  to anon
  using (device_id = public.request_device_id());
