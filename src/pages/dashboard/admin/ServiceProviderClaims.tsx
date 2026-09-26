/**
 * FLEET OWNER CLAIMS REVIEW — Yalla's side of the claim chain.
 *
 * Yalla reviews the Fleet Owner's claim, approves an amount, raises the invoice
 * and authorises the payment against the verified settlement destination. The
 * receipt is only issued once real provider evidence for the money movement is
 * recorded, so nothing here can invent a payment.
 */
import { useCallback, useEffect, useState } from "react";
import {
  listClaims, listClaimInvoices, listClaimPayments, reviewClaim, issueClaimInvoice,
  authoriseClaimPayment,
  type ServiceProviderClaim, type ServiceProviderInvoice, type ServiceProviderPayment,
} from "@/lib/sales/booking";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const kes = (n: number | null) =>
  n === null || n === undefined
    ? "—"
    : `KES ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const tone = (s: string) =>
  ["APPROVED", "INVOICED", "PAID", "CLOSED"].includes(s)
    ? "bg-status-success/10 text-status-success border-status-success/30"
    : ["REJECTED", "FAILED"].includes(s)
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : "bg-status-warning/10 text-status-warning border-status-warning/30";

export default function ServiceProviderClaimsPage() {
  const [claims, setClaims] = useState<ServiceProviderClaim[]>([]);
  const [invoices, setInvoices] = useState<ServiceProviderInvoice[]>([]);
  const [payments, setPayments] = useState<ServiceProviderPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const c = await listClaims();
      setClaims(c);
      const ids = c.map((x) => x.id);
      const [inv, pay] = await Promise.all([listClaimInvoices(ids), listClaimPayments(ids)]);
      setInvoices(inv);
      setPayments(pay);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast({ title: ok });
      await load();
    } catch (e) {
      toast({ title: "Not accepted", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (loading)
    return (
      <main className="p-8">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </main>
    );

  return (
    <main className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Fleet Owner claims</h1>
        <p className="text-sm text-muted-foreground">
          Review the claim, approve the amount, raise the invoice and authorise payment. Whoever submitted a
          claim cannot decide it.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load claims</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {claims.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">No claim has been submitted.</CardContent>
        </Card>
      )}

      {claims.map((c) => {
        const inv = invoices.find((i) => i.claim_id === c.id);
        const pay = payments.find((p) => p.claim_id === c.id);
        return (
          <Card key={c.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-lg">{c.claim_ref}</CardTitle>
                <Badge variant="outline" className={tone(c.state)}>{c.state.replace(/_/g, " ")}</Badge>
              </div>
              <CardDescription>
                {c.customer_label} · {c.origin_label} → {c.destination_label} · {c.service_date ?? "—"} ·
                claimed {kes(c.claimed_amount_kes)}
                {c.approved_amount_kes !== null && ` · approved ${kes(c.approved_amount_kes)}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{c.service_description}</p>
              <p className="text-xs text-muted-foreground">
                Declared by {c.declaration_name ?? "—"}
                {c.review_notes && ` · note: ${c.review_notes}`}
              </p>

              {!["PAID", "CLOSED", "REJECTED"].includes(c.state) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`amt-${c.id}`}>Amount to approve (KES)</Label>
                    <Input
                      id={`amt-${c.id}`}
                      type="number"
                      step="0.01"
                      placeholder={String(c.claimed_amount_kes ?? "")}
                      value={amounts[c.id] ?? ""}
                      onChange={(e) => setAmounts((a) => ({ ...a, [c.id]: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`note-${c.id}`}>Decision note</Label>
                    <Textarea
                      id={`note-${c.id}`}
                      value={notes[c.id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {c.state === "SUBMITTED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === c.id}
                    onClick={() =>
                      void run(c.id, () => reviewClaim({ claimId: c.id, action: "OPEN_REVIEW", notes: notes[c.id] }), "Claim opened for review")
                    }
                  >
                    Open review
                  </Button>
                )}
                {["SUBMITTED", "ADMIN_REVIEW", "QUERY"].includes(c.state) && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy === c.id}
                      onClick={() =>
                        void run(
                          c.id,
                          () =>
                            reviewClaim({
                              claimId: c.id,
                              action: "APPROVE",
                              notes: notes[c.id],
                              approvedAmountKes: amounts[c.id] ? Number(amounts[c.id]) : undefined,
                            }),
                          "Claim approved",
                        )
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === c.id}
                      onClick={() =>
                        void run(c.id, () => reviewClaim({ claimId: c.id, action: "QUERY", notes: notes[c.id] }), "Query raised")
                      }
                    >
                      Query
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy === c.id}
                      onClick={() =>
                        void run(c.id, () => reviewClaim({ claimId: c.id, action: "REJECT", notes: notes[c.id] }), "Claim rejected")
                      }
                    >
                      Reject
                    </Button>
                  </>
                )}
                {c.state === "APPROVED" && (
                  <Button size="sm" disabled={busy === c.id} onClick={() => void run(c.id, () => issueClaimInvoice(c.id), "Invoice issued")}>
                    Issue invoice
                  </Button>
                )}
                {inv && inv.state === "ISSUED" && (
                  <Button
                    size="sm"
                    disabled={busy === c.id}
                    onClick={() => void run(c.id, () => authoriseClaimPayment(inv.id, `claim-${c.id}`), "Payment authorised")}
                  >
                    Authorise payment
                  </Button>
                )}
              </div>

              {inv && (
                <p className="text-xs">
                  Invoice {inv.invoice_ref} · {kes(inv.amount_kes)} · {inv.state}
                </p>
              )}
              {pay && (
                <p className="text-xs">
                  Payment {pay.payment_ref} · {pay.state} · to {pay.msisdn_snapshot ?? "—"}
                  {pay.provider_reference && ` · ${pay.provider_reference}`}
                  {pay.state === "AUTHORISED" && " · receipt is issued only once the M-Pesa payout evidence is recorded"}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </main>
  );
}
