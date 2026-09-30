CREATE OR REPLACE FUNCTION public._driver_finance_clearance_seed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_user uuid;
BEGIN
  IF NEW.status = 'APPROVED' AND coalesce(OLD.status,'') <> 'APPROVED' THEN
    -- The applicant may have applied while signed out. Resolve their own login
    -- from the email the application itself carries, never from anything typed
    -- by a third party at decision time.
    v_user := NEW.applicant_user_id;
    IF v_user IS NULL AND NEW.contact_email IS NOT NULL THEN
      SELECT u.id INTO v_user
        FROM auth.users u
       WHERE lower(u.email) = lower(btrim(NEW.contact_email))
       LIMIT 1;
      IF v_user IS NOT NULL THEN
        NEW.applicant_user_id := v_user;
      END IF;
    END IF;

    IF v_user IS NULL THEN
      RETURN NEW;
    END IF;

    -- The driver record must carry the same login so the operator portal shows
    -- that driver their own rides, statement and wallet.
    IF NEW.driver_id IS NOT NULL THEN
      UPDATE public.drivers
         SET user_id = v_user
       WHERE id = NEW.driver_id AND user_id IS NULL;
    END IF;

    INSERT INTO public.driver_finance_clearances
      (driver_user_id, driver_id, application_id, state)
    VALUES (v_user, NEW.driver_id, NEW.id, 'PENDING')
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
END $function$;