/**
 * Commercial priority brief — data plus downloadable PDF.
 *
 * The server computes every figure over the requested calendar window and the
 * one before it, so the deltas are period-over-period on authoritative records.
 * The PDF repeats those numbers verbatim and carries drill-down links back into
 * the Control Tower; it never recomputes or interpolates anything.
 */
import { supabase } from "@/integrations/supabase/client";
import { formatCents } from "./closureEngine";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type BriefPeriod = "day" | "week" | "month" | "year";

export const PERIOD_META: Record<BriefPeriod, { label: string; comparison: string; cadence: string }> = {
  day: { label: "Morning brief", comparison: "Yesterday vs today", cadence: "Daily" },
  week: { label: "Weekly brief", comparison: "Last week vs this week", cadence: "Weekly" },
  month: { label: "Monthly brief", comparison: "Last month vs this month", cadence: "Monthly" },
  year: { label: "Annual brief", comparison: "Last year vs this year", cadence: "Annual" },
};

function obj(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export interface BriefWindow {
  revenueCents: number;
  contributionCents: number;
  gtvCents: number;
  collectionsCents: number;
  transactions: number;
  fulfilments: number;
  events: number;
}

export interface BriefOpportunity {
  opportunity_ref: string;
  title: string | null;
  stage: string | null;
  customer_label: string | null;
  expected_value_cents: number | null;
  probability_pct: number | null;
  provenance: string | null;
}

export interface BriefAction {
  action_ref: string;
  title: string | null;
  recommendation: string | null;
  status: string | null;
  risk_class: string | null;
  expected_revenue_cents: number | null;
  expected_contribution_cents: number | null;
  confidence_pct: number | null;
  approval_required: boolean | null;
}

export interface BriefConstraint {
  exception_ref: string;
  transaction_ref: string | null;
  stage: string | null;
  kind: string;
  severity: string;
  value_at_risk_cents: number | null;
  sla_due_at: string | null;
  owner_team: string | null;
  recommended_action: string | null;
  breached: boolean | null;
}

export interface BriefReconRow {
  kind: string;
  severity: string;
  cases: number;
  exposure_cents: number;
}

export interface BriefIncident {
  exception_ref: string;
  transaction_ref: string | null;
  kind: string;
  stage: string | null;
  severity: string;
  value_at_risk_cents: number | null;
  sla_due_at: string | null;
  escalation_level: number | null;
}

export interface PriorityBrief {
  ok: boolean;
  period: BriefPeriod;
  asOf: string | null;
  currentStart: string | null;
  previousStart: string | null;
  current: BriefWindow;
  previous: BriefWindow;
  opportunities: BriefOpportunity[];
  actions: BriefAction[];
  constraints: BriefConstraint[];
  reconciliation: BriefReconRow[];
  incidents: BriefIncident[];
  integrityScorePct: number | null;
  error?: string;
}

const emptyWindow: BriefWindow = {
  revenueCents: 0, contributionCents: 0, gtvCents: 0, collectionsCents: 0,
  transactions: 0, fulfilments: 0, events: 0,
};

function parseWindow(v: unknown): BriefWindow {
  const d = obj(v);
  return {
    revenueCents: num(d.revenue_cents),
    contributionCents: num(d.contribution_cents),
    gtvCents: num(d.gtv_cents),
    collectionsCents: num(d.collections_cents),
    transactions: num(d.transactions),
    fulfilments: num(d.fulfilments),
    events: num(d.events),
  };
}

export async function loadPriorityBrief(period: BriefPeriod): Promise<PriorityBrief> {
  const empty: PriorityBrief = {
    ok: false, period, asOf: null, currentStart: null, previousStart: null,
    current: emptyWindow, previous: emptyWindow, opportunities: [], actions: [],
    constraints: [], reconciliation: [], incidents: [], integrityScorePct: null,
  };
  const { data, error } = await rpc("commercial_priority_brief", { _period: period });
  if (error) return { ...empty, error: error.message };
  const d = obj(data);
  if (d.ok !== true) return { ...empty, error: typeof d.error === "string" ? d.error : "brief_unavailable" };
  const integrity = obj(d.integrity);
  return {
    ok: true,
    period,
    asOf: typeof d.as_of === "string" ? d.as_of : null,
    currentStart: typeof d.current_start === "string" ? d.current_start : null,
    previousStart: typeof d.previous_start === "string" ? d.previous_start : null,
    current: parseWindow(d.current),
    previous: parseWindow(d.previous),
    opportunities: arr<BriefOpportunity>(d.opportunities),
    actions: arr<BriefAction>(d.actions),
    constraints: arr<BriefConstraint>(d.constraints),
    reconciliation: arr<BriefReconRow>(d.reconciliation_exceptions),
    incidents: arr<BriefIncident>(d.critical_incidents),
    integrityScorePct: d.integrity ? num(integrity.score_pct) : null,
  };
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function formatDelta(current: number, previous: number): string {
  const d = deltaPct(current, previous);
  if (d === null) return previous === 0 && current > 0 ? "new" : "n/a";
  return `${d > 0 ? "+" : ""}${d}%`;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const INK = { brand: [20, 52, 144] as [number, number, number], ink: [15, 23, 42] as [number, number, number], muted: [100, 116, 139] as [number, number, number] };

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

function drillUrl(ref: string | null | undefined): string {
  const base = typeof window !== "undefined" ? window.location.origin : "https://safarid.org";
  return ref ? `${base}/staff/closure?tx=${encodeURIComponent(ref)}` : `${base}/staff/closure`;
}

/** Renders the brief to a PDF and triggers the download. Returns the filename. */
export async function downloadBriefPdf(brief: PriorityBrief): Promise<string> {
  const { default: JsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const meta = PERIOD_META[brief.period];
  const margin = 40;
  let y = 0;

  // Header band
  doc.setFillColor(...INK.brand);
  doc.rect(0, 0, pageW, 76, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text("SAFARID", margin, 32);
  doc.setFont("helvetica", "normal").setFontSize(11);
  doc.text(`Commercial Priority Brief — ${meta.label}`, margin, 50);
  doc.setFontSize(8);
  doc.text(`As of ${shortDate(brief.asOf)}  ·  ${meta.comparison}`, margin, 65);
  doc.text("CONFIDENTIAL", pageW - margin, 32, { align: "right" });
  if (brief.integrityScorePct !== null) {
    doc.text(`Revenue integrity ${brief.integrityScorePct}%`, pageW - margin, 50, { align: "right" });
  }
  y = 100;

  const c = brief.current;
  const p = brief.previous;
  doc.setTextColor(...INK.ink);
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text("Economic performance", margin, y);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [["Measure", "This period", "Previous period", "Delta"]],
    body: [
      ["Recognised revenue", formatCents(c.revenueCents), formatCents(p.revenueCents), formatDelta(c.revenueCents, p.revenueCents)],
      ["Contribution", formatCents(c.contributionCents), formatCents(p.contributionCents), formatDelta(c.contributionCents, p.contributionCents)],
      ["Gross transaction value", formatCents(c.gtvCents), formatCents(p.gtvCents), formatDelta(c.gtvCents, p.gtvCents)],
      ["Collections", formatCents(c.collectionsCents), formatCents(p.collectionsCents), formatDelta(c.collectionsCents, p.collectionsCents)],
      ["Transactions", String(c.transactions), String(p.transactions), formatDelta(c.transactions, p.transactions)],
      ["Fulfilments", String(c.fulfilments), String(p.fulfilments), formatDelta(c.fulfilments, p.fulfilments)],
      ["Revenue events", String(c.events), String(p.events), formatDelta(c.events, p.events)],
    ],
    theme: "grid",
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 4, textColor: INK.ink },
    headStyles: { fillColor: INK.brand, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;

  const section = (title: string, head: string[][], body: (string | number)[][], links?: (string | null)[]) => {
    if (y > 700) { doc.addPage(); y = 60; }
    doc.setTextColor(...INK.ink).setFont("helvetica", "bold").setFontSize(11);
    doc.text(title, margin, y);
    y += 8;
    if (body.length === 0) {
      doc.setFont("helvetica", "italic").setFontSize(8).setTextColor(...INK.muted);
      doc.text("No records for this period.", margin, y + 12);
      y += 32;
      return;
    }
    autoTable(doc, {
      startY: y,
      head,
      body,
      theme: "striped",
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 3.5, textColor: INK.ink, overflow: "linebreak" },
      headStyles: { fillColor: INK.brand, textColor: [255, 255, 255], fontStyle: "bold" },
      didDrawCell: (data) => {
        if (data.section !== "body" || data.column.index !== 0 || !links) return;
        const url = links[data.row.index];
        if (!url) return;
        doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
  };

  section(
    "Top opportunities",
    [["Reference", "Opportunity", "Stage", "Expected value", "Win probability"]],
    brief.opportunities.map((o) => [
      o.opportunity_ref, o.title ?? o.customer_label ?? "—", o.stage ?? "—",
      formatCents(o.expected_value_cents ?? 0), o.probability_pct !== null ? `${o.probability_pct}%` : "—",
    ]),
    brief.opportunities.map(() => drillUrl(null)),
  );

  section(
    "Priority actions",
    [["Reference", "Action", "Expected contribution", "Confidence", "Approval"]],
    brief.actions.map((a) => [
      a.action_ref, a.title ?? a.recommendation ?? "—",
      formatCents(a.expected_contribution_cents ?? 0),
      a.confidence_pct !== null ? `${a.confidence_pct}%` : "—",
      a.approval_required ? "Required" : "Not required",
    ]),
    brief.actions.map(() => drillUrl(null)),
  );

  section(
    "Constraints blocking revenue",
    [["Reference", "Transaction", "Constraint", "At risk", "SLA"]],
    brief.constraints.map((k) => [
      k.exception_ref, k.transaction_ref ?? "—", `${k.kind} (${k.severity})`,
      formatCents(k.value_at_risk_cents ?? 0),
      k.breached ? "BREACHED" : k.sla_due_at ? shortDate(k.sla_due_at) : "—",
    ]),
    brief.constraints.map((k) => drillUrl(k.transaction_ref)),
  );

  section(
    "Reconciliation exceptions",
    [["Break kind", "Severity", "Cases", "Exposure"]],
    brief.reconciliation.map((r) => [r.kind, r.severity, String(r.cases), formatCents(r.exposure_cents)]),
  );

  section(
    "Critical incidents",
    [["Reference", "Transaction", "Kind", "At risk", "Escalation"]],
    brief.incidents.map((i) => [
      i.exception_ref, i.transaction_ref ?? "—", i.kind,
      formatCents(i.value_at_risk_cents ?? 0), `L${i.escalation_level ?? 0}`,
    ]),
    brief.incidents.map((i) => drillUrl(i.transaction_ref)),
  );

  if (y > 720) { doc.addPage(); y = 60; }
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...INK.muted);
  doc.text(
    "Every figure is read from authoritative commercial records. Reference cells link back to the Economic Closure Control Tower for drill-down.",
    margin, y, { maxWidth: pageW - margin * 2 },
  );

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7.5).setTextColor(...INK.muted);
    doc.text(`SAFARID · ${meta.label} · page ${i} of ${pages}`, margin, doc.internal.pageSize.getHeight() - 20);
    doc.textWithLink("Open Control Tower", pageW - margin, doc.internal.pageSize.getHeight() - 20, {
      url: drillUrl(null), align: "right",
    });
  }

  const stamp = (brief.asOf ?? new Date().toISOString()).slice(0, 10);
  const filename = `yalla-commercial-brief-${brief.period}-${stamp}.pdf`;
  doc.save(filename);
  return filename;
}
