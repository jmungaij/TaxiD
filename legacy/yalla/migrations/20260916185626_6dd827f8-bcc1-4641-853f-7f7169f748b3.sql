CREATE OR REPLACE FUNCTION public._partner_application_to_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_owner_user uuid;
  v_creator uuid;
  v_ref text;
  v_id uuid;
  v_service text;
BEGIN
  v_owner := public.sales_partner_enquiry_owner();
  IF v_owner IS NULL THEN
    RETURN NEW;                     -- no specialist on the register: no lead invented
  END IF;

  SELECT user_id INTO v_owner_user FROM public.staff_members WHERE id = v_owner;
  v_creator := coalesce(auth.uid(), NEW.submitted_by, v_owner_user);
  IF v_creator IS NULL THEN
    RETURN NEW;                     -- no accountable creator: application saved, no lead invented
  END IF;

  v_service := 'Partner enquiry — ' || replace(coalesce(NEW.partner_type::text,'UNSPECIFIED'),'_',' ')
             || ' / ' || replace(coalesce(NEW.commercial_model::text,'UNSPECIFIED'),'_',' ');
  v_ref := 'LEAD-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));

  INSERT INTO public.sales_leads (
    lead_ref, sales_staff_id, organisation_name, contact_name, contact_email, contact_phone,
    service_interest, notes, source, partner_application_id, created_by
  ) VALUES (
    v_ref, v_owner, NEW.organisation_name,
    coalesce(nullif(trim(NEW.contact_name),''),'Contact to confirm'),
    nullif(lower(trim(coalesce(NEW.contact_email,''))),''),
    nullif(trim(coalesce(NEW.contact_phone,'')),''),
    v_service,
    nullif(trim(coalesce(NEW.requirements,'')),''),
    'PARTNER_APPLICATION', NEW.id, v_creator
  ) RETURNING id INTO v_id;

  INSERT INTO public.sales_lead_events (lead_id, action, stage_to, detail)
  VALUES (v_id, 'CREATED', 'NEW',
          jsonb_build_object('lead_ref', v_ref, 'source', 'PARTNER_APPLICATION',
                             'partner_reference', NEW.reference, 'owner_staff_id', v_owner));

  INSERT INTO public.sales_assignment_events (lead_id, from_staff_id, to_staff_id, rule_kind, reason)
  VALUES (v_id, NULL, v_owner, 'PARTNER_APPLICATION', 'Assigned on partner application intake');

  RETURN NEW;
END;
$$;