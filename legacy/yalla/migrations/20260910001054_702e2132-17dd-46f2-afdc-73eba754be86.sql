DROP POLICY IF EXISTS "capacity photos are viewable" ON storage.objects;

CREATE POLICY "capacity photos readable by signed-in users"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'capacity-photos');

CREATE OR REPLACE FUNCTION public.comms_can_read_thread(_thread_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH t AS (
    SELECT th.account_id, th.owner_staff_id, ac.is_privileged
    FROM public.comms_threads th
    JOIN public.comms_accounts ac ON ac.id = th.account_id
    WHERE th.id = _thread_id
  )
  SELECT EXISTS (
    SELECT 1 FROM t WHERE public.comms_can_read_account(t.account_id)
  ) OR EXISTS (
    SELECT 1 FROM t
    WHERE NOT t.is_privileged
      AND t.owner_staff_id IS NOT NULL
      AND t.owner_staff_id = public.comms_my_staff_id()
  ) OR EXISTS (
    SELECT 1
    FROM t
    JOIN public.comms_messages m ON m.thread_id = _thread_id
    JOIN public.staff_members s ON s.user_id = auth.uid()
    WHERE NOT t.is_privileged
      AND s.employment_status = 'active'
      AND s.work_email IS NOT NULL
      AND (
        lower(s.work_email) = lower(coalesce(m.from_address,''))
        OR lower(s.work_email) = ANY (SELECT lower(x) FROM unnest(coalesce(m.to_addresses, '{}')) x)
      )
  );
$function$;