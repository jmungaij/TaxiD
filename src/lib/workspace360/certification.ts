/**
 * Phase D7.2 — Workspace 360 Certification.
 *
 * Pure-function certification of the Workspace 360 registry against the
 * canonical enterprise standard. Consumed by:
 *   • unit tests (src/lib/workspace360/__tests__/certification.test.ts)
 *   • CI gate    (scripts/schema-contract-gate.ts)
 *   • Readiness  (src/components/dashboard/ReadinessV2Card.tsx)
 *
 * The certifier makes NO network calls and introduces NO new persistence.
 * It re-reads structures the platform already owns: the schema contract,
 * the canonical tab / domain registry, and the route registry.
 */
import { WORKSPACE360_TABS, WORKSPACE360_DEFAULT_TAB } from "./tabs";
import { WORKSPACE360_DOMAINS, workspace360BasePath, type Workspace360Domain } from "./domains";
import { workspace360Path } from "./links";

export interface Workspace360Contract {
  domains: string[];
  adopted_domains: string[];
  tabs: string[];
  shared_modules: string[];
  domain_routes: Record<string, { directory: string; workspace: string }>;
}

export interface RouteLike { path: string }

export interface Workspace360DomainCert {
  domain: string;
  adopted: boolean;
  passed: boolean;
  failures: string[];
}

export interface Workspace360Certification {
  passed: boolean;
  score: number;                 // 0-100 across adopted domains
  totalDomains: number;
  adoptedDomains: number;
  passingDomains: number;
  globalFailures: string[];      // registry-level failures, not domain-scoped
  domains: Workspace360DomainCert[];
}

/** Registry-level invariants: run once, not per-domain. */
function certifyRegistry(contract: Workspace360Contract): string[] {
  const failures: string[] = [];

  // Tab registry must exactly match the canonical list, no duplicates.
  const canonical = [...WORKSPACE360_TABS];
  const contractTabs = contract.tabs ?? [];
  if (new Set(contractTabs).size !== contractTabs.length) {
    failures.push("workspace360.tabs contains duplicates");
  }
  if (contractTabs.length !== canonical.length ||
      contractTabs.some((t, i) => t !== canonical[i])) {
    failures.push(
      `workspace360.tabs drifted from canonical registry (expected ${canonical.join(",")})`,
    );
  }

  // Domains registry must exactly match code — no duplicates, no drift.
  const canonicalDomains = [...WORKSPACE360_DOMAINS];
  const contractDomains = contract.domains ?? [];
  if (new Set(contractDomains).size !== contractDomains.length) {
    failures.push("workspace360.domains contains duplicates");
  }
  if (contractDomains.length !== canonicalDomains.length ||
      contractDomains.some((d, i) => d !== canonicalDomains[i])) {
    failures.push(
      `workspace360.domains drifted from canonical registry (expected ${canonicalDomains.join(",")})`,
    );
  }

  // adopted ⊆ domains, no duplicates
  const adopted = contract.adopted_domains ?? [];
  if (new Set(adopted).size !== adopted.length) {
    failures.push("workspace360.adopted_domains contains duplicates");
  }
  for (const d of adopted) {
    if (!contractDomains.includes(d)) {
      failures.push(`adopted domain '${d}' is not in workspace360.domains`);
    }
  }

  return failures;
}

/**
 * Certify one adopted domain. Non-adopted domains are reported but do not
 * contribute to the failure score — they simply haven't been rolled out yet.
 */
function certifyDomain(
  domain: string,
  contract: Workspace360Contract,
  routes: ReadonlyArray<RouteLike>,
): Workspace360DomainCert {
  const adopted = (contract.adopted_domains ?? []).includes(domain);
  const failures: string[] = [];

  if (!adopted) {
    return { domain, adopted: false, passed: true, failures };
  }

  // Adopted domains must have route metadata registered.
  const routeCfg = contract.domain_routes?.[domain];
  if (!routeCfg) {
    failures.push(`missing domain_routes entry for adopted domain '${domain}'`);
    return { domain, adopted: true, passed: false, failures };
  }

  // Deep-link builder must agree with the declared directory path.
  const expectedBase = workspace360BasePath(domain as Workspace360Domain);
  if (routeCfg.directory !== expectedBase) {
    failures.push(
      `domain_routes.${domain}.directory (${routeCfg.directory}) != workspace360BasePath (${expectedBase})`,
    );
  }

  // Workspace route must be the directory + a single :param segment.
  if (!routeCfg.workspace.startsWith(routeCfg.directory + "/:")) {
    failures.push(
      `domain_routes.${domain}.workspace (${routeCfg.workspace}) must be '${routeCfg.directory}/:<param>'`,
    );
  }

  // Both routes must exist in the app route registry.
  const paths = new Set(routes.map((r) => r.path));
  if (!paths.has(routeCfg.directory)) {
    failures.push(`route registry is missing directory path '${routeCfg.directory}'`);
  }
  if (!paths.has(routeCfg.workspace)) {
    failures.push(`route registry is missing workspace path '${routeCfg.workspace}'`);
  }

  // Deep-link + tab must resolve to the workspace base (no ?tab= for default).
  const linkOverview = workspace360Path(domain as Workspace360Domain, "abc");
  if (!linkOverview.startsWith(routeCfg.directory + "/")) {
    failures.push(`workspace360Path('${domain}') does not resolve under '${routeCfg.directory}'`);
  }
  if (linkOverview.includes("?tab=")) {
    failures.push(`workspace360Path default tab must not append ?tab= (got ${linkOverview})`);
  }
  const linkTimeline = workspace360Path(domain as Workspace360Domain, "abc", "timeline");
  if (!linkTimeline.endsWith("?tab=timeline")) {
    failures.push(`workspace360Path('${domain}','timeline') did not append ?tab=timeline`);
  }
  // Sanity: the default is still 'overview' — future edits mustn't break the fallback contract.
  if (WORKSPACE360_DEFAULT_TAB !== "overview") {
    failures.push("WORKSPACE360_DEFAULT_TAB drifted from 'overview' — update certifier");
  }

  return { domain, adopted: true, passed: failures.length === 0, failures };
}

export function certifyWorkspace360(
  contract: Workspace360Contract,
  routes: ReadonlyArray<RouteLike>,
): Workspace360Certification {
  const globalFailures = certifyRegistry(contract);

  const domains = (contract.domains ?? []).map((d) => certifyDomain(d, contract, routes));
  const adopted = domains.filter((d) => d.adopted);
  const passingAdopted = adopted.filter((d) => d.passed).length;

  // Score = fraction of adopted domains that fully pass, docked by any
  // registry-level drift. Non-adopted domains do not lower the score.
  const denominator = adopted.length || 1;
  const domainRatio = passingAdopted / denominator;
  const registryPenalty = globalFailures.length === 0 ? 1 : 0.5;
  const score = Math.round(domainRatio * registryPenalty * 100);

  return {
    passed: globalFailures.length === 0 && passingAdopted === adopted.length,
    score,
    totalDomains: domains.length,
    adoptedDomains: adopted.length,
    passingDomains: passingAdopted,
    globalFailures,
    domains,
  };
}
