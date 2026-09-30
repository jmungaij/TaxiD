
DO $$ BEGIN
  CREATE TYPE public.ifrs_classification AS ENUM (
    'CURRENT_ASSET','NON_CURRENT_ASSET',
    'CURRENT_LIABILITY','NON_CURRENT_LIABILITY',
    'EQUITY',
    'OPERATING_REVENUE','OTHER_INCOME',
    'OPERATING_EXPENSE','FINANCE_COST','TAX_EXPENSE',
    'CLEARING','CONTROL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.chart_of_accounts
  ADD COLUMN IF NOT EXISTS ifrs_classification public.ifrs_classification,
  ADD COLUMN IF NOT EXISTS display_order int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.chart_of_accounts SET ifrs_classification = CASE
  WHEN code IN ('1000','1100','1110','1120','1130','1140','1200','1210','1300','1400','1410','1420','1430','1440') THEN 'CURRENT_ASSET'::ifrs_classification
  WHEN code IN ('2000','2100','2200','2210','2220','2300','2400','2410','2420') THEN 'CURRENT_LIABILITY'::ifrs_classification
  WHEN code IN ('3000','3100') THEN 'EQUITY'::ifrs_classification
  WHEN code IN ('4000','4100','4200','4300','4400') THEN 'OPERATING_REVENUE'::ifrs_classification
  WHEN code IN ('5000','5100','5200','5300') THEN 'OPERATING_EXPENSE'::ifrs_classification
  WHEN code = '5400' THEN 'FINANCE_COST'::ifrs_classification
  ELSE ifrs_classification
END
WHERE ifrs_classification IS NULL;

UPDATE public.chart_of_accounts SET ifrs_classification='CLEARING' WHERE code='1140';
UPDATE public.chart_of_accounts SET display_order = code::int WHERE code ~ '^[0-9]+$';
UPDATE public.chart_of_accounts SET currency='KES' WHERE is_postable=true AND currency IS NULL;

DROP TRIGGER IF EXISTS trg_coa_updated_at ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_updated_at BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.chart_of_accounts
  ALTER COLUMN ifrs_classification SET NOT NULL;

-- Ledger accounts backfill
UPDATE public.ledger_accounts SET coa_code='5300' WHERE code='MPESA_FEES'       AND coa_code IS NULL;
UPDATE public.ledger_accounts SET coa_code='4400' WHERE code='REVENUE_PLATFORM' AND coa_code IS NULL;

UPDATE public.ledger_accounts la
   SET coa_code = CASE w.wallet_type::text
                    WHEN 'personal'   THEN '1410'
                    WHEN 'corporate'  THEN '1420'
                    WHEN 'driver'     THEN '1430'
                    WHEN 'treasury'   THEN '1440'
                    ELSE '1410'
                  END
  FROM public.wallets w
 WHERE la.wallet_id = w.id AND la.coa_code IS NULL;

ALTER TABLE public.ledger_accounts
  ALTER COLUMN coa_code SET NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_ledger_account_coa_valid()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE _c record;
BEGIN
  SELECT is_postable, active, currency INTO _c FROM public.chart_of_accounts WHERE code = NEW.coa_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'COA code % does not exist', NEW.coa_code; END IF;
  IF _c.active = false THEN RAISE EXCEPTION 'COA code % is inactive', NEW.coa_code; END IF;
  IF _c.is_postable = false THEN RAISE EXCEPTION 'COA code % is not postable', NEW.coa_code; END IF;
  IF _c.currency IS NOT NULL AND _c.currency <> NEW.currency THEN
    RAISE EXCEPTION 'Currency mismatch: ledger_account %=% vs COA %=%',
      NEW.code, NEW.currency, NEW.coa_code, _c.currency;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ledger_account_coa_valid ON public.ledger_accounts;
CREATE TRIGGER trg_ledger_account_coa_valid
  BEFORE INSERT OR UPDATE OF coa_code, currency ON public.ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION public.assert_ledger_account_coa_valid();

CREATE OR REPLACE VIEW public.v_chart_of_accounts_tree AS
WITH RECURSIVE tree AS (
  SELECT code, name, account_type, normal_side, parent_code, is_postable, active,
         currency, ifrs_classification, display_order,
         0 AS depth, code AS path
    FROM public.chart_of_accounts WHERE parent_code IS NULL
  UNION ALL
  SELECT c.code, c.name, c.account_type, c.normal_side, c.parent_code, c.is_postable, c.active,
         c.currency, c.ifrs_classification, c.display_order,
         t.depth + 1, t.path || ' > ' || c.code
    FROM public.chart_of_accounts c
    JOIN tree t ON c.parent_code = t.code
)
SELECT * FROM tree ORDER BY path;

GRANT SELECT ON public.v_chart_of_accounts_tree TO authenticated, service_role;
