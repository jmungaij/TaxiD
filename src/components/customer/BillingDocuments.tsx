/**
 * MY DOCUMENTS — the customer-facing billing panel.
 *
 * Shows issued proformas and invoices with what is owed, the payments recorded
 * against them, and lets the customer confirm they received a document.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { BadgeCheck, Banknote, FileSignature, FileText, ReceiptText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  cents,
  confirmDocumentReceipt,
  fetchCustomerBilling,
  totalOutstanding,
  type BillingLine,
  type ConfirmableKind,
} from "@/lib/customer/billing";
import { statusTone } from "@/lib/customer/portal";

const d = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "—";

function Lines({ lines, currency }: { lines: BillingLine[]; currency: string }) {
  if (!lines?.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {lines.map((l, i) => (
        <li key={i} className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {l.description ?? "Service"}
            {l.qty ? ` · ${l.qty}` : ""}
          </span>
          <span className="tabular-nums">{cents(l.amount_cents, currency)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function BillingDocuments() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["customer-billing"],
    queryFn: fetchCustomerBilling,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });

  const confirm = useMutation({
    mutationFn: (args: { kind: ConfirmableKind; id: string }) =>
      confirmDocumentReceipt(args.kind, args.id),
    onSuccess: (r) => {
      toast({
        title: r.already_confirmed ? "Already confirmed" : "Receipt confirmed",
        description: `${r.document_no} is recorded as received.`,
      });
      void qc.invalidateQueries({ queryKey: ["customer-billing"] });
    },
    onError: (e: Error) => toast({ title: "Not confirmed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-48 w-full rounded-2xl" />;
  if (error) return null;

  const b = data!;
  const nothing =
    !b.invoices.length && !b.proformas.length && !b.receipts.length && !b.agreements.length;
  const owed = totalOutstanding(b.invoices);
  const s = b.summary;
  const nextStepInvoice = b.invoices.find((i) => i.balance_cents > 0 && i.next_step);

  return (
    <div className="space-y-4">
    {b.invoices.length ? (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="h-4 w-4 text-primary" aria-hidden /> My account
          </CardTitle>
          <CardDescription>
            Live figures for your account, updated as payments are recorded.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="text-lg font-semibold tabular-nums">{cents(s.overdue_cents)}</p>
            <p className="text-xs text-muted-foreground">
              {s.overdue_count} invoice{s.overdue_count === 1 ? "" : "s"} past due
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total owing</p>
            <p className="text-lg font-semibold tabular-nums">{cents(s.outstanding_cents)}</p>
            <p className="text-xs text-muted-foreground">
              {s.next_due_date ? `Next due ${d(s.next_due_date)}` : "Nothing due"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Payments received</p>
            <p className="text-lg font-semibold tabular-nums">{cents(s.paid_cents)}</p>
            <p className="text-xs text-muted-foreground">
              {s.last_payment_on ? `Last on ${d(s.last_payment_on)}` : "No payment yet"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Next step</p>
            {nextStepInvoice?.next_step ? (
              <>
                <p className="text-sm font-semibold capitalize">
                  {nextStepInvoice.next_step.action_type ?? "Follow up"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {nextStepInvoice.document_no}
                  {nextStepInvoice.next_step.due_on ? ` · ${d(nextStepInvoice.next_step.due_on)}` : ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {s.outstanding_cents > 0 ? "Awaiting your payment" : "Nothing outstanding"}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    ) : null}
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="h-4 w-4 text-primary" aria-hidden /> My documents
          </CardTitle>
          <CardDescription>
            Your proformas, invoices and the payments we have received from you.
          </CardDescription>
        </div>
        {b.invoices.length ? (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-lg font-semibold tabular-nums">{cents(owed)}</p>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {nothing ? (
          <p className="text-sm text-muted-foreground">
            No invoice or proforma has been issued to you yet.
          </p>
        ) : null}

        {b.proformas.length ? (
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-muted-foreground" aria-hidden /> Proforma invoices
            </h3>
            {b.proformas.map((p) => (
              <div key={p.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{p.document_no}</p>
                    <p className="text-xs text-muted-foreground">
                      Issued {d(p.issue_date)}
                      {p.valid_until ? ` · valid until ${d(p.valid_until)}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{cents(p.total_cents, p.currency)}</p>
                    <Badge variant="outline" className={statusTone(p.status)}>{p.status}</Badge>
                  </div>
                </div>
                <Lines lines={p.lines} currency={p.currency} />
                <div className="mt-3 flex items-center gap-2">
                  {p.confirmed_at ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> You confirmed receipt on {d(p.confirmed_at)}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={confirm.isPending}
                      onClick={() => confirm.mutate({ kind: "proforma", id: p.id })}
                    >
                      Confirm receipt
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {b.invoices.length ? (
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <ReceiptText className="h-4 w-4 text-muted-foreground" aria-hidden /> Invoices
            </h3>
            {b.invoices.map((i) => (
              <div key={i.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{i.document_no}</p>
                    <p className="text-xs text-muted-foreground">
                      Issued {d(i.issue_date)} · due {d(i.due_date)}
                      {i.lpo_reference ? ` · your reference ${i.lpo_reference}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{cents(i.total_cents, i.currency)}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Paid {cents(i.paid_cents, i.currency)} · owing {cents(i.balance_cents, i.currency)}
                    </p>
                    <Badge variant="outline" className={statusTone(i.status)}>{i.status}</Badge>
                  </div>
                </div>
                <Lines lines={i.lines} currency={i.currency} />
                <div className="mt-3 flex items-center gap-2">
                  {i.confirmed_at ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> You confirmed receipt on {d(i.confirmed_at)}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={confirm.isPending}
                      onClick={() => confirm.mutate({ kind: "invoice", id: i.id })}
                    >
                      Confirm receipt
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {b.receipts.length ? (
          <section className="space-y-2">
            <Separator />
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Banknote className="h-4 w-4 text-muted-foreground" aria-hidden /> Payments received
            </h3>
            {b.receipts.map((r) => (
              <div key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span>
                  {r.document_no}
                  {r.invoice_no ? ` · against ${r.invoice_no}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {d(r.received_on)}
                  {r.method ? ` · ${r.method}` : ""}
                </span>
                <span className="tabular-nums">{cents(r.amount_cents, r.currency)}</span>
              </div>
            ))}
          </section>
        ) : null}

        {b.agreements.length ? (
          <section className="space-y-2">
            <Separator />
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <FileSignature className="h-4 w-4 text-muted-foreground" aria-hidden /> Your agreement record
            </h3>
            {b.agreements.map((a) => (
              <div key={a.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{a.kind}</p>
                  <span className="text-xs text-muted-foreground">{d(a.recorded_at)}</span>
                </div>
                {a.reference ? <p className="text-xs text-muted-foreground">{a.reference}</p> : null}
                {a.note ? <p className="mt-1 text-xs text-muted-foreground">{a.note}</p> : null}
              </div>
            ))}
          </section>
        ) : null}
      </CardContent>
    </Card>
    </div>
  );
}
