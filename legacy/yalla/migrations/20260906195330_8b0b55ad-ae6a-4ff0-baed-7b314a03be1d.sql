-- 1. Canonical Charles Gateru record: align work email with the linked login.
UPDATE public.staff_members
   SET work_email = 'charles.gateru@yalla.africa', updated_at = now()
 WHERE id = '7a98630c-882a-4fd4-a07e-585efb9ce452';

-- Consolidate his reporting line onto the record his login is attached to.
UPDATE public.staff_members
   SET manager_staff_id = '7a98630c-882a-4fd4-a07e-585efb9ce452', updated_at = now()
 WHERE manager_staff_id = '62a834c9-be98-475b-b26b-74826079df5a';

-- 2. General Manager / Director are staff roles for portal purposes.
CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role::text IN ('admin','super_admin','director','general_manager','finance_admin',
                         'compliance_admin','operations_admin','operations_manager',
                         'pricing_manager','fleet_manager')
  );
$function$;

-- 3. Management authority follows the whole reporting line, not only direct reports.
CREATE OR REPLACE FUNCTION public.manages_staff_record(_staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH RECURSIVE me AS (
    SELECT id FROM public.staff_members WHERE user_id = auth.uid()
  ), line AS (
    SELECT s.id, s.manager_staff_id, 1 AS depth
      FROM public.staff_members s
     WHERE s.manager_staff_id IN (SELECT id FROM me)
    UNION ALL
    SELECT c.id, c.manager_staff_id, l.depth + 1
      FROM public.staff_members c
      JOIN line l ON c.manager_staff_id = l.id
     WHERE l.depth < 8
  )
  SELECT EXISTS (SELECT 1 FROM line WHERE id = _staff_id);
$function$;

-- 4. Manager team overview (whole reporting line) with work counts.
CREATE OR REPLACE FUNCTION public.staff_my_team_overview()
RETURNS TABLE (
  staff_id uuid,
  full_name text,
  work_email text,
  position_title text,
  unit_name text,
  employment_status text,
  has_login boolean,
  reports_to uuid,
  depth integer,
  open_work integer,
  overdue_work integer,
  completed_work integer,
  last_activity timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH RECURSIVE me AS (
    SELECT id FROM public.staff_members WHERE user_id = auth.uid()
  ), line AS (
    SELECT s.id, s.manager_staff_id, 1 AS depth
      FROM public.staff_members s
     WHERE s.manager_staff_id IN (SELECT id FROM me)
    UNION ALL
    SELECT c.id, c.manager_staff_id, l.depth + 1
      FROM public.staff_members c
      JOIN line l ON c.manager_staff_id = l.id
     WHERE l.depth < 8
  )
  SELECT s.id,
         COALESCE(s.preferred_name, s.full_name),
         s.work_email,
         p.title,
         u.name,
         s.employment_status::text,
         s.user_id IS NOT NULL,
         l.manager_staff_id,
         l.depth,
         COALESCE(w.open_work, 0)::int,
         COALESCE(w.overdue_work, 0)::int,
         COALESCE(w.completed_work, 0)::int,
         w.last_activity
    FROM line l
    JOIN public.staff_members s ON s.id = l.id
    LEFT JOIN public.org_positions p ON p.id = s.position_id
    LEFT JOIN public.org_units u ON u.id = s.unit_id
    LEFT JOIN (
      SELECT staff_id,
             count(*) FILTER (WHERE status IS DISTINCT FROM 'done' AND completed_at IS NULL) AS open_work,
             count(*) FILTER (WHERE completed_at IS NULL AND next_action_due IS NOT NULL
                                AND next_action_due < current_date) AS overdue_work,
             count(*) FILTER (WHERE completed_at IS NOT NULL) AS completed_work,
             max(GREATEST(COALESCE(updated_at, created_at), created_at)) AS last_activity
        FROM public.staff_work_items
       GROUP BY staff_id
    ) w ON w.staff_id = s.id
   ORDER BY l.depth, 2;
$function$;

REVOKE ALL ON FUNCTION public.staff_my_team_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_my_team_overview() TO authenticated;