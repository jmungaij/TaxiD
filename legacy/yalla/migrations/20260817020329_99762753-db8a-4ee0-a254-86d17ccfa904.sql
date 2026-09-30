-- Recruitment 360 migration engine: worker monitoring + retry controls.

CREATE OR REPLACE FUNCTION public.rec_migration_worker_status(p_batch_id uuid DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_batches jsonb; v_totals jsonb;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_batches
  FROM (
    SELECT b.id AS batch_id,
           b.batch_no,
           b.name,
           b.status,
           b.created_at,
           count(f.id) FILTER (WHERE f.file_kind = 'document') AS documents,
           count(f.id) FILTER (WHERE f.status = 'queued') AS queued,
           count(f.id) FILTER (WHERE f.status = 'parsing') AS parsing,
           count(f.id) FILTER (WHERE f.status = 'parsed') AS parsed,
           count(f.id) FILTER (WHERE f.status = 'failed') AS failed,
           count(f.id) FILTER (WHERE f.status = 'stored') AS stored,
           count(f.id) FILTER (WHERE f.status = 'failed' AND f.attempts >= 3) AS exhausted,
           coalesce(max(f.attempts), 0) AS max_attempts,
           round(coalesce(avg(f.attempts) FILTER (WHERE f.file_kind = 'document'), 0), 2) AS avg_attempts,
           min(f.created_at) FILTER (WHERE f.status IN ('queued','parsing')) AS oldest_pending_at,
           (SELECT jsonb_build_object('file_id', e.id, 'file_name', e.original_file_name,
                                      'error', e.parse_error, 'attempts', e.attempts)
              FROM public.rec_migration_files e
             WHERE e.batch_id = b.id AND e.parse_error IS NOT NULL
             ORDER BY e.created_at DESC LIMIT 1) AS last_error,
           (SELECT count(*) FROM public.rec_migration_records r
             WHERE r.batch_id = b.id AND r.state IN ('QUEUED','PARSING')) AS records_pending,
           (SELECT count(*) FROM public.rec_migration_records r
             WHERE r.batch_id = b.id AND r.state = 'EXCEPTION') AS records_exception
      FROM public.rec_migration_batches b
      LEFT JOIN public.rec_migration_files f ON f.batch_id = b.id
     WHERE p_batch_id IS NULL OR b.id = p_batch_id
     GROUP BY b.id, b.batch_no, b.name, b.status, b.created_at
     ORDER BY b.created_at DESC
     LIMIT greatest(coalesce(p_limit, 25), 1)
  ) t;

  SELECT jsonb_build_object(
    'queued', count(*) FILTER (WHERE status = 'queued'),
    'parsing', count(*) FILTER (WHERE status = 'parsing'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'parsed', count(*) FILTER (WHERE status = 'parsed'),
    'exhausted', count(*) FILTER (WHERE status = 'failed' AND attempts >= 3),
    'stuck_parsing', count(*) FILTER (WHERE status = 'parsing' AND created_at < now() - interval '30 minutes'),
    'oldest_pending_at', min(created_at) FILTER (WHERE status IN ('queued','parsing'))
  ) INTO v_totals
  FROM public.rec_migration_files
  WHERE p_batch_id IS NULL OR batch_id = p_batch_id;

  RETURN jsonb_build_object('batches', v_batches, 'totals', coalesce(v_totals, '{}'::jsonb), 'generated_at', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.rec_migration_requeue_files(p_file_ids uuid[] DEFAULT NULL, p_batch_id uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_affected integer := 0; v_batch uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;
  IF p_file_ids IS NULL AND p_batch_id IS NULL THEN
    RAISE EXCEPTION 'either p_file_ids or p_batch_id is required';
  END IF;

  WITH target AS (
    UPDATE public.rec_migration_files f
       SET status = 'queued',
           parse_error = NULL
     WHERE f.file_kind = 'document'
       AND f.status IN ('failed','stored','parsing')
       AND ((p_file_ids IS NOT NULL AND f.id = ANY(p_file_ids))
            OR (p_file_ids IS NULL AND f.batch_id = p_batch_id))
    RETURNING f.id, f.batch_id
  )
  SELECT count(*), min(batch_id) INTO v_affected, v_batch FROM target;

  UPDATE public.rec_migration_records r
     SET state = 'QUEUED', exception_code = NULL, exception_reason = NULL
   WHERE r.state IN ('EXCEPTION','FAILED')
     AND r.exception_code = 'parse_failed'
     AND r.id IN (
       SELECT rf.record_id FROM public.rec_migration_record_files rf
        WHERE (p_file_ids IS NOT NULL AND rf.file_id = ANY(p_file_ids))
           OR (p_file_ids IS NULL AND rf.file_id IN (SELECT id FROM public.rec_migration_files WHERE batch_id = p_batch_id))
     );

  PERFORM public.rec_mig_audit(coalesce(p_batch_id, v_batch), NULL, 'files_requeued', NULL,
    jsonb_build_object('files', v_affected, 'file_ids', p_file_ids), p_reason);

  RETURN jsonb_build_object('requeued', v_affected);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rec_migration_worker_status(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_migration_requeue_files(uuid[], uuid, text) TO authenticated;