-- Link the two live @yalla.africa staff logins to the staff register
INSERT INTO public.staff_members (org_id, unit_id, position_id, user_id, staff_no, full_name, work_email, employment_status, employment_type, start_date)
VALUES
  ('b459ec1f-e29e-41ac-b8cd-b19c8ee7a9e3','42f2fc8b-0eaa-4726-9917-9617e986c84b','78cbfaae-9e1a-4b45-9efa-ee436a156974','7a8f6644-40c8-44fa-9347-e827dade9d51','ADM-101','John Mungai','jmungai@yalla.africa','active','permanent','2026-01-08'),
  ('b459ec1f-e29e-41ac-b8cd-b19c8ee7a9e3','42f2fc8b-0eaa-4726-9917-9617e986c84b','78cbfaae-9e1a-4b45-9efa-ee436a156974','fdfacaf2-10ae-4f02-b96c-865e8fc0a3d0','ADM-102','Charles Gateru','charles.gateru@yalla.africa','active','permanent','2026-01-08');