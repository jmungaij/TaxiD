-- =========================================================================
-- 1. rider_device_fingerprints — trust fields become fraud-system-owned
-- =========================================================================

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role'
      OR current_user = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.enforce_rider_device_trust_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  privileged boolean;
BEGIN
  privileged := public.is_service_role() OR public.has_role(auth.uid(), 'admin'::app_role);
  IF privileged THEN
    IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Devices always enter the system unverified and unblocked.
    NEW.trust_level := 'unverified';
    NEW.is_blocked := false;
    RETURN NEW;
  END IF;

  IF NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
    RAISE EXCEPTION 'A device fingerprint cannot be reassigned to another rider';
  END IF;

  IF NEW.trust_level IS DISTINCT FROM OLD.trust_level
     OR NEW.is_blocked IS DISTINCT FROM OLD.is_blocked THEN
    RAISE EXCEPTION 'Device trust level and blocked status are set by fraud review, not by the device owner';
  END IF;

  NEW.first_seen_at := OLD.first_seen_at;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_rider_device_trust_fields ON public.rider_device_fingerprints;
CREATE TRIGGER trg_enforce_rider_device_trust_fields
BEFORE INSERT OR UPDATE ON public.rider_device_fingerprints
FOR EACH ROW EXECUTE FUNCTION public.enforce_rider_device_trust_fields();

DROP POLICY IF EXISTS "Riders update own devices" ON public.rider_device_fingerprints;

CREATE POLICY "Riders update own device telemetry"
ON public.rider_device_fingerprints
FOR UPDATE
TO authenticated
USING (rider_id = auth.uid())
WITH CHECK (rider_id = auth.uid());

CREATE POLICY "Admins update device trust"
ON public.rider_device_fingerprints
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

GRANT ALL ON public.rider_device_fingerprints TO service_role;

-- Safe "device was just seen" write that cannot touch trust fields.
CREATE OR REPLACE FUNCTION public.rider_device_touch(p_fingerprint_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  UPDATE public.rider_device_fingerprints
     SET last_seen_at = now(), updated_at = now()
   WHERE rider_id = auth.uid()
     AND fingerprint_hash = p_fingerprint_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.rider_device_touch(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_device_touch(text) TO authenticated, service_role;

-- =========================================================================
-- 2. trusted_devices — granting trust requires a verified step-up
-- =========================================================================

DROP POLICY IF EXISTS td_user_own ON public.trusted_devices;

CREATE POLICY td_select_own_or_admin
ON public.trusted_devices
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- Users may revoke (remove) their own trusted device, but not create or edit one.
CREATE POLICY td_delete_own_or_admin
ON public.trusted_devices
FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY td_admin_insert
ON public.trusted_devices
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY td_admin_update
ON public.trusted_devices
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT, DELETE ON public.trusted_devices TO authenticated;
GRANT ALL ON public.trusted_devices TO service_role;

CREATE OR REPLACE FUNCTION public.trusted_device_grant(
  p_fingerprint_id uuid,
  p_label text DEFAULT NULL,
  p_ttl_days integer DEFAULT 30
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_stepup boolean;
  v_ttl integer := least(greatest(coalesce(p_ttl_days, 30), 1), 90);
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- The device must belong to the caller and must not be blocked by fraud review.
  IF NOT EXISTS (
    SELECT 1 FROM public.rider_device_fingerprints d
     WHERE d.id = p_fingerprint_id
       AND d.rider_id = v_uid
       AND d.is_blocked = false
  ) THEN
    RAISE EXCEPTION 'That device is not registered to you, or is blocked';
  END IF;

  -- A verified step-up (one-time code / MFA) within the last 15 minutes is required.
  SELECT EXISTS (
    SELECT 1 FROM public.authentication_events e
     WHERE e.user_id = v_uid
       AND e.success = true
       AND e.occurred_at > now() - interval '15 minutes'
       AND (
         coalesce(e.method, '') ~* '(mfa|otp|totp|step[_ -]?up|webauthn|passkey)'
         OR coalesce(e.event_type, '') ~* '(mfa|otp|step[_ -]?up)'
       )
  ) INTO v_stepup;

  IF NOT v_stepup THEN
    RAISE EXCEPTION 'Verify a one-time code before trusting this device';
  END IF;

  INSERT INTO public.trusted_devices (user_id, fingerprint_id, label, trusted_at, expires_at)
  VALUES (v_uid, p_fingerprint_id, nullif(p_label, ''), now(), now() + (v_ttl || ' days')::interval)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trusted_device_grant(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trusted_device_grant(uuid, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trusted_device_revoke(p_device_id uuid, p_reason text DEFAULT 'user_revoked')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  UPDATE public.trusted_devices
     SET revoked_at = now(),
         revoked_reason = coalesce(nullif(p_reason, ''), 'user_revoked'),
         expires_at = least(coalesce(expires_at, now()), now())
   WHERE id = p_device_id
     AND (user_id = v_uid OR public.has_role(v_uid, 'admin'::app_role));
END;
$$;

REVOKE ALL ON FUNCTION public.trusted_device_revoke(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trusted_device_revoke(uuid, text) TO authenticated, service_role;