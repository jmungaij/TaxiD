CREATE OR REPLACE FUNCTION private.department_budget_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.monthly_budget_cents IS NULL THEN
    UPDATE corporate_budgets SET active=false WHERE scope='department' AND department_id=NEW.id;
  ELSE
    INSERT INTO corporate_budgets(corporate_id, scope, department_id, monthly_amount_cents, enforcement, created_by)
      VALUES (NEW.corporate_id, 'department', NEW.id, NEW.monthly_budget_cents, 'approval', auth.uid())
      ON CONFLICT (corporate_id, department_id) WHERE scope='department'
      DO UPDATE SET monthly_amount_cents=EXCLUDED.monthly_amount_cents, active=true;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.department_budget_sync() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_department_budget_sync AFTER INSERT OR UPDATE OF monthly_budget_cents ON public.corporate_departments
  FOR EACH ROW EXECUTE FUNCTION private.department_budget_sync();
INSERT INTO public.corporate_budgets(corporate_id, scope, department_id, monthly_amount_cents, enforcement)
  SELECT corporate_id, 'department', id, monthly_budget_cents, 'approval' FROM public.corporate_departments WHERE monthly_budget_cents IS NOT NULL
  ON CONFLICT DO NOTHING;