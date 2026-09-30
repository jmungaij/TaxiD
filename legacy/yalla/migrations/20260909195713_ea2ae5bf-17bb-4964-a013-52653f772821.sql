-- Recurring audit helper: realtime-published tables must keep RLS + scoped SELECT policies.
CREATE OR REPLACE FUNCTION public.realtime_rls_violations(_approved text[] DEFAULT '{}')
RETURNS TABLE(tablename text, reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH published AS (
    SELECT DISTINCT pt.tablename::text AS tablename
    FROM pg_publication_tables pt
    WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
  ), info AS (
    SELECT p.tablename,
           c.relrowsecurity AS rls,
           regexp_replace(p.tablename, '_(\d{6}|default)$', '') AS parent,
           (SELECT count(*) FROM pg_policies pol
              WHERE pol.schemaname = 'public' AND pol.tablename = p.tablename
                AND pol.cmd IN ('SELECT','ALL')) AS select_policies,
           (SELECT count(*) FROM pg_policies pol
              WHERE pol.schemaname = 'public' AND pol.tablename = p.tablename
                AND pol.cmd IN ('SELECT','ALL')
                AND (pol.qual IS NULL OR lower(btrim(pol.qual)) IN ('true','(true)'))) AS broad_policies
    FROM published p
    JOIN pg_class c ON c.relname = p.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  )
  SELECT tablename, 'row-level security is disabled on a realtime-published table'
  FROM info WHERE rls IS NOT TRUE
  UNION ALL
  SELECT tablename, 'realtime-published table has no SELECT policy (subscribers get nothing, or policy was dropped)'
  FROM info WHERE rls IS TRUE AND select_policies = 0
  UNION ALL
  SELECT tablename, 'realtime-published table has an unconditional SELECT policy — change events would leak to subscribers'
  FROM info WHERE broad_policies > 0
  UNION ALL
  SELECT tablename, 'table is in the supabase_realtime publication but is not on the approved broadcast allowlist'
  FROM info
  WHERE array_length(_approved, 1) IS NOT NULL
    AND NOT (tablename = ANY(_approved)) AND NOT (parent = ANY(_approved));
$$;

REVOKE ALL ON FUNCTION public.realtime_rls_violations(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.realtime_rls_violations(text[]) TO service_role;

-- Recurring audit helper: unconditional anon/public reads are allowed only on approved reference tables.
CREATE OR REPLACE FUNCTION public.public_reference_read_violations(_approved text[] DEFAULT '{}')
RETURNS TABLE(tablename text, policyname text, reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT p.tablename::text,
         p.policyname::text,
         'table is readable by anonymous callers without any predicate but is not on the approved public reference allowlist'
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.cmd IN ('SELECT','ALL')
    AND ('anon' = ANY(p.roles) OR 'public' = ANY(p.roles))
    AND (p.qual IS NULL OR lower(btrim(p.qual)) IN ('true','(true)'))
    AND NOT (p.tablename::text = ANY(_approved))
  ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.public_reference_read_violations(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_reference_read_violations(text[]) TO service_role;