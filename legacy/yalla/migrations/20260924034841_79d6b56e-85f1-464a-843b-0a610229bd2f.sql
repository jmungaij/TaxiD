CREATE TABLE public.sales_lead_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_lead_changes TO authenticated;
GRANT ALL ON public.sales_lead_changes TO service_role;
ALTER TABLE public.sales_lead_changes ENABLE ROW LEVEL SECURITY;
CREATE INDEX sales_lead_changes_lead_idx ON public.sales_lead_changes(lead_id, changed_at DESC);
CREATE POLICY sales_lead_changes_read ON public.sales_lead_changes FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.sales_leads l WHERE l.id = lead_id
  AND (l.sales_staff_id = public._my_staff_member_id() OR public.has_staff_permission('staff.crm.read'))));

CREATE OR REPLACE FUNCTION public._sales_lead_change_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f text; o text; n text;
BEGIN
  FOREACH f IN ARRAY ARRAY['organisation_name','contact_name','contact_email','contact_phone','service_interest','origin_label','destination_label','service_date','estimated_value_kes','notes'] LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', f, f) INTO o, n USING OLD, NEW;
    IF o IS DISTINCT FROM n THEN
      INSERT INTO public.sales_lead_changes(lead_id, field, old_value, new_value, changed_by)
      VALUES (NEW.id, f, o, n, auth.uid());
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._sales_lead_change_log() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_sales_lead_change_log AFTER UPDATE ON public.sales_leads
FOR EACH ROW EXECUTE FUNCTION public._sales_lead_change_log();

CREATE OR REPLACE FUNCTION public._sales_lead_detail_validate() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.organisation_name IS NULL OR length(btrim(NEW.organisation_name)) < 2 THEN
    RAISE EXCEPTION 'Enter the organisation name.';
  END IF;
  IF NEW.contact_email IS DISTINCT FROM OLD.contact_email AND NEW.contact_email IS NOT NULL
     AND NEW.contact_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address.';
  END IF;
  IF NEW.contact_phone IS DISTINCT FROM OLD.contact_phone AND NEW.contact_phone IS NOT NULL
     AND NEW.contact_phone !~ '^\+?[0-9 ()-]{7,20}$' THEN
    RAISE EXCEPTION 'Enter a valid telephone number.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sales_lead_detail_validate BEFORE UPDATE ON public.sales_leads
FOR EACH ROW EXECUTE FUNCTION public._sales_lead_detail_validate();