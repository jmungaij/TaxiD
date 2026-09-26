/**
 * CREDIT STATUS (company facing).
 *
 * Shows the company's authoritative payment position: whether guarantee-backed
 * credit exists at all, how much is available, the guarantee behind it, and what
 * is still awaiting payment. Every figure is returned by the server
 * (corp_credit_snapshot / v_corporate_payment_position) — nothing is computed here.
 * When there is no active guarantee the card says plainly that trips are cash-first.
 */
import { useCallback, useEffect, useState } from "react";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, Info } from "lucide-react";
import { CREDIT_UNAVAILABLE_MESSAGE, loadCreditSnapshot, money, reasonText, type CreditSnapshot } from "@/lib/corporate/payments";

interface Position {
  awaiting_payment: number;
  paid_trips: number;
  credit_trips: number;
  awaiting_cents: number;
  outstanding_receivable_cents: number;
}

export function CreditStatusCard({ corporateId }: { corporateId: string }) {
  const [snap, setSnap] = useState<CreditSnapshot | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, p] = await Promise.all([
      loadCreditSnapshot(corporateId),
      untypedDb.from("v_corporate_payment_position").select("*").eq("corporate_id", corporateId).maybeSingle(),
    ]);
    setSnap(s);
    setPos((p.data ?? null) as Position | null);
    setLoading(false);
  }, [corporateId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your payment position…
        </CardContent>
      </Card>
    );
  }

  const usable = !!snap?.credit_available && !!snap?.facility;

  return (
    <Card data-analytics-id="corporate-credit-status">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Payment &amp; credit status</CardTitle>
        <Badge variant={usable ? "default" : "secondary"}>{usable ? "Credit available" : "Cash-first"}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {usable ? (
          <>
            <p className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              {money(snap!.available_credit_cents, snap!.facility!.currency)} available to spend on credit
            </p>
            <dl className="grid gap-1 text-muted-foreground sm:grid-cols-2">
              <div className="flex justify-between gap-2 sm:col-span-2">
                <dt>Approved credit limit</dt>
                <dd>{money(snap!.facility!.approved_credit_limit_cents, snap!.facility!.currency)}</dd>
              </div>
              <div className="flex justify-between gap-2 sm:col-span-2">
                <dt>Already used</dt>
                <dd>{money(snap!.facility!.utilized_credit_cents, snap!.facility!.currency)}</dd>
              </div>
              <div className="flex justify-between gap-2 sm:col-span-2">
                <dt>Facility valid to</dt>
                <dd>{snap!.facility!.expiry_date}</dd>
              </div>
              {snap!.guarantee ? (
                <div className="flex justify-between gap-2 sm:col-span-2">
                  <dt>Bank guarantee</dt>
                  <dd>
                    {snap!.guarantee!.issuing_bank ?? "Bank"} ·{" "}
                    {money(snap!.guarantee!.amount_cents, snap!.guarantee!.currency)} · expires{" "}
                    {snap!.guarantee!.expiry_date}
                  </dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : (
          <Alert>
            <Info className="h-4 w-4" aria-hidden />
            <AlertDescription>
              {CREDIT_UNAVAILABLE_MESSAGE}
              {snap?.reason_codes?.length ? ` (${snap.reason_codes.map(reasonText).join("; ")})` : ""}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-2 rounded-md border border-border p-3 text-muted-foreground sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <span>Trips awaiting payment</span>
            <span>
              {pos?.awaiting_payment ?? 0} · {money(pos?.awaiting_cents ?? 0)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Paid and verified</span>
            <span>{pos?.paid_trips ?? 0}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>On credit</span>
            <span>{pos?.credit_trips ?? 0}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Outstanding on invoice</span>
            <span>{money(pos?.outstanding_receivable_cents ?? 0)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
