/**
 * INTERNS 360 — cockpit view model.
 *
 * One presentation contract serves both environments. LIVE is projected from
 * authoritative reads (scoreboard, cohort health, integrity flags); DEMO is a
 * seeded, explicitly labelled cohort. A panel with no evidence renders as
 * unavailable rather than as an invented number.
 */
import type { CohortHealthRow, InternIntegrityFlag, InternScoreboardRow, TalentLevel } from "./types";
import { PERFORMANCE_DIMENSIONS } from "./types";
import type { InternsEnvironment } from "./environment";

export type WorkLane = "TODAY" | "REVIEW" | "BLOCKED" | "DONE";

export interface CockpitWork {
  id: string;
  ref: string;
  title: string;
  intern: string;
  internId: string | null;
  track: string;
  lane: WorkLane;
  status: string;
  priority: "low" | "medium" | "high" | "critical";
  due: string | null;
  objective: string;
  deliverable: string | null;
  reviewer: string | null;
  quality: number | null;
  evidence: string[];
}

export interface CockpitEvent {
  date: string;
  title: string;
  kind: "INDUCTION" | "REVIEW" | "CLINIC" | "CAPSTONE" | "DEADLINE";
  detail: string;
}

export interface CockpitDimension {
  key: string;
  label: string;
  value: number | null;
  weight: number;
}

export interface CockpitModel {
  environment: InternsEnvironment;
  /** True when figures are seeded rather than authoritative. */
  seeded: boolean;
  cohortLabel: string | null;
  periodLabel: string;
  /** Assigned / submitted / accepted per weekday. */
  activity: { label: string; assigned: number; submitted: number; accepted: number }[];
  utilisation: { label: string; value: number }[];
  work: CockpitWork[];
  calendar: CockpitEvent[];
  learning: { overall: number | null; domains: { label: string; value: number; validated: number; total: number }[] };
  performance: { index: number | null; scored: number; dimensions: CockpitDimension[]; evidenceConfidence: number | null };
  talent: { name: string; internId: string | null; level: TalentLevel; index: number | null; track: string; revenue: number }[];
  commercial: { verifiedRevenue: number; attributedDeals: number; pipelineKes: number; assists: number };
  cohorts: CohortHealthRow[];
  attention: { title: string; detail: string; severity: "low" | "medium" | "high"; to: string }[];
  totals: { register: number; active: number; acceptedWork: number; openFlags: number; talent: number };
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  learning_score: 20,
  productivity_score: 25,
  quality_score: 20,
  commercial_score: 15,
  operational_score: 10,
  conduct_score: 10,
};

const laneFor = (status: string): WorkLane => {
  if (status === "BLOCKED" || status === "REWORK") return "BLOCKED";
  if (status === "SUBMITTED" || status === "UNDER_REVIEW") return "REVIEW";
  if (status === "ACCEPTED" || status === "COMPLETED") return "DONE";
  return "TODAY";
};

const avg = (vals: number[]): number | null =>
  vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

/** Project the authoritative reads into the cockpit contract. */
export function buildLiveModel(input: {
  rows: InternScoreboardRow[];
  cohorts: CohortHealthRow[];
  flags: InternIntegrityFlag[];
  period: { start: string; end: string };
}): CockpitModel {
  const { rows, cohorts, flags, period } = input;
  const scored = rows.filter((r) => r.performance_index !== null);
  const active = rows.filter((r) => r.status === "ACTIVE");
  const openFlags = flags.filter((f) => f.status === "REVIEW_REQUIRED");

  const talent = rows
    .filter((r) => r.talent_level === "PRODUCER" || r.talent_level === "YALLA_TALENT")
    .slice(0, 8)
    .map((r) => ({
      name: r.full_name,
      internId: r.intern_id,
      level: r.talent_level,
      index: r.performance_index === null ? null : Number(r.performance_index),
      track: r.track_code ?? "No track",
      revenue: Number(r.verified_revenue_kes ?? 0),
    }));

  return {
    environment: "LIVE",
    seeded: false,
    cohortLabel: cohorts[0]?.cohort_name ?? null,
    periodLabel: `${period.start} → ${period.end}`,
    activity: [],
    utilisation: [],
    work: [],
    calendar: cohorts
      .filter((c) => c.start_date)
      .slice(0, 6)
      .map((c) => ({
        date: c.start_date as string,
        title: `${c.cohort_name} intake`,
        kind: "INDUCTION" as const,
        detail: `${c.enrolled} enrolled${c.intake_size ? ` of ${c.intake_size} planned` : ""}`,
      })),
    learning: {
      overall: avg(scored.map((r) => Number(r.learning_score ?? 0))),
      domains: [],
    },
    performance: {
      index: avg(scored.map((r) => Number(r.performance_index ?? 0))),
      scored: scored.length,
      dimensions: PERFORMANCE_DIMENSIONS.map((d) => ({
        key: d.key,
        label: d.label,
        value: avg(scored.map((r) => Number(r[d.key] ?? 0))),
        weight: DEFAULT_WEIGHTS[d.key] ?? 0,
      })),
      evidenceConfidence: avg(scored.map((r) => Number(r.evidence_confidence ?? 0))),
    },
    talent,
    commercial: {
      verifiedRevenue: rows.reduce((a, r) => a + Number(r.verified_revenue_kes ?? 0), 0),
      attributedDeals: rows.filter((r) => Number(r.verified_revenue_kes ?? 0) > 0).length,
      pipelineKes: 0,
      assists: 0,
    },
    cohorts,
    attention: openFlags.slice(0, 6).map((f) => ({
      title: f.signal.split("_").join(" ").toLowerCase(),
      detail: `Integrity signal awaiting human review · severity ${f.severity}`,
      severity: f.severity,
      to: "/staff/interns/governance",
    })),
    totals: {
      register: rows.length,
      active: active.length,
      acceptedWork: rows.reduce((a, r) => a + Number(r.accepted_work ?? 0), 0),
      openFlags: openFlags.length,
      talent: rows.filter((r) => r.talent_level === "YALLA_TALENT").length,
    },
  };
}

const DEMO_INTERNS = [
  { name: "Aisha Wanjiru", level: "YALLA_TALENT" as TalentLevel, index: 91, track: "SALES", revenue: 1_480_000 },
  { name: "Brian Otieno", level: "PRODUCER" as TalentLevel, index: 82, track: "TRAVEL_OPS", revenue: 620_000 },
  { name: "Cynthia Mwikali", level: "PRODUCER" as TalentLevel, index: 78, track: "LOGISTICS", revenue: 410_000 },
  { name: "Daniel Kiplagat", level: "OPERATOR" as TalentLevel, index: 68, track: "EVENTS", revenue: 145_000 },
  { name: "Emily Nafula", level: "OPERATOR" as TalentLevel, index: 64, track: "CX", revenue: 0 },
  { name: "Felix Mburu", level: "APPRENTICE" as TalentLevel, index: 52, track: "DIGITAL", revenue: 0 },
];

const demoWork = (
  ref: string,
  title: string,
  intern: string,
  track: string,
  status: string,
  priority: CockpitWork["priority"],
  due: string | null,
  objective: string,
  evidence: string[],
  reviewer: string | null = "Charles Gateru",
  quality: number | null = null,
  deliverable: string | null = null,
): CockpitWork => ({
  id: ref,
  ref,
  title,
  intern,
  internId: null,
  track,
  lane: laneFor(status),
  status,
  priority,
  due,
  objective,
  deliverable,
  reviewer,
  quality,
  evidence,
});

/** Seeded demo cohort — labelled DEMO everywhere it renders. */
export function buildDemoModel(environment: InternsEnvironment = "DEMO"): CockpitModel {
  return {
    environment,
    seeded: true,
    cohortLabel: "YMEITA Cohort 2026-01 (DEMO)",
    periodLabel: "Trailing 28 days (DEMO)",
    activity: [
      { label: "Mon", assigned: 14, submitted: 11, accepted: 9 },
      { label: "Tue", assigned: 17, submitted: 15, accepted: 12 },
      { label: "Wed", assigned: 12, submitted: 12, accepted: 11 },
      { label: "Thu", assigned: 19, submitted: 16, accepted: 13 },
      { label: "Fri", assigned: 21, submitted: 18, accepted: 16 },
      { label: "Sat", assigned: 6, submitted: 5, accepted: 4 },
      { label: "Sun", assigned: 3, submitted: 2, accepted: 2 },
    ],
    utilisation: [
      { label: "W1", value: 54 },
      { label: "W2", value: 63 },
      { label: "W3", value: 71 },
      { label: "W4", value: 76 },
    ],
    work: [
      demoWork(
        "WQ-1041",
        "Qualify 12 corporate mobility leads (Westlands cluster)",
        "Aisha Wanjiru",
        "SALES",
        "IN_PROGRESS",
        "high",
        "2026-02-14",
        "Commercial: qualified pipeline created with traceable evidence",
        ["CRM lead records ×12", "Call log export", "Supervisor note"],
      ),
      demoWork(
        "WQ-1042",
        "Airport transfer dispatch audit — night shift",
        "Brian Otieno",
        "TRAVEL_OPS",
        "SUBMITTED",
        "medium",
        "2026-02-12",
        "Operational: exception rate reduced on airport transfers",
        ["Dispatch exception sheet", "Shift handover log"],
        "Charles Gateru",
        null,
        "ops/airport-night-audit.pdf",
      ),
      demoWork(
        "WQ-1043",
        "Last-mile route consolidation model",
        "Cynthia Mwikali",
        "LOGISTICS",
        "UNDER_REVIEW",
        "high",
        "2026-02-11",
        "Productivity: cost per delivery reduced with verified inputs",
        ["Route dataset", "Model workbook", "Cost baseline"],
        "James Mungai",
        null,
        "logistics/route-consolidation.xlsx",
      ),
      demoWork(
        "WQ-1044",
        "Corporate events pack — Q1 activation",
        "Daniel Kiplagat",
        "EVENTS",
        "BLOCKED",
        "critical",
        "2026-02-10",
        "Commercial: activation collateral approved by brand",
        ["Brand review request", "Blocked: awaiting supplier quote"],
      ),
      demoWork(
        "WQ-1045",
        "Rider complaint root-cause clinic",
        "Emily Nafula",
        "CX",
        "ASSIGNED",
        "medium",
        "2026-02-16",
        "Quality: repeat-complaint drivers identified from evidence",
        ["Complaint extract", "Clinic template"],
      ),
      demoWork(
        "WQ-1039",
        "Social distribution content calendar (Feb)",
        "Felix Mburu",
        "DIGITAL",
        "ACCEPTED",
        "low",
        "2026-02-06",
        "Learning: brand-compliant publishing capability demonstrated",
        ["Calendar record", "Reviewer acceptance", "Publishing log"],
        "Charles Gateru",
        86,
        "digital/feb-calendar.pdf",
      ),
      demoWork(
        "WQ-1036",
        "Corporate wallet reconciliation walkthrough",
        "Aisha Wanjiru",
        "SALES",
        "COMPLETED",
        "medium",
        "2026-02-04",
        "Operational: reconciliation exceptions cleared with audit trail",
        ["Reconciliation run", "Finance sign-off"],
        "James Mungai",
        92,
        "finance/wallet-recon-walkthrough.pdf",
      ),
    ],
    calendar: [
      { date: "2026-02-10", title: "Mentor clinic — commercial evidence", kind: "CLINIC", detail: "All tracks · 60 min" },
      { date: "2026-02-12", title: "Mid-cohort performance review", kind: "REVIEW", detail: "Supervisors + mentors" },
      { date: "2026-02-14", title: "Lead qualification deadline", kind: "DEADLINE", detail: "SALES track" },
      { date: "2026-02-19", title: "Capstone scoping submission", kind: "CAPSTONE", detail: "Sealed on submission" },
      { date: "2026-03-02", title: "Cohort 2026-02 induction", kind: "INDUCTION", detail: "24 places planned" },
    ],
    learning: {
      overall: 74,
      domains: [
        { label: "Mobility fundamentals", value: 88, validated: 6, total: 6 },
        { label: "Commercial craft", value: 76, validated: 4, total: 6 },
        { label: "Operations & dispatch", value: 71, validated: 4, total: 5 },
        { label: "Compliance & conduct", value: 64, validated: 3, total: 5 },
        { label: "Digital tooling", value: 58, validated: 2, total: 4 },
      ],
    },
    performance: {
      index: 72.5,
      scored: 6,
      dimensions: PERFORMANCE_DIMENSIONS.map((d) => ({
        key: d.key,
        label: d.label,
        value: { learning_score: 74, productivity_score: 78, quality_score: 71, commercial_score: 66, operational_score: 69, conduct_score: 88 }[d.key] ?? 0,
        weight: DEFAULT_WEIGHTS[d.key] ?? 0,
      })),
      evidenceConfidence: 81,
    },
    talent: DEMO_INTERNS.filter((i) => i.index >= 70).map((i) => ({
      name: i.name,
      internId: null,
      level: i.level,
      index: i.index,
      track: i.track,
      revenue: i.revenue,
    })),
    commercial: {
      verifiedRevenue: DEMO_INTERNS.reduce((a, i) => a + i.revenue, 0),
      attributedDeals: 9,
      pipelineKes: 4_250_000,
      assists: 23,
    },
    cohorts: [
      {
        cohort_id: "demo-cohort-1",
        cohort_name: "YMEITA Cohort 2026-01 (DEMO)",
        status: "ACTIVE",
        start_date: "2026-01-12",
        end_date: "2026-04-10",
        intake_size: 18,
        enrolled: 16,
        active: 14,
        completed: 1,
        exited: 1,
        yalla_talent: 1,
        avg_performance_index: 72.5,
        avg_evidence_confidence: 81,
        verified_revenue_kes: DEMO_INTERNS.reduce((a, i) => a + i.revenue, 0),
        open_integrity_flags: 2,
      },
    ],
    attention: [
      {
        title: "Self-reported revenue without source verification",
        detail: "1 attribution awaiting finance verification before it can score.",
        severity: "high",
        to: "/staff/interns/governance",
      },
      {
        title: "Work accepted without deliverable link",
        detail: "1 item accepted with no artefact attached — reviewer follow-up required.",
        severity: "medium",
        to: "/staff/interns/governance",
      },
      {
        title: "Learning validation lagging productivity",
        detail: "DIGITAL track has 2 of 4 competencies validated against 76% productivity.",
        severity: "low",
        to: "/staff/interns/talent",
      },
    ],
    totals: { register: 16, active: 14, acceptedWork: 67, openFlags: 2, talent: 1 },
  };
}
