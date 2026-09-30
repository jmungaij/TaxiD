DO $do$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'paf_apply_remediations_bulk'
   LIMIT 1;

  IF v_def IS NULL THEN
    RAISE NOTICE 'function missing, nothing to fix';
    RETURN;
  END IF;

  v_def := replace(v_def,
    'admin_audit_log(action, actor_id, entity_type, entity_id, metadata)',
    'admin_audit_log(action, actor_id, resource_type, resource_id, metadata)');
  v_def := replace(v_def, '''paf_remediation_batch'', v_batch,', '''paf_remediation_batch'', v_batch::text,');

  EXECUTE v_def;
END
$do$;