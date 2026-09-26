/**
 * Customer-facing charter confirmation summary.
 *
 * Produces a self-contained, print-ready HTML document with the full flight
 * timeline, human reason labels and any attached evidence documents (resolved
 * to short-lived signed links when the viewer is authorised to read them).
 */
import { reasonLabel } from "./access";
import { domainLexicon, resolveAssetDomain } from "./assetDomains";
import { statusLabel } from "./transitions";
import { tryEvidenceSignedUrl } from "./evidence";
import type { CharterBookingRow } from "./api";

export interface SummaryEvent {
  at: string;
  status: string;
  note?: string | null;
  reason_code?: string | null;
  actor?: string | null;
  evidence_url?: string | null;
}

export type SummaryBooking = Partial<Omit<CharterBookingRow, "flight_events">> & {
  reference?: string;
  flight_events?: SummaryEvent[];
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** Resolve evidence storage paths to signed links (null when not permitted). */
export async function resolveEvidenceLinks(events: SummaryEvent[]): Promise<Record<string, string | null>> {
  const paths = Array.from(new Set(events.map((e) => e.evidence_url).filter((p): p is string => !!p)));
  const entries = await Promise.all(paths.map(async (p) => [p, await tryEvidenceSignedUrl(p)] as const));
  return Object.fromEntries(entries);
}

export function buildConfirmationHtml(
  booking: SummaryBooking,
  links: Record<string, string | null> = {},
): string {
  const trip = (booking.trip ?? {}) as Record<string, string>;
  const events = booking.flight_events ?? [];

  const rows = events.map((e) => {
    const link = e.evidence_url ? links[e.evidence_url] : null;
    const doc = e.evidence_url
      ? (link ? `<a href="${esc(link)}">Open document</a>` : "Attached — available from your concierge")
      : "—";
    return `<tr>
      <td>${esc(new Date(e.at).toLocaleString())}</td>
      <td><strong>${esc(statusLabel(e.status))}</strong></td>
      <td>${esc(e.reason_code ? reasonLabel(e.reason_code) : "—")}</td>
      <td>${esc(e.note ?? "—")}</td>
      <td>${doc}</td>
    </tr>`;
  }).join("");

  const lex = domainLexicon(booking.category_slug);
  const facts: Array<[string, string]> = [
    ["Reference", String(booking.reference ?? "—")],
    [lex.assetLabel, String(booking.asset_name ?? "—")],
    [lex.routeLabel, `${trip.origin || "—"} → ${trip.destination || "—"}`],
    [lex.departureLabel, String(trip.date || "—")],
    [lex.occupantPluralLabel, String((booking.passengers ?? []).length || trip.passengers || "—")],
    ["Booking status", String(booking.status ?? "—")],
    [resolveAssetDomain(booking.category_slug) === "aviation" ? "Flight status" : "Trip status",
      statusLabel(booking.flight_status ?? "requested")],
    ["Amount", booking.amount != null ? `${booking.currency ?? ""} ${Number(booking.amount).toLocaleString()}` : "—"],
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>${esc(lex.confirmationTitle)} ${esc(booking.reference ?? "")}</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; padding:40px; background:#f6f7f9; font-family:"Helvetica Neue",Arial,sans-serif; color:#10131a; }
  .sheet { max-width:820px; margin:0 auto; background:#fff; border-radius:20px; padding:40px;
           box-shadow:0 24px 60px -30px rgba(10,16,32,.45); }
  .brand { letter-spacing:.28em; text-transform:uppercase; font-size:11px; color:#8a8f9c; }
  h1 { font-size:30px; margin:8px 0 4px; font-weight:600; }
  .sub { color:#5c6373; margin:0 0 28px; }
  dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px 24px; margin:0 0 32px; }
  dt { font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:#8a8f9c; }
  dd { margin:2px 0 0; font-size:15px; font-weight:500; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.12em; color:#5c6373; margin:0 0 12px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#8a8f9c;
       border-bottom:1px solid #e6e8ee; padding:8px 10px; }
  td { border-bottom:1px solid #f0f1f5; padding:10px; vertical-align:top; }
  a { color:#1c4fd8; }
  footer { margin-top:28px; font-size:11px; color:#8a8f9c; }
</style></head>
<body><div class="sheet">
  <p class="brand">Yalla Mobility · ${esc(lex.brandName)}</p>
  <h1>${esc(lex.brandEmoji)} ${esc(lex.confirmationTitle)}</h1>
  <p class="sub">Reference ${esc(booking.reference ?? "—")}</p>
  <dl>${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
  <h2>${esc(lex.id === "aviation" ? "Flight timeline" : "Trip timeline")}</h2>
  <table><thead><tr><th>When</th><th>Status</th><th>Reason</th><th>Operator note</th><th>Evidence</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="5">No status events recorded yet.</td></tr>`}</tbody></table>
  <footer>Generated ${esc(new Date().toLocaleString())} · Evidence links expire 15 minutes after generation.</footer>
</div></body></html>`;
}

export function downloadConfirmationSummary(booking: SummaryBooking, links: Record<string, string | null>) {
  const blob = new Blob([buildConfirmationHtml(booking, links)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${booking.reference ?? "charter"}-confirmation.html`;
  a.click();
  URL.revokeObjectURL(url);
}
