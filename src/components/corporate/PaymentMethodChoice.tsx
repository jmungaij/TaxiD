/**
 * PAYMENT METHOD CHOICE (cash-first).
 *
 * Shows only the payment methods this company may actually use right now:
 *   • TaxiD M-Pesa PayBill and TaxiD bank account — always available, and a
 *     payment is never treated as received until it has been verified.
 *   • Approved corporate credit — shown ONLY when the server reports an active,
 *     verified, approved and activated bank-guarantee-backed credit facility
 *     with enough available credit for this amount.
 *
 * The browser never decides. Selecting credit re-asks the server
 * (corp_payment_decide) and displays the recorded decision and its reasons.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Info, Loader2, ShieldCheck, Landmark, Smartphone } from "lucide-react";
import {
  CREDIT_WARNING,
  DECISION_LABEL,
  loadCreditSnapshot,
  loadPaymentChannels,
  decidePayment,
  money,
  reasonText,
  type CreditSnapshot,
  type DecisionResult,
  type PaymentChannel,
  type PaymentMode,
} from "@/lib/corporate/payments";

interface Props {
  corporateId: string;
  amountCents: number;
  bookingReference?: string;
  onDecision?: (result: DecisionResult) => void;
}

export function PaymentMethodChoice({ corporateId, amountCents, bookingReference, onDecision }: Props) {
  const [channels, setChannels] = useState<PaymentChannel[]>([]);
  const [snapshot, setSnapshot] = useState<CreditSnapshot | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [decision, setDecision] = useState<DecisionResult | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      const [ch, snap] = await Promise.all([
        loadPaymentChannels().catch(() => [] as PaymentChannel[]),
        loadCreditSnapshot(corporateId),
      ]);
      if (!alive) return;
      setChannels(ch);
      setSnapshot(snap);
      setSelected(ch[0]?.id ?? "");
      setBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [corporateId]);

  const creditUsable =
    !!snapshot?.credit_available &&
    !!snapshot.facility &&
    snapshot.available_credit_cents >= amountCents;

  const choose = useCallback(
    async (value: string) => {
      setSelected(value);
      const mode: PaymentMode = value === "CREDIT" ? "CREDIT" : "CASH";
      const result = await decidePayment(corporateId, amountCents, mode);
      setDecision(result);
      onDecision?.(result);
    },
    [amountCents, corporateId, onDecision],
  );

  if (busy) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking which payment methods are available…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-analytics-id="corporate-payment-method-choice">
      <CardHeader>
        <CardTitle className="text-base">How this trip will be paid</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={selected} onValueChange={choose} className="space-y-3">
          {channels.map((c) => (
            <label
              key={c.id}
              htmlFor={`pay-${c.id}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
            >
              <RadioGroupItem id={`pay-${c.id}`} value={c.id} className="mt-1" />
              <span className="space-y-1">
                <span className="flex items-center gap-2 font-medium">
                  {c.channel_type === "MPESA_PAYBILL" ? (
                    <Smartphone className="h-4 w-4" aria-hidden />
                  ) : (
                    <Landmark className="h-4 w-4" aria-hidden />
                  )}
                  {c.display_name}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {c.channel_type === "MPESA_PAYBILL"
                    ? `PayBill ${c.paybill_number ?? "—"} · ${c.reference_instructions}`
                    : `${c.bank_name ?? ""} ${c.account_number ?? ""} · ${c.reference_instructions}`}
                </span>
                {bookingReference ? (
                  <span className="block text-sm">
                    Reference: <span className="font-mono">{bookingReference}</span> · Amount {money(amountCents)}
                  </span>
                ) : null}
              </span>
            </label>
          ))}

          {creditUsable ? (
            <label
              htmlFor="pay-credit"
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
            >
              <RadioGroupItem id="pay-credit" value="CREDIT" className="mt-1" />
              <span className="space-y-1">
                <span className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Approved corporate credit
                </span>
                <span className="block text-sm text-muted-foreground">
                  Available credit {money(snapshot!.available_credit_cents, snapshot!.facility!.currency)} · facility
                  valid to {snapshot!.facility!.expiry_date}
                </span>
              </span>
            </label>
          ) : null}
        </RadioGroup>

        {!creditUsable ? (
          <Alert>
            <Info className="h-4 w-4" aria-hidden />
            <AlertDescription>
              Corporate credit is unavailable. Pay using TaxiD M-Pesa PayBill or bank transfer.
              {snapshot?.reason_codes?.length ? ` (${snapshot.reason_codes.map(reasonText).join("; ")})` : ""}
            </AlertDescription>
          </Alert>
        ) : null}

        {decision?.decision ? (
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={decision.decision.startsWith("ALLOW") ? "default" : "secondary"}>
                {DECISION_LABEL[decision.decision]}
              </Badge>
            </div>
            {decision.reason_codes?.length ? (
              <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                {decision.reason_codes.map((r) => (
                  <li key={r}>{reasonText(r)}</li>
                ))}
              </ul>
            ) : null}
            {decision.cash_fallback ? <p className="mt-2">{decision.cash_fallback}</p> : null}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">{CREDIT_WARNING}</p>
        <p className="text-xs text-muted-foreground">
          A payment is only treated as received once TaxiD has verified it. Screenshots, transaction numbers typed in by
          hand and proforma invoices are kept as evidence for reconciliation — they never confirm payment on their own.
        </p>
      </CardContent>
    </Card>
  );
}
