/**
 * SEALED EVIDENCE SOURCE.
 *
 * The DF-10 / staging register engines were written before the DI-00
 * orchestrator existed, so they inferred environment readiness from build-time
 * VITE_ variables. Evidence does not live in build variables — it lives in the
 * sealed certification records. This module is the ONE channel through which the
 * loaded, sealed evidence is published to those pure engines, so a single
 * authoritative projection is rendered everywhere.
 *
 * It stores nothing that a caller can invent: only what the readiness hook read
 * from `st_control_executions`, `infra_environments` and the independence
 * assertions. There is no setter that marks a control PASS by hand.
 */
export interface SealedStResult {
  control_id: string;
  result: string;
  environment_key: string | null;
  environment_fingerprint: string | null;
  evidence_sha256: string | null;
  finished_at: string | null;
  valid: boolean;
}

export interface SealedEvidenceSnapshot {
  /** Latest valid sealed execution per ST control. */
  st: Record<string, SealedStResult>;
  /** True only when the DI-00 registry proves an independent, synthetic, verified pair. */
  infraReady: boolean;
  /** Human-readable provenance for the certificate narrative. */
  provenance: string;
  loadedAt: string | null;
}

const EMPTY: SealedEvidenceSnapshot = { st: {}, infraReady: false, provenance: "No sealed certification evidence loaded.", loadedAt: null };

let snapshot: SealedEvidenceSnapshot = EMPTY;

export function publishSealedEvidence(next: Omit<SealedEvidenceSnapshot, "loadedAt">): void {
  snapshot = { ...next, loadedAt: new Date().toISOString() };
}

export function sealedEvidence(): SealedEvidenceSnapshot {
  return snapshot;
}

export function resetSealedEvidence(): void {
  snapshot = EMPTY;
}
