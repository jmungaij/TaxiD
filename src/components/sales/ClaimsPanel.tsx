/**
 * SERVICE PROVIDER CLAIMS — the money leg after delivery.
 *
 * A fleet owner claims against an approved proof of delivery; a reviewer opens,
 * queries, rejects or approves it; an approved claim is invoiced. Every decision
 * is executed by the database, so this panel only offers what the claim's own
 * state allows and never sets an amount the reviewer did not type.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { FileCheck2 } from "lucide-react";
import {
  issueClaimInvoice,
  listClaimInvoices,
  listClaims,
  reviewClaim,
  type ServiceProviderClaim,
} from "@/lib/sales/booking";

const KES = (n: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);
const nice = (s: string) => s.split("_").join(" ").toLowerCase();

function ClaimCard({
  claim,
  invoiceRef,
  onChanged,
}: {
  claim: ServiceProviderClaim;
  invoiceRef?: string;
  onChanged: () => void;
}) {
  const [notes, setNotes] = React.useState("");
  const [amount, setAmount] = React.useState(
    claim.approved_amount_kes != null
      ? String(claim.approved_amount_kes)
      : claim.claimed_amount_kes != null
        ? String(claim.claimed_amount_kes)
        : "",
  );
  const [busy, setBusy] = React.useState(false);

  const act = (
    action: "OPEN_REVIEW" | "QUERY" | "REJECT" | "APPROVE",
    label: string,
  ) => async () => {
    setBusy(true);
    try {
      await reviewClaim({
        claimId: claim.id,
        action,
        notes: notes.trim() || undefined,
        approvedAmountKes: action === "APPROVE" && amount ? Number(amount) : undefined,
      });
      toast({ title: label });
      setNotes("");
      onChanged();
    } catch (e) {
      toast({
        title: "Not accepted",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const invoice = async () => {
    setBusy(true);
    try {
      const res = (await issueClaimInvoice(claim.id)) as { invoice_ref?: string };
      toast({ title: `Invoice issued${res.invoice_ref ? ` — ${res.invoice_ref}` : ""}` });
      onChanged();
    } catch (e) {
      toast({
        title: "Invoice not issued",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const canReview = ["SUBMITTED", "IN_REVIEW", "QUERIED"].includes(claim.state);

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-xs">{claim.claim_ref}</p>
          <p className="font-medium">{claim.customer_label ?? "Client not stated"}</p>
          <p className="text-xs text-muted-foreground">
            {claim.origin_label ?? "—"} → {claim.destination_label ?? "—"}
            {claim.service_date ? ` · ${claim.service_date}` : ""}
          </p>
        </div>
        <div className="text-right">
          <Badge variant="outline">{nice(claim.state)}</Badge>
          <p className="mt-1 text-xs text-muted-foreground">
            Claimed {claim.claimed_amount_kes != null ? KES(claim.claimed_amount_kes) : "NOT STATED"}
            {claim.approved_amount_kes != null ? ` · approved ${KES(claim.approved_amount_kes)}` : ""}
          </p>
          {invoiceRef && <p className="text-xs font-mono">{invoiceRef}</p>}
        </div>
      </div>

      {claim.service_description && (
        <p className="mt-2 text-xs text-muted-foreground">{claim.service_description}</p>
      )}
      {claim.review_notes && (
        <p className="mt-2 text-xs italic text-muted-foreground">“{claim.review_notes}”</p>
      )}

      {canReview && (
        <div className="mt-3 space-y-2 rounded-md bg-muted/30 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
            <div>
              <Label htmlFor={`n-${claim.id}`} className="text-xs">
                Reviewer note
              </Label>
              <Textarea
                id={`n-${claim.id}`}
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`a-${claim.id}`} className="text-xs">
                Amount to approve (KES)
              </Label>
              <Input
                id={`a-${claim.id}`}
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {claim.state === "SUBMITTED" && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={act("OPEN_REVIEW", "Under review")}>
                Open review
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={act("QUERY", "Query sent")}>
              Query
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={act("REJECT", "Claim rejected")}>
              Reject
            </Button>
            <Button size="sm" disabled={busy || !amount} onClick={act("APPROVE", "Claim approved")}>
              Approve
            </Button>
          </div>
        </div>
      )}

      {claim.state === "APPROVED" && !invoiceRef && (
        <div className="mt-3">
          <Button size="sm" disabled={busy} onClick={invoice}>
            Issue invoice
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ClaimsPanel({ leadId }: { leadId?: string }) {
  const claims = useQuery({
    queryKey: ["sp-claims", leadId ?? "all"],
    queryFn: () => listClaims(leadId),
  });
  const ids = (claims.data ?? []).map((c) => c.id);
  const invoices = useQuery({
    queryKey: ["sp-claim-invoices", ids.join(",")],
    queryFn: () => listClaimInvoices(ids),
    enabled: ids.length > 0,
  });

  const invoiceByClaim = new Map((invoices.data ?? []).map((i) => [i.claim_id, i.invoice_ref]));
  const refresh = () => {
    void claims.refetch();
    void invoices.refetch();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCheck2 className="h-4 w-4" aria-hidden /> Fleet owner claims
        </CardTitle>
        <CardDescription>
          Claims raised against approved proof of delivery, their review decisions and the invoices
          issued from them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {claims.isLoading && <Skeleton className="h-20 w-full" />}
        {claims.error && (
          <p className="text-sm text-muted-foreground">{(claims.error as Error).message}</p>
        )}
        {!claims.isLoading && !claims.error && (claims.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            NO CLAIMS SUBMITTED. A fleet owner can only claim once delivery proof has been approved.
          </p>
        )}
        {(claims.data ?? []).map((c) => (
          <ClaimCard key={c.id} claim={c} invoiceRef={invoiceByClaim.get(c.id)} onChanged={refresh} />
        ))}
      </CardContent>
    </Card>
  );
}
