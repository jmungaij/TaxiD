CREATE OR REPLACE FUNCTION public.rec_enrichment_audit_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changes jsonb;
  v_candidate uuid;
  v_actor uuid := auth.uid();
  v_source text := nullif(current_setting('rec.import_source', true), '');
  v_new jsonb := to_jsonb(NEW);
BEGIN
  IF TG_OP NOT IN ('INSERT','UPDATE') THEN
    RETURN NULL;
  END IF;

  -- Service-role writers (import worker, governed seeds) record their own
  -- audit rows with run/step linkage; skip the generic row to avoid doubles
  -- unless an explicit source context was set for the transaction.
  IF v_actor IS NULL AND v_source IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(jsonb_object_agg(key, jsonb_build_object('old', old_val, 'new', new_val)), '{}'::jsonb)
      INTO v_changes
      FROM (
        SELECT n.key, o.value AS old_val, n.value AS new_val
          FROM jsonb_each(v_new) n
          JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
         WHERE n.value IS DISTINCT FROM o.value
           AND n.key <> 'updated_at'
      ) d;
    IF v_changes = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  ELSE
    SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      INTO v_changes
      FROM jsonb_each(v_new)
     WHERE key NOT IN ('id','created_at','updated_at') AND value IS NOT NULL;
  END IF;

  -- rec_candidates is the candidate aggregate root and therefore uses NEW.id.
  -- Every other approved attachment carries candidate_id. JSON extraction is
  -- intentional: a polymorphic trigger must not bind NEW.candidate_id against
  -- rec_candidates, where that field cannot exist.
  IF TG_TABLE_NAME = 'rec_candidates' THEN
    v_candidate := nullif(v_new->>'id', '')::uuid;
  ELSE
    v_candidate := nullif(v_new->>'candidate_id', '')::uuid;
  END IF;

  IF v_candidate IS NULL THEN
    RAISE EXCEPTION 'rec_enrichment_audit contract violation: %.% has no canonical candidate identity',
      TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  INSERT INTO public.rec_enrichment_audit
    (table_name, record_id, candidate_id, action, changes, actor_user_id, actor_label, source, run_id, step_key)
  VALUES
    (TG_TABLE_NAME, nullif(v_new->>'id', '')::uuid, v_candidate, lower(TG_OP), v_changes, v_actor,
     nullif(current_setting('rec.actor_label', true), ''),
     coalesce(v_source, 'app'),
     nullif(current_setting('rec.import_run_id', true), '')::uuid,
     nullif(current_setting('rec.import_step_key', true), ''));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rec_enrichment_audit_trg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rec_enrichment_audit_trg() TO service_role;