/**
 * CSV export for the charter pricing / evidence audit trail.
 * Includes quote-settings diffs and a deep link back to the evidenced entity.
 */
import type { CharterAuditRow } from "./api";

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const COLUMNS = [
  "created_at", "action", "entity_type", "entity_id", "reference", "actor_email",
  "category_slug", "asset_name", "currency", "total", "changed_fields",
  "cost_settings", "evidence_hash", "evidence_link", "evidence_document", "evidence_note",
];

export function auditRowsToCsv(rows: CharterAuditRow[], origin = window.location.origin): string {
  const lines = [COLUMNS.join(",")];
  for (const r of rows) {
    const diff = (r.changed_fields ?? [])
      .map((c) => `${c.field}: ${String(c.from ?? "—")} -> ${String(c.to ?? "—")}`)
      .join(" | ");
    const link = r.entity_id
      ? `${origin}/app/admin/aviation-center?entity=${encodeURIComponent(r.entity_id)}&evidence=${encodeURIComponent(r.evidence_hash)}`
      : "";
    lines.push([
      r.created_at, r.action, r.entity_type, r.entity_id ?? "", r.reference ?? "", r.actor_email ?? "",
      r.category_slug ?? "", r.asset_name ?? "", r.currency, r.total, diff,
      JSON.stringify(r.cost_settings ?? {}), r.evidence_hash, link,
      r.evidence_url ? `${origin}/app/admin/aviation-center?document=${encodeURIComponent(r.evidence_url)}` : "",
      r.evidence_note ?? "",
    ].map(esc).join(","));
  }
  return lines.join("\n");
}

export function downloadAuditCsv(rows: CharterAuditRow[]) {
  const blob = new Blob([auditRowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `charter-pricing-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
