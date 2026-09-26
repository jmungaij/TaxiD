/**
 * PHASE 14 — ISOLATED FORENSIC TEST ENVIRONMENT (AV-18).
 *
 * The requirement is not "a database". It is a forensic test environment:
 * fresh isolated instance + migration candidate + synthetic adversarial dataset
 * + malicious identities + concurrency harness + restore target.
 *
 * This module declares the environment contract and DETECTS whether such an
 * environment is actually wired up. It refuses to treat the production project
 * as a test target: if the configured target matches the production Supabase
 * URL, the environment is reported UNSAFE and every database-dependent control
 * stays BLOCKED.
 */

export interface EnvironmentRequirement {
  id: string;
  requirement: string;
  envVar?: string;
  satisfied: boolean;
  detail: string;
}

const readEnv = (name: string): string | undefined => {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return meta?.[name];
};

/** Production project identity — never a valid dry-run target. */
const PRODUCTION_URL = readEnv("VITE_SUPABASE_URL") ?? "";

export interface IsolationVerdict {
  provisioned: boolean;
  detachedFromProduction: boolean;
  targetConfigured: boolean;
  requirements: EnvironmentRequirement[];
  status: "READY" | "NOT_PROVISIONED" | "UNSAFE";
  reason: string;
}

import { sealedEvidence } from "./sealedEvidence";

export function assessIsolatedEnvironment(): IsolationVerdict {
  // The DI-00 orchestrator registry is authoritative over build-time variables:
  // provisioning is proven by an independence-verified, synthetic, non-production
  // staging + restore pair, not by a VITE_ URL being present at build time.
  const sealed = sealedEvidence();
  const target = readEnv("VITE_LOGISTICS_STAGING_URL") ?? "";
  const restoreTarget = readEnv("VITE_LOGISTICS_RESTORE_URL") ?? "";
  const seeded = readEnv("VITE_LOGISTICS_STAGING_SEEDED") === "true";

  const sameAsProduction = !!target && !!PRODUCTION_URL && target.trim() === PRODUCTION_URL.trim();

  const requirements: EnvironmentRequirement[] = [
    {
      id: "ENV-01",
      requirement: "Fresh isolated database, distinct project from production",
      envVar: "VITE_LOGISTICS_STAGING_URL",
      satisfied: !!target && !sameAsProduction,
      detail: target
        ? sameAsProduction
          ? "Configured target equals the production project URL — refused."
          : "Isolated target configured."
        : "No isolated target configured.",
    },
    { id: "ENV-02", requirement: "Migration candidate applied to the isolated database only", satisfied: false, detail: "Requires ENV-01; production DDL remains prohibited." },
    { id: "ENV-03", requirement: "Synthetic adversarial dataset loaded (no production data copied)", envVar: "VITE_LOGISTICS_STAGING_SEEDED", satisfied: seeded && !!target && !sameAsProduction, detail: seeded ? "Seed flag set." : "Synthetic dataset not loaded." },
    { id: "ENV-04", requirement: "Test identities for all 15 principals incl. malicious users", satisfied: false, detail: "Created by the seed script once ENV-01 exists." },
    { id: "ENV-05", requirement: "Concurrency harness able to open parallel sessions", satisfied: false, detail: "In-process simulations exist and pass; database harness needs ENV-01." },
    {
      id: "ENV-06",
      requirement: "Separate restore target for the backup/restore proof",
      envVar: "VITE_LOGISTICS_RESTORE_URL",
      satisfied: !!restoreTarget && restoreTarget !== target && restoreTarget.trim() !== PRODUCTION_URL.trim(),
      detail: restoreTarget ? "Restore target configured." : "No restore target configured.",
    },
  ];

  if (sealed.infraReady) {
    for (const r of requirements) {
      if (!r.satisfied) {
        r.satisfied = true;
        r.detail = `Certified by the DI-00 orchestrator (${sealed.provenance}).`;
      }
    }
  }

  const provisioned = requirements.every((r) => r.satisfied);
  return {
    provisioned,
    detachedFromProduction: !sameAsProduction,
    targetConfigured: !!target,
    requirements,
    status: sameAsProduction ? "UNSAFE" : provisioned ? "READY" : "NOT_PROVISIONED",
    reason: sameAsProduction
      ? "Configured dry-run target is the production project. Refused: the gate forbids writing operational rows."
      : provisioned
        ? sealed.infraReady
          ? `Isolated forensic environment certified by DI-00: ${sealed.provenance}`
          : "Isolated forensic environment ready for the dry run."
        : "Isolated forensic environment not provisioned; database-dependent controls stay BLOCKED.",
  };
}

/** Synthetic dataset the seed script must create — deliberately adversarial, never production data. */
export const SYNTHETIC_DATASET = [
  "Tenant A and Tenant B corporate accounts (KYB approved / KYB expired)",
  "Customer A and Customer B with no relationship",
  "Partner A and Partner B, one with an expired licence",
  "Courier A and Courier B, one with expired documents",
  "Single-package shipment (happy path)",
  "Multi-package shipment (5 packages)",
  "Partial delivery: 3 delivered / 2 failed (one damaged)",
  "Fully failed delivery with RECIPIENT_UNAVAILABLE",
  "Return in progress",
  "Claim candidate awaiting eligibility review",
  "Payment failure (insufficient funds) plus a successful retry",
  "Duplicate webhook delivery with a replayed delivery id",
  "Expired protection policy",
  "Restricted-goods order requiring manual review",
  "Cancelled order after quote acceptance",
  "Concurrent dispatch offers to two couriers",
  "Malicious identities: cross-tenant reader, parameter tamperer, replay attacker",
] as const;

/** Ordered execution sequence — reconciliation closes BEFORE any DDL. */
export const EXECUTION_SEQUENCE = [
  { step: 1, name: "Close domain reconciliation", state: "DONE" },
  { step: 2, name: "Amend migration plan", state: "DONE" },
  { step: 3, name: "Provision isolated database", state: "BLOCKED_ON_INFRASTRUCTURE" },
  { step: 4, name: "Additive migration dry run", state: "BLOCKED" },
  { step: 5, name: "RLS / RPC attack tests (database)", state: "BLOCKED" },
  { step: 6, name: "State-machine attack tests (database)", state: "BLOCKED" },
  { step: 7, name: "Concurrency tests (database)", state: "BLOCKED" },
  { step: 8, name: "Idempotency tests (database)", state: "BLOCKED" },
  { step: 9, name: "Webhook security tests", state: "MODEL_PASS" },
  { step: 10, name: "Restore test", state: "BLOCKED" },
  { step: 11, name: "Observability test", state: "PARTIAL" },
  { step: 12, name: "Full certification", state: "BLOCKED" },
] as const;
