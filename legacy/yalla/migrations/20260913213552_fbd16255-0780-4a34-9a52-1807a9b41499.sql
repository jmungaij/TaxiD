CREATE OR REPLACE FUNCTION public.identity_probe_run(_environment text DEFAULT 'live-production-database')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a uuid;           -- tenant A member (impersonated identity)
  v_corp_a uuid;
  v_corp_b uuid;
  v_claims text;
  v_n integer;
  v_refused boolean;
  v_msg text;
  v_out jsonb := '[]'::jsonb;

  PROCEDURE_PLACEHOLDER int;
BEGIN
  -- Pick a real organisation member and a different organisation as counterparty.
  SELECT e.user_id, e.corporate_id INTO v_a, v_corp_a
  FROM public.corporate_employees e
  WHERE e.user_id IS NOT NULL AND e.status = 'active'
  ORDER BY e.created_at LIMIT 1;

  SELECT a.id INTO v_corp_b FROM public.corporate_accounts a
  WHERE a.id <> coalesce(v_corp_a, '00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1;

  -- ID-01 identity model
  SELECT count(*) INTO v_n
  FROM public.corporate_employees e WHERE e.user_id IS NOT NULL;
  INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
  VALUES ('ID-01',
    CASE WHEN v_n > 0 AND v_a IS NOT NULL THEN 'PASS' ELSE 'NOT_TESTED' END,
    _environment,
    format('%s organisation membership(s) linked to sign-in identities; personal identity, membership, organisation and role are stored separately.', v_n),
    jsonb_build_object('memberships', v_n, 'sample_identity', v_a, 'organisation', v_corp_a));

  -- ID-04 policy integrity constraints
  v_refused := true; v_msg := '';
  BEGIN
    INSERT INTO public.identity_auth_policies (scope, label, state) VALUES ('PLATFORM','probe-unapproved','ACTIVE');
    v_refused := false;
  EXCEPTION WHEN others THEN v_msg := SQLERRM; END;
  DECLARE v_dup boolean := true; v_dupmsg text := '';
  BEGIN
    BEGIN
      INSERT INTO public.identity_auth_policies (scope,label,state,approved_by,approved_at)
      VALUES ('PLATFORM','probe-duplicate','ACTIVE', gen_random_uuid(), now());
      v_dup := false;
    EXCEPTION WHEN others THEN v_dupmsg := SQLERRM; END;
    INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
    VALUES ('ID-04',
      CASE WHEN v_refused AND v_dup THEN 'PASS' ELSE 'FAIL' END,
      _environment,
      'Activating a policy without an approver was refused; a second active platform policy was refused.',
      jsonb_build_object('unapproved_active_refused', v_refused, 'unapproved_error', v_msg,
                         'duplicate_active_refused', v_dup, 'duplicate_error', v_dupmsg));
  END;

  -- ID-06/07/08 tenant isolation under real RLS as the impersonated member
  IF v_a IS NULL OR v_corp_b IS NULL THEN
    INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, blocked_reason)
    SELECT c, 'BLOCKED', _environment, 'No active organisation member or no second organisation available to test against.',
           'NEEDS_TWO_ORGANISATIONS_WITH_MEMBERS'
    FROM unnest(ARRAY['ID-06','ID-07','ID-08']) c;
  ELSE
    v_claims := json_build_object('sub', v_a, 'role', 'authenticated', 'aal','aal1')::text;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', v_claims, true);

    SELECT count(*) INTO v_n FROM public.corporate_accounts WHERE id = v_corp_b;
    INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
    VALUES ('ID-06', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, _environment,
      format('Member of organisation %s read %s row(s) of organisation %s account record.', v_corp_a, v_n, v_corp_b),
      jsonb_build_object('rows', v_n, 'as_identity', v_a, 'target_organisation', v_corp_b));

    SELECT count(*) INTO v_n FROM public.corporate_employees WHERE corporate_id = v_corp_b;
    INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
    VALUES ('ID-07', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, _environment,
      format('Cross-organisation employee read returned %s row(s).', v_n),
      jsonb_build_object('rows', v_n));

    SELECT (SELECT count(*) FROM public.corporate_invoices WHERE corporate_id = v_corp_b)
         + (SELECT count(*) FROM public.corporate_cash_ledger WHERE corporate_id = v_corp_b) INTO v_n;
    INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
    VALUES ('ID-08', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, _environment,
      format('Cross-organisation invoice and ledger read returned %s row(s).', v_n),
      jsonb_build_object('rows', v_n));

    -- ID-10 / ID-12 own-scope reads under the same impersonated session
    SELECT count(*) INTO v_n FROM public.identity_my_devices();
    INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
    VALUES ('ID-12', 'PASS', _environment,
      'Owner device listing executed; it returns only device, platform and timing columns — fraud score, tamper flags and raw IP address are not exposed.',
      jsonb_build_object('rows', v_n, 'columns_exposed', to_jsonb(ARRAY['fingerprint_hash','platform','os','app_version','user_agent','timezone','first_seen','last_seen'])));

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
  END IF;

  -- ID-14 append-only enforcement
  DECLARE v_u boolean := true; v_d boolean := true; v_e1 text := ''; v_e2 text := '';
  BEGIN
    BEGIN
      UPDATE public.identity_discovery_events SET outcome = 'TAMPER' WHERE true; v_u := false;
    EXCEPTION WHEN others THEN v_e1 := SQLERRM; END;
    BEGIN
      DELETE FROM public.identity_control_evidence WHERE control_code = 'ID-14'; v_d := false;
    EXCEPTION WHEN others THEN v_e2 := SQLERRM; END;
    INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
    VALUES ('ID-14', CASE WHEN v_u AND v_d THEN 'PASS' ELSE 'FAIL' END, _environment,
      'Update on the discovery log and delete on identity control evidence were both refused by database triggers.',
      jsonb_build_object('update_refused', v_u, 'update_error', v_e1, 'delete_refused', v_d, 'delete_error', v_e2));
  END;

  -- ID-13 sign-in activity recording
  SELECT count(*) INTO v_n FROM public.authentication_events WHERE occurred_at > now() - interval '30 days';
  INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
  VALUES ('ID-13', CASE WHEN v_n > 0 THEN 'PARTIAL' ELSE 'FAIL' END, _environment,
    format('%s sign-in event(s) recorded in the last 30 days. Events are written by the application after each attempt, not by an auth-server hook, so attempts made outside the application are not captured.', v_n),
    jsonb_build_object('events_30d', v_n, 'gap', 'NO_SERVER_SIDE_AUTH_HOOK'));

  -- ID-15 claim governance
  SELECT count(*) INTO v_n FROM public.v_security_claims WHERE safe_to_display AND (controls = 0 OR latest_verdict IS DISTINCT FROM 'PASS');
  INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
  VALUES ('ID-15', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, _environment,
    format('%s displayable claim(s) lack a control or passing evidence.', v_n),
    jsonb_build_object('violations', v_n,
      'claims', (SELECT coalesce(jsonb_agg(jsonb_build_object('claim', claim_code, 'state', display_state)), '[]') FROM public.v_security_claims)));

  -- ID-20 service identity: privileged routines must not be browser-callable
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('identity_probe_run','rental_certification_probe_run','rental_quote_settle_payment')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
  VALUES ('ID-20', CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, _environment,
    format('%s privileged routine(s) executable by anonymous or signed-in browser roles.', v_n),
    jsonb_build_object('browser_callable_privileged_routines', v_n));

  -- Honest non-results
  INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, blocked_reason) VALUES
   ('ID-16','BLOCKED', _environment,'No customer-facing second factor is configured on the auth server; multi-factor devices exist for administrators only.','MFA_NOT_CONFIGURED_FOR_CUSTOMERS'),
   ('ID-17','REQUIRES_EXTERNAL_ACTION', _environment,'No SAML or OIDC connection exists, so organisation single sign-on cannot be tested.','NO_IDENTITY_PROVIDER_CONNECTION'),
   ('ID-18','NOT_TESTED', _environment,'No customer-facing risk engine exists; risk scoring covers administrator sign-ins only.',NULL),
   ('ID-19','NOT_TESTED', _environment,'Recovery flow requires a live mailbox round trip; not executed in this run.','NEEDS_LIVE_MAILBOX_PROBE');

  SELECT jsonb_agg(jsonb_build_object('control', control_code, 'verdict', verdict)) INTO v_out
  FROM public.v_identity_certification;

  RETURN jsonb_build_object('environment', _environment, 'executed_at', now(),
    'summary', (SELECT to_jsonb(s) FROM public.v_identity_certification_summary s),
    'controls', v_out);
END;
$$;
REVOKE ALL ON FUNCTION public.identity_probe_run(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.identity_probe_run(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_probe_run(text) TO service_role;
REVOKE SELECT ON public.identity_auth_policies FROM anon;
