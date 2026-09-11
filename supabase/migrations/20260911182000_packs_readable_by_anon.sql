-- The packs read policy calls is_admin(); anonymous callers (the checkout
-- function looking up a pack) must be able to evaluate it (it returns false).
grant execute on function public.is_admin() to anon;
