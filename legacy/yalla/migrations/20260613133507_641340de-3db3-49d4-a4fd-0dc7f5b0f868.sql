
CREATE OR REPLACE FUNCTION public.enforce_mpesa_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status, NEW.status) IN (
       ('PENDING'::mpesa_status,    'PROCESSING'::mpesa_status),
       ('PENDING'::mpesa_status,    'CANCELLED'::mpesa_status),
       ('PENDING'::mpesa_status,    'FAILED'::mpesa_status),
       ('PROCESSING'::mpesa_status, 'SUCCESS'::mpesa_status),
       ('PROCESSING'::mpesa_status, 'FAILED'::mpesa_status),
       ('PROCESSING'::mpesa_status, 'CANCELLED'::mpesa_status),
       ('SUCCESS'::mpesa_status,    'REVERSED'::mpesa_status)
     ) THEN
    allowed := true;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Illegal payment status transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.enforce_mpesa_status_transition() FROM PUBLIC, anon, authenticated;
