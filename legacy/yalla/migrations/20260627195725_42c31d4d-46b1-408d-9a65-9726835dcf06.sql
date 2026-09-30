
-- corporate_cash_ledger_audit indexes
CREATE INDEX IF NOT EXISTS idx_corp_audit_corp_created ON public.corporate_cash_ledger_audit (corporate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corp_audit_event_type ON public.corporate_cash_ledger_audit (event_type);
CREATE INDEX IF NOT EXISTS idx_corp_audit_paybill_ref ON public.corporate_cash_ledger_audit (paybill_reference);
CREATE INDEX IF NOT EXISTS idx_corp_audit_reference ON public.corporate_cash_ledger_audit (reference);
CREATE INDEX IF NOT EXISTS idx_corp_audit_actor_email ON public.corporate_cash_ledger_audit (lower(actor_email));
CREATE INDEX IF NOT EXISTS idx_corp_audit_ledger_entry ON public.corporate_cash_ledger_audit (ledger_entry_id);
CREATE INDEX IF NOT EXISTS idx_corp_audit_proof ON public.corporate_cash_ledger_audit (proof_id);

-- admin_audit_log indexes
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON public.admin_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_email ON public.admin_audit_log (lower(actor_email));
CREATE INDEX IF NOT EXISTS idx_admin_audit_resource ON public.admin_audit_log (resource_type, resource_id);

-- admin_login_events indexes for pagination
CREATE INDEX IF NOT EXISTS idx_admin_login_events_created ON public.admin_login_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_login_events_email ON public.admin_login_events (lower(email));
