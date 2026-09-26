/**
 * Seed / demo data isolation (Gate 0 — Production Safety).
 *
 * Seed records must never satisfy availability, verification, compliance or
 * dispatch eligibility. Demo datasets are permitted only in non-production
 * environments and only for illustrative surfaces, and every demo record must
 * carry its provenance so downstream logic can refuse it.
 */

export type DataProvenance = "PRODUCTION" | "SEED" | "DEMO" | "TEST";

export interface ProvenanceTagged {
  provenance?: DataProvenance;
}

/** True when the running environment may render demo/seed datasets at all. */
export function demoDataAllowed(): boolean {
  const mode = (import.meta.env?.MODE ?? "production") as string;
  const flag = (import.meta.env?.VITE_ALLOW_DEMO_LOGISTICS_DATA ?? "") as string;
  if (flag === "true") return true;
  return mode !== "production";
}

/** Returns the dataset when demo data is permitted, otherwise an empty set. */
export function guardDemoDataset<T>(rows: readonly T[]): T[] {
  return demoDataAllowed() ? rows.map((r) => ({ ...(r as object), provenance: "DEMO" } as T)) : [];
}

export function isProductionRecord(row: ProvenanceTagged | null | undefined): boolean {
  return !!row && (row.provenance ?? "PRODUCTION") === "PRODUCTION";
}

/**
 * Hard guard for operational decisions. Any seed/demo/test record is refused
 * regardless of environment — production logic must never depend on them.
 */
export function assertOperationalRecord(row: ProvenanceTagged, context: string): void {
  if (!isProductionRecord(row)) {
    throw new Error(`seed_data_cannot_drive_operations:${context}:${row.provenance}`);
  }
}

/** Operational flags that seed data may never satisfy. */
export const SEED_FORBIDDEN_FLAGS = [
  "is_available",
  "is_verified",
  "is_compliant",
  "can_dispatch",
] as const;
