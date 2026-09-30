-- Device trust integrity on rider_device_fingerprints.
-- Column-level privileges are the enforcement point: SECURITY DEFINER routines
-- (rider_device_touch, trusted_device_grant, fraud/risk engines) execute as the
-- table owner and are unaffected, while direct writes from anon/authenticated
-- cannot reach trust_level or is_blocked.

REVOKE INSERT, UPDATE ON public.rider_device_fingerprints FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.rider_device_fingerprints FROM authenticated;

GRANT INSERT (
  rider_id, fingerprint_hash, device_type, os, os_version,
  app_version, ip_address, user_agent, metadata
) ON public.rider_device_fingerprints TO authenticated;

GRANT UPDATE (
  device_type, os, os_version, app_version, ip_address,
  user_agent, last_seen_at, metadata, updated_at
) ON public.rider_device_fingerprints TO authenticated;

-- Admin trust/block changes keep working via the "Admins update device trust"
-- and "Admins delete devices" policies, executed through privileged routines.
GRANT ALL ON public.rider_device_fingerprints TO service_role;