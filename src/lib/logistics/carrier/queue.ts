/**
 * UNIFIED FLEET OWNER WORK QUEUE — authoritative reads only.
 *
 * The queue is a projection of the four places work actually waits:
 *   1. partner interest applications awaiting review / conversion
 *   2. compliance evidence awaiting verification
 *   3. nominated settlement destinations awaiting verification
 *   4. delivery evidence awaiting approval, and payables awaiting release
 *
 * Counts are never hardcoded: every number comes from the row set returned by
 * the database under the caller's own permissions.
 */
import { supabase } from "@/integrations/supabase/client";
import { listPartnerApplicationCases, type PartnerApplicationCase } from "@/lib/partners/conversion";
import { listPodSubmissions, listPayableLines, type CarrierPodSubmissionRow, type CarrierPayableLineRow } from "./pod";
import type { ComplianceItemRow, SettlementDestinationRow } from "./onboarding";

export interface CarrierNameRow {
  id: string;
  carrier_code: string;
  legal_entity_name: string;
  operating_status: string;
}

export interface FleetOwnerQueue {
  carriers: CarrierNameRow[];
  applications: PartnerApplicationCase[];
  evidence: ComplianceItemRow[];
  destinations: SettlementDestinationRow[];
  pods: CarrierPodSubmissionRow[];
  payables: CarrierPayableLineRow[];
}

export async function loadFleetOwnerQueue(): Promise<FleetOwnerQueue> {
  const [carriers, applications, evidence, destinations, pods, payables] = await Promise.all([
    supabase
      .from("carrier_profiles")
      .select("id,carrier_code,legal_entity_name,operating_status")
      .order("legal_entity_name"),
    listPartnerApplicationCases(),
    supabase
      .from("carrier_compliance_items" as never)
      .select("*")
      .in("state", ["PENDING_REVIEW", "LEGAL_REVIEW_REQUIRED"])
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("carrier_settlement_destinations" as never)
      .select("*")
      .in("verification_state", ["UNVERIFIED", "UNDER_REVIEW"])
      .order("created_at", { ascending: true })
      .limit(200),
    listPodSubmissions("SUBMITTED"),
    listPayableLines(),
  ]);

  if (carriers.error) throw new Error(carriers.error.message);
  if (evidence.error) throw new Error(evidence.error.message);
  if (destinations.error) throw new Error(destinations.error.message);

  return {
    carriers: (carriers.data ?? []) as unknown as CarrierNameRow[],
    applications: applications.filter((a) => a.carrier_id === null && a.status !== "REJECTED"),
    evidence: (evidence.data ?? []) as unknown as ComplianceItemRow[],
    destinations: (destinations.data ?? []) as unknown as SettlementDestinationRow[],
    pods,
    payables: payables.filter((p) => p.state === "ACCRUED"),
  };
}

export const carrierName = (carriers: CarrierNameRow[], id: string) =>
  carriers.find((c) => c.id === id)?.legal_entity_name ?? id.slice(0, 8);
