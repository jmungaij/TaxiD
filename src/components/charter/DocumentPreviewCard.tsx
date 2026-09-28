/**
 * Executive travel document preview (Document System 2.0).
 *
 * The on-screen twin of the generated PDF: lifecycle-aware title, status
 * badge, itinerary, fully itemised pricing and the forensic control line.
 * Used at the notification/approval step so the customer sees the exact
 * dossier they are about to download or send for approval.
 */
import { Download, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/charter/catalog";
import { roadFareLines, type RoadFare } from "@/lib/charter/roadFare";
import {
  documentStatusBadge,
  resolveDocumentTitle,
} from "@/lib/charter/documentTitles";
import { AppButton } from "@/components/nav/AppButton";

interface Props {
  reference: string;
  customerName: string;
  vehicle: string;
  passengers: number;
  route: string;
  itinerary: string[];
  fare: RoadFare;
  paymentStatus?: string | null;
  /** Download handler — wired to the road invoice PDF builder. */
  onDownload?: () => void;
  downloading?: boolean;
  className?: string;
}

export function DocumentPreviewCard({
  reference, customerName, vehicle, passengers, route, itinerary, fare,
  paymentStatus, onDownload, downloading, className,
}: Props) {
  const title = resolveDocumentTitle({ paymentStatus, quoteOnly: !paymentStatus });
  const status = documentStatusBadge(paymentStatus);
  const settled = status.toLowerCase() === "paid";

  return (
    <section
      className={`overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${className ?? ""}`}
      aria-label="Travel document preview"
    >
      <header className="border-b border-border bg-muted/40 px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <FileText className="h-3.5 w-3.5" aria-hidden /> TaxiD · Executive travel dossier
            </p>
            <h3 className="mt-1 text-lg font-semibold">{title.title}</h3>
            <p className="text-xs text-muted-foreground">{title.subtitle}</p>
          </div>
          <Badge variant={settled ? "default" : "destructive"}>{status}</Badge>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {title.numberPrefix}-{reference} · Issued to {customerName || "traveller"} ·{" "}
          {new Date().toLocaleDateString("en-KE")}
        </p>
      </header>

      <div className="grid gap-6 px-6 py-5 sm:grid-cols-2">
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mission</h4>
          <p className="mt-1 text-sm font-medium">{route || "Route to be confirmed"}</p>
          <p className="text-xs text-muted-foreground">
            {vehicle} · {passengers} passenger{passengers === 1 ? "" : "s"}
          </p>
        </div>
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Itinerary</h4>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {itinerary.slice(0, 6).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {!itinerary.length && <li>Itinerary details pending</li>}
          </ul>
        </div>
      </div>

      <div className="border-t border-border px-6 py-5">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Enterprise pricing — fully itemised
        </h4>
        <dl className="mt-3 space-y-2">
          {roadFareLines(fare).map((l) => (
            <div key={l.label} className="flex items-baseline justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">{l.label}</dt>
              <dd className="font-medium tabular-nums">{l.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
          <span className="text-sm font-semibold">Total mission value</span>
          <span className="text-2xl font-bold text-primary tabular-nums">
            {formatMoney(fare.total, "KES")}
          </span>
        </div>
        <p className="mt-1 text-right text-[11px] text-muted-foreground">
          {formatMoney(fare.perUnit, "KES")} per passenger · VAT included in the quoted fare
        </p>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-4">
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
          Forensically watermarked · control number issued on download
        </p>
        {onDownload && (
          <AppButton analytics="charter_document_dossier_download" action="submit" size="sm" onClick={onDownload} disabled={downloading}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            {downloading ? "Preparing…" : "Download dossier (PDF)"}
          </AppButton>
        )}
      </footer>
    </section>
  );
}

export default DocumentPreviewCard;
