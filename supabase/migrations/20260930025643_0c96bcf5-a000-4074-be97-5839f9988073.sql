CREATE OR REPLACE FUNCTION public.yp_is_finance()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','director']::app_role[]);
$$;
REVOKE ALL ON FUNCTION public.yp_is_finance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.yp_is_finance() TO service_role;

-- Company membership checks may only answer for the caller (staff/backend may check anyone)
CREATE OR REPLACE FUNCTION public.is_corporate_member(_user_id uuid, _corporate_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::app_role[]))
     AND EXISTS (SELECT 1 FROM public.corporate_employees WHERE user_id = _user_id AND corporate_id = _corporate_id AND status = 'active');
$$;
CREATE OR REPLACE FUNCTION public.is_corporate_manager_or_admin(_user_id uuid, _corporate_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::app_role[]))
     AND EXISTS (SELECT 1 FROM public.corporate_employees WHERE user_id = _user_id AND corporate_id = _corporate_id AND status = 'active' AND role IN ('corporate_admin','corporate_manager'));
$$;

-- Company wallet balance: only that company's members, finance or admins
CREATE OR REPLACE FUNCTION public.corporate_wallet_balance_cents(_corporate_id uuid)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_corporate_member(auth.uid(), _corporate_id)
     AND NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN coalesce((SELECT balance_after_cents FROM public.corporate_cash_ledger WHERE corporate_id = _corporate_id ORDER BY occurred_at DESC, created_at DESC LIMIT 1), 0);
END $$;

-- Close actions the browser never calls or that lack a caller check
REVOKE EXECUTE ON FUNCTION public.fin_record_mpesa(text, numeric, text, boolean, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.next_driver_payout_batch_number() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.next_etims_invoice_number() FROM authenticated;

-- Company-level access: members read their own company's records; managers maintain their own company's staff set-up
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables x ON x.table_schema=c.table_schema AND x.table_name=c.table_name AND x.table_type='BASE TABLE'
           WHERE c.table_schema='public' AND c.column_name='corporate_id' LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Company members read own company" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Company members read own company" ON public.%I FOR SELECT TO authenticated USING (public.is_corporate_member(auth.uid(), corporate_id))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['corporate_employees','corporate_departments','cost_centers','corporate_expense_codes','corporate_ride_policies','corporate_designations','corporate_invitations'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='corporate_id') THEN
      EXECUTE format('DROP POLICY IF EXISTS "Company managers maintain own company" ON public.%I', t);
      EXECUTE format('CREATE POLICY "Company managers maintain own company" ON public.%I FOR ALL TO authenticated USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id)) WITH CHECK (public.is_corporate_manager_or_admin(auth.uid(), corporate_id))', t);
    END IF;
  END LOOP;
END $$;