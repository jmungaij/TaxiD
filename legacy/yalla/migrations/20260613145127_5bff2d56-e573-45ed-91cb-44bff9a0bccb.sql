
-- =====================================================================
-- Phase 6 / A2: Analytics export outbox for BigQuery
-- =====================================================================

CREATE TYPE public.export_status AS ENUM ('PENDING','EXPORTED','FAILED','SKIPPED');

CREATE TABLE public.analytics_export_outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table   text NOT NULL,
  source_pk      text NOT NULL,
  event_date     date NOT NULL DEFAULT CURRENT_DATE,
  payload        jsonb NOT NULL,
  payload_hash   text,
  status         public.export_status NOT NULL DEFAULT 'PENDING',
  attempts       int NOT NULL DEFAULT 0,
  last_error     text,
  exported_at    timestamptz,
  bq_insert_id   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_pk)
);

GRANT SELECT ON public.analytics_export_outbox TO authenticated;
GRANT ALL ON public.analytics_export_outbox TO service_role;

ALTER TABLE public.analytics_export_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles read export queue"
  ON public.analytics_export_outbox FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(),
         ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE INDEX idx_export_outbox_pending
  ON public.analytics_export_outbox (created_at)
  WHERE status = 'PENDING';

CREATE INDEX idx_export_outbox_source
  ON public.analytics_export_outbox (source_table, status);

CREATE TRIGGER trg_outbox_updated_at
  BEFORE UPDATE ON public.analytics_export_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Generic enqueue function
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_analytics_export()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _payload jsonb;
  _pk      text;
  _date    date;
BEGIN
  _payload := to_jsonb(NEW);
  _pk      := COALESCE(NEW.id::text, gen_random_uuid()::text);
  _date    := COALESCE(
                (NEW.created_at)::date,
                CURRENT_DATE
              );

  INSERT INTO public.analytics_export_outbox
    (source_table, source_pk, event_date, payload, payload_hash)
  VALUES
    (TG_TABLE_NAME, _pk, _date, _payload,
     encode(digest(_payload::text,'sha256'),'hex'))
  ON CONFLICT (source_table, source_pk) DO NOTHING;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- Wire triggers on the financial event tables (INSERT only — append-only)
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_export_ledger_entries
  AFTER INSERT ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_analytics_export();

CREATE TRIGGER trg_export_journals
  AFTER INSERT ON public.journals
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_analytics_export();

CREATE TRIGGER trg_export_mpesa
  AFTER INSERT ON public.mpesa_transactions
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_analytics_export();

CREATE TRIGGER trg_export_settlements
  AFTER INSERT ON public.settlements
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_analytics_export();

CREATE TRIGGER trg_export_audit_hashes
  AFTER INSERT ON public.audit_hashes
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_analytics_export();

-- ---------------------------------------------------------------------
-- Helper: mark batch results
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_export_batch(
  _ids uuid[], _status public.export_status, _error text DEFAULT NULL, _bq_id text DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  UPDATE public.analytics_export_outbox
     SET status      = _status,
         attempts    = attempts + 1,
         last_error  = _error,
         exported_at = CASE WHEN _status = 'EXPORTED' THEN now() ELSE exported_at END,
         bq_insert_id= COALESCE(_bq_id, bq_insert_id)
   WHERE id = ANY(_ids);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
