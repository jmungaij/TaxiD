CREATE TABLE IF NOT EXISTS public.corporate_work_domains (
  domain text PRIMARY KEY CHECK (domain = lower(domain)),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.corporate_work_domains TO authenticated;
GRANT ALL ON public.corporate_work_domains TO service_role;
ALTER TABLE public.corporate_work_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members read their domains" ON public.corporate_work_domains FOR SELECT TO authenticated
  USING (private.is_corporate_member(auth.uid(), corporate_id) OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.corporate_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_saved_views TO authenticated;
GRANT ALL ON public.corporate_saved_views TO service_role;
ALTER TABLE public.corporate_saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own saved views" ON public.corporate_saved_views FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND private.is_corporate_manager_or_admin(auth.uid(), corporate_id));

-- Seed Yalla Beena Limited
DO $$ DECLARE c uuid; BEGIN
  SELECT id INTO c FROM corporate_accounts WHERE legal_name ILIKE 'Yalla Beena%';
  IF c IS NULL THEN
    INSERT INTO corporate_accounts(legal_name, trading_name, kra_pin, registration_number, billing_email, currency, status, payment_terms_days, metadata)
      VALUES ('Yalla Beena Limited','Yalla Beena','P052311504G','PVT-5JUZZ8JR','jmungai@yalla.africa','KES','ACTIVE',3, jsonb_build_object('work_domain','yalla.africa','login_method','email_password'))
      RETURNING id INTO c;
  END IF;
  INSERT INTO corporate_work_domains(domain, corporate_id) VALUES ('yalla.africa', c) ON CONFLICT (domain) DO NOTHING;
  INSERT INTO corporate_employees(corporate_id, email, full_name, role, status, invited_at, metadata)
    SELECT c, 'jmungai@yalla.africa', 'John Mungai', 'corporate_admin', 'invited', now(), jsonb_build_object('title','Director','protected_director',true)
    WHERE NOT EXISTS (SELECT 1 FROM corporate_employees WHERE corporate_id=c AND lower(email)='jmungai@yalla.africa');
  INSERT INTO corporate_employees(corporate_id, email, full_name, role, status, invited_at, metadata)
    SELECT c, 'charles.gateru@yalla.africa', 'Charles Gateru', 'corporate_admin', 'invited', now(), jsonb_build_object('title','General Manager')
    WHERE NOT EXISTS (SELECT 1 FROM corporate_employees WHERE corporate_id=c AND lower(email)='charles.gateru@yalla.africa');
END $$;

-- Director protection
CREATE OR REPLACE FUNCTION private.trg_protect_director()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('taxid.director_handover', true),'') = 'on' THEN RETURN coalesce(NEW, OLD); END IF;
  IF coalesce((OLD.metadata->>'protected_director')::boolean, false) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'DIRECTOR_PROTECTED: the Director can only be replaced by another director' USING ERRCODE='42501'; END IF;
    IF NEW.status IN ('suspended','removed') OR NEW.removed_at IS NOT NULL OR NEW.role <> 'corporate_admin'
       OR NOT coalesce((NEW.metadata->>'protected_director')::boolean, false) OR NEW.corporate_id <> OLD.corporate_id THEN
      RAISE EXCEPTION 'DIRECTOR_PROTECTED: the Director can only be replaced by another director' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND coalesce((NEW.metadata->>'protected_director')::boolean,false) AND NOT coalesce((OLD.metadata->>'protected_director')::boolean,false) THEN
    RAISE EXCEPTION 'DIRECTOR_PROTECTED: use the director handover' USING ERRCODE='42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_protect_director ON public.corporate_employees;
CREATE TRIGGER trg_protect_director BEFORE UPDATE OR DELETE ON public.corporate_employees FOR EACH ROW EXECUTE FUNCTION private.trg_protect_director();

CREATE OR REPLACE FUNCTION private.trg_protect_director_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(current_setting('taxid.director_handover', true),'') = 'on' THEN RETURN OLD; END IF;
  IF OLD.role::text IN ('super_admin','director') AND EXISTS (SELECT 1 FROM corporate_employees WHERE user_id=OLD.user_id AND coalesce((metadata->>'protected_director')::boolean,false)) THEN
    RAISE EXCEPTION 'DIRECTOR_PROTECTED: the Director''s super admin role can only move through a director handover' USING ERRCODE='42501';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_protect_director_roles ON public.user_roles;
CREATE TRIGGER trg_protect_director_roles BEFORE DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION private.trg_protect_director_roles();

-- Work-account claim (verified email only)
CREATE OR REPLACE FUNCTION private.corporate_claim_work_account()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid := auth.uid(); em text; ok boolean; d text; corp uuid; e corporate_employees%ROWTYPE;
BEGIN
  IF me IS NULL THEN RETURN jsonb_build_object('ok',false,'error','AUTH_REQUIRED'); END IF;
  SELECT lower(email), email_confirmed_at IS NOT NULL INTO em, ok FROM auth.users WHERE id=me;
  IF NOT coalesce(ok,false) THEN RETURN jsonb_build_object('ok',false,'error','EMAIL_NOT_CONFIRMED'); END IF;
  d := split_part(em,'@',2);
  SELECT corporate_id INTO corp FROM corporate_work_domains WHERE domain=d;
  IF corp IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_A_WORK_DOMAIN'); END IF;
  SELECT * INTO e FROM corporate_employees WHERE corporate_id=corp AND lower(email)=em AND status IN ('invited','active') AND removed_at IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_ON_STAFF_LIST','message','Ask your company admin to add you to the staff list.'); END IF;
  IF e.user_id IS NOT NULL AND e.user_id <> me THEN RETURN jsonb_build_object('ok',false,'error','LINKED_TO_ANOTHER_ACCOUNT'); END IF;
  UPDATE corporate_employees SET user_id=me, status='active', activated_at=coalesce(activated_at, now()) WHERE id=e.id;
  INSERT INTO user_roles(user_id, role) VALUES (me, CASE WHEN e.role='corporate_admin' THEN 'corporate_admin' ELSE 'corporate_employee' END::app_role) ON CONFLICT DO NOTHING;
  IF coalesce((e.metadata->>'protected_director')::boolean,false) THEN
    INSERT INTO user_roles(user_id, role) VALUES (me,'super_admin'),(me,'director') ON CONFLICT DO NOTHING;
  ELSIF e.metadata->>'title' = 'General Manager' THEN
    INSERT INTO user_roles(user_id, role) VALUES (me,'general_manager') ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO corporate_policy_audit_log(corporate_id, actor_user_id, action, target_type, target_id, after)
    VALUES (corp, me, 'employee.work_account_linked', 'employee', e.id, jsonb_build_object('email', em));
  RETURN jsonb_build_object('ok',true,'corporate_id',corp,'employee_id',e.id);
END $$;

-- Director handover
CREATE OR REPLACE FUNCTION private.corporate_director_handover(_corp uuid, _new_employee uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid := auth.uid(); old corporate_employees%ROWTYPE; nw corporate_employees%ROWTYPE;
BEGIN
  SELECT * INTO old FROM corporate_employees WHERE corporate_id=_corp AND coalesce((metadata->>'protected_director')::boolean,false) LIMIT 1;
  IF NOT (public.has_role(me,'super_admin') OR old.user_id = me) THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHORISED'); END IF;
  SELECT * INTO nw FROM corporate_employees WHERE id=_new_employee AND corporate_id=_corp AND status='active' AND user_id IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NEW_DIRECTOR_MUST_BE_ACTIVE_SIGNED_IN_EMPLOYEE'); END IF;
  IF nw.id = old.id THEN RETURN jsonb_build_object('ok',false,'error','SAME_PERSON'); END IF;
  PERFORM set_config('taxid.director_handover','on', true);
  UPDATE corporate_employees SET role='corporate_admin', metadata = metadata || jsonb_build_object('title','Director','protected_director',true) WHERE id=nw.id;
  INSERT INTO user_roles(user_id, role) VALUES (nw.user_id,'super_admin'),(nw.user_id,'director'),(nw.user_id,'corporate_admin') ON CONFLICT DO NOTHING;
  IF old.id IS NOT NULL THEN
    UPDATE corporate_employees SET metadata = (metadata - 'protected_director') || jsonb_build_object('title','Former Director') WHERE id=old.id;
    DELETE FROM user_roles WHERE user_id=old.user_id AND role::text IN ('super_admin','director');
  END IF;
  PERFORM set_config('taxid.director_handover','off', true);
  INSERT INTO corporate_policy_audit_log(corporate_id, actor_user_id, action, target_type, target_id, before, after)
    VALUES (_corp, me, 'director.handover', 'employee', nw.id, jsonb_build_object('from', old.id), jsonb_build_object('to', nw.id));
  RETURN jsonb_build_object('ok',true);
END $$;

-- Staff status management
CREATE OR REPLACE FUNCTION private.corporate_employee_set_status(_employee uuid, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid := auth.uid(); e corporate_employees%ROWTYPE;
BEGIN
  SELECT * INTO e FROM corporate_employees WHERE id=_employee;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF NOT (private.is_corporate_manager_or_admin(me, e.corporate_id) OR public.has_role(me,'super_admin')) THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHORISED'); END IF;
  IF _status NOT IN ('active','suspended','removed','deleted') THEN RETURN jsonb_build_object('ok',false,'error','INVALID_STATUS'); END IF;
  IF coalesce((e.metadata->>'protected_director')::boolean,false) AND _status <> 'active' THEN
    RETURN jsonb_build_object('ok',false,'error','DIRECTOR_PROTECTED','message','The Director can only be replaced by another director.'); END IF;
  IF e.user_id = me AND _status <> 'active' THEN RETURN jsonb_build_object('ok',false,'error','CANNOT_CHANGE_SELF'); END IF;
  IF _status = 'deleted' THEN
    DELETE FROM corporate_employees WHERE id=_employee;
  ELSE
    UPDATE corporate_employees SET status=_status::corporate_employee_status, removed_at = CASE WHEN _status='removed' THEN now() ELSE NULL END WHERE id=_employee;
  END IF;
  IF _status IN ('suspended','removed','deleted') AND e.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM corporate_employees WHERE user_id=e.user_id AND status='active' AND id<>_employee) THEN
    DELETE FROM user_roles WHERE user_id=e.user_id AND role::text IN ('corporate_admin','corporate_employee');
  END IF;
  INSERT INTO corporate_policy_audit_log(corporate_id, actor_user_id, action, target_type, target_id, before)
    VALUES (e.corporate_id, me, 'employee.'||_status, 'employee', _employee, jsonb_build_object('email', e.email, 'status', e.status));
  RETURN jsonb_build_object('ok',true);
END $$;

-- HR spreadsheet import
CREATE OR REPLACE FUNCTION private.corporate_employees_import(_corp uuid, _rows jsonb, _suspend_missing boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid := auth.uid(); r jsonb; em text; dep uuid; rl corporate_employee_role; added int := 0; updated int := 0; skipped int := 0; suspended int := 0; errs jsonb := '[]'::jsonb; seen text[] := '{}'; ex corporate_employees%ROWTYPE;
BEGIN
  IF NOT (private.is_corporate_manager_or_admin(me, _corp) OR public.has_role(me,'super_admin')) THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHORISED'); END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) > 2000 THEN RETURN jsonb_build_object('ok',false,'error','INVALID_FILE'); END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    em := lower(btrim(coalesce(r->>'email','')));
    IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN skipped := skipped+1; errs := errs || to_jsonb('Invalid email: '||left(em,80)); CONTINUE; END IF;
    seen := seen || em;
    rl := CASE lower(coalesce(r->>'role','')) WHEN 'admin' THEN 'corporate_admin' WHEN 'corporate_admin' THEN 'corporate_admin' WHEN 'manager' THEN 'corporate_manager' WHEN 'corporate_manager' THEN 'corporate_manager' ELSE 'corporate_employee' END;
    dep := NULL;
    IF nullif(btrim(coalesce(r->>'department','')),'') IS NOT NULL THEN
      SELECT id INTO dep FROM corporate_departments WHERE corporate_id=_corp AND lower(name)=lower(btrim(r->>'department')) LIMIT 1;
    END IF;
    SELECT * INTO ex FROM corporate_employees WHERE corporate_id=_corp AND lower(email)=em LIMIT 1;
    IF FOUND THEN
      IF coalesce((ex.metadata->>'protected_director')::boolean,false) THEN rl := 'corporate_admin'; END IF;
      UPDATE corporate_employees SET full_name=coalesce(nullif(left(btrim(r->>'full_name'),120),''), full_name), phone=coalesce(nullif(left(btrim(r->>'phone'),30),''), phone),
        employee_code=coalesce(nullif(left(btrim(r->>'employee_code'),40),''), employee_code), department_id=coalesce(dep, department_id), role=rl,
        metadata = metadata || CASE WHEN nullif(btrim(r->>'title'),'') IS NOT NULL AND NOT coalesce((ex.metadata->>'protected_director')::boolean,false) THEN jsonb_build_object('title', left(btrim(r->>'title'),80)) ELSE '{}'::jsonb END
        WHERE id=ex.id;
      updated := updated+1;
    ELSE
      INSERT INTO corporate_employees(corporate_id, email, full_name, phone, employee_code, department_id, role, status, invited_at, metadata)
        VALUES (_corp, em, nullif(left(btrim(r->>'full_name'),120),''), nullif(left(btrim(r->>'phone'),30),''), nullif(left(btrim(r->>'employee_code'),40),''), dep, rl, 'invited', now(),
          jsonb_build_object('source','hr_import') || CASE WHEN nullif(btrim(r->>'title'),'') IS NOT NULL THEN jsonb_build_object('title', left(btrim(r->>'title'),80)) ELSE '{}'::jsonb END);
      added := added+1;
    END IF;
  END LOOP;
  IF _suspend_missing THEN
    UPDATE corporate_employees SET status='suspended' WHERE corporate_id=_corp AND status IN ('active','invited') AND NOT (lower(email) = ANY(seen))
      AND NOT coalesce((metadata->>'protected_director')::boolean,false) AND user_id IS DISTINCT FROM me;
    GET DIAGNOSTICS suspended = ROW_COUNT;
  END IF;
  INSERT INTO corporate_policy_audit_log(corporate_id, actor_user_id, action, target_type, after)
    VALUES (_corp, me, 'employee.hr_import', 'import', jsonb_build_object('added',added,'updated',updated,'skipped',skipped,'suspended',suspended));
  RETURN jsonb_build_object('ok',true,'added',added,'updated',updated,'skipped',skipped,'suspended',suspended,'errors',errs);
END $$;

-- Executive summary
CREATE OR REPLACE FUNCTION private.corporate_executive_summary(_corp uuid, _from date, _to date, _group text DEFAULT 'cost_center')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid := auth.uid(); out jsonb;
BEGIN
  IF NOT (private.is_corporate_manager_or_admin(me, _corp) OR public.has_role(me,'super_admin')) THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHORISED'); END IF;
  IF _group NOT IN ('cost_center','department','employee','month','invoice') THEN _group := 'cost_center'; END IF;
  WITH items AS (
    SELECT ii.*, i.invoice_number, i.status inv_status, i.issued_at, e.department_id
    FROM corporate_invoice_items ii JOIN corporate_invoices i ON i.id=ii.invoice_id
    LEFT JOIN trip_bookings b ON b.id = nullif(ii.metadata->>'booking_id','')::uuid
    LEFT JOIN corporate_employees e ON e.id = b.corporate_employee_id
    WHERE i.corporate_id=_corp AND coalesce(ii.trip_ended_at, i.created_at)::date BETWEEN _from AND _to
  ), g AS (
    SELECT CASE _group WHEN 'cost_center' THEN coalesce(cost_center,'Unassigned') WHEN 'employee' THEN coalesce(employee_name,'Guest / unassigned')
      WHEN 'month' THEN to_char(coalesce(trip_ended_at, issued_at),'YYYY-MM') WHEN 'invoice' THEN coalesce(invoice_number,'Draft')
      ELSE coalesce((SELECT name FROM corporate_departments d WHERE d.id=items.department_id),'Unassigned') END k,
      count(*) trips, sum(total_cents) total_cents
    FROM items GROUP BY 1
  )
  SELECT jsonb_build_object('ok',true,
    'groups', coalesce((SELECT jsonb_agg(jsonb_build_object('key',k,'trips',trips,'total_cents',total_cents) ORDER BY total_cents DESC) FROM g),'[]'),
    'totals', (SELECT jsonb_build_object('trips',count(*),'total_cents',coalesce(sum(total_cents),0)) FROM items),
    'invoices', (SELECT jsonb_build_object('open_cents',coalesce(sum(balance_cents) FILTER (WHERE status::text NOT IN ('paid','void','voided')),0),'count',count(*)) FROM corporate_invoices WHERE corporate_id=_corp),
    'exceptions', (SELECT count(*) FROM corporate_trip_settlements WHERE corporate_id=_corp AND status='EXCEPTION'),
    'safety', (SELECT jsonb_build_object('open',count(*) FILTER (WHERE s.resolved_at IS NULL),'total',count(*),
        'recent', coalesce(jsonb_agg(jsonb_build_object('reference',s.reference,'type',s.incident_type,'severity',s.severity,'status',s.status,'at',s.created_at,'trip',s.booking_number) ORDER BY s.created_at DESC) FILTER (WHERE s.id IS NOT NULL),'[]'))
      FROM safety_incidents s JOIN trip_bookings b ON b.id=s.trip_booking_id WHERE b.corporate_id=_corp AND s.created_at::date BETWEEN _from AND _to),
    'delays', (SELECT count(*) FROM trip_delay_alerts a JOIN trip_bookings b ON b.id=a.trip_booking_id WHERE b.corporate_id=_corp AND a.created_at::date BETWEEN _from AND _to),
    'live_trips', (SELECT count(*) FROM trip_bookings WHERE corporate_id=_corp AND status IN ('accepted','arrived','in_progress'))
  ) INTO out;
  RETURN out;
END $$;

REVOKE ALL ON FUNCTION private.corporate_claim_work_account(), private.corporate_director_handover(uuid,uuid), private.corporate_employee_set_status(uuid,text),
  private.corporate_employees_import(uuid,jsonb,boolean), private.corporate_executive_summary(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.corporate_claim_work_account(), private.corporate_director_handover(uuid,uuid), private.corporate_employee_set_status(uuid,text),
  private.corporate_employees_import(uuid,jsonb,boolean), private.corporate_executive_summary(uuid,date,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.corporate_claim_work_account() RETURNS jsonb LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.corporate_claim_work_account() $$;
CREATE OR REPLACE FUNCTION public.corporate_director_handover(_corp uuid, _new_employee uuid) RETURNS jsonb LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.corporate_director_handover(_corp,_new_employee) $$;
CREATE OR REPLACE FUNCTION public.corporate_employee_set_status(_employee uuid, _status text) RETURNS jsonb LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.corporate_employee_set_status(_employee,_status) $$;
CREATE OR REPLACE FUNCTION public.corporate_employees_import(_corp uuid, _rows jsonb, _suspend_missing boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.corporate_employees_import(_corp,_rows,_suspend_missing) $$;
CREATE OR REPLACE FUNCTION public.corporate_executive_summary(_corp uuid, _from date, _to date, _group text DEFAULT 'cost_center') RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $$ SELECT private.corporate_executive_summary(_corp,_from,_to,_group) $$;
REVOKE ALL ON FUNCTION public.corporate_claim_work_account(), public.corporate_director_handover(uuid,uuid), public.corporate_employee_set_status(uuid,text),
  public.corporate_employees_import(uuid,jsonb,boolean), public.corporate_executive_summary(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_claim_work_account(), public.corporate_director_handover(uuid,uuid), public.corporate_employee_set_status(uuid,text),
  public.corporate_employees_import(uuid,jsonb,boolean), public.corporate_executive_summary(uuid,date,date,text) TO authenticated;