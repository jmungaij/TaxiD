/**
 * SAFARID PARTNERS 360 — partner audit log export.
 *
 * Exports the lifecycle audit trail, the profile state history and the computed
 * consecutive-stage diffs for one visitor session, as either a spreadsheet (CSV)
 * or a paginated A4 report (PDF). Everything exported is already visible to the
 * operator on screen — this only changes the container, so no additional
 * authorisation is implied.
 */
import { downloadCsv, toCsv } from "@/lib/csv";
import { labelOf } from "@/lib/partners/journeyDrill";
import {
  CHANGE_KIND_LABEL,
  HISTORY_FIELD_LABEL,
  type PartnerLifecycleAuditRow,
  type PartnerProfileHistoryRow,
} from "@/lib/partners/history";
import {
  buildTimelineDiffs,
  DIFF_FIELD_KEY,
  DIFF_FIELD_LABEL,
  type TimelineDiff,
} from "@/lib/partners/timelineDiff";

export interface PartnerAuditExportInput {
  sessionId: string;
  audit: PartnerLifecycleAuditRow[];
  history?: PartnerProfileHistoryRow[];
  organisation?: string | null;
  contactEmail?: string | null;
}

const at = (iso: string) => new Date(iso).toLocaleString("en-KE");
const val = (key: "bring" | "category" | "level" | "stage", v: string | null) =>
  v ? labelOf(key, v) : "—";

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

/* ------------------------------- CSV -------------------------------- */

export interface AuditCsvRow {
  record: string;
  when: string;
  stage: string;
  from_stage: string;
  intent: string;
  category: string;
  maturity_level: string;
  variant: string;
  page_source: string;
  task_raised: string;
  changed: string;
}

export function buildAuditCsvRows(input: PartnerAuditExportInput): AuditCsvRow[] {
  const diffs = buildTimelineDiffs(input.audit);
  const diffByTo = new Map(diffs.map((d) => [d.toId, d]));

  const auditRows: AuditCsvRow[] = [...input.audit]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((r) => ({
      record: "lifecycle_stage_move",
      when: at(r.created_at),
      stage: val("stage", r.lifecycle_stage),
      from_stage: val("stage", r.previous_stage),
      intent: val("bring", r.intent_bring),
      category: val("category", r.network_category),
      maturity_level: val("level", r.maturity_level),
      variant: r.ab_variant ?? "—",
      page_source: r.page_source ?? "—",
      task_raised: r.work_item_id ? "yes" : "no",
      changed:
        diffByTo
          .get(r.id)
          ?.changedFields.map((f) => DIFF_FIELD_LABEL[f])
          .join(" | ") ?? "",
    }));

  const historyRows: AuditCsvRow[] = (input.history ?? []).map((h) => ({
    record: `profile_${h.change_kind}`,
    when: at(h.created_at),
    stage: val("stage", h.lifecycle_stage),
    from_stage: "—",
    intent: val("bring", h.intent_bring),
    category: val("category", h.network_category),
    maturity_level: val("level", h.maturity_level),
    variant: h.ab_variant ?? "—",
    page_source: "profile",
    task_raised: "n/a",
    changed: h.changed_fields.map((f) => HISTORY_FIELD_LABEL[f] ?? f).join(" | "),
  }));

  return [...auditRows, ...historyRows];
}

export function exportPartnerAuditCsv(input: PartnerAuditExportInput): number {
  const rows = buildAuditCsvRows(input);
  downloadCsv(`yalla-partner-audit-${input.sessionId}-${stamp()}.csv`, toCsv(rows));
  return rows.length;
}

/* ------------------------------- PDF -------------------------------- */

function diffLine(d: TimelineDiff): string {
  if (d.identical) return "no governed change";
  return d.deltas
    .filter((x) => x.changed)
    .map((x) => {
      const key = DIFF_FIELD_KEY[x.field];
      return `${DIFF_FIELD_LABEL[x.field]}: ${val(key, x.before)} \u2192 ${val(key, x.after)}`;
    })
    .join("; ");
}

export async function exportPartnerAuditPdf(input: PartnerAuditExportInput): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const M = 48;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = M;

  const page = () => {
    doc.addPage();
    y = M;
  };
  const room = (need: number) => {
    if (y + need > H - M) page();
  };
  const line = (text: string, size = 10, bold = false, indent = 0) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const wrapped = doc.splitTextToSize(text, W - M * 2 - indent) as string[];
    room(wrapped.length * (size + 4));
    doc.text(wrapped, M + indent, y);
    y += wrapped.length * (size + 4);
  };
  const rule = () => {
    room(14);
    doc.setDrawColor(200);
    doc.line(M, y, W - M, y);
    y += 12;
  };

  line("SAFARID Partners 360", 16, true);
  line("Partner journey audit log", 12, true);
  y += 4;
  line(`Session ${input.sessionId}`, 9);
  if (input.organisation) line(`Organisation: ${input.organisation}`, 9);
  if (input.contactEmail) line(`Contact: ${input.contactEmail}`, 9);
  line(`Generated ${new Date().toLocaleString("en-KE")} · ${input.audit.length} stage moves recorded`, 9);
  rule();

  line("Lifecycle stage moves", 12, true);
  const ordered = [...input.audit].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  if (ordered.length === 0) line("No lifecycle stage moves audited for this session.", 10);
  ordered.forEach((r, i) => {
    line(
      `${i + 1}. ${at(r.created_at)} — ${val("stage", r.previous_stage)} \u2192 ${val("stage", r.lifecycle_stage)}${
        r.work_item_id ? " (task raised)" : ""
      }`,
      10,
      true,
    );
    line(
      [
        `Brings ${val("bring", r.intent_bring)}`,
        `Category ${val("category", r.network_category)}`,
        `Level ${val("level", r.maturity_level)}`,
        r.ab_variant ? `Variant ${r.ab_variant}` : null,
        r.page_source ?? null,
      ]
        .filter(Boolean)
        .join(" · "),
      9,
      false,
      14,
    );
  });

  rule();
  line("What changed between consecutive stage updates", 12, true);
  const diffs = buildTimelineDiffs(input.audit);
  if (diffs.length === 0) line("Fewer than two stage moves — nothing to compare.", 10);
  diffs.forEach((d) => {
    line(`${at(d.fromAt)} \u2192 ${at(d.toAt)} (${d.gapMinutes} min apart)`, 10, true);
    line(diffLine(d), 9, false, 14);
  });

  if (input.history && input.history.length > 0) {
    rule();
    line("Profile state history", 12, true);
    input.history.forEach((h) => {
      line(`${at(h.created_at)} — ${CHANGE_KIND_LABEL[h.change_kind]}`, 10, true);
      line(
        [
          `Brings ${val("bring", h.intent_bring)}`,
          `Category ${val("category", h.network_category)}`,
          `Level ${val("level", h.maturity_level)}`,
          `Stage ${val("stage", h.lifecycle_stage)}`,
        ].join(" · "),
        9,
        false,
        14,
      );
      if (h.changed_fields.length > 0) {
        line(`Changed: ${h.changed_fields.map((f) => HISTORY_FIELD_LABEL[f] ?? f).join(", ")}`, 9, false, 14);
      }
    });
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`SAFARID Partners 360 · audit export · page ${p} of ${pages}`, M, H - 24);
    doc.setTextColor(0);
  }

  doc.save(`yalla-partner-audit-${input.sessionId}-${stamp()}.pdf`);
}
