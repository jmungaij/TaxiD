/**
 * FN FINANCIAL CERTIFICATION — client mirror of the orchestrator registry.
 *
 * The authoritative definition lives in
 * `supabase/functions/_shared/di00/fnRegistry.ts`; this mirror exists only so
 * the browser can render scope, dependency and provider information without a
 * round trip. A vitest gate proves the two files never drift.
 */
import type { StResult } from "@/lib/logistics/certification/stControls";

export type FnResult = StResult;
export type FnRequirement = "STAGING_VERIFIED" | "SCHEMA" | "FIXTURES" | "FIN_SCHEMA";

export interface FnControlDefinition {
  control_id: string;
  title: string;
  target: "STAGING" | "RESTORE" | "CONTROL_PLANE";
  depends_on: string[];
  requires: FnRequirement[];
  owner: "finance";
  scope: string;
  success_condition: string;
  evidence: string;
  provider_execution_required: boolean;
}

export const FN_CONTROLS: FnControlDefinition[] = [
  {
    control_id: "FN-03",
    title: "Invoice issuance and immutable lineage",
    target: "STAGING",
    depends_on: [],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIN_SCHEMA"],
    owner: "finance",
    scope: "shipment → charge → invoice → payment → ledger lineage and invoice immutability",
    success_condition:
      "Exactly one invoice exists per charge, its amount/lineage/rate-plan version cannot be updated or deleted, a later rate-plan version does not reprice it, and every financial row carries lineage to the originating shipment.",
    evidence: "Invoice number, charge/shipment references, refusal messages (SQLSTATE + text), amount before and after a V2 rate plan exists.",
    provider_execution_required: false,
  },
  {
    control_id: "FN-05",
    title: "Payment failure, duplicate, stale and conflicting callback handling",
    target: "STAGING",
    depends_on: ["FN-03"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIN_SCHEMA"],
    owner: "finance",
    scope: "callback idempotency and financial-effect uniqueness in the authoritative ledger",
    success_condition:
      "A failed callback marks the payment actionable; a repeated, stale or conflicting callback is retained in the callback ledger and produces no second financial effect; a controlled retry produces exactly one authoritative payment.",
    evidence: "Callback ledger decisions per delivery, confirmed-payment count, ledger entry count per payment.",
    provider_execution_required: false,
  },
  {
    control_id: "FN-06",
    title: "Reconciliation control with owned exception queue",
    target: "STAGING",
    depends_on: ["FN-05"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIN_SCHEMA"],
    owner: "finance",
    scope: "three-way reconciliation over shipment → invoice → payment → payable → settlement",
    success_condition:
      "A clean transaction produces no exception, and each seeded anomaly class (missing payment, wrong amount, unmatched provider transaction, duplicate payment, payable mismatch) is detected with a severity, an owner, a source reference and a financial impact.",
    evidence: "Reconciliation run reference, anomaly census by code, exception rows with owner/severity/impact.",
    provider_execution_required: false,
  },
  {
    control_id: "FN-07",
    title: "Partner payable and Yalla revenue split",
    target: "STAGING",
    depends_on: ["FN-06"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIN_SCHEMA"],
    owner: "finance",
    scope: "versioned commission configuration → payable, revenue and tax components",
    success_condition:
      "The split is computed from the approved rate-plan version bound to the invoice (never a hard-coded percentage), partner share + Yalla share reconstruct the invoice net amount, a later plan version does not restate an existing payable, and a refund adjusts the payable.",
    evidence: "Rate-plan version, gross/net/tax, commission, partner share, Yalla share, payable after refund.",
    provider_execution_required: false,
  },
  {
    control_id: "FN-08",
    title: "Settlement batch approval and audit",
    target: "STAGING",
    depends_on: ["FN-07"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIN_SCHEMA"],
    owner: "finance",
    scope: "reconciled payables → batch → approval → execution → audit",
    success_condition:
      "The batch creator cannot approve their own batch, a payable cannot appear in two batches, an approved batch cannot be altered or deleted, and approval writes an audited ledger effect with an execution reference.",
    evidence: "Batch number, included payables, total, creator and approver identities, refusal messages, ledger entry.",
    provider_execution_required: false,
  },
  {
    control_id: "FN-04",
    title: "Refund path with audit trail",
    target: "STAGING",
    depends_on: ["FN-03"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIN_SCHEMA"],
    owner: "finance",
    scope: "refund request → approval → compensating ledger entry → reconciliation, plus the provider disbursement leg",
    success_condition:
      "A refund cannot exceed the refundable amount, cannot be self-approved, cannot be executed twice, never mutates or deletes the original payment, and posts a compensating ledger entry — AND the provider disbursement is executed against a non-production provider environment.",
    evidence: "Refund id, approval identity, refusal messages, compensating ledger entry, provider disbursement reference.",
    provider_execution_required: true,
  },
  {
    control_id: "FN-01",
    title: "M-Pesa collection end-to-end with callback ledger",
    target: "STAGING",
    depends_on: ["FN-03"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIN_SCHEMA"],
    owner: "finance",
    scope: "real Daraja STK push, real provider callback, callback authentication and ledger application",
    success_condition:
      "A real STK push is issued against a NON-PRODUCTION Daraja application, the provider posts a real callback to a non-production sink, the callback is authenticated, its provider transaction reference is persisted, and the isolated ledger records exactly one payment effect.",
    evidence: "Checkout request id, provider transaction reference, callback payload digest, payment state transition, callback ledger record, environment fingerprint.",
    provider_execution_required: true,
  },
  {
    control_id: "FN-02",
    title: "Card / corporate account collection",
    target: "STAGING",
    depends_on: ["FN-03"],
    requires: ["STAGING_VERIFIED", "SCHEMA", "FIN_SCHEMA"],
    owner: "finance",
    scope: "invoice-on-account corporate collection (internal) and card collection (external PSP)",
    success_condition:
      "Corporate invoice-on-account collection is verified in the isolated ledger AND a card collection is authorised by a real non-production card PSP.",
    evidence: "On-account payment and ledger entry, PSP authorisation reference.",
    provider_execution_required: true,
  },
];

export const FN_CONTROL_IDS = FN_CONTROLS.map((c) => c.control_id);

/** Dependency-ordered execution waves (mirrors the orchestrator). */
export function fnExecutionWaves(): string[][] {
  const done = new Set<string>();
  const waves: string[][] = [];
  let remaining = [...FN_CONTROLS];
  while (remaining.length > 0) {
    const wave = remaining.filter((c) => c.depends_on.every((d) => done.has(d)));
    if (wave.length === 0) break;
    for (const c of wave) done.add(c.control_id);
    waves.push(wave.map((c) => c.control_id));
    remaining = remaining.filter((c) => !done.has(c.control_id));
  }
  return waves;
}

export const FN_RESULT_TONE: Record<string, "ok" | "warn" | "danger" | "info"> = {
  PASS: "ok",
  FAIL: "danger",
  PRODUCTION_TARGET_REFUSED: "danger",
  PROVIDER_CONFIGURATION_REQUIRED: "warn",
  EXTERNAL_EXECUTION_REQUIRED: "warn",
  DEPENDENCY_NOT_READY: "warn",
  OWNER_ACTION_REQUIRED: "warn",
  EVIDENCE_EXPIRED: "warn",
  BLOCKED: "danger",
  NOT_TESTED: "info",
  LEGAL_APPROVAL_REQUIRED: "warn",
};
