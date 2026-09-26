/**
 * FLEET OWNER PORTAL — read aggregation only.
 *
 * Every figure shown in the Fleet Owner portal is read from the authoritative
 * records that the platform itself acts on: carrier_profiles, the carrier
 * compliance register, carrier_matchability, the carrier payable ledger,
 * partner_wallets and carrier_withdrawal_requests. Nothing is derived, cached
 * or invented here, and no verdict is computed client-side.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  listComplianceItems, listDeclarations, listSettlementDestinations,
  listWithdrawalRequests, carrierMatchability,
  type ComplianceItemRow, type CarrierDeclarationRow, type SettlementDestinationRow,
  type WithdrawalRequestRow, type EligibilityVerdict,
} from "./onboarding";
import { listPayableLines, type CarrierPayableLineRow } from "./pod";

export interface FleetOwnerCarrier {
  id: string;
  partner_id: string | null;
  carrier_code: string;
  legal_entity_name: string;
  operating_status: string;
  contract_status: string;
}

export interface FleetOwnerMovement {
  id: string;
  order_id: string;
  leg_no: number;
  leg_type: string;
  status: string;
  origin_label: string;
  destination_label: string;
  planned_departure: string | null;
  actual_arrival: string | null;
  vehicle_id: string | null;
}

export interface FleetOwnerWallet {
  currency: string;
  balance: number;
  reserved: number;
}

export interface FleetOwnerPortalView {
  carrier: FleetOwnerCarrier;
  matchability: EligibilityVerdict;
  items: ComplianceItemRow[];
  declarations: CarrierDeclarationRow[];
  destinations: SettlementDestinationRow[];
  movements: FleetOwnerMovement[];
  payables: CarrierPayableLineRow[];
  withdrawals: WithdrawalRequestRow[];
  /** null when no partner wallet exists — never presented as KES 0.00. */
  wallet: FleetOwnerWallet | null;
}

/** Fleet Owner accounts the signed-in operator may read (RLS decides). */
export async function listMyFleetOwners(): Promise<FleetOwnerCarrier[]> {
  const { data, error } = await supabase
    .from("carrier_profiles")
    .select("id,partner_id,carrier_code,legal_entity_name,operating_status,contract_status")
    .order("legal_entity_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FleetOwnerCarrier[];
}

/**
 * Movements attributed to this Fleet Owner's registered vehicles. Presentation
 * scoping only — the database policies still decide what is readable.
 */
export async function listCarrierMovements(carrierId: string): Promise<FleetOwnerMovement[]> {
  const fleet = await supabase
    .from("logistics_fleet_capacity")
    .select("vehicle_id")
    .eq("carrier_id", carrierId);
  if (fleet.error) throw new Error(fleet.error.message);
  const vehicleIds = (fleet.data ?? []).map((r) => (r as { vehicle_id: string }).vehicle_id);
  if (vehicleIds.length === 0) return [];

  const { data, error } = await supabase
    .from("logistics_order_legs")
    .select("id,order_id,leg_no,leg_type,status,origin_label,destination_label,planned_departure,actual_arrival,vehicle_id")
    .in("vehicle_id", vehicleIds)
    .order("planned_departure", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FleetOwnerMovement[];
}

async function readWallet(partnerId: string | null): Promise<FleetOwnerWallet | null> {
  if (!partnerId) return null;
  const { data, error } = await supabase
    .from("partner_wallets" as never)
    .select("currency,balance,reserved")
    .eq("partner_id", partnerId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as { currency: string; balance: number; reserved: number };
  return { currency: row.currency, balance: Number(row.balance), reserved: Number(row.reserved) };
}

export async function loadFleetOwnerPortal(carrier: FleetOwnerCarrier): Promise<FleetOwnerPortalView> {
  const [matchability, items, declarations, destinations, movements, payables, withdrawals, wallet] =
    await Promise.all([
      carrierMatchability(carrier.id),
      listComplianceItems(carrier.id),
      listDeclarations(carrier.id),
      listSettlementDestinations(carrier.id),
      listCarrierMovements(carrier.id),
      listPayableLines(),
      listWithdrawalRequests(carrier.id),
      readWallet(carrier.partner_id),
    ]);
  return {
    carrier,
    matchability,
    items,
    declarations,
    destinations,
    movements,
    payables: payables.filter((p) => p.carrier_id === carrier.id),
    withdrawals,
    wallet,
  };
}

export interface CompliancePosition {
  mandatory: number;
  verified: number;
  pending: number;
  missing: number;
  rejected: number;
}

export function compliancePosition(items: ComplianceItemRow[], level = "CARRIER"): CompliancePosition {
  const scoped = items.filter((i) => i.responsibility_level === level && i.is_mandatory);
  return {
    mandatory: scoped.length,
    verified: scoped.filter((i) => i.state === "VERIFIED").length,
    pending: scoped.filter((i) => i.state === "PENDING_REVIEW" || i.state === "LEGAL_REVIEW_REQUIRED").length,
    missing: scoped.filter((i) => i.state === "MISSING").length,
    rejected: scoped.filter((i) => i.state === "REJECTED" || i.state === "EXPIRED").length,
  };
}

/** A time-limited link to an uploaded evidence document (staff & owner review). */
export async function evidenceDocumentUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const clean = path.startsWith("partner-documents/") ? path.slice("partner-documents/".length) : path;
  const { data, error } = await supabase.storage.from("partner-documents").createSignedUrl(clean, 300);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Money that has accrued but is not yet posted to the wallet. */
export const pendingPayableTotal = (rows: CarrierPayableLineRow[]) =>
  rows.filter((r) => r.state === "ACCRUED").reduce((s, r) => s + Number(r.net_payable), 0);

export const releasedPayableTotal = (rows: CarrierPayableLineRow[]) =>
  rows.filter((r) => r.state === "RELEASED").reduce((s, r) => s + Number(r.net_payable), 0);
