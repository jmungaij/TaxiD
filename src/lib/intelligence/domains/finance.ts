/**
 * Finance intelligence — deterministic read service.
 *
 * The intelligence layer never computes or adjusts money. It reports what the
 * transaction register already holds, and it reports the register's own
 * completeness so a reader knows how much of the picture is settled.
 */
import { supabase } from "@/integrations/supabase/client";
import { emptyReading, kes, newestTimestamp, type Claim, type DomainReading } from "../contract";

export const FINANCE_PERMISSION = "staff.commercial.read";

interface TxRow {
  platform_revenue_cents: number | null;
  gross_transaction_value_cents: number | null;
  recognised_at: string | null;
  financially_eligible: boolean | null;
  economics_complete: boolean | null;
  updated_at: string | null;
}

export async function readFinance(authorised: boolean): Promise<DomainReading> {
  if (!authorised) {
    return emptyReading("finance", FINANCE_PERMISSION, "finance read permission not held", false);
  }

  const { data, error } = await supabase
    .from("commercial_transactions")
    .select("platform_revenue_cents,gross_transaction_value_cents,recognised_at,financially_eligible,economics_complete,updated_at")
    .order("updated_at", { ascending: false })
    .limit(1000);

  if (error) {
    return emptyReading("finance", FINANCE_PERMISSION, `transaction register unreadable: ${error.message}`);
  }

  const rows = (data ?? []) as TxRow[];
  if (rows.length === 0) {
    return emptyReading("finance", FINANCE_PERMISSION, "no transactions inside your scope");
  }

  const freshestAt = newestTimestamp(rows.map((r) => r.updated_at));
  const recognisedRows = rows.filter((r) => r.recognised_at);
  const platformRevenue = recognisedRows.reduce((s, r) => s + (Number(r.platform_revenue_cents ?? 0) || 0), 0) / 100;
  const gross = recognisedRows.reduce((s, r) => s + (Number(r.gross_transaction_value_cents ?? 0) || 0), 0) / 100;
  const incomplete = rows.filter((r) => r.economics_complete === false).length;
  const ineligible = rows.filter((r) => r.financially_eligible === false).length;

  const claims: Claim[] = [
    {
      id: "finance.platform_revenue",
      label: "Recognised platform revenue",
      value: kes(platformRevenue),
      numeric: platformRevenue,
      classification: "FACT",
      source: "commercial_transactions.platform_revenue_cents",
      observedAt: freshestAt,
      confidence: 95,
      evidence: [
        { label: `${recognisedRows.length} recognised transaction(s) in the latest window`, path: "/staff/closure" },
      ],
    },
    {
      id: "finance.gross",
      label: "Gross transaction value recognised",
      value: kes(gross),
      numeric: gross,
      classification: "FACT",
      source: "commercial_transactions.gross_transaction_value_cents",
      observedAt: freshestAt,
      confidence: 95,
      evidence: [{ label: "Sum over recognised transactions", path: "/staff/commerce-os" }],
    },
    {
      id: "finance.completeness",
      label: "Transactions with incomplete economics",
      value: `${incomplete}`,
      numeric: incomplete,
      classification: "FACT",
      source: "commercial_transactions.economics_complete",
      observedAt: freshestAt,
      confidence: 100,
      evidence: [
        { label: `${ineligible} transaction(s) currently not financially eligible`, path: "/staff/commerce-os/review" },
      ],
    },
  ];

  return {
    domain: "finance",
    permission: FINANCE_PERMISSION,
    authorised: true,
    claims,
    freshestAt,
    rowsInspected: rows.length,
  };
}
