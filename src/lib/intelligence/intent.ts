/**
 * Intent resolution.
 *
 * Deterministic keyword resolution, deliberately transparent: the console shows
 * which domains a question was routed to, so a reader can tell when the
 * question was understood and when it was only approximated.
 */
import { INTELLIGENCE_DOMAINS, type IntelligenceDomain } from "./contract";

export interface ResolvedIntent {
  code: string;
  label: string;
  domains: IntelligenceDomain[];
  /** False when nothing matched and the default domains were used. */
  resolved: boolean;
}

interface IntentRule {
  code: string;
  label: string;
  domains: IntelligenceDomain[];
  keywords: string[];
}

const RULES: IntentRule[] = [
  {
    code: "revenue_position",
    label: "Revenue and collection position",
    domains: ["commercial", "finance"],
    keywords: ["revenue", "recognised", "recognized", "collected", "cash", "invoice", "invoiced", "billing", "money", "turnover"],
  },
  {
    code: "pipeline_health",
    label: "Pipeline and contracting health",
    domains: ["commercial", "decision_spine"],
    keywords: ["pipeline", "opportunity", "opportunities", "deal", "deals", "quote", "quotation", "contract", "contracted", "won", "prospect"],
  },
  {
    code: "operational_pressure",
    label: "Operational pressure and SLA risk",
    domains: ["operations", "decision_spine"],
    keywords: ["sla", "queue", "backlog", "alert", "alerts", "breach", "operations", "dispatch", "delay", "late", "work"],
  },
  {
    code: "people_performance",
    label: "Objectives and people performance",
    domains: ["workforce", "commercial"],
    keywords: ["performance", "objective", "objectives", "kpi", "target", "attainment", "staff", "employee", "team", "candice", "specialist"],
  },
  {
    code: "next_best_action",
    label: "What to do next",
    domains: ["decision_spine", "operations", "commercial"],
    keywords: ["what should", "next", "priority", "prioritise", "prioritize", "focus", "recommend", "advise", "action"],
  },
  {
    code: "security_posture",
    label: "Security posture and verified controls",
    domains: ["security", "decision_spine"],
    keywords: ["secure", "security", "vulnerability", "vulnerabilities", "breach", "penetration", "pentest", "exposed", "exposure", "rls", "privilege", "posture", "hardening"],
  },
  {
    code: "enterprise_state",
    label: "Enterprise state of play",
    domains: [...INTELLIGENCE_DOMAINS],
    keywords: ["overall", "everything", "state of", "how are we", "business", "enterprise", "summary", "brief"],
  },
];

const DEFAULT_DOMAINS: IntelligenceDomain[] = ["commercial", "operations", "decision_spine"];

export function resolveIntent(question: string): ResolvedIntent {
  const q = question.toLowerCase();
  const hits = RULES.map((rule) => ({
    rule,
    score: rule.keywords.reduce((s, k) => (q.includes(k) ? s + 1 : s), 0),
  })).filter((h) => h.score > 0);

  if (hits.length === 0) {
    return {
      code: "unresolved",
      label: "Closest matching domains",
      domains: DEFAULT_DOMAINS,
      resolved: false,
    };
  }

  hits.sort((a, b) => b.score - a.score);
  const primary = hits[0].rule;
  const domains = new Set<IntelligenceDomain>(primary.domains);
  // A question touching two subjects legitimately spans both.
  if (hits.length > 1 && hits[1].score === hits[0].score) {
    for (const d of hits[1].rule.domains) domains.add(d);
  }

  return { code: primary.code, label: primary.label, domains: [...domains], resolved: true };
}
