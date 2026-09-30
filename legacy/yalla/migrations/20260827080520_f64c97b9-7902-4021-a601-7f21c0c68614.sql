DO $do$
DECLARE r record; new_qual text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual
    FROM pg_policies
    WHERE schemaname='public' AND cmd='SELECT'
      AND tablename LIKE 'org\_%'
      AND qual LIKE '%is_staff_member()%'
  LOOP
    new_qual := replace(r.qual, 'is_staff_member()', $$has_staff_permission('staff.people.read')$$);
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
                   r.policyname, r.tablename, new_qual);
  END LOOP;
END
$do$;