-- Accounts, points, admin grants, and paid point packs for Paint Momo.
-- Mirrors the Talking Jelly credit model: every account starts with a few
-- points, talking to a pet spends one, admins can grant more, and Stripe
-- purchases add more through the webhook.

-- ---------------------------------------------------------------------------
-- Admin allow-list. Anyone who signs up with one of these emails is an admin.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.admin_emails enable row level security;
insert into public.admin_emails (email) values ('vwinnv@gmail.com')
  on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user, holds the point balance.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  points integer not null default 10 check (points >= 0),
  is_admin boolean not null default false,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_created_idx on public.profiles (created_at desc);
alter table public.profiles enable row level security;

-- Every balance change is recorded here. `ref` makes purchases idempotent.
create table if not exists public.point_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  balance_after integer not null,
  reason text not null check (reason in ('signup', 'talk', 'admin', 'purchase', 'adjust')),
  ref text unique,
  note text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists point_ledger_user_idx on public.point_ledger (user_id, created_at desc);
alter table public.point_ledger enable row level security;

-- Point packs sold through Stripe Checkout. Admins edit these in the app.
create table if not exists public.point_packs (
  id text primary key,
  label text not null,
  points integer not null check (points > 0),
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd',
  badge text,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.point_packs enable row level security;
insert into public.point_packs (id, label, points, price_cents, badge, sort) values
  ('pack_small', 'Starter', 50, 499, null, 1),
  ('pack_medium', 'Playtime', 120, 999, 'Most popular', 2),
  ('pack_large', 'Big imagination', 300, 1999, 'Best value', 3)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Pets now belong to accounts. Rows saved before accounts existed keep their
-- device id as owner; new rows are keyed by the signed-in user, so the same
-- pet id can exist for different owners without clashing.
-- ---------------------------------------------------------------------------
alter table public.pets add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.pets add column if not exists owner_key text
  generated always as (coalesce(user_id::text, device_id, '')) stored;

do $$
declare pk text;
begin
  select conname into pk from pg_constraint
   where conrelid = 'public.pets'::regclass and contype = 'p';
  if pk is not null then
    execute format('alter table public.pets drop constraint %I', pk);
  end if;
  alter table public.pets add primary key (owner_key, id);
end $$;

alter table public.pets alter column device_id drop not null;
create index if not exists pets_user_idx on public.pets (user_id, created_at);

drop policy if exists "device can read own pets" on public.pets;
drop policy if exists "device can insert own pets" on public.pets;
drop policy if exists "device can update own pets" on public.pets;
drop policy if exists "device can delete own pets" on public.pets;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and is_admin = true
  );
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Core balance mutation. Never exposed to browsers; other functions call it.
create or replace function public.apply_points(
  p_user_id uuid,
  p_delta integer,
  p_reason text,
  p_ref text default null,
  p_note text default null,
  p_actor uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_balance integer;
  v_existing integer;
begin
  if p_ref is not null then
    select balance_after into v_existing from public.point_ledger where ref = p_ref;
    if found then
      select points into v_balance from public.profiles where user_id = p_user_id;
      return coalesce(v_balance, v_existing);
    end if;
  end if;

  insert into public.profiles (user_id, points)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select points into v_balance from public.profiles where user_id = p_user_id for update;
  if v_balance + p_delta < 0 then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;
  v_balance := v_balance + p_delta;

  update public.profiles
     set points = v_balance, updated_at = now()
   where user_id = p_user_id;

  insert into public.point_ledger (user_id, delta, balance_after, reason, ref, note, actor_id)
  values (p_user_id, p_delta, v_balance, p_reason, p_ref, p_note, p_actor);

  return v_balance;
end;
$$;
revoke execute on function public.apply_points(uuid, integer, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_points(uuid, integer, text, text, text, uuid) to service_role;

-- New auth users get a profile, starting points, and admin status from the allow-list.
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
  perform public.apply_points(new.id, 10, 'signup', 'signup:' || new.id::text, 'Welcome points');
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where user_id = new.id;
  return new;
end;
$$;
drop trigger if exists on_auth_user_email on auth.users;
create trigger on_auth_user_email
  after update of email on auth.users
  for each row execute function public.handle_user_email();

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_user_email() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.handle_user_email() to supabase_auth_admin;

-- Backfill profiles for users that existed before this migration.
insert into public.profiles (user_id, email, points, is_admin)
select u.id, u.email, 10,
       exists (select 1 from public.admin_emails a where lower(a.email) = lower(coalesce(u.email, '')))
  from auth.users u
 where not exists (select 1 from public.profiles p where p.user_id = u.id);

-- ---------------------------------------------------------------------------
-- Browser-callable functions (run as the signed-in user)
-- ---------------------------------------------------------------------------

-- Spend points on an action such as starting a chat. Returns the new balance
-- or the current balance with ok=false when there are not enough points.
create or replace function public.spend_points(p_amount integer, p_reason text default 'talk')
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000 then
    raise exception 'bad_amount' using errcode = '22023';
  end if;
  if p_reason not in ('talk', 'adjust') then
    p_reason := 'talk';
  end if;
  begin
    v_balance := public.apply_points(v_uid, -p_amount, p_reason, null, null, v_uid);
    return json_build_object('ok', true, 'points', v_balance);
  exception when others then
    if sqlerrm = 'insufficient_points' then
      select points into v_balance from public.profiles where user_id = v_uid;
      return json_build_object('ok', false, 'error', 'insufficient_points', 'points', coalesce(v_balance, 0));
    end if;
    raise;
  end;
end;
$$;
revoke execute on function public.spend_points(integer, text) from public, anon;
grant execute on function public.spend_points(integer, text) to authenticated, service_role;

-- Admin: give (or take back) points. Negative deltas never go below zero.
create or replace function public.admin_grant_points(p_user_id uuid, p_delta integer, p_note text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_balance integer;
begin
  if not public.is_admin() then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'bad_amount' using errcode = '22023';
  end if;
  select points into v_balance from public.profiles where user_id = p_user_id;
  if not found then
    raise exception 'unknown_user' using errcode = 'P0002';
  end if;
  if v_balance + p_delta < 0 then
    p_delta := -v_balance;
  end if;
  return public.apply_points(p_user_id, p_delta, 'admin', null, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
end;
$$;
revoke execute on function public.admin_grant_points(uuid, integer, text) from public, anon;
grant execute on function public.admin_grant_points(uuid, integer, text) to authenticated, service_role;

-- Admin: promote or demote another account. Admins cannot demote themselves.
create or replace function public.admin_set_admin(p_user_id uuid, p_is_admin boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admins_only' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and not p_is_admin then
    raise exception 'cannot_demote_self' using errcode = '22023';
  end if;
  update public.profiles set is_admin = p_is_admin, updated_at = now() where user_id = p_user_id;
  return found;
end;
$$;
revoke execute on function public.admin_set_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated, service_role;

-- Admin: everyone with their balance and pet count.
create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  points integer,
  is_admin boolean,
  created_at timestamptz,
  pet_count bigint,
  purchased_points bigint,
  granted_points bigint
)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.email, p.points, p.is_admin, p.created_at,
         (select count(*) from public.pets t where t.user_id = p.user_id) as pet_count,
         coalesce((select sum(l.delta) from public.point_ledger l where l.user_id = p.user_id and l.reason = 'purchase'), 0) as purchased_points,
         coalesce((select sum(l.delta) from public.point_ledger l where l.user_id = p.user_id and l.reason = 'admin'), 0) as granted_points
    from public.profiles p
   where public.is_admin()
   order by p.created_at desc;
$$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

drop policy if exists "own ledger read" on public.point_ledger;
create policy "own ledger read" on public.point_ledger
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

drop policy if exists "read active packs" on public.point_packs;
create policy "read active packs" on public.point_packs
  for select to anon, authenticated using (active = true or public.is_admin());
drop policy if exists "admin manage packs" on public.point_packs;
create policy "admin manage packs" on public.point_packs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "user reads own pets" on public.pets;
create policy "user reads own pets" on public.pets
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "user inserts own pets" on public.pets;
create policy "user inserts own pets" on public.pets
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "user updates own pets" on public.pets;
create policy "user updates own pets" on public.pets
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "user deletes own pets" on public.pets;
create policy "user deletes own pets" on public.pets
  for delete to authenticated using (user_id = auth.uid());
