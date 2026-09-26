/**
 * Ask SAFARID — Recruitment 360.
 *
 * Recommendations are computed deterministically from the recruiter's own
 * RLS-scoped pipeline records. Nothing is generated from a model and nothing is
 * executed automatically: each suggestion must be logged as an AI request
 * (`rec_ai_recommendations`) and then accepted, modified or rejected by a human,
 * with the reason captured in the recruitment audit trail.
 */
import type { AttentionItem } from "./attention";
import { daysSince, type RecApplication, type RecInterview, type RecOffer, type RecVacancy } from "./types";

export interface NextBestAction {
  id: string;
  kind:
    | "screen_backlog"
    | "confirm_shortlist"
    | "schedule_interview"
    | "collect_scorecard"
    | "chase_offer"
    | "publish_vacancy"
    | "reengage_talent_pool";
  title: string;
  rationale: string;
  /** Deterministic evidence lines — every one traces to a record count or date. */
  evidence: string[];
  /** 0–1, derived from how unambiguous the signal is. Never a model score. */
  confidence: number;
  to: string;
  subjectType: string;
  subjectId: string | null;
}

export interface AskYallaInputs {
  vacancies: RecVacancy[];
  applications: RecApplication[];
  interviews: RecInterview[];
  offers: RecOffer[];
  attention: AttentionItem[];
  talentPoolIdle: number;
}

export function recommendNextBestActions(input: AskYallaInputs): NextBestAction[] {
  const out: NextBestAction[] = [];
  const active = input.applications.filter((a) => a.status === "active");

  const toScreen = active.filter((a) => a.stage === "applied" || a.stage === "screening");
  if (toScreen.length) {
    const oldest = Math.max(...toScreen.map((a) => daysSince(a.stage_entered_at)));
    out.push({
      id: "screen_backlog",
      kind: "screen_backlog",
      title: `Screen ${toScreen.length} application${toScreen.length === 1 ? "" : "s"} waiting for a first decision`,
      rationale:
        "Applications sitting before screening are the cheapest place to recover time-to-fill, and the queue is the largest unblocked step in your pipeline.",
      evidence: [
        `${toScreen.length} active application(s) in Applied or Screening`,
        `Oldest has waited ${oldest} day(s) in stage`,
      ],
      confidence: Math.min(0.95, 0.6 + toScreen.length / 40),
      to: "/staff/recruitment/screening",
      subjectType: "pipeline",
      subjectId: null,
    });
  }

  const shortlisted = active.filter((a) => a.stage === "shortlisted");
  if (shortlisted.length) {
    out.push({
      id: "confirm_shortlist",
      kind: "confirm_shortlist",
      title: `Get hiring-manager decisions on ${shortlisted.length} shortlisted candidate(s)`,
      rationale:
        "Shortlisted candidates are already screened; the only thing between them and an interview is a recorded decision.",
      evidence: [
        `${shortlisted.length} application(s) in Shortlisted`,
        `Average ${Math.round(
          shortlisted.reduce((s, a) => s + daysSince(a.stage_entered_at), 0) / shortlisted.length,
        )} day(s) awaiting a decision`,
      ],
      confidence: 0.8,
      to: "/staff/recruitment/shortlist",
      subjectType: "pipeline",
      subjectId: null,
    });
  }

  const awaitingInterview = active.filter((a) => a.stage === "interview");
  const unscheduled = awaitingInterview.filter(
    (a) => !input.interviews.some((i) => i.application_id === a.id && i.status === "scheduled"),
  );
  if (unscheduled.length) {
    out.push({
      id: "schedule_interview",
      kind: "schedule_interview",
      title: `Schedule interviews for ${unscheduled.length} candidate(s) at interview stage`,
      rationale: "These candidates were advanced to interview but have no scheduled slot, so the stage cannot progress.",
      evidence: [
        `${unscheduled.length} application(s) at Interview with no scheduled interview`,
        `${input.interviews.filter((i) => i.status === "scheduled").length} interview(s) currently scheduled`,
      ],
      confidence: 0.85,
      to: "/staff/recruitment/interviews",
      subjectType: "pipeline",
      subjectId: null,
    });
  }

  const missingScorecards = input.interviews.filter((i) => i.status === "completed");
  if (missingScorecards.length) {
    out.push({
      id: "collect_scorecard",
      kind: "collect_scorecard",
      title: `Close out ${missingScorecards.length} completed interview(s) with an evaluation decision`,
      rationale:
        "A completed interview without a recorded evaluation leaves the hiring decision undocumented and blocks the offer stage.",
      evidence: [`${missingScorecards.length} interview(s) marked completed`],
      confidence: 0.75,
      to: "/staff/recruitment/evaluations",
      subjectType: "pipeline",
      subjectId: null,
    });
  }

  const waitingOffers = input.offers.filter((o) => ["sent", "viewed"].includes(o.status));
  if (waitingOffers.length) {
    const longest = Math.max(...waitingOffers.map((o) => daysSince(o.sent_at)));
    out.push({
      id: "chase_offer",
      kind: "chase_offer",
      title: `Follow up on ${waitingOffers.length} outstanding offer(s)`,
      rationale: "Offer silence is the highest-cost stage to lose: the role is already approved and the pipeline is spent.",
      evidence: [
        `${waitingOffers.length} offer(s) sent or viewed without a response`,
        `Longest has been open ${longest} day(s)`,
      ],
      confidence: 0.9,
      to: "/staff/recruitment/offers",
      subjectType: "pipeline",
      subjectId: null,
    });
  }

  const unpublished = input.vacancies.filter(
    (v) => v.status === "open" && v.publication_status !== "published",
  );
  if (unpublished.length) {
    out.push({
      id: "publish_vacancy",
      kind: "publish_vacancy",
      title: `Publish ${unpublished.length} open vacancy(ies) that are not live`,
      rationale: "An open vacancy that is not published cannot attract applications, so its SLA clock runs with no supply.",
      evidence: [`${unpublished.length} open vacancy(ies) with publication status not "published"`],
      confidence: 0.88,
      to: "/staff/recruitment/vacancies",
      subjectType: "vacancy",
      subjectId: unpublished[0]?.id ?? null,
    });
  }

  if (input.talentPoolIdle > 0 && toScreen.length === 0) {
    out.push({
      id: "reengage_talent_pool",
      kind: "reengage_talent_pool",
      title: `Re-engage ${input.talentPoolIdle} talent-pool candidate(s) with no recent contact`,
      rationale:
        "With no screening backlog, the highest-return sourcing move is warm candidates you have already qualified.",
      evidence: [`${input.talentPoolIdle} pooled candidate(s) not engaged in the last 60 days`],
      confidence: 0.6,
      to: "/staff/recruitment/talent-pool",
      subjectType: "talent_pool",
      subjectId: null,
    });
  }

  if (input.attention.length) {
    const top = input.attention[0];
    out.push({
      id: `attention:${top.key}`,
      kind: "screen_backlog",
      title: `Clear the top attention item: ${top.title}`,
      rationale: "This is the most severe breach of a configured recruitment SLA in your scope.",
      evidence: [top.detail, `Severity: ${top.severity}`],
      confidence: 0.92,
      to: top.to,
      subjectType: top.objectType,
      subjectId: top.objectId,
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}
