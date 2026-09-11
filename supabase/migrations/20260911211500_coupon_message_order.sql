-- Tell a returning user they already used the code before saying it is used up.
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
  if exists (
    select 1 from public.point_coupon_redemptions
     where coupon_id = v_coupon.id and user_id = v_uid
  ) then
    return json_build_object('ok', false, 'error', 'already_redeemed');
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
