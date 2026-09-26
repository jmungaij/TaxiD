/**
 * TRIP PAYMENT STEP.
 *
 * The step between "a trip has been created" and "the trip is confirmed".
 * The server decides everything: asking for the payment step returns either
 *   • a cash instruction with a payment reference — the trip is NOT confirmed
 *     until SAFARID has verified a real M-Pesa or bank receipt against it, or
 *   • an authorisation on guarantee-backed credit, with the receivable and the
 *     invoice already raised.
 * Nothing here can mark a trip paid.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, Smartphone, Landmark, Info, RefreshCw } from "lucide-react";
import {
  DECISION_LABEL,
  INTENT_STATE_LABEL,
  loadPaymentChannels,
  loadPaymentIntents,
  money,
  openPaymentIntent,
  reasonText,
  type IntentState,
  type OpenIntentResult,
  type PaymentChannel,
  type PaymentMode,
} from "@/lib/corporate/payments";

interface Props {
  corporateId: string;
  amountCents: number;
  bookingId?: string | null;
  approvalId?: string | null;
  requestedMode: PaymentMode;
  /** Stable key so re-submitting the same trip never creates a second payment record. */
  idempotencyKey: string;
}

export function TripPaymentStep({
  corporateId,
  amountCents,
  bookingId,
  approvalId,
  requestedMode,
  idempotencyKey,
}: Props) {
  const [result, setResult] = useState<OpenIntentResult | null>(null);
  const [channels, setChannels] = useState<PaymentChannel[]>([]);
  const [state, setState] = useState<IntentState | null>(null);
  const [busy, setBusy] = useState(true);

  const open = useCallback(async () => {
    setBusy(true);
    const [res, ch] = await Promise.all([
      openPaymentIntent({ corporateId, amountCents, mode: requestedMode, bookingId, approvalId, idempotencyKey }),
      loadPaymentChannels().catch(() => [] as PaymentChannel[]),
    ]);
    setResult(res);
    setChannels(ch);
    setState(res.state ?? null);
    setBusy(false);
  }, [amountCents, approvalId, bookingId, corporateId, idempotencyKey, requestedMode]);

  useEffect(() => {
    void open();
  }, [open]);

  const refreshState = useCallback(async () => {
    if (!result?.reference) return;
    const rows = await loadPaymentIntents(corporateId, 50).catch(() => []);
    const row = rows.find((r) => r.reference === result.reference);
    if (row) setState(row.state);
  }, [corporateId, result?.reference]);

  if (busy) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Preparing the payment step…
        </CardContent>
      </Card>
    );
  }

  if (!result?.ok) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          The payment step could not be opened{result?.error ? `: ${result.error.split("_").join(" ")}` : "."} The trip is
          not confirmed.
        </AlertDescription>
      </Alert>
    );
  }

  const onCredit = result.mode === "CREDIT";
  const mpesa = channels.find((c) => c.channel_type === "MPESA_PAYBILL");
  const bank = channels.find((c) => c.channel_type === "BANK_ACCOUNT");

  return (
    <Card data-analytics-id="corporate-trip-payment-step">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Payment for this trip</CardTitle>
          <p className="text-sm text-muted-foreground">
            Reference <span className="font-mono">{result.reference}</span> · {money(amountCents)}
          </p>
        </div>
        <Badge variant={state === "PAYMENT_VERIFIED" || onCredit ? "default" : "secondary"}>
          {state ? INTENT_STATE_LABEL[state] : "—"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {result.decision ? (
          <p className="font-medium">{DECISION_LABEL[result.decision] ?? result.decision}</p>
        ) : null}

        {result.credit_refused ? (
          <Alert>
            <Info className="h-4 w-4" aria-hidden />
            <AlertDescription>
              Credit was requested but is not available, so this trip must be paid before it is confirmed.
            </AlertDescription>
          </Alert>
        ) : null}

        {onCredit ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Authorised on guarantee-backed credit
            </p>
            <p className="text-muted-foreground">
              The amount has been reserved against your approved credit facility, a receivable has been raised and an
              invoice has been issued on your payment terms.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {mpesa ? (
              <div className="rounded-md border border-border p-3">
                <p className="flex items-center gap-2 font-medium">
                  <Smartphone className="h-4 w-4" aria-hidden /> M-Pesa PayBill
                </p>
                <p className="mt-1 text-muted-foreground">
                  PayBill <span className="font-mono">{mpesa.paybill_number}</span> · Account{" "}
                  <span className="font-mono">{result.reference}</span> · Amount {money(amountCents)}
                </p>
              </div>
            ) : null}
            {bank ? (
              <div className="rounded-md border border-border p-3">
                <p className="flex items-center gap-2 font-medium">
                  <Landmark className="h-4 w-4" aria-hidden /> Bank transfer
                </p>
                <p className="mt-1 text-muted-foreground">
                  {bank.bank_name}, {bank.branch} · {bank.account_name} · Account{" "}
                  <span className="font-mono">{bank.account_number}</span> · Reference{" "}
                  <span className="font-mono">{result.reference}</span>
                </p>
              </div>
            ) : null}
            <p className="text-muted-foreground">
              The trip is confirmed only when SAFARID has verified a real receipt for this reference. A screenshot or a
              typed transaction number does not confirm payment.
            </p>
            <Button variant="outline" size="sm" onClick={() => void refreshState()}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Check payment status
            </Button>
          </div>
        )}

        {result.reason_codes?.length ? (
          <ul className="list-disc pl-5 text-muted-foreground">
            {result.reason_codes.map((r) => (
              <li key={r}>{reasonText(r)}</li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
