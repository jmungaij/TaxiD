
-- ============================================================
-- PHASE 3 — FINAL-MILE EVIDENCE, POD, OTP, RETURNS, HUB RESOLUTION
-- Extends: packages, logistics_delivery_attempts, logistics_exceptions,
-- logistics_hubs, package_chain_of_custody, package_returns, routes.
-- ============================================================

-- ---------- shared authorisation helper ----------
CREATE OR REPLACE FUNCTION public.logistics_delivery_authorised(_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.has_staff_permission('staff.logistics.delivery.' || _action)
          OR public.has_staff_permission('staff.logistics.manage')
          OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
$$;
REVOKE ALL ON FUNCTION public.logistics_delivery_authorised(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logistics_delivery_authorised(text) TO authenticated, service_role;

-- ============================================================
-- 1. POD POLICY ENGINE (versioned, service-specific)
-- ============================================================
CREATE TABLE public.logistics_pod_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_code text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','superseded','retired')),
  require_signature boolean NOT NULL DEFAULT false,
  require_photo boolean NOT NULL DEFAULT false,
  require_recipient_name boolean NOT NULL DEFAULT true,
  require_otp boolean NOT NULL DEFAULT false,
  require_scan boolean NOT NULL DEFAULT false,
  require_geolocation boolean NOT NULL DEFAULT true,
  require_notes boolean NOT NULL DEFAULT false,
  require_id_reference boolean NOT NULL DEFAULT false,
  require_recipient_relationship boolean NOT NULL DEFAULT false,
  otp_ttl_seconds integer NOT NULL DEFAULT 600 CHECK (otp_ttl_seconds BETWEEN 60 AND 3600),
  otp_max_attempts integer NOT NULL DEFAULT 5 CHECK (otp_max_attempts BETWEEN 1 AND 10),
  otp_max_resends integer NOT NULL DEFAULT 3 CHECK (otp_max_resends BETWEEN 0 AND 10),
  requires_inspection_before_disposition boolean NOT NULL DEFAULT true,
  notes text,
  effective_from timestamptz,
  superseded_by uuid REFERENCES public.logistics_pod_policies(id),
  created_by uuid REFERENCES auth.users(id),
  activated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_code, version)
);
CREATE UNIQUE INDEX logistics_pod_policies_one_active
  ON public.logistics_pod_policies (offering_code) WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE ON public.logistics_pod_policies TO authenticated;
GRANT ALL ON public.logistics_pod_policies TO service_role;
ALTER TABLE public.logistics_pod_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pod policies readable by delivery staff" ON public.logistics_pod_policies
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));
CREATE POLICY "pod policies managed by delivery staff" ON public.logistics_pod_policies
  FOR ALL TO authenticated USING (public.logistics_delivery_authorised('policy'))
  WITH CHECK (public.logistics_delivery_authorised('policy'));

-- ============================================================
-- 2. OTP ENGINE
-- ============================================================
CREATE TABLE public.logistics_delivery_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES public.logistics_delivery_attempts(id) ON DELETE SET NULL,
  purpose text NOT NULL DEFAULT 'delivery_confirmation'
    CHECK (purpose IN ('delivery_confirmation','return_handover','hub_release')),
  recipient_phone text,
  recipient_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  code_hash text NOT NULL,
  code_salt text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verified','consumed','expired','invalidated','locked')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  resend_count integer NOT NULL DEFAULT 0,
  max_resends integer NOT NULL DEFAULT 3,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz,
  consumed_pod_id uuid,
  last_sent_at timestamptz,
  delivery_channel text,
  provider text,
  provider_message_id text,
  provider_status text NOT NULL DEFAULT 'not_sent',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX logistics_delivery_otps_one_pending
  ON public.logistics_delivery_otps (package_id, purpose) WHERE status = 'pending';
CREATE INDEX logistics_delivery_otps_pkg ON public.logistics_delivery_otps (package_id, created_at DESC);

GRANT SELECT ON public.logistics_delivery_otps TO authenticated;
GRANT ALL ON public.logistics_delivery_otps TO service_role;
ALTER TABLE public.logistics_delivery_otps ENABLE ROW LEVEL SECURITY;
-- code_hash/code_salt are never usable to recover the code; reads are staff-only.
CREATE POLICY "otps readable by delivery staff" ON public.logistics_delivery_otps
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));

-- ============================================================
-- 3. POD RECORDS + EVIDENCE FILES
-- ============================================================
CREATE TABLE public.logistics_pod_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.logistics_delivery_attempts(id) ON DELETE RESTRICT,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  order_id uuid,
  policy_id uuid REFERENCES public.logistics_pod_policies(id),
  policy_version integer,
  offering_code text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  recipient_name text,
  recipient_relationship text,
  recipient_id_reference text,
  signature_ref text,
  scanned_barcode text,
  otp_id uuid REFERENCES public.logistics_delivery_otps(id),
  otp_verified boolean NOT NULL DEFAULT false,
  captured_lat numeric,
  captured_lng numeric,
  notes text,
  integrity_hash text NOT NULL,
  captured_by uuid REFERENCES auth.users(id),
  captured_at timestamptz NOT NULL DEFAULT now(),
  supersedes_pod_id uuid REFERENCES public.logistics_pod_records(id),
  superseded_by_pod_id uuid REFERENCES public.logistics_pod_records(id),
  supersede_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX logistics_pod_records_pkg ON public.logistics_pod_records (package_id, captured_at DESC);

GRANT SELECT ON public.logistics_pod_records TO authenticated;
GRANT ALL ON public.logistics_pod_records TO service_role;
ALTER TABLE public.logistics_pod_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pod readable by delivery staff" ON public.logistics_pod_records
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));
CREATE POLICY "pod readable by assigned driver" ON public.logistics_pod_records
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.packages p WHERE p.id = package_id AND p.assigned_driver_id = auth.uid())
  );

CREATE TABLE public.logistics_pod_evidence_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pod_id uuid NOT NULL REFERENCES public.logistics_pod_records(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('signature','photo','id_document','scan','other')),
  object_ref text NOT NULL,
  content_hash text NOT NULL,
  hash_algorithm text NOT NULL DEFAULT 'sha256',
  byte_size bigint,
  mime_type text,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.logistics_pod_evidence_files TO authenticated;
GRANT ALL ON public.logistics_pod_evidence_files TO service_role;
ALTER TABLE public.logistics_pod_evidence_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pod evidence readable by delivery staff" ON public.logistics_pod_evidence_files
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));

-- POD records are append-only: only supersession columns may change.
CREATE OR REPLACE FUNCTION public._logistics_pod_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.attempt_id <> OLD.attempt_id OR NEW.package_id <> OLD.package_id
     OR NEW.integrity_hash <> OLD.integrity_hash OR NEW.captured_at <> OLD.captured_at THEN
    RAISE EXCEPTION 'pod_record_is_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER logistics_pod_immutable BEFORE UPDATE ON public.logistics_pod_records
  FOR EACH ROW EXECUTE FUNCTION public._logistics_pod_immutable();

CREATE OR REPLACE FUNCTION public._logistics_pod_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'pod_evidence_is_append_only';
END;
$$;
CREATE TRIGGER logistics_pod_evidence_immutable BEFORE UPDATE OR DELETE
  ON public.logistics_pod_evidence_files FOR EACH ROW
  EXECUTE FUNCTION public._logistics_pod_evidence_immutable();

-- ============================================================
-- 4. MESSAGING PROVIDER ADAPTER CONFIG + NOTIFICATION LOG
-- ============================================================
CREATE TABLE public.logistics_message_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','whatsapp','email')),
  provider text NOT NULL,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','staging','production')),
  credentials_secret_name text,
  sender_identity text,
  enabled boolean NOT NULL DEFAULT false,
  timeout_ms integer NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 60000),
  retry_max_attempts integer NOT NULL DEFAULT 3 CHECK (retry_max_attempts BETWEEN 0 AND 10),
  retry_backoff_seconds integer NOT NULL DEFAULT 30,
  health_status text NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown','healthy','degraded','unavailable','configuration_required')),
  health_checked_at timestamptz,
  health_detail text,
  notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, environment)
);
GRANT SELECT, INSERT, UPDATE ON public.logistics_message_providers TO authenticated;
GRANT ALL ON public.logistics_message_providers TO service_role;
ALTER TABLE public.logistics_message_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "providers readable by delivery staff" ON public.logistics_message_providers
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));
CREATE POLICY "providers managed by admins" ON public.logistics_message_providers
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE public.logistics_delivery_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  package_id uuid REFERENCES public.packages(id) ON DELETE CASCADE,
  attempt_id uuid,
  return_id uuid,
  otp_id uuid,
  channel text,
  recipient text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','failed','provider_configuration_required','suppressed')),
  provider text,
  provider_ref text,
  error_detail text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX logistics_delivery_notifications_recent
  ON public.logistics_delivery_notifications (created_at DESC);
GRANT SELECT ON public.logistics_delivery_notifications TO authenticated;
GRANT ALL ON public.logistics_delivery_notifications TO service_role;
ALTER TABLE public.logistics_delivery_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "delivery notifications readable by delivery staff"
  ON public.logistics_delivery_notifications
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));

CREATE OR REPLACE FUNCTION public._logistics_notify(
  _event text, _package_id uuid, _attempt_id uuid, _return_id uuid, _otp_id uuid,
  _recipient text, _payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_provider public.logistics_message_providers; v_status text; v_id uuid;
BEGIN
  SELECT * INTO v_provider FROM public.logistics_message_providers
   WHERE channel = 'sms' AND enabled = true ORDER BY updated_at DESC LIMIT 1;
  IF NOT FOUND OR v_provider.credentials_secret_name IS NULL THEN
    v_status := 'provider_configuration_required';
  ELSE
    v_status := 'queued';
  END IF;
  INSERT INTO public.logistics_delivery_notifications
    (event_name, package_id, attempt_id, return_id, otp_id, channel, recipient, status, provider, payload)
  VALUES (_event, _package_id, _attempt_id, _return_id, _otp_id, 'sms', _recipient, v_status,
          v_provider.provider, coalesce(_payload,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._logistics_notify(text,uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._logistics_notify(text,uuid,uuid,uuid,uuid,text,jsonb) TO service_role;

-- ============================================================
-- 5. RETURNS — extend existing package_returns
-- ============================================================
ALTER TABLE public.package_returns
  ADD COLUMN IF NOT EXISTS return_number text,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS authorization_status text NOT NULL DEFAULT 'pending'
    CHECK (authorization_status IN ('pending','authorized','rejected')),
  ADD COLUMN IF NOT EXISTS authorized_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS merchant_approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merchant_approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS merchant_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS origin_attempt_id uuid REFERENCES public.logistics_delivery_attempts(id),
  ADD COLUMN IF NOT EXISTS origin_route_id uuid REFERENCES public.logistics_routes(id),
  ADD COLUMN IF NOT EXISTS return_route_id uuid REFERENCES public.logistics_routes(id),
  ADD COLUMN IF NOT EXISTS destination_hub_id uuid REFERENCES public.logistics_hubs(id),
  ADD COLUMN IF NOT EXISTS return_service_level text,
  ADD COLUMN IF NOT EXISTS return_instructions text,
  ADD COLUMN IF NOT EXISTS movement_status text NOT NULL DEFAULT 'AUTHORIZED'
    CHECK (movement_status IN ('AUTHORIZED','READY_FOR_RETURN','DISPATCHED','IN_TRANSIT',
                               'HUB_RECEIVED','INSPECTION','DISPOSITION','RESOLVED','CANCELLED')),
  ADD COLUMN IF NOT EXISTS disposition text,
  ADD COLUMN IF NOT EXISTS resolution_state text,
  ADD COLUMN IF NOT EXISTS financial_reference text,
  ADD COLUMN IF NOT EXISTS exception_id uuid REFERENCES public.logistics_exceptions(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS package_returns_return_number_key
  ON public.package_returns (return_number) WHERE return_number IS NOT NULL;

CREATE TABLE public.logistics_return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.package_returns(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  from_status text,
  to_status text,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX logistics_return_events_ret ON public.logistics_return_events (return_id, created_at);
GRANT SELECT ON public.logistics_return_events TO authenticated;
GRANT ALL ON public.logistics_return_events TO service_role;
ALTER TABLE public.logistics_return_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "return events readable by delivery staff" ON public.logistics_return_events
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));

CREATE OR REPLACE FUNCTION public._logistics_return_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'return_events_are_append_only'; END;
$$;
CREATE TRIGGER logistics_return_events_append_only BEFORE UPDATE OR DELETE
  ON public.logistics_return_events FOR EACH ROW
  EXECUTE FUNCTION public._logistics_return_events_append_only();

-- hub receipts
CREATE TABLE public.logistics_return_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.package_returns(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid REFERENCES auth.users(id),
  condition text NOT NULL CHECK (condition IN ('good','damaged','partial','unknown')),
  seal_state text NOT NULL DEFAULT 'unknown' CHECK (seal_state IN ('intact','broken','missing','unknown')),
  seal_id text,
  scanned_reference text,
  custody_event_id uuid REFERENCES public.package_chain_of_custody(id),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX logistics_return_receipts_one_per_return
  ON public.logistics_return_receipts (return_id);
GRANT SELECT ON public.logistics_return_receipts TO authenticated;
GRANT ALL ON public.logistics_return_receipts TO service_role;
ALTER TABLE public.logistics_return_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "return receipts readable by delivery staff" ON public.logistics_return_receipts
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));

-- inspections
CREATE TABLE public.logistics_return_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.package_returns(id) ON DELETE CASCADE,
  receipt_id uuid REFERENCES public.logistics_return_receipts(id),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  inspector_id uuid REFERENCES auth.users(id),
  condition text NOT NULL CHECK (condition IN ('good','damaged','partial','destroyed','unknown')),
  damage_found boolean NOT NULL DEFAULT false,
  damage_detail text,
  missing_contents boolean NOT NULL DEFAULT false,
  missing_detail text,
  seal_condition text NOT NULL DEFAULT 'unknown' CHECK (seal_condition IN ('intact','broken','missing','unknown')),
  packaging_condition text NOT NULL DEFAULT 'unknown'
    CHECK (packaging_condition IN ('intact','crushed','wet','torn','unknown')),
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.logistics_return_inspections TO authenticated;
GRANT ALL ON public.logistics_return_inspections TO service_role;
ALTER TABLE public.logistics_return_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "return inspections readable by delivery staff" ON public.logistics_return_inspections
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));

-- dispositions
CREATE TABLE public.logistics_return_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.package_returns(id) ON DELETE CASCADE,
  inspection_id uuid REFERENCES public.logistics_return_inspections(id),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  disposition text NOT NULL CHECK (disposition IN ('RETURN_TO_MERCHANT','RETURN_TO_CUSTOMER','RESTOCK',
                                                   'REPAIR','REPACK','DISPOSE','HOLD','CLAIM_REVIEW')),
  authorized_by uuid REFERENCES auth.users(id),
  authorization_note text,
  executed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.logistics_return_dispositions TO authenticated;
GRANT ALL ON public.logistics_return_dispositions TO service_role;
ALTER TABLE public.logistics_return_dispositions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "return dispositions readable by delivery staff" ON public.logistics_return_dispositions
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));

-- returns readable by delivery staff (package_returns already has policies; add staff read)
CREATE POLICY "returns readable by delivery staff" ON public.package_returns
  FOR SELECT TO authenticated USING (public.logistics_delivery_authorised('read'));

-- ============================================================
-- 6. TOUCH TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION public._logistics_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER touch_pod_policies BEFORE UPDATE ON public.logistics_pod_policies
  FOR EACH ROW EXECUTE FUNCTION public._logistics_touch_updated_at();
CREATE TRIGGER touch_delivery_otps BEFORE UPDATE ON public.logistics_delivery_otps
  FOR EACH ROW EXECUTE FUNCTION public._logistics_touch_updated_at();
CREATE TRIGGER touch_message_providers BEFORE UPDATE ON public.logistics_message_providers
  FOR EACH ROW EXECUTE FUNCTION public._logistics_touch_updated_at();
CREATE TRIGGER touch_delivery_notifications BEFORE UPDATE ON public.logistics_delivery_notifications
  FOR EACH ROW EXECUTE FUNCTION public._logistics_touch_updated_at();
