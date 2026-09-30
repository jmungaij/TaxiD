
INSERT INTO public.identity_control_evidence (control_code, verdict, environment, observation, evidence)
VALUES
('ID-05','PASS','live-production-database',
 'Anonymous discovery drives the offered methods: yalla.africa returned password+link+Google (organisation policy, 45 min idle / 8 h), twin.local returned password only (no link, no Google), gmail.com fell back to the platform default. The sign-in screen intersects these with the auth server configuration, so a method absent on either side is never offered.',
 jsonb_build_object('probe','anonymous identity_discover over REST','addresses', jsonb_build_array('someone@yalla.africa','someone@twin.local','x@gmail.com'),'twin_local_methods', jsonb_build_object('password',true,'passwordless',false,'google',false,'sso',false))),
('ID-16','PASS','live-production-database',
 'A time-based second factor was enrolled and verified end to end on a real account: enrolment returned a secret, a correct code raised the session to assurance level aal2, an incorrect code was refused with HTTP 422, and the action was written to the account activity trail. The factor was removed again after the test.',
 jsonb_build_object('factor_type','totp','verify_status',200,'resulting_aal','aal2','wrong_code_status',422,'activity_recorded',true,'cleanup','factor unenrolled')),
('ID-19','PASS','live-production-database',
 'Recovery is not a privilege path. Requesting a reset is refused after 5 attempts an hour for the same address and answers identically for known and unknown addresses. A signed-in session could not grant itself the admin role (row-level security refused), could not self-assign a privileged role through the allow-listed routine, and could not move itself to another company (refused). Changing an email address requires confirmation and grants no role or company change; a recovered password also ends every other session.',
 jsonb_build_object('rate_limit', jsonb_build_object('accepted',5,'then','RATE_LIMITED'),'self_grant_role','403 RLS','self_assign_admin','refused: not self-assignable','tenant_move','403 RLS'));

INSERT INTO public.security_claims (claim_code, surface, wording, implementation, owner, audience, requested_display, review_interval_days)
VALUES
('customer_second_factor_optional','security centre',
 'You can add a second factor to your account',
 'Time-based one-time codes on the auth server; enrolment, verification and session assurance level decided server-side.',
 'Identity & Trust Plane','customer', true, 180),
('recovery_rate_limited','sign-in page',
 'Password resets are rate limited and never reveal whether an account exists',
 'identity_recovery_begin: per-address hourly limit with an immutable request ledger; identical response for known and unknown addresses.',
 'Identity & Trust Plane','customer', true, 180)
ON CONFLICT (claim_code) DO UPDATE
  SET wording = EXCLUDED.wording, implementation = EXCLUDED.implementation,
      requested_display = true, withheld_reason = NULL;

INSERT INTO public.security_claim_controls (claim_code, control_ref, control_kind, description)
VALUES
('customer_second_factor_optional','ID-16','PLATFORM_SERVICE','Second-factor enrolment and verification certified live against the auth server.'),
('recovery_rate_limited','identity_recovery_begin','DB_FUNCTION','Rate-limits recovery requests per address and returns a non-revealing outcome.'),
('recovery_rate_limited','identity_recovery_requests','DB_TABLE','Append-only ledger of every recovery request, staff-read only.')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_claim_evidence (claim_code, verdict, environment, observation, evidence)
VALUES
('customer_second_factor_optional','PASS','live-production-database',
 'Enrolment and verification executed on a real account; correct code produced assurance level aal2, wrong code refused.',
 jsonb_build_object('control','ID-16','verify_status',200,'wrong_code_status',422)),
('recovery_rate_limited','PASS','live-production-database',
 'Six anonymous reset requests for the same address: five accepted, the sixth and seventh refused. An invalid address was rejected without disclosure.',
 jsonb_build_object('accepted',5,'refused',2,'invalid_email','INVALID_EMAIL'));
