-- Bridge: let browsers without an account keep saving pets by device id,
-- alongside the account policies added by the accounts migration. Rows saved
-- this way have user_id null and owner_key = device_id, so an account can
-- claim them later. Requires the (owner_key, id) primary key.
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

drop policy if exists "device reads own pets" on public.pets;
create policy "device reads own pets"
  on public.pets for select
  to anon
  using (user_id is null and device_id = public.request_device_id());

drop policy if exists "device inserts own pets" on public.pets;
create policy "device inserts own pets"
  on public.pets for insert
  to anon
  with check (user_id is null and device_id = public.request_device_id());

drop policy if exists "device updates own pets" on public.pets;
create policy "device updates own pets"
  on public.pets for update
  to anon
  using (user_id is null and device_id = public.request_device_id())
  with check (user_id is null and device_id = public.request_device_id());

drop policy if exists "device deletes own pets" on public.pets;
create policy "device deletes own pets"
  on public.pets for delete
  to anon
  using (user_id is null and device_id = public.request_device_id());
