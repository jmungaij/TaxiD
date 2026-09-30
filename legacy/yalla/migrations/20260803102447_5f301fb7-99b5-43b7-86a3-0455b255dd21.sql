CREATE TABLE IF NOT EXISTS public.charter_corporate_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  organization_name text NOT NULL,
  approver_name text,
  approver_title text,
  currency text NOT NULL DEFAULT 'KES',
  balance_kes numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, organization_name)
);

GRANT SELECT, INSERT, UPDATE ON public.charter_corporate_wallets TO authenticated;
GRANT ALL ON public.charter_corporate_wallets TO service_role;
ALTER TABLE public.charter_corporate_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their corporate wallets"
  ON public.charter_corporate_wallets FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE TABLE IF NOT EXISTS public.charter_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.charter_corporate_wallets(id) ON DELETE CASCADE,
  direction text NOT NULL,
  amount_kes numeric NOT NULL,
  balance_after numeric NOT NULL,
  reference text,
  booking_id uuid REFERENCES public.charter_bookings(id) ON DELETE SET NULL,
  approver_name text,
  approver_title text,
  cost_center text,
  prev_hash text,
  entry_hash text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.charter_wallet_ledger TO authenticated;
GRANT ALL ON public.charter_wallet_ledger TO service_role;
ALTER TABLE public.charter_wallet_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their wallet ledger"
  ON public.charter_wallet_ledger FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.charter_corporate_wallets w
      WHERE w.id = charter_wallet_ledger.wallet_id AND w.owner_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE TRIGGER charter_corporate_wallets_touch
  BEFORE UPDATE ON public.charter_corporate_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.charter_document_registry
  ADD COLUMN IF NOT EXISTS signature text,
  ADD COLUMN IF NOT EXISTS qr_payload text,
  ADD COLUMN IF NOT EXISTS validation_token text,
  ADD COLUMN IF NOT EXISTS token_consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS procurement jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS audit_chain jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS charter_document_registry_token_idx
  ON public.charter_document_registry (validation_token);