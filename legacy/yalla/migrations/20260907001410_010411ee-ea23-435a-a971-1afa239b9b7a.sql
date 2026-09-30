INSERT INTO public.comms_account_grants (account_id, staff_id, permission, granted_by)
SELECT a.id, s.id, 'read', NULL
FROM public.comms_accounts a
JOIN public.staff_members s ON s.staff_no = 'YM-CSS-001'
WHERE a.mailbox_address IN ('sales@yalla.africa', 'support@yalla.africa')
ON CONFLICT DO NOTHING;

INSERT INTO public.comms_account_grants (account_id, staff_id, permission, granted_by)
SELECT a.id, s.id, 'reply', NULL
FROM public.comms_accounts a
JOIN public.staff_members s ON s.staff_no = 'YM-CSS-001'
WHERE a.mailbox_address IN ('sales@yalla.africa', 'support@yalla.africa')
ON CONFLICT DO NOTHING;