/**
 * FLEET OWNER CLAIMS — the Fleet Owner claims payment for a completed movement.
 *
 * A claim can only be raised against delivery evidence SAFARID has already
 * approved. The claimed amount, the declaration and the movement identity are
 * all recorded; the decision, the invoice and the payment belong to SAFARID.
 */
import { useCallback, useEffect, useState } from "react";
import {
  listClaimablePods, listClaims, listClaimInvoices, listClaimPayments, submitClaim,
  type ClaimablePod, type ServiceProviderClaim, type ServiceProviderInvoice,
  type ServiceProviderPayment,
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
  ["APPROVED", "INVOICED", "PAID", "CLOSED", "SETTLED"].includes(s)
    ? "bg-status-success/10 text-status-success border-status-success/30"
    : ["REJECTED", "FAILED"].includes(s)
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : "bg-status-warning/10 text-status-warning border-status-warning/30";

export default function FleetOwnerClaims({
  carrierId,
  legalName,
}: {
  carrierId: string;
  legalName: string;
}) {
  const [pods, setPods] = useState<ClaimablePod[]>([]);
  const [claims, setClaims] = useState<ServiceProviderClaim[]>([]);
  const [invoices, setInvoices] = useState<ServiceProviderInvoice[]>([]);
  const [payments, setPayments] = useState<ServiceProviderPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [podId, setPodId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [declaration, setDeclaration] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([listClaimablePods(carrierId), listClaims()]);
      const mine = c.filter((x) => x.carrier_id === carrierId);
      setPods(p);
      setClaims(mine);
      const ids = mine.map((x) => x.id);
      const [inv, pay] = await Promise.all([listClaimInvoices(ids), listClaimPayments(ids)]);
      setInvoices(inv);
      setPayments(pay);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [carrierId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit() {
    setBusy(true);
    try {
      const res = await submitClaim({
        carrierId,
        podSubmissionId: podId,
        serviceDescription: description.trim(),
        claimedAmountKes: Number(amount),
        declarationName: declaration.trim(),
      });
      toast({
        title: "Claim submitted",
        description: `Reference ${String(res.claim_ref ?? res.reference ?? "recorded")}. SAFARID will review it.`,
      });
      setPodId("");
      setDescription("");
      setAmount("");
      setDeclaration("");
      await load();
    } catch (e) {
      toast({ title: "Claim not accepted", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const ready = podId && description.trim().length > 5 && Number(amount) > 0 && declaration.trim().length > 2;

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" aria-hidden />;

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load your claims</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Claim payment for a completed movement</CardTitle>
          <CardDescription>
            Only movements whose delivery evidence SAFARID has approved can be claimed. One claim per movement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pods.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No approved delivery evidence is waiting to be claimed.
            </p>
          ) : (
            <>
              <div>
                <Label htmlFor="clm-pod">Completed movement</Label>
                <select
                  id="clm-pod"
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={podId}
                  onChange={(e) => setPodId(e.target.value)}
                >
                  <option value="">Select a movement…</option>
                  {pods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.submission_reference} · {p.origin_label} → {p.destination_label} · delivered{" "}
                      {p.delivered_at ? new Date(p.delivered_at).toLocaleDateString() : "—"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="clm-amt">Amount claimed (KES)</Label>
                  <Input
                    id="clm-amt"
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="clm-dec">Your name (declaration)</Label>
                  <Input
                    id="clm-dec"
                    value={declaration}
                    onChange={(e) => setDeclaration(e.target.value)}
                    placeholder="Full name of the person claiming"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="clm-desc">What was carried</Label>
                <Textarea
                  id="clm-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the movement you are claiming for"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                By submitting you declare, as {legalName}, that this movement was performed by your vehicle and
                driver and that the amount claimed is correct.
              </p>
              <Button disabled={!ready || busy} onClick={() => void onSubmit()}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Submit claim
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your claims</CardTitle>
          <CardDescription>SAFARID's decision, the invoice raised and the payment recorded against it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {claims.length === 0 && <p className="text-sm text-muted-foreground">No claim submitted yet.</p>}
          {claims.map((c) => {
            const inv = invoices.find((i) => i.claim_id === c.id);
            const pay = payments.find((p) => p.claim_id === c.id);
            return (
              <div key={c.id} className="space-y-1 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{c.claim_ref}</p>
                  <Badge variant="outline" className={tone(c.state)}>{c.state.replace(/_/g, " ")}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {c.customer_label} · {c.origin_label} → {c.destination_label} · {c.service_date ?? "—"}
                </p>
                <p className="text-xs">
                  Claimed {kes(c.claimed_amount_kes)}
                  {c.approved_amount_kes !== null && ` · approved ${kes(c.approved_amount_kes)}`}
                </p>
                {c.review_notes && <p className="text-xs text-muted-foreground">Note: {c.review_notes}</p>}
                {inv && (
                  <p className="text-xs">
                    Invoice {inv.invoice_ref} · {kes(inv.amount_kes)} · {inv.state}
                  </p>
                )}
                {pay && (
                  <p className="text-xs">
                    Payment {pay.payment_ref} · {pay.state}
                    {pay.provider_reference && ` · ${pay.provider_reference}`}
                    {pay.failure_reason && ` · ${pay.failure_reason}`}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
