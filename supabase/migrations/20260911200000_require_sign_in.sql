-- Every user signs in. Remove the temporary device-id bridge so pets can only
-- be read or written by the account that owns them.
drop policy if exists "device reads own pets" on public.pets;
drop policy if exists "device inserts own pets" on public.pets;
drop policy if exists "device updates own pets" on public.pets;
drop policy if exists "device deletes own pets" on public.pets;
drop function if exists public.request_device_id();
