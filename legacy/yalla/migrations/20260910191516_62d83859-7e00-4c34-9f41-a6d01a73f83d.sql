CREATE TABLE public.driver_finance_clearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL UNIQUE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.driver_applications(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'PENDING',
  note text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_finance_clearances_state_chk CHECK (state IN ('PENDING','CLEARED','SUSPENDED'))
);

GRANT SELECT ON public.driver_finance_clearances TO authenticated;
GRANT ALL ON public.driver_finance_clearances TO service_role;
ALTER TABLE public.driver_finance_clearances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers read own finance clearance"
  ON public.driver_finance_clearances FOR SELECT TO authenticated
  USING (driver_user_id = auth.uid() OR public._driver_finance_staff());

CREATE POLICY "No client writes to finance clearances"
  ON public.driver_finance_clearances AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE TABLE public.driver_finance_clearance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clearance_id uuid NOT NULL REFERENCES public.driver_finance_clearances(id) ON DELETE CASCADE,
  action text NOT NULL,
  state_from text,
  state_to text,
  note text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.driver_finance_clearance_events TO authenticated;
GRANT ALL ON public.driver_finance_clearance_events TO service_role;
ALTER TABLE public.driver_finance_clearance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance staff read clearance history"
  ON public.driver_finance_clearance_events FOR SELECT TO authenticated
  USING (
    public._driver_finance_staff()
    OR EXISTS (
      SELECT 1 FROM public.driver_finance_clearances c
       WHERE c.id = clearance_id AND c.driver_user_id = auth.uid()
    )
  );

CREATE POLICY "No client writes to clearance history"
  ON public.driver_finance_clearance_events AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public._driver_finance_clearance_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'CLEARANCE_HISTORY_IS_APPEND_ONLY';
END $$;

CREATE TRIGGER driver_finance_clearance_events_immutable
  BEFORE UPDATE OR DELETE ON public.driver_finance_clearance_events
  FOR EACH ROW EXECUTE FUNCTION public._driver_finance_clearance_events_append_only();

CREATE OR REPLACE FUNCTION public._driver_finance_clearance_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER driver_finance_clearances_touch
  BEFORE UPDATE ON public.driver_finance_clearances
  FOR EACH ROW EXECUTE FUNCTION public._driver_finance_clearance_touch();

-- Seed a PENDING clearance whenever a driver application is approved.
CREATE OR REPLACE FUNCTION public._driver_finance_clearance_seed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF NEW.status = 'APPROVED' AND coalesce(OLD.status,'') <> 'APPROVED'
     AND NEW.applicant_user_id IS NOT NULL THEN
    INSERT INTO public.driver_finance_clearances
      (driver_user_id, driver_id, application_id, state)
    VALUES (NEW.applicant_user_id, NEW.driver_id, NEW.id, 'PENDING')
    ON CONFLICT (driver_user_id) DO UPDATE
      SET driver_id = coalesce(EXCLUDED.driver_id, public.driver_finance_clearances.driver_id),
          application_id = coalesce(EXCLUDED.application_id, public.driver_finance_clearances.application_id)
    RETURNING id INTO v_id;

    INSERT INTO public.driver_finance_clearance_events
      (clearance_id, action, state_to, note, actor_user_id)
    VALUES (v_id, 'SEEDED_ON_APPLICATION_APPROVAL', 'PENDING',
            'Driver application ' || NEW.application_reference || ' approved', auth.uid());
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER driver_applications_seed_finance_clearance
  AFTER UPDATE ON public.driver_applications
  FOR EACH ROW EXECUTE FUNCTION public._driver_finance_clearance_seed();

-- Payout gate: a driver cannot withdraw until finance clears the account.
CREATE OR REPLACE FUNCTION public._driver_finance_clearance_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_is_driver boolean;
  v_state text;
  v_id uuid;
BEGIN
  SELECT state INTO v_state FROM public.driver_finance_clearances
   WHERE driver_user_id = NEW.provider_user_id;

  IF v_state IS NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.drivers WHERE user_id = NEW.provider_user_id)
      INTO v_is_driver;
    IF NOT v_is_driver THEN RETURN NEW; END IF;

    INSERT INTO public.driver_finance_clearances (driver_user_id, driver_id, state)
    SELECT NEW.provider_user_id, d.id, 'PENDING'
      FROM public.drivers d WHERE d.user_id = NEW.provider_user_id
     ORDER BY d.created_at LIMIT 1
    ON CONFLICT (driver_user_id) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
      INSERT INTO public.driver_finance_clearance_events
        (clearance_id, action, state_to, note)
      VALUES (v_id, 'SEEDED_ON_WITHDRAWAL_ATTEMPT', 'PENDING',
              'Created when the driver first requested a withdrawal');
    END IF;
    v_state := 'PENDING';
  END IF;

  IF v_state <> 'CLEARED' THEN
    RAISE EXCEPTION 'FINANCE_CLEARANCE_REQUIRED'
      USING DETAIL = format('clearance state %s', v_state);
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER provider_payout_requests_driver_finance_clearance
  BEFORE INSERT ON public.provider_payout_requests
  FOR EACH ROW EXECUTE FUNCTION public._driver_finance_clearance_gate();

-- Finance console.
CREATE OR REPLACE FUNCTION public.driver_finance_clearance_console()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public._driver_finance_staff() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;

  SELECT jsonb_build_object(
    'clearances', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'state' DESC, x->>'created_at')
        FROM (
          SELECT jsonb_build_object(
            'id', c.id,
            'driver_user_id', c.driver_user_id,
            'state', c.state,
            'note', c.note,
            'decided_at', c.decided_at,
            'created_at', c.created_at,
            'application_reference', a.application_reference,
            'driver_code', d.driver_code,
            'driver_name', btrim(coalesce(d.first_name, a.first_name, '') || ' ' || coalesce(d.last_name, a.last_name, '')),
            'contact_phone', coalesce(d.phone_number, a.contact_phone),
            'contact_email', coalesce(d.email, a.contact_email),
            'available_cents', coalesce(w.available_cents, 0),
            'held_cents', coalesce(w.held_cents, 0),
            'currency', coalesce(w.currency, 'KES'),
            'payout_account_state', (
              SELECT pa.verification_state FROM public.provider_payout_accounts pa
               WHERE pa.provider_user_id = c.driver_user_id
               ORDER BY pa.is_default DESC, pa.created_at LIMIT 1
            ),
            'history', coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                       'action', e.action, 'state_from', e.state_from,
                       'state_to', e.state_to, 'note', e.note, 'created_at', e.created_at)
                     ORDER BY e.created_at DESC)
                FROM public.driver_finance_clearance_events e WHERE e.clearance_id = c.id
            ), '[]'::jsonb)
          ) AS x
          FROM public.driver_finance_clearances c
          LEFT JOIN public.drivers d ON d.id = c.driver_id
          LEFT JOIN public.driver_applications a ON a.id = c.application_id
          LEFT JOIN public.provider_wallets w ON w.provider_user_id = c.driver_user_id
        ) s
    ), '[]'::jsonb),
    'summary', (
      SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE state = 'PENDING'),
        'cleared', count(*) FILTER (WHERE state = 'CLEARED'),
        'suspended', count(*) FILTER (WHERE state = 'SUSPENDED'),
        'total', count(*))
        FROM public.driver_finance_clearances
    )
  ) INTO v;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.driver_finance_clearance_console() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_finance_clearance_console() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.driver_finance_clearance_decide(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid := (p->>'clearance_id')::uuid;
  v_state text := upper(coalesce(p->>'state',''));
  v_note text := nullif(btrim(coalesce(p->>'note','')), '');
  c public.driver_finance_clearances;
BEGIN
  IF NOT public._driver_finance_staff() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF v_state NOT IN ('PENDING','CLEARED','SUSPENDED') THEN
    RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_STATE');
  END IF;

  SELECT * INTO c FROM public.driver_finance_clearances WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_CLEARANCE'); END IF;

  IF v_state = 'SUSPENDED' AND v_note IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'REASON_REQUIRED');
  END IF;

  UPDATE public.driver_finance_clearances
     SET state = v_state,
         note = coalesce(v_note, note),
         decided_by = auth.uid(),
         decided_at = now()
   WHERE id = v_id;

  INSERT INTO public.driver_finance_clearance_events
    (clearance_id, action, state_from, state_to, note, actor_user_id)
  VALUES (v_id, 'DECISION', c.state, v_state, v_note, auth.uid());

  RETURN jsonb_build_object('ok', true, 'state', v_state);
END $$;

REVOKE ALL ON FUNCTION public.driver_finance_clearance_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_finance_clearance_decide(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.driver_finance_clearance_self()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); c public.driver_finance_clearances;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO c FROM public.driver_finance_clearances WHERE driver_user_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('exists', false); END IF;
  RETURN jsonb_build_object('exists', true, 'state', c.state, 'note', c.note, 'decided_at', c.decided_at);
END $$;

REVOKE ALL ON FUNCTION public.driver_finance_clearance_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_finance_clearance_self() TO authenticated, service_role;