/**
 * Phase D8.2 — Executive Consistency Certifier.
 *
 * Cross-checks that Executive Scorecard values equal the canonical
 * governance / consistency / operations scores. Prevents "displayed KPI ≠
 * source of truth" drift — the number one cause of executive dashboards
 * losing credibility. Pure function; no queries.
 */
export interface ExecutiveScorecardItem {
  label: string;
  score: number;
  passed: boolean;
  href: string;
  canonicalSource: string;   // must be a key in `canonicalScores`
}

export interface ExecutiveConsistencyReport {
  passed: boolean;
  score: number;
  drifts: Array<{ label: string; displayed: number; canonical: number; source: string }>;
  orphanScorecard: string[];       // scorecard items whose href doesn't match a known owner
  failures: string[];
}

export function certifyExecutiveConsistency(
  scorecard: ExecutiveScorecardItem[],
  canonicalScores: Record<string, number>,
  knownOwners: ReadonlyArray<string>,
): ExecutiveConsistencyReport {
  const drifts: ExecutiveConsistencyReport["drifts"] = [];
  const failures: string[] = [];
  for (const s of scorecard) {
    const canon = canonicalScores[s.canonicalSource];
    if (canon == null) {
      failures.push(`scorecard '${s.label}' references unknown source '${s.canonicalSource}'`);
      continue;
    }
    if (Math.round(canon) !== Math.round(s.score)) {
      drifts.push({ label: s.label, displayed: s.score, canonical: canon, source: s.canonicalSource });
      failures.push(`scorecard '${s.label}' displays ${s.score} but canonical ${s.canonicalSource}=${canon}`);
    }
  }
  const orphans = scorecard.filter((s) => !knownOwners.some((h) => s.href.startsWith(h))).map((s) => s.label);
  for (const o of orphans) failures.push(`scorecard '${o}' has no registered operational owner`);
  const total = scorecard.length || 1;
  const badCount = drifts.length + orphans.length;
  const score = Math.max(0, Math.round(((total - badCount) / total) * 100));
  return { passed: failures.length === 0, score, drifts, orphanScorecard: orphans, failures };
}
