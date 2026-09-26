/**
 * INVOICES & PAYMENTS, INSIDE THE COMMERCIAL BOOK.
 *
 * A specialist's own read of the one invoice register — nothing is duplicated
 * here. A signed contract can be turned into a draft invoice in one step
 * (pressing it twice never raises a second), the invoice follows the existing
 * approval route, and money received is recorded as a receipt against the
 * invoice. Collected money is what counts towards the monthly target; invoiced
 * but unpaid is stated separately.
 */
import * as React from "react";
import { Banknote, FileSignature, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  KESc,
  invoiceFromContract,
  loadBillingBoard,
  loadContractsAwaitingSignature,
  type AwaitingSignatureContract,
  type BillableContract,
  type BillingBoard,
  type BillingInvoice,
} from "@/lib/sales/billing";
import {
  INVOICE_STATUS_LABEL,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  issueInvoice,
  recordReceipt,
  submitInvoice,
  type PaymentMethod,
} from "@/lib/commercial/invoice";

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

function RecordPaymentDialog({ invoice, onDone }: { invoice: BillingInvoice; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("MPESA");
  const [reference, setReference] = React.useState("");
  const [receivedOn, setReceivedOn] = React.useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Enter the amount received.");
    if (!reference.trim()) return toast.error("Enter the M-Pesa code or bank reference on the payment.");
    setBusy(true);
    try {
      await recordReceipt({
        invoice_id: invoice.invoice_id,
        amount_cents: Math.round(value * 100),
        method,
        payment_reference: reference.trim(),
        received_on: receivedOn,
      });
      toast.success("Payment recorded against this invoice.");
      setOpen(false);
      setAmount("");
      setReference("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The payment was not recorded.");
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Banknote className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record money received</DialogTitle>
          <DialogDescription>
            {invoice.customer} · {invoice.invoice_no ?? "no number yet"} · {KESc(invoice.balance_cents)} outstanding.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pay-amount" className="text-xs">
              Amount received in KSh
            </Label>
            <Input
              id="pay-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 27400"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">How it was paid</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-ref" className="text-xs">
              M-Pesa code or bank reference
            </Label>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-date" className="text-xs">
              Date received
            </Label>
            <Input id="pay-date" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />} Record payment
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContractRow({ c, onInvoiced }: { c: BillableContract; onInvoiced: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const raise = async () => {
    setBusy(true);
    try {
      const res = await invoiceFromContract(c.contract_id);
      toast[res.already_existed ? "info" : "success"](
        res.already_existed ? "This contract already has an invoice." : "Draft invoice raised from the signed contract.",
      );
      onInvoiced();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The invoice was not raised.");
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{c.customer ?? "Unnamed customer"}</p>
        <p className="text-xs text-muted-foreground">
          {c.contract_number ?? "No contract number"} ·{" "}
          {c.value_amount ? `${c.currency ?? "KES"} ${c.value_amount.toLocaleString()}` : "value not recorded"}
          {c.signed_on ? ` · signed ${new Date(c.signed_on).toLocaleDateString()}` : ""}
        </p>
      </div>
      <Button size="sm" onClick={raise} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <FileSignature className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        )}
        Raise invoice
      </Button>
    </div>
  );
}

export function BillingPanel({ staffId }: { staffId?: string | null }) {
  const [board, setBoard] = React.useState<BillingBoard | null>(null);
  const [awaiting, setAwaiting] = React.useState<AwaitingSignatureContract[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await loadBillingBoard(staffId ?? null));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Billing could not be read.");
    }
    try {
      setAwaiting(await loadContractsAwaitingSignature(staffId ?? null));
    } catch {
      // Pending contracts are supporting information; billing stands without them.
    }
    setLoading(false);
  }, [staffId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nothing was changed.");
    }
  };

  if (loading && !board) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading your invoices and payments…
      </div>
    );
  }
  if (error) return <p className="py-6 text-sm text-destructive">{error}</p>;
  if (!board) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Money collected counts towards your monthly target. Invoiced but unpaid does not.
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Collected this month" value={KESc(board.collected_month_cents)} note="Counts to target" />
        <Figure label="Collected today" value={KESc(board.collected_today_cents)} />
        <Figure label="Invoiced this month" value={KESc(board.invoiced_month_cents)} />
        <Figure
          label="Outstanding"
          value={KESc(board.outstanding_cents)}
          note={board.overdue_cents > 0 ? `${KESc(board.overdue_cents)} of it overdue` : "Nothing overdue"}
        />
      </div>

      {board.contracts_awaiting_invoice.length > 0 && (
        <Card className="border-primary/40">
          <CardContent className="space-y-2 pt-5">
            <p className="text-sm font-semibold">
              Signed contracts with no invoice ({board.contracts_awaiting_invoice.length})
            </p>
            <p className="text-xs text-muted-foreground">
              Raising the invoice here carries the contract value and number across, so the money can be collected and
              counted.
            </p>
            {board.contracts_awaiting_invoice.map((c) => (
              <ContractRow key={c.contract_id} c={c} onInvoiced={() => void load()} />
            ))}
          </CardContent>
        </Card>
      )}

      {awaiting.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="text-sm font-semibold">Sent to the customer, signature still outstanding ({awaiting.length})</p>
            <p className="text-xs text-muted-foreground">
              These cannot be invoiced and are not counted anywhere as revenue. They become billable the moment the
              signed copy is filed on the contract.
            </p>
            {awaiting.map((c) => (
              <div key={c.contract_id} className="rounded-md border p-3">
                <p className="text-sm font-medium">{c.customer ?? "Unnamed customer"}</p>
                <p className="text-xs text-muted-foreground">
                  {c.contract_number ?? "No contract number"} ·{" "}
                  {c.value_amount ? `${c.currency ?? "KES"} ${c.value_amount.toLocaleString()}` : "value not recorded"} ·
                  waiting for: {c.awaiting}
                  {c.awaiting_since ? ` · since ${new Date(c.awaiting_since).toLocaleDateString()}` : ""}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {board.invoices.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm font-semibold">No invoices held against you yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              An invoice appears here once you raise one — usually from a signed contract.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {board.invoices.map((i) => (
            <div key={i.invoice_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{i.customer}</p>
                <p className="text-xs text-muted-foreground">
                  {i.invoice_no ?? "No number yet"} · {KESc(i.total_cents)} billed · {KESc(i.paid_cents)} paid ·{" "}
                  {KESc(i.balance_cents)} outstanding
                  {i.due_date ? ` · due ${new Date(i.due_date).toLocaleDateString()}` : ""}
                  {i.contract_reference ? ` · contract ${i.contract_reference}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={i.overdue ? "destructive" : "secondary"} className="text-[10px]">
                  {i.overdue ? "Overdue" : (INVOICE_STATUS_LABEL[i.status] ?? i.status)}
                </Badge>
                {i.status === "draft" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void act(() => submitInvoice(i.invoice_id), "Sent for approval.")}
                  >
                    Send for approval
                  </Button>
                )}
                {i.status === "approved" && (
                  <Button size="sm" onClick={() => void act(() => issueInvoice(i.invoice_id), "Invoice issued.")}>
                    Issue invoice
                  </Button>
                )}
                {["issued", "sent", "part_paid"].includes(i.status) && (
                  <RecordPaymentDialog invoice={i} onDone={() => void load()} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
