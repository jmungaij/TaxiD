/**
 * Yalla Security Control Plane — Learning Engine.
 *
 * The step that linear remediation always skips: after a finding is fixed, look
 * for the same shape elsewhere. A fix that is not generalised leaves siblings
 * behind.
 *
 * Deterministic by design: a fingerprint plus a trait predicate over the asset
 * graph. No model decides what counts as analogous.
 */
import { SECURITY_ASSETS, type SecurityAsset } from "./assetGraph";
import type { FindingClass, SecurityFinding } from "./riskEngine";

export interface AnalogousCandidate {
  assetId: string;
  label: string;
  /** Why this asset shares the shape of the original finding. */
  sharedTraits: string[];
  /** What to check on it. */
  probe: string;
}

export interface LearningRecord {
  fingerprint: string;
  findingClass: FindingClass;
  /** The generalised statement the platform should hold from now on. */
  rule: string;
  candidates: AnalogousCandidate[];
}

/** The class-level rule each finding class teaches once it is fixed. */
const RULE_BY_CLASS: Record<FindingClass, string> = {
  excessive_privilege: "Every privileged function's live grant set must match the roles its policies allow — nothing wider.",
  missing_rls: "Every public-schema table enables RLS in the same migration that creates it, with explicit GRANTs.",
  permissive_policy: "No policy predicate is always true unless the data is public reference data by decision.",
  anon_write_surface: "Every anonymous write path carries an atomic per-scope and global reservation ceiling.",
  unauthenticated_endpoint: "Every edge function authorises before parsing a body or touching a privileged client.",
  public_reference_exposure: "Public reads are limited to data with no personal, commercial or monetary content.",
  definer_reliance: "Every SECURITY DEFINER helper denies anonymous callers and pins its search_path.",
  config_weakness: "Storage and function configuration is asserted by a gate, not by memory.",
  unverified_control: "A control is unverified until an executed probe proves it; it is never assumed to pass.",
};

type TraitPredicate = (asset: SecurityAsset, origin: SecurityAsset | undefined) => string[] | null;

const TRAITS_BY_CLASS: Record<FindingClass, TraitPredicate> = {
  excessive_privilege: (a) =>
    a.privileged && a.kind === "db_function" ? ["privileged database function"] : null,
  missing_rls: (a) => (a.kind === "db_table" ? ["public-schema table"] : null),
  permissive_policy: (a) =>
    a.kind === "db_table" && a.externallyAccessible ? ["table reachable by an anonymous caller"] : null,
  anon_write_surface: (a) =>
    a.externallyAccessible && (a.kind === "db_function" || a.kind === "storage_bucket")
      ? ["anonymous write surface"]
      : null,
  unauthenticated_endpoint: (a) => (a.kind === "edge_function" ? ["edge function"] : null),
  public_reference_exposure: (a) =>
    a.externallyAccessible && a.dataSensitivity <= 2 ? ["low-sensitivity public read"] : null,
  definer_reliance: (a) => (a.privileged ? ["runs with elevated rights"] : null),
  config_weakness: (a) =>
    a.kind === "storage_bucket" || a.kind === "config" ? ["configuration-governed asset"] : null,
  unverified_control: (a, origin) =>
    origin && a.domain === origin.domain ? [`same domain (${a.domain})`] : null,
};

const PROBE_BY_CLASS: Record<FindingClass, string> = {
  excessive_privilege: "Read the live EXECUTE grant set and compare it against the allowlist.",
  missing_rls: "Assert relrowsecurity and count the policies on the live table.",
  permissive_policy: "Read the live policy predicates and reject any always-true one.",
  anon_write_surface: "Attempt an anonymous write beyond the ceiling and require refusal.",
  unauthenticated_endpoint: "Call the function signed out and with a forged token; require 401 or 403.",
  public_reference_exposure: "Read the table signed out and confirm no personal or monetary column is returned.",
  definer_reliance: "Call the helper as an anonymous caller and require denial.",
  config_weakness: "Read the live configuration and compare it against the declared contract.",
  unverified_control: "Obtain the missing identity or evidence, then execute the control's probe.",
};

export function fingerprint(finding: Pick<SecurityFinding, "findingClass" | "assetId">): string {
  return `${finding.findingClass}::${finding.assetId}`;
}

/**
 * Given a remediated finding, return the analogous assets that must now be
 * inspected for the same shape, plus the generalised rule.
 */
export function learnFrom(finding: SecurityFinding): LearningRecord {
  const origin = SECURITY_ASSETS.find((a) => a.id === finding.assetId);
  const predicate = TRAITS_BY_CLASS[finding.findingClass];

  const candidates: AnalogousCandidate[] = SECURITY_ASSETS
    .filter((a) => a.id !== finding.assetId)
    .map((a) => {
      const traits = predicate(a, origin);
      if (!traits) return undefined;
      const shared = [...traits];
      if (origin) {
        if (a.domain === origin.domain) shared.push(`same domain (${a.domain})`);
        if (a.financialPath && origin.financialPath) shared.push("also on a monetary path");
        if (a.externallyAccessible && origin.externallyAccessible) shared.push("also externally reachable");
      }
      return {
        assetId: a.id,
        label: a.label,
        sharedTraits: [...new Set(shared)],
        probe: PROBE_BY_CLASS[finding.findingClass],
      };
    })
    .filter((c): c is AnalogousCandidate => Boolean(c))
    .sort((a, b) => b.sharedTraits.length - a.sharedTraits.length || a.assetId.localeCompare(b.assetId));

  return {
    fingerprint: fingerprint(finding),
    findingClass: finding.findingClass,
    rule: RULE_BY_CLASS[finding.findingClass],
    candidates,
  };
}

/**
 * Predictive read: assets that match a known failure shape but have no finding
 * against them yet. These are inspection targets, never claimed as breaches.
 */
export function predictLikelyExposures(
  fixedFindings: SecurityFinding[],
): Array<{ assetId: string; label: string; because: string; findingClass: FindingClass }> {
  const known = new Set(fixedFindings.map(fingerprint));
  const out: Array<{ assetId: string; label: string; because: string; findingClass: FindingClass }> = [];
  for (const finding of fixedFindings) {
    for (const candidate of learnFrom(finding).candidates) {
      const fp = `${finding.findingClass}::${candidate.assetId}`;
      if (known.has(fp) || out.some((o) => o.assetId === candidate.assetId && o.findingClass === finding.findingClass)) {
        continue;
      }
      if (candidate.sharedTraits.length < 2) continue;
      out.push({
        assetId: candidate.assetId,
        label: candidate.label,
        findingClass: finding.findingClass,
        because: `Shares ${candidate.sharedTraits.join(", ")} with a confirmed ${finding.findingClass} finding.`,
      });
    }
  }
  return out.sort((a, b) => a.assetId.localeCompare(b.assetId));
}
