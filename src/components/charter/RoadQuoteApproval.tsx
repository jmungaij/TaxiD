/**
 * Road charter (bus, van & coach) quote approval and payment authorisation.
 *
 * Presents the invoice + itinerary confirmation exactly as the customer will
 * receive it — marked UNPAID in red until settled — with the journey stated in
 * text, latitude/longitude and on a map. Payment can only be selected after the
 * passenger explicitly approves the quotation, and is then settled from the
 * corporate wallet, by M-Pesa STK prompt (below the KES 250,000 ceiling) or by
 * bank transfer, which emails operations a request for the transfer details.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Copy, FileText, Landmark, Loader2, MapPin, Smartphone } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { BookingPoint } from "@/components/rider/bookingTypes";
import { isRoadUnpaid, roadPaymentLabel } from "@/lib/charter/roadPayment";
import { CorporateApprovalPanel } from "@/components/charter/CorporateApprovalPanel";
import type { ProcurementDetails } from "@/lib/charter/corporateApproval";
import type { CorporateWalletRow } from "@/lib/charter/api";

/** M-Pesa STK is only offered below this per-transaction ceiling. */
export const STK_PROMPT_CEILING_KES = 250_000;

export interface RoadItinerary {
  assetName: string;
  origin: string;
  destination: string;
  originPoint: BookingPoint | null;
  destinationPoint: BookingPoint | null;
  date: string;
  duration: number;
  unit: string;
  quantity: number;
  passengers: number;
  notes: string;
}

interface Props {
  reference: string;
  itinerary: RoadItinerary;
  fareLines: Array<{ label: string; value: string }>;
  totalLabel: string;
  totalKes: number;
  contact: { name: string; email: string; phone: string; company: string };
  method: string;
  onMethodChange: (method: string) => void;
  approved: boolean;
  onApprovedChange: (approved: boolean) => void;
  /** Enterprise procurement details supplied by the approving authority. */
  procurement: ProcurementDetails;
  onProcurementChange: (next: ProcurementDetails) => void;
  bookingId?: string | null;
  /** Fired once the invoice is settled from the corporate wallet balance. */
  onWalletSettled?: (wallet: CorporateWalletRow) => void;
  signedIn?: boolean;
  onDownloadInvoice: () => void;
  downloading?: boolean;
  /** Persisted payment state — drives the red UNPAID presentation. */
  paymentStatus?: string | null;
  /** Control number of the issued invoice, quoted in shares and emails. */
  invoice?: { controlNumber: string; fileName: string } | null;
}

const MAP_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;

const coord = (p: BookingPoint | null) =>
  p ? `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}` : "Awaiting a mapped address";

function embedUrl(it: RoadItinerary): string | null {
  if (!MAP_KEY) return null;
  const o = it.originPoint;
  const d = it.destinationPoint;
  if (o && d) {
    return `https://www.google.com/maps/embed/v1/directions?key=${MAP_KEY}` +
      `&origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}&mode=driving`;
  }
  const one = o ?? d;
  if (one) return `https://www.google.com/maps/embed/v1/view?key=${MAP_KEY}&center=${one.lat},${one.lng}&zoom=12`;
  return null;
}

export function RoadQuoteApproval({
  reference, itinerary, fareLines, totalLabel, totalKes, contact,
  method, onMethodChange, approved, onApprovedChange, onDownloadInvoice, downloading,
  paymentStatus, invoice, procurement, onProcurementChange, bookingId, onWalletSettled,
  signedIn = true,
}: Props) {
  const [requesting, setRequesting] = useState(false);
  const [bankRequested, setBankRequested] = useState(false);
  const map = embedUrl(itinerary);
  const stkAvailable = totalKes < STK_PROMPT_CEILING_KES;
  const unpaid = isRoadUnpaid(paymentStatus);
  const statusLabel = roadPaymentLabel(paymentStatus);

  const summaryText = [
    `SAFARID — charter quotation ${reference}`,
    `Vehicle: ${itinerary.assetName}`,
    `Journey: ${itinerary.origin || "—"} → ${itinerary.destination || "—"}`,
    `Pickup coordinates: ${coord(itinerary.originPoint)}`,
    `Drop-off coordinates: ${coord(itinerary.destinationPoint)}`,
    `Departure: ${itinerary.date || "—"}`,
    `Duration: ${itinerary.duration} ${itinerary.unit}(s) × ${itinerary.quantity} vehicle(s)`,
    `Passengers: ${itinerary.passengers}`,
    itinerary.notes ? `Notes: ${itinerary.notes}` : "",
    "",
    ...fareLines.map((l) => `${l.label}: ${l.value}`),
    `Total payable: ${totalLabel} — status ${unpaid ? "UNPAID" : "PAID"} (${statusLabel})`,
    invoice ? `Invoice document: ${invoice.fileName} · control number ${invoice.controlNumber}` : "",
  ].filter(Boolean).join("\n");

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `Charter quotation ${reference}`, text: summaryText });
        return;
      }
      await navigator.clipboard.writeText(summaryText);
      toast({ title: "Quotation copied", description: "Share it with the approver for sign-off." });
    } catch {
      toast({ title: "Could not share", description: "Copy the details from the summary above.", variant: "destructive" });
    }
  };

  const requestBankTransfer = async () => {
    if (!contact.email || !contact.name) {
      toast({ title: "Contact details required", description: "Add your name and email in step 1 first.", variant: "destructive" });
      return;
    }
    setRequesting(true);
    try {
      const { error } = await supabase.functions.invoke("contact-submission", {
        body: {
          name: contact.name,
          email: contact.email,
          phone: contact.phone || null,
          company: contact.company || null,
          type: "sales",
          subject: `Bank transfer details requested — quotation ${reference}`,
          message:
            `I would like to settle charter quotation ${reference} by bank transfer. ` +
            `Please send the SAFARID bank account details for the amount ${totalLabel}.\n\n${summaryText}`,
          source_page: "/charter/book",
          elapsed_ms: 60_000,
        },
      });
      if (error) throw error;
      setBankRequested(true);
      toast({
        title: "Bank transfer request sent",
        description: "Operations will email you the transfer details for this quotation.",
      });
    } catch (e) {
      toast({
        title: "Request failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Invoice & itinerary confirmation — unpaid until settled */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-lg">Invoice &amp; itinerary confirmation</h2>
            <p className="text-sm text-muted-foreground">
              Quotation <span className="font-mono text-foreground">{reference}</span> · {itinerary.assetName}
            </p>
          </div>
          <Badge
            className={
              unpaid
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-primary/40 bg-primary/10 text-primary"
            }
            variant="outline"
          >
            {unpaid ? "UNPAID" : "PAID"} · {statusLabel}
          </Badge>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Pickup</dt>
            <dd className="font-medium">{itinerary.origin || "—"}</dd>
            <dd className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {coord(itinerary.originPoint)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Drop-off</dt>
            <dd className="font-medium">{itinerary.destination || "—"}</dd>
            <dd className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {coord(itinerary.destinationPoint)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Departure</dt>
            <dd className="font-medium">{itinerary.date || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Journey as requested</dt>
            <dd className="font-medium">
              {itinerary.duration} {itinerary.unit}(s) · {itinerary.quantity} vehicle(s) · {itinerary.passengers} passenger(s)
            </dd>
          </div>
          {itinerary.notes && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Notes</dt>
              <dd>{itinerary.notes}</dd>
            </div>
          )}
        </dl>

        {map ? (
          <iframe
            title="Journey route map"
            src={map}
            className="h-64 w-full rounded-xl border border-border"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
            Pick your pickup and drop-off from the address suggestions in step 1 to plot the route and capture
            latitude/longitude on the invoice.
          </p>
        )}

        <div className="rounded-xl bg-secondary/50 p-4 text-sm space-y-1.5">
          {fareLines.map((l) => (
            <div key={l.label} className="flex justify-between gap-3 text-muted-foreground">
              <span>{l.label}</span>
              <span className="text-foreground">{l.value}</span>
            </div>
          ))}
          <div className="border-t border-border pt-2 mt-2 flex justify-between font-semibold text-base">
            <span>Total payable</span>
            <span className={unpaid ? "text-destructive" : "text-primary"}>
              {totalLabel} · {unpaid ? "UNPAID" : "PAID"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" data-analytics="charter.road_quote.download_invoice" onClick={onDownloadInvoice} disabled={downloading}>
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            Download invoice &amp; itinerary
          </Button>
          <Button variant="outline" size="sm" onClick={() => void share()}>
            <Copy className="mr-2 h-4 w-4" /> Share for approval
          </Button>
        </div>

      </div>

      {/* Corporate organisation approval replaces passenger sign-off */}
      <CorporateApprovalPanel
        reference={reference}
        totalKes={totalKes}
        totalLabel={totalLabel}
        bookingId={bookingId}
        procurement={procurement}
        onProcurementChange={onProcurementChange}
        approved={approved}
        onApprovedChange={onApprovedChange}
        walletSelected={method === "corporate_wallet"}
        onWalletSettled={onWalletSettled}
        signedIn={signedIn}
      />


      {/* Payment authorisation */}
      <div className={`rounded-2xl border border-border bg-card p-6 space-y-4 ${approved ? "" : "opacity-60"}`}>
        <h2 className="font-semibold text-lg">Payment</h2>
        <div className="grid gap-3">
          <button
            type="button"
            disabled={!approved}
            onClick={() => onMethodChange("corporate_wallet")}
            className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${
              method === "corporate_wallet" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            }`}
          >
            <Building2 className="mt-0.5 h-4 w-4 text-primary" />
            <span>
              <span className="block font-medium">Corporate wallet</span>
              <span className="block text-xs text-muted-foreground">
                Settled instantly from your pre-funded company balance.
              </span>
            </span>
          </button>

          <button
            type="button"
            disabled={!approved || !stkAvailable}
            onClick={() => onMethodChange("mpesa")}
            className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${
              method === "mpesa" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            } ${stkAvailable ? "" : "cursor-not-allowed"}`}
          >
            <Smartphone className="mt-0.5 h-4 w-4 text-primary" />
            <span>
              <span className="block font-medium">M-Pesa STK prompt</span>
              <span className="block text-xs text-muted-foreground">
                {stkAvailable
                  ? "A payment prompt is pushed to your phone after confirmation."
                  : `Unavailable above KSh ${STK_PROMPT_CEILING_KES.toLocaleString("en-KE")} — use the wallet or a bank transfer.`}
              </span>
            </span>
          </button>

          <div
            className={`rounded-xl border p-4 ${
              method === "invoice" ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <div className="flex items-start gap-3">
              <Landmark className="mt-0.5 h-4 w-4 text-primary" />
              <div className="space-y-2">
                <p className="font-medium">Bank transfer</p>
                <p className="text-xs text-muted-foreground">
                  Email operations for the SAFARID account details, quoting {reference}.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!approved || requesting || bankRequested}
                  onClick={() => {
                    onMethodChange("invoice");
                    void requestBankTransfer();
                  }}
                >
                  {requesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {bankRequested ? "Request sent" : "Request bank transfer details"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RoadQuoteApproval;
