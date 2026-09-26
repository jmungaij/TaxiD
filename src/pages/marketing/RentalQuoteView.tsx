/**
 * RENTAL QUOTATION — the customer's private copy of a priced rental.
 *
 * Opened with the link token issued when the quote was created. Everything on
 * this page is read back from the stored quotation, so the figure shown is the
 * figure the platform recorded against the published rate card.
 *
 * Payment: the customer pays the full quoted amount to the Yalla paybill using
 * the quotation reference. Confirmation is never taken from the browser — the
 * server matches the quotation against the verified M-Pesa ledger, which only
 * Safaricom's signed callback writes.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, Copy, Loader2, Printer, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CONTACT, PHONE_TEL } from "@/config/contact";
import { YALLA_PAYBILL } from "@/lib/payments/checkout";
import { kes } from "@/lib/marketing/publicRateCard";
import { confirmRentalPayment, openRentalQuote, type RentalQuoteView as Quote } from "@/lib/marketing/rentalQuote";

const dateLong = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" });

const stamp = (iso: string) =>
  iso ? new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function RentalQuoteView() {
  const { token = "" } = useParams<{ token: string }>();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const view = await openRentalQuote(token);
    setQuote(view);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkPayment = async () => {
    if (!quote || checking) return;
    setChecking(true);
    setNotice(null);
    const outcome = await confirmRentalPayment(quote.reference);
    if (outcome.settled === true) {
      toast.success("Payment confirmed — your rental is booked.");
      await load();
    } else {
      setNotice(outcome.message);
    }
    setChecking(false);
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed — please note it manually.");
    }
  };

  if (loading) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-16">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-40 w-full" />
        <Skeleton className="mt-4 h-40 w-full" />
      </main>
    );
  }

  if (!quote) {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-20 text-center">
        <Helmet>
          <title>Quotation not found | Yalla Mobility</title>
          <meta name="robots" content="noindex" />
        </Helmet>
        <h1 className="text-2xl font-semibold">We could not open this quotation</h1>
        <p className="mt-3 text-muted-foreground">
          The link may be incomplete or the quotation may have been removed. Call{" "}
          <a href={PHONE_TEL} className="text-primary underline">
            {CONTACT.phoneDisplay}
          </a>{" "}
          and we will re-issue it.
        </p>
        <Button asChild className="mt-6">
          <Link to="/rentals/self-drive">Back to rentals</Link>
        </Button>
      </main>
    );
  }

  const paid = quote.paymentStatus === "paid";
  const categoryLabel = quote.category === "SELF_DRIVE" ? "Self-drive rental" : "Chauffeured rental";

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <Helmet>
        <title>{`Quotation ${quote.reference} | Yalla Mobility`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="flex items-center justify-between gap-4 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link to={quote.category === "SELF_DRIVE" ? "/rentals/self-drive" : "/rentals/chauffeur"}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Rentals
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> Print / save as PDF
        </Button>
      </div>

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={paid ? "default" : "secondary"}>{paid ? "Booked" : quote.expired ? "Expired" : "Quotation"}</Badge>
          <span className="text-sm text-muted-foreground">Reference {quote.reference}</span>
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          {categoryLabel} — {quote.bandLabel}
          {quote.seats ? ` (${quote.seats} seats)` : ""}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Priced from rate card v{quote.pricingVersion}. Issued {stamp(quote.createdAt)}.
        </p>
      </header>

      {paid ? (
        <Alert className="mt-6">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>
              Payment of {kes(quote.amountPaidKes)} received
              {quote.mpesaReceipt ? ` (M-Pesa ${quote.mpesaReceipt})` : ""}.
              {quote.booking
                ? ` Your booking reference is ${quote.booking.bookingReference}.`
                : " Our team will confirm vehicle handover details with you on " + quote.contactPhone + "."}
            </p>
            {quote.booking?.vehicle ? (
              <p>
                Reserved for you: {quote.booking.vehicle.make} {quote.booking.vehicle.model}
                {quote.booking.vehicle.year ? ` (${quote.booking.vehicle.year})` : ""}
                {quote.booking.vehicle.transmission ? ` · ${quote.booking.vehicle.transmission.toLowerCase()}` : ""}
                {quote.booking.vehicle.seats ? ` · ${quote.booking.vehicle.seats} seats` : ""}. We will confirm handover
                details on {quote.contactPhone}.
              </p>
            ) : null}
            <Button asChild size="sm" variant="outline" className="print:hidden">
              <Link to="/rider/rentals">Manage this rental</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : quote.expired ? (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This quotation stood until {stamp(quote.expiresAt)}. Request a fresh quote so you are charged the current
            published rate.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="mt-6">
          <Clock className="h-4 w-4" />
          <AlertDescription>This quotation stands until {stamp(quote.expiresAt)}.</AlertDescription>
        </Alert>
      )}

      {/* -------------------------------- the rental ------------------------- */}
      <section className="mt-8 rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Your rental</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">Collection</dt>
            <dd className="font-medium">{dateLong(quote.startDate)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Return</dt>
            <dd className="font-medium">{dateLong(quote.endDate)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Duration</dt>
            <dd className="font-medium">
              {quote.rentalDays} day{quote.rentalDays === 1 ? "" : "s"}
              {quote.extraHours > 0 ? ` + ${quote.extraHours} extra hour${quote.extraHours === 1 ? "" : "s"}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Distance</dt>
            <dd className="font-medium">
              {quote.expectedKm} km planned · {quote.includedKmTotal} km included
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-muted-foreground">
              {quote.category === "SELF_DRIVE" ? "Collection or delivery" : "Pick-up"}
            </dt>
            <dd className="font-medium">{quote.pickupLocation}</dd>
          </div>
          {quote.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">Your notes</dt>
              <dd>{quote.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* --------------------------------- pricing --------------------------- */}
      <section className="mt-6 rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">What it costs</h2>
        <table className="mt-4 w-full text-sm">
          <tbody>
            {(quote.lines.length > 0
              ? quote.lines
              : [
                  { code: "DAILY_RATE", label: "Rental", amount_kes: quote.baseKes },
                  ...(quote.extraHoursKes > 0
                    ? [{ code: "EXTRA_HOURS", label: "Extra hours", amount_kes: quote.extraHoursKes }]
                    : []),
                  ...(quote.excessKmKes > 0
                    ? [{ code: "EXCESS_KM", label: "Excess distance", amount_kes: quote.excessKmKes }]
                    : []),
                  { code: "VAT", label: "VAT", amount_kes: quote.vatKes },
                ]
            ).map((line) => (
              <tr key={line.code} className="border-b last:border-0">
                <td className="py-2 pr-4">{line.label}</td>
                <td className="py-2 text-right font-medium">{kes(line.amount_kes)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-4 text-base font-semibold">Total payable</td>
              <td className="pt-4 text-right text-2xl font-bold">{kes(quote.totalKes)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          Figures are the platform's own record for this quotation, calculated from published rate card v
          {quote.pricingVersion}. Fuel is the renter's responsibility unless your agreement states otherwise.
        </p>
      </section>

      {/* --------------------------------- payment --------------------------- */}
      {!paid && !quote.expired ? (
        <section className="mt-6 rounded-xl border bg-card p-6 print:hidden">
          <h2 className="text-lg font-semibold">Pay to confirm</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Pay the full quoted amount by M-Pesa, then check the payment below. Your booking is confirmed the moment
            Safaricom confirms the payment to us — we never mark it paid from this page.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-secondary/40 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Paybill</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-lg font-semibold">{YALLA_PAYBILL}</p>
                <Button variant="ghost" size="icon" onClick={() => copy(YALLA_PAYBILL, "Paybill")} aria-label="Copy paybill">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="rounded-lg border bg-secondary/40 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Account number</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-lg font-semibold">{quote.reference}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copy(quote.reference, "Reference")}
                  aria-label="Copy account number"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="rounded-lg border bg-secondary/40 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount</p>
              <p className="mt-1 text-lg font-semibold">{kes(quote.totalKes)}</p>
            </div>
          </div>

          <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>On your phone, open M-Pesa → Lipa na M-Pesa → Pay Bill.</li>
            <li>
              Business number {YALLA_PAYBILL}, account number {quote.reference}.
            </li>
            <li>Enter {kes(quote.totalKes)} and confirm with your PIN.</li>
            <li>Come back here and press “I have paid — check now”.</li>
          </ol>

          {notice ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={checkPayment} disabled={checking} size="lg">
              {checking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking with M-Pesa
                </>
              ) : (
                "I have paid — check now"
              )}
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> Proforma invoice for bank transfer
            </Button>
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Paying by bank transfer instead? Print this quotation as your proforma invoice and email it to{" "}
            <a href={`mailto:${CONTACT.salesEmail}`} className="underline">
              {CONTACT.salesEmail}
            </a>{" "}
            — the commercial desk will confirm your booking once the funds clear.
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Quotation issued to</h2>
        <p className="mt-2">
          {quote.contactName}
          {quote.companyName ? ` · ${quote.companyName}` : ""}
        </p>
        <p className="text-sm text-muted-foreground">
          {quote.contactEmail} · {quote.contactPhone}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          Questions? Call{" "}
          <a href={PHONE_TEL} className="text-primary underline">
            {CONTACT.phoneDisplay}
          </a>{" "}
          or email{" "}
          <a href={`mailto:${CONTACT.salesEmail}`} className="text-primary underline">
            {CONTACT.salesEmail}
          </a>
          .
        </p>
      </section>
    </main>
  );
}
