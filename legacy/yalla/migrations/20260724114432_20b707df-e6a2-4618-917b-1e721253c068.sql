-- Phase P0 forensic repair: normalize workflow_name drift + repair terminal
-- current_state from linked payment_attempts. Original values are preserved
-- in metadata under original_workflow_name / original_current_state, and
-- the row is flagged metadata.reconstructed = true with a timestamp so
-- downstream evidence tooling can distinguish repaired rows from live ones.

WITH aliases(alias, canonical) AS (
  VALUES
    ('payment.wallet.topup','wallet_topup'),
    ('payment.ride.settlement','ride_payment'),
    ('payment.ride','ride_payment'),
    ('payment.corporate','corporate_payment'),
    ('payment.settlement','settlement'),
    ('payment.reconciliation','reconciliation')
)
UPDATE public.workflow_invocations wi
SET
  workflow_name = a.canonical,
  metadata = COALESCE(wi.metadata, '{}'::jsonb)
             || jsonb_build_object(
                  'original_workflow_name', wi.workflow_name,
                  'reconstructed', true,
                  'reconstructed_at', now(),
                  'reconstruction_reason', 'P0_workflow_name_normalization'
                )
FROM aliases a
WHERE wi.workflow_name = a.alias;

-- Repair current_state on mpesa-callback invocations whose linked
-- payment_attempt already reached a terminal state. Only rewrite when the
-- current_state is still the transient CALLBACK_RECEIVED bookkeeping value.
UPDATE public.workflow_invocations wi
SET
  current_state = pa.state,
  metadata = COALESCE(wi.metadata, '{}'::jsonb)
             || jsonb_build_object(
                  'original_current_state', wi.current_state,
                  'reconstructed', true,
                  'reconstructed_at', now(),
                  'reconstruction_reason', 'P0_current_state_from_payment_attempt',
                  'payment_attempt_id', pa.id
                )
FROM public.payment_attempts pa
WHERE wi.function_name = 'mpesa-callback'
  AND wi.current_state = 'CALLBACK_RECEIVED'
  AND pa.checkout_request_id = (wi.metadata->>'checkout_request_id')
  AND pa.state IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT','REVERSED');