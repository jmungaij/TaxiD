/**
 * Charter Business Portal profile store.
 *
 * The enterprise procurement spine (organisation, approving authority, cost
 * centre, purchase order, settlement route) and the operator pricing settings
 * are no longer captured on the public marketing site. They live in the charter
 * business portal and are persisted per browser so every mission planned from
 * the portal inherits the organisation's governed defaults.
 */
import type { ProcurementDetails } from "@/lib/charter/corporateApproval";
import type { CostSettings } from "@/lib/charter/catalog";

const PROCUREMENT_KEY = "yalla.charter.portal.procurement.v1";
const PRICING_KEY = "yalla.charter.portal.pricing.v1";

const read = <T,>(key: string): Partial<T> | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — portal still works for the current session */
  }
};

export const loadProcurementProfile = () => read<ProcurementDetails>(PROCUREMENT_KEY);
export const saveProcurementProfile = (p: ProcurementDetails) => write(PROCUREMENT_KEY, p);

export const loadPricingProfile = () => read<CostSettings>(PRICING_KEY);
export const savePricingProfile = (c: CostSettings) => write(PRICING_KEY, c);
