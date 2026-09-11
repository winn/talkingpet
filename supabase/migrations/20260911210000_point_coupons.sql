-- Coupons: admin-generated codes that add points when a user redeems them.

alter table public.point_ledger drop constraint if exists point_ledger_reason_check;
alter table public.point_ledger add constraint point_ledger_reason_check
  check (reason in ('signup', 'talk', 'admin', 'purchase', 'adjust', 'coupon'));

create table if not exists public.point_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  points integer not null check (points > 0 and points <= 100000),
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  expires_at timestamptz,
  batch_id uuid,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists point_coupons_batch_idx on public.point_coupons (batch_id, created_at desc);
create index if not exists point_coupons_created_idx on public.point_coupons (created_at desc);

create table if not exists public.point_coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.point_coupons (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  points_granted integer not null check (points_granted > 0),
  redeemed_at timestamptz not null default now(),
  constraint point_coupon_redemptions_once unique (coupon_id, user_id)
);
create index if not exists point_coupon_redemptions_user_idx
  on public.point_coupon_redemptions (user_id, redeemed_at desc);

alter table public.point_coupons enable row level security;
alter table public.point_coupon_redemptions enable row level security;

drop policy if exists "admin manage coupons" on public.point_coupons;
create policy "admin manage coupons" on public.point_coupons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "own redemptions read" on public.point_coupon_redemptions;
create policy "own redemptions read" on public.point_coupon_redemptions
  for select to authenticated using (auth.uid() = user_id or public.is_admin());

-- Codes are stored and looked up in one canonical form: A-Z, 0-9 and hyphens.
create or replace function public.normalize_coupon_code(p_code text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9-]', '', 'g'));
$$;

-- A signed-in user claims a code. One redemption per user per code.
create or replace function public.redeem_point_coupon(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_code text := public.normalize_coupon_code(p_code);
  v_coupon public.point_coupons%rowtype;
  v_balance integer;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if v_code = '' then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  select * into v_coupon from public.point_coupons where code = v_code for update;
  if not found then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;
  if not v_coupon.active then
    return json_build_object('ok', false, 'error', 'inactive');
  end if;
  if v_coupon.expires_at is not null and v_coupon.expires_at < now() then
    return json_build_object('ok', false, 'error', 'expired');
  end if;
  if v_coupon.max_redemptions is not null and v_coupon.redemption_count >= v_coupon.max_redemptions then
    return json_build_object('ok', false, 'error', 'exhausted');
  end if;
  if exists (
    select 1 from public.point_coupon_redemptions
     where coupon_id = v_coupon.id and user_id = v_uid
  ) then
    return json_build_object('ok', false, 'error', 'already_redeemed');
  end if;

  insert into public.point_coupon_redemptions (coupon_id, user_id, points_granted)
  values (v_coupon.id, v_uid, v_coupon.points);

  update public.point_coupons
     set redemption_count = redemption_count + 1
   where id = v_coupon.id;

  v_balance := public.apply_points(
    v_uid, v_coupon.points, 'coupon',
    'coupon:' || v_coupon.id::text || ':' || v_uid::text,
    v_coupon.code, null);

  return json_build_object('ok', true, 'points', v_coupon.points, 'balance', v_balance);
end;
$$;
revoke execute on function public.redeem_point_coupon(text) from public, anon;
grant execute on function public.redeem_point_coupon(text) to authenticated, service_role;

-- Admin user list now also shows points that came from coupons.
drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  points integer,
  is_admin boolean,
  created_at timestamptz,
  pet_count bigint,
  purchased_points bigint,
  granted_points bigint,
  coupon_points bigint
)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.email, p.points, p.is_admin, p.created_at,
         (select count(*) from public.pets t where t.user_id = p.user_id) as pet_count,
         coalesce((select sum(l.delta) from public.point_ledger l where l.user_id = p.user_id and l.reason = 'purchase'), 0) as purchased_points,
         coalesce((select sum(l.delta) from public.point_ledger l where l.user_id = p.user_id and l.reason = 'admin'), 0) as granted_points,
         coalesce((select sum(l.delta) from public.point_ledger l where l.user_id = p.user_id and l.reason = 'coupon'), 0) as coupon_points
    from public.profiles p
   where public.is_admin()
   order by p.created_at desc;
$$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated, service_role;
