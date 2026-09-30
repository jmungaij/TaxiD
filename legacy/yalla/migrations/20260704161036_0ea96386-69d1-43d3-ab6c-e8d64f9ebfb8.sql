CREATE OR REPLACE FUNCTION public.trg_score_wallet_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  _payload jsonb;
BEGIN
  -- Skip zero-amount or system rows with no owner
  IF NEW.user_id IS NULL OR COALESCE(NEW.amount_cents, 0) = 0 THEN
    RETURN NEW;
  END IF;

  _payload := jsonb_build_object(
    'entity_type', 'rider',
    'entity_id',   NEW.user_id,
    'amount',      (NEW.amount_cents::numeric / 100.0),
    'currency',    'KES',
    'source',      'wallet_transactions',
    'source_ref',  NEW.id,
    'features',    jsonb_build_object(
      'new_payment_method', false,
      'amount_zscore', 0
    )
  );

  PERFORM net.http_post(
    url     := 'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/fraud-transaction-score',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',       'sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ'
    ),
    body    := _payload,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wallet_transactions_after_insert_score ON public.wallet_transactions;
CREATE TRIGGER wallet_transactions_after_insert_score
AFTER INSERT ON public.wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_score_wallet_transaction();