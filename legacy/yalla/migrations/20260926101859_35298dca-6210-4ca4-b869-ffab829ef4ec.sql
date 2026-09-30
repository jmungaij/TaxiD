INSERT INTO public.comms_account_grants (account_id, staff_id, permission)
SELECT ac.id, sm.id, 'reply'::public.comms_grant_permission
FROM public.comms_accounts ac
JOIN public.staff_members sm ON lower(sm.work_email) = lower(ac.mailbox_address)
WHERE NOT ac.is_privileged
  AND NOT EXISTS (SELECT 1 FROM public.comms_account_grants g
                  WHERE g.account_id = ac.id AND g.staff_id = sm.id AND g.permission = 'reply'::public.comms_grant_permission);