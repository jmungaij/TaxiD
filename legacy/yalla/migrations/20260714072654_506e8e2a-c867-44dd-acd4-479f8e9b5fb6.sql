
-- 1. corporate_ride_approvals: remove requester self-approval
DROP POLICY IF EXISTS corp_appr_update_manager ON public.corporate_ride_approvals;
CREATE POLICY corp_appr_update_manager ON public.corporate_ride_approvals
  FOR UPDATE
  USING (
    has_corporate_role(auth.uid(), corporate_id, 'corporate_admin'::corporate_employee_role)
    OR has_corporate_role(auth.uid(), corporate_id, 'corporate_manager'::corporate_employee_role)
  )
  WITH CHECK (
    has_corporate_role(auth.uid(), corporate_id, 'corporate_admin'::corporate_employee_role)
    OR has_corporate_role(auth.uid(), corporate_id, 'corporate_manager'::corporate_employee_role)
  );

-- 2. mpesa_transactions: drop the broad user update policy
DROP POLICY IF EXISTS update_mpesa_transactions_user_metadata ON public.mpesa_transactions;

-- 3. trip_bookings: add WITH CHECK + trigger guarding financial fields
DROP POLICY IF EXISTS "Rider/driver update booking" ON public.trip_bookings;
CREATE POLICY "Rider/driver update booking" ON public.trip_bookings
  FOR UPDATE
  USING (
    (rider_user_id = auth.uid()) OR (driver_id = auth.uid())
  )
  WITH CHECK (
    (rider_user_id = auth.uid()) OR (driver_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.trip_bookings_guard_financial_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_privileged boolean;
BEGIN
  -- Service role bypasses RLS entirely, but this trigger fires for it too.
  -- Allow privileged roles and admins to change financial fields.
  is_privileged := (
    auth.uid() IS NULL  -- service role / edge function
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'finance_admin'::app_role)
  );

  IF is_privileged THEN
    RETURN NEW;
  END IF;

  IF NEW.total_fare IS DISTINCT FROM OLD.total_fare
     OR NEW.base_fare IS DISTINCT FROM OLD.base_fare
     OR NEW.surge_multiplier IS DISTINCT FROM OLD.surge_multiplier
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.rider_user_id IS DISTINCT FROM OLD.rider_user_id
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
  THEN
    RAISE EXCEPTION 'Not allowed to modify financial or ownership fields on trip_bookings'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_bookings_guard_financial_fields ON public.trip_bookings;
CREATE TRIGGER trip_bookings_guard_financial_fields
  BEFORE UPDATE ON public.trip_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trip_bookings_guard_financial_fields();
