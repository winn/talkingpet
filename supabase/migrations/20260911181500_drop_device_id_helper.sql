-- The x-device-id header no longer drives access; accounts do.
drop function if exists public.request_device_id();
