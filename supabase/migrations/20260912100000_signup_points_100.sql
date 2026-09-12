-- New accounts start with 100 points (was 10).
alter table public.profiles
  alter column points set default 100;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean;
begin
  select exists (select 1 from public.admin_emails where lower(email) = lower(coalesce(new.email, '')))
    into v_admin;
  insert into public.profiles (user_id, email, points, is_admin)
  values (new.id, new.email, 0, v_admin)
  on conflict (user_id) do update set email = excluded.email, is_admin = public.profiles.is_admin or excluded.is_admin;
  perform public.apply_points(new.id, 100, 'signup', 'signup:' || new.id::text, 'Welcome points');
  return new;
end;
$$;
