/**
 * CSV export for Flight Partner Onboarding audit trails — submissions,
 * document evidence, reviewer actions and timestamps in one flat file.
 */
import type { PartnerApplication, PartnerEvent } from "./partners";

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export const PARTNER_AUDIT_COLUMNS = [
  "event_at", "application_id", "operator_name", "contact_name", "contact_email",
  "country", "home_base", "fleet_size", "application_status", "readiness_documents",
  "action", "from_status", "to_status", "actor_email", "note", "document_path",
  "documents_attached", "submitted_at", "reviewed_at",
];

export function partnerAuditToCsv(apps: PartnerApplication[], events: PartnerEvent[]): string {
  const byApp = new Map(apps.map((a) => [a.id, a]));
  const rows = [...events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const lines = [PARTNER_AUDIT_COLUMNS.join(",")];

  const push = (app: PartnerApplication | undefined, e: Partial<PartnerEvent> & { created_at: string; action: string }) => {
    const docs = (app?.documents ?? []).map((d) => `${d.key}:${d.file_name}`).join(" | ");
    lines.push([
      e.created_at, app?.id ?? e.application_id ?? "", app?.operator_name ?? "", app?.contact_name ?? "",
      app?.contact_email ?? "", app?.country ?? "", app?.home_base ?? "", app?.fleet_size ?? "",
      app?.status ?? "", app?.documents?.length ?? 0,
      e.action, e.from_status ?? "", e.to_status ?? "", e.actor_email ?? "", e.note ?? "", e.document_path ?? "",
      docs, app?.created_at ?? "", app?.reviewed_at ?? "",
    ].map(esc).join(","));
  };

  for (const e of rows) push(byApp.get(e.application_id), e);

  // Applications with no event history still belong in the audit export.
  const covered = new Set(rows.map((e) => e.application_id));
  for (const a of apps) {
    if (!covered.has(a.id)) push(a, { created_at: a.created_at, action: "submitted", to_status: a.status });
  }

  return lines.join("\n");
}

export function downloadPartnerAuditCsv(apps: PartnerApplication[], events: PartnerEvent[]) {
  const blob = new Blob([partnerAuditToCsv(apps, events)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flight-partner-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
