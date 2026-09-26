/**
 * DESTINATIONS MANAGEMENT, MOBILITY SUPPLY & FLEET DEVELOPMENT — client contract.
 *
 * Every number rendered by the supply cockpit is read from an authoritative
 * record or computed by the database (`intern_supply_score`). Nothing here
 * derives a score, an activation or a revenue figure in the browser:
 *  - Interns can capture supply records but never verify, activate, approve or
 *    declare revenue (enforced by the `intern_supply_guard` trigger).
 *  - Verified revenue exists only where an authoritative financial record is
 *    attached, so demonstration cohorts always report KES 0.
 *  - Integrity findings are raised as INTEGRITY REVIEW REQUIRED and always
 *    require human review — never an automatic misconduct determination.
 */
import { untypedDb } from "@/integrations/supabase/untyped";

const anyClient = untypedDb;

const unwrap = <T>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
};

/* --------------------------------- types --------------------------------- */

export interface SupplyMetrics {
  intern_id: string;
  full_name: string | null;
  cohort_id: string | null;
  cohort_name: string | null;
  track_code: string | null;
  track_name: string | null
  talent_level: string | null;
  driver_prospects: number;
  qualified_drivers: number;
  drivers_onboarding: number;
  drivers_activated: number;
  prospects_accepted: number;
  prospects_rejected: number;
  fleet_leads: number;
  fleet_suppliers_qualified: number;
  fleet_suppliers_verified: number;
  verified_fleet_capacity: number;
  vehicles_mapped: number;
  destinations_researched: number;
  destination_profiles: number;
  opportunities: number;
  opportunities_qualified: number;
  verified_revenue_kes: number;
  field_assignments: number;
  field_assignments_verified: number;
  data_quality_score: number | null;
  is_demo: boolean | null;
}

export interface SupplyScoreComponent {
  dimension: string;
  weight: number;
  achievement: number;
}

export interface SupplyScore {
  intern_id: string;
  supply_score: number;
  productivity_score: number;
  quality_score: number;
  acceptance_rate: number | null;
  verified_revenue_kes: number;
  components: SupplyScoreComponent[];
  weights: Record<string, number>;
  is_demo: boolean | null;
}

export interface DriverProspect {
  id: string;
  intern_id: string;
  full_name: string;
  phone: string;
  location: string | null;
  operating_area: string | null;
  vehicle_category: string | null;
  service_category: string | null;
  stage: string;
  documents_status: string;
  review_status: string;
  data_quality_score: number | null;
  is_demo: boolean;
  created_at: string;
}

export interface FleetSupplier {
  id: string;
  intern_id: string;
  supplier_name: string;
  owner_name: string | null;
  fleet_type: string | null;
  location: string | null;
  service_category: string | null;
  vehicle_count: number;
  documentation_status: string;
  insurance_status: string;
  inspection_status: string;
  supplier_status: string;
  activation_status: string;
  is_demo: boolean;
}

export interface DestinationProfile {
  id: string;
  intern_id: string;
  destination_name: string;
  destination_type: string;
  location: string | null;
  customer_segments: string[];
  demand_status: string;
  vehicle_categories: string[];
  yalla_products: string[];
  completeness: number;
  status: string;
  is_demo: boolean;
}

export interface SupplyOpportunity {
  id: string;
  intern_id: string;
  title: string;
  product_line: string;
  customer_segment: string | null;
  stage: string;
  estimated_value_kes: number | null;
  verified_revenue_kes: number;
  review_status: string;
  is_demo: boolean;
}

export interface FieldAssignment {
  id: string;
  intern_id: string;
  assignment: string;
  location: string;
  scheduled_for: string;
  contacts_made: number;
  records_created: number;
  supervisor_verified: boolean;
  is_demo: boolean;
}

export interface SupplyCohort {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  intake_size: number | null;
  duration_weeks: number | null;
  target_outcomes: string | null;
}

/** Published state machines, mirrored from the database CHECK constraints. */
export const DRIVER_PIPELINE = [
  "LEAD", "CONTACTED", "INTERESTED", "QUALIFIED", "DOCUMENTS_REQUESTED",
  "DOCUMENTS_SUBMITTED", "VERIFIED", "ONBOARDING", "APPROVED", "ACTIVATED", "PRODUCTIVE",
] as const;

export const FLEET_PIPELINE = [
  "LEAD", "CONTACTED", "QUALIFIED", "DOCUMENTS_SUBMITTED", "VERIFIED", "ONBOARDING", "ACTIVATED",
] as const;

export const COMMERCIAL_PIPELINE = [
  "LEAD", "QUALIFIED", "OPPORTUNITY", "CUSTOMER", "BOOKING", "COMPLETED_SERVICE", "VERIFIED_REVENUE",
] as const;

export const DMFD_COHORT_NAME = "YMEITA-DMFD-2026-A";

export const stageLabel = (s: string) =>
  s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/* ------------------------------- data reads ------------------------------ */

export async function fetchSupplyCohorts(): Promise<SupplyCohort[]> {
  return unwrap(
    await anyClient
      .from("intern_cohorts")
      .select("id, name, status, start_date, end_date, intake_size, duration_weeks, target_outcomes")
      .order("start_date", { ascending: false }),
  );
}

export async function fetchSupplyMetrics(cohortId: string): Promise<SupplyMetrics[]> {
  return unwrap(
    await anyClient
      .from("v_intern_supply_metrics")
      .select("*")
      .eq("cohort_id", cohortId)
      .order("full_name"),
  );
}

export async function fetchSupplyScore(internId: string): Promise<SupplyScore> {
  const { data, error } = await anyClient.rpc("intern_supply_score", { p_intern: internId });
  if (error) throw new Error(error.message);
  return data as SupplyScore;
}

export async function fetchDriverProspects(cohortId: string, limit = 400): Promise<DriverProspect[]> {
  return unwrap(
    await anyClient
      .from("intern_supply_driver_prospects")
      .select("id, intern_id, full_name, phone, location, operating_area, vehicle_category, service_category, stage, documents_status, review_status, data_quality_score, is_demo, created_at")
      .eq("cohort_id", cohortId)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
}

export async function fetchFleetSuppliers(cohortId: string): Promise<FleetSupplier[]> {
  return unwrap(
    await anyClient
      .from("intern_supply_fleet_suppliers")
      .select("id, intern_id, supplier_name, owner_name, fleet_type, location, service_category, vehicle_count, documentation_status, insurance_status, inspection_status, supplier_status, activation_status, is_demo")
      .eq("cohort_id", cohortId)
      .order("supplier_name"),
  );
}

export async function fetchDestinationProfiles(cohortId: string): Promise<DestinationProfile[]> {
  return unwrap(
    await anyClient
      .from("intern_supply_destinations")
      .select("id, intern_id, destination_name, destination_type, location, customer_segments, demand_status, vehicle_categories, yalla_products, completeness, status, is_demo")
      .eq("cohort_id", cohortId)
      .order("destination_name"),
  );
}

export async function fetchSupplyOpportunities(cohortId: string): Promise<SupplyOpportunity[]> {
  return unwrap(
    await anyClient
      .from("intern_supply_opportunities")
      .select("id, intern_id, title, product_line, customer_segment, stage, estimated_value_kes, verified_revenue_kes, review_status, is_demo")
      .eq("cohort_id", cohortId)
      .order("created_at", { ascending: false }),
  );
}

export async function fetchFieldAssignments(cohortId: string): Promise<FieldAssignment[]> {
  return unwrap(
    await anyClient
      .from("intern_supply_field_assignments")
      .select("id, intern_id, assignment, location, scheduled_for, contacts_made, records_created, supervisor_verified, is_demo")
      .eq("cohort_id", cohortId)
      .order("scheduled_for", { ascending: false }),
  );
}

/** Programme-authority only; raises INTEGRITY REVIEW REQUIRED flags. */
export async function scanSupplyIntegrity(cohortId: string): Promise<{ flags_raised: number; note: string }> {
  const { data, error } = await anyClient.rpc("intern_supply_scan_integrity", { p_cohort: cohortId });
  if (error) throw new Error(error.message);
  return data as { flags_raised: number; note: string };
}

/* ------------------------------- aggregation ------------------------------ */

export interface CohortKpis {
  activeInterns: number;
  driverProspects: number;
  qualifiedDrivers: number;
  driversOnboarding: number;
  driversActivated: number;
  fleetSuppliers: number;
  verifiedFleetCapacity: number;
  vehiclesMapped: number;
  destinationProfiles: number;
  opportunities: number;
  verifiedRevenueKes: number;
  dataQuality: number | null;
  demoOnly: boolean;
}

export function cohortKpis(rows: SupplyMetrics[]): CohortKpis {
  const sum = (k: keyof SupplyMetrics) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const quality = rows.map((r) => Number(r.data_quality_score)).filter((n) => Number.isFinite(n) && n > 0);
  return {
    activeInterns: rows.length,
    driverProspects: sum("driver_prospects"),
    qualifiedDrivers: sum("qualified_drivers"),
    driversOnboarding: sum("drivers_onboarding"),
    driversActivated: sum("drivers_activated"),
    fleetSuppliers: sum("fleet_suppliers_qualified"),
    verifiedFleetCapacity: sum("verified_fleet_capacity"),
    vehiclesMapped: sum("vehicles_mapped"),
    destinationProfiles: sum("destination_profiles"),
    opportunities: sum("opportunities"),
    verifiedRevenueKes: sum("verified_revenue_kes"),
    dataQuality: quality.length ? Math.round((quality.reduce((a, b) => a + b, 0) / quality.length) * 10) / 10 : null,
    demoOnly: rows.length > 0 && rows.every((r) => r.is_demo === true),
  };
}

/** Counts records per pipeline stage, preserving the published stage order. */
export function pipelineCounts<T extends { stage: string }>(rows: T[], stages: readonly string[]) {
  return stages.map((stage) => ({ stage, label: stageLabel(stage), count: rows.filter((r) => r.stage === stage).length }));
}

/**
 * Evidence-based cohort ranking. Ranking never uses raw record volume: it
 * blends the server Supply Development Score, server productivity score,
 * quality and acceptance. Interns with no accepted work cannot rank highly.
 */
export interface RankedIntern {
  intern_id: string;
  full_name: string | null;
  track_name: string | null;
  supply_score: number;
  productivity_score: number;
  quality_score: number;
  acceptance_rate: number | null;
  composite: number;
  potential: "DEVELOPING" | "PRODUCER" | "HIGH POTENTIAL";
}

export function rankInterns(scores: Array<SupplyScore & { full_name: string | null; track_name: string | null }>): RankedIntern[] {
  return scores
    .map((s) => {
      const acceptance = s.acceptance_rate ?? 0;
      const composite =
        Math.round((s.supply_score * 0.45 + s.productivity_score * 0.25 + s.quality_score * 0.2 + acceptance * 0.1) * 10) / 10;
      const potential: RankedIntern["potential"] =
        composite >= 75 && s.quality_score >= 90 ? "HIGH POTENTIAL" : composite >= 50 ? "PRODUCER" : "DEVELOPING";
      return {
        intern_id: s.intern_id,
        full_name: s.full_name,
        track_name: s.track_name,
        supply_score: s.supply_score,
        productivity_score: s.productivity_score,
        quality_score: s.quality_score,
        acceptance_rate: s.acceptance_rate,
        composite,
        potential,
      };
    })
    .sort((a, b) => b.composite - a.composite);
}
