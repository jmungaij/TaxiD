import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Upload, Download, ChevronRight, CreditCard } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { AsyncState } from "@/components/dashboard/AsyncState";
import AccountBalancePanel from "@/components/corporate/AccountBalancePanel";
import { chargeInvoice, money } from "@/lib/corporate/wallet";


interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  currency: string;
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  period_id: string;
}
interface Period { id: string; period_start: string; period_end: string }

interface InvoiceItem {
  id: string;
  invoice_id: string;
  line_number: number;
  description: string | null;
  employee_name: string | null;
  department: string | null;
  cost_center: string | null;
  policy_code: string | null;
  trip_origin: string | null;
  trip_destination: string | null;
  trip_started_at: string | null;
  trip_ended_at: string | null;
  quantity: number | null;
  unit_price_cents: number | null;
  taxable_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
}

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, "''")}"`;

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CorporateInvoicing({ corporateId }: { corporateId: string | null }) {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [periods, setPeriods] = useState<Record<string, Period>>({});
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [paybillRef, setPaybillRef] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Receipt (M-Pesa proof) dialog state
  const [receiptFor, setReceiptFor] = useState<Invoice | null>(null);
  const [mpesaCode, setMpesaCode] = useState("");
  const [amount, setAmount] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);
  const [balanceKey, setBalanceKey] = useState(0);
  const [chargeFor, setChargeFor] = useState<Invoice | null>(null);
  const [chargeShortfall, setChargeShortfall] = useState(0);
  const [chargePhone, setChargePhone] = useState("");
  const [chargeProgress, setChargeProgress] = useState<string | null>(null);


  const load = async () => {
    if (!corporateId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("corporate_invoices")
        .select("id,invoice_number,status,total_cents,paid_cents,balance_cents,currency,issued_at,due_at,paid_at,period_id")
        .eq("corporate_id", corporateId)
        .order("issued_at", { ascending: false });
      if (err) throw err;
      const list = (data ?? []) as Invoice[];
      setInvoices(list);

      const periodIds = Array.from(new Set(list.map(i => i.period_id).filter(Boolean)));
      if (periodIds.length > 0) {
        const { data: p, error: pErr } = await supabase
          .from("corporate_billing_periods")
          .select("id,period_start,period_end")
          .in("id", periodIds);
        if (pErr) throw pErr;
        const map: Record<string, Period> = {};
        (p ?? []).forEach(x => { map[x.id] = x as Period; });
        setPeriods(map);
      }

      // Per-trip charge breakdown for every visible invoice.
      if (list.length > 0) {
        const { data: li, error: liErr } = await supabase
          .from("corporate_invoice_items")
          .select("id,invoice_id,line_number,description,employee_name,department,cost_center,policy_code,trip_origin,trip_destination,trip_started_at,trip_ended_at,quantity,unit_price_cents,taxable_cents,tax_cents,total_cents")
          .in("invoice_id", list.map(i => i.id))
          .order("line_number", { ascending: true });
        if (liErr) throw liErr;
        setItems((li ?? []) as InvoiceItem[]);
      } else {
        setItems([]);
      }

      const { data: corp } = await supabase
        .from("corporate_accounts").select("paybill_reference").eq("id", corporateId).maybeSingle();
      setPaybillRef(corp?.paybill_reference ?? `CORP-${corporateId.slice(0, 8).toUpperCase()}`);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load invoices.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [corporateId]);

  const itemsByInvoice = useMemo(() => {
    const m = new Map<string, InvoiceItem[]>();
    for (const it of items) {
      const arr = m.get(it.invoice_id) ?? [];
      arr.push(it);
      m.set(it.invoice_id, arr);
    }
    return m;
  }, [items]);

  const fmt = (cents: number | null | undefined, cur = "KES") =>
    `${cur} ${((cents ?? 0) / 100).toLocaleString()}`;

  function exportInvoiceHistory() {
    const header = [
      "invoice_number", "status", "period_start", "period_end", "currency",
      "total_cents", "paid_cents", "balance_cents", "issued_at", "due_at", "paid_at", "line_count",
    ];
    const rows = invoices.map(inv => {
      const p = periods[inv.period_id];
      return [
        inv.invoice_number, inv.status, p?.period_start ?? "", p?.period_end ?? "", inv.currency,
        inv.total_cents, inv.paid_cents, inv.balance_cents,
        inv.issued_at ?? "", inv.due_at ?? "", inv.paid_at ?? "",
        (itemsByInvoice.get(inv.id) ?? []).length,
      ];
    });
    downloadCsv(`corporate-invoice-history-${paybillRef || "account"}.csv`, [header, ...rows]);
  }

  function exportChargeBreakdown(only?: Invoice) {
    const scope = only ? [only] : invoices;
    const header = [
      "invoice_number", "line_number", "description", "employee", "department", "cost_center",
      "policy_code", "trip_origin", "trip_destination", "trip_started_at", "trip_ended_at",
      "quantity", "unit_price_cents", "taxable_cents", "tax_cents", "total_cents",
    ];
    const rows: (string | number)[][] = [];
    for (const inv of scope) {
      for (const it of itemsByInvoice.get(inv.id) ?? []) {
        rows.push([
          inv.invoice_number, it.line_number, it.description ?? "", it.employee_name ?? "",
          it.department ?? "", it.cost_center ?? "", it.policy_code ?? "",
          it.trip_origin ?? "", it.trip_destination ?? "",
          it.trip_started_at ?? "", it.trip_ended_at ?? "",
          it.quantity ?? 0, it.unit_price_cents ?? 0, it.taxable_cents ?? 0,
          it.tax_cents ?? 0, it.total_cents ?? 0,
        ]);
      }
    }
    if (rows.length === 0) {
      toast({ title: "Nothing to export", description: "No trip charge lines are attached to these invoices yet." });
      return;
    }
    downloadCsv(
      only ? `charges-${only.invoice_number}.csv` : `corporate-trip-charges-${paybillRef || "account"}.csv`,
      [header, ...rows],
    );
  }

  function openReceipt(inv: Invoice) {
    setReceiptFor(inv);
    setMpesaCode("");
    setPayerPhone("");
    setPaidAt("");
    setFile(null);
    setAmount(((inv.balance_cents || inv.total_cents) / 100).toString());
  }

  /**
   * Charges an invoice for real: the funded balance is applied first and any
   * shortfall is collected with a live M-Pesa prompt to the phone entered.
   */
  async function chargeNow(inv: Invoice, phone?: string) {
    setSettling(inv.id);
    setChargeProgress(null);
    try {
      const result = await chargeInvoice({ invoiceId: inv.id, phone }, setChargeProgress);

      if (result.state === "needs_phone") {
        setChargeFor(inv);
        setChargeShortfall(result.shortfallCents);
        setChargePhone(phone ?? "");
        return;
      }

      if (result.state === "failed") {
        toast({ title: "Invoice not charged", description: result.message, variant: "destructive" });
        return;
      }

      if (result.state === "collection_pending") {
        toast({ title: "Payment still confirming", description: result.message });
      } else {
        const s = result.settlement;
        toast({
          title: result.state === "settled" ? "Invoice paid" : "Part payment applied",
          description:
            (result.collectedCents > 0
              ? `${money(result.collectedCents, inv.currency)} collected by M-Pesa. `
              : "") +
            `${money(s.appliedCents, inv.currency)} applied. ` +
            `Outstanding ${money(s.outstandingCents, inv.currency)}, ` +
            `balance now ${money(s.balanceCents, inv.currency)}.`,
        });
        setChargeFor(null);
        setChargePhone("");
      }

      setBalanceKey((k) => k + 1);
      await load();
    } catch (e) {
      toast({ title: "Invoice not charged", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSettling(null);
      setChargeProgress(null);
    }
  }


  async function submitReceipt() {
    if (!receiptFor || !corporateId || !user) return;
    const cents = Math.round(parseFloat(amount) * 100);
    if (!mpesaCode.trim()) {
      toast({ title: "M-Pesa code required", description: "Enter the confirmation code from your payment.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(cents) || cents <= 0) {
      toast({ title: "Amount required", description: "Enter the amount you paid.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      let proofPath: string | null = null;
      if (file) {
        const path = `${corporateId}/${receiptFor.invoice_number}-${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const up = await supabase.storage.from("paybill-proofs")
          .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (up.error) throw up.error;
        proofPath = path;
      }
      const { error: insErr } = await supabase.from("corporate_paybill_proofs").insert({
        corporate_id: corporateId,
        mpesa_code: mpesaCode.trim().toUpperCase(),
        amount_cents: cents,
        payer_phone: payerPhone.trim() || null,
        paid_at: paidAt ? new Date(paidAt).toISOString() : null,
        proof_file_path: proofPath,
        paybill_reference: `${paybillRef}/${receiptFor.invoice_number}`,
        submitted_by: user.id,
      });
      if (insErr) {
        // Keep storage and database consistent when the ledger insert is rejected.
        if (proofPath) await supabase.storage.from("paybill-proofs").remove([proofPath]);
        throw insErr;
      }
      toast({
        title: "Receipt submitted",
        description: `Payment against ${receiptFor.invoice_number} is queued for finance verification.`,
      });
      setReceiptFor(null);
    } catch (e) {
      toast({ title: "Could not submit receipt", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2"><FileText className="h-5 w-5" />Corporate Invoicing</h2>
          <p className="text-sm text-muted-foreground">
            Settlement invoices generated per billing period. Expand an invoice for the per-trip charge breakdown, or
            upload the M-Pesa receipt to close it out.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1" onClick={exportInvoiceHistory} disabled={invoices.length === 0}>
            <Download className="h-3.5 w-3.5" />Invoice history CSV
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => exportChargeBreakdown()} disabled={invoices.length === 0}>
            <Download className="h-3.5 w-3.5" />Trip charges CSV
          </Button>
        </div>
      </div>
      <AccountBalancePanel key={balanceKey} corporateId={corporateId} onSettled={load} />

      <AsyncState
        loading={loading}
        error={error}
        isEmpty={!loading && !error && invoices.length === 0}
        emptyTitle="No invoices yet"
        emptyMessage="Settlements are generated automatically at the end of each billing period."
        onRetry={load}
      >
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-8" />
              <TableHead>#</TableHead>
              <TableHead>Settlement period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Pending</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {invoices.map(inv => {
                const p = periods[inv.period_id];
                const lines = itemsByInvoice.get(inv.id) ?? [];
                const isOpen = expanded === inv.id;
                return (
                  <Fragment key={inv.id}>
                    <TableRow>
                      <TableCell className="p-0 pl-2">
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7"
                          aria-label={isOpen ? `Hide charges for ${inv.invoice_number}` : `Show charges for ${inv.invoice_number}`}
                          onClick={() => setExpanded(isOpen ? null : inv.id)}
                        >
                          <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                      <TableCell className="text-sm">{p ? `${p.period_start} → ${p.period_end}` : "—"}</TableCell>
                      <TableCell><Badge variant={inv.status === "PAID" ? "default" : "secondary"} className="capitalize">{inv.status.toLowerCase()}</Badge></TableCell>
                      <TableCell>{fmt(inv.total_cents, inv.currency)}</TableCell>
                      <TableCell>{fmt(inv.paid_cents, inv.currency)}</TableCell>
                      <TableCell>{fmt(inv.balance_cents, inv.currency)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" className="gap-1" onClick={() => exportChargeBreakdown(inv)} disabled={lines.length === 0}>
                          <Download className="h-3 w-3" />CSV
                        </Button>
                        {inv.status !== "PAID" && inv.status !== "VOIDED" && (
                          <Button
                            size="sm" className="gap-1 ml-1"
                            onClick={() => chargeNow(inv)}
                            disabled={settling === inv.id}
                          >
                            <CreditCard className="h-3 w-3" />
                            {settling === inv.id ? "Charging…" : "Charge now"}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="gap-1 ml-1" onClick={() => openReceipt(inv)}>
                          <Upload className="h-3 w-3" />Upload receipt
                        </Button>

                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30">
                          {lines.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">No trip charge lines attached to this invoice.</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="text-muted-foreground uppercase">
                                  <tr>
                                    <th className="text-left py-1 pr-3">#</th>
                                    <th className="text-left py-1 pr-3">Trip</th>
                                    <th className="text-left py-1 pr-3">Rider</th>
                                    <th className="text-left py-1 pr-3">Department</th>
                                    <th className="text-left py-1 pr-3">Cost centre</th>
                                    <th className="text-right py-1 pr-3">Net</th>
                                    <th className="text-right py-1 pr-3">Tax</th>
                                    <th className="text-right py-1">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lines.map(it => (
                                    <tr key={it.id} className="border-t border-border/50">
                                      <td className="py-1 pr-3 font-mono">{it.line_number}</td>
                                      <td className="py-1 pr-3">
                                        {it.trip_origin || it.trip_destination
                                          ? `${it.trip_origin ?? "—"} → ${it.trip_destination ?? "—"}`
                                          : (it.description ?? "—")}
                                      </td>
                                      <td className="py-1 pr-3">{it.employee_name ?? "—"}</td>
                                      <td className="py-1 pr-3">{it.department ?? "—"}</td>
                                      <td className="py-1 pr-3">{it.cost_center ?? "—"}</td>
                                      <td className="py-1 pr-3 text-right">{fmt(it.taxable_cents, inv.currency)}</td>
                                      <td className="py-1 pr-3 text-right">{fmt(it.tax_cents, inv.currency)}</td>
                                      <td className="py-1 text-right font-semibold">{fmt(it.total_cents, inv.currency)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </AsyncState>

      <Dialog
        open={!!chargeFor}
        onOpenChange={(o) => { if (!o && settling === null) { setChargeFor(null); setChargePhone(""); } }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Collect the shortfall by M-Pesa</DialogTitle>
            <DialogDescription>
              The account balance does not cover invoice{" "}
              <span className="font-mono">{chargeFor?.invoice_number}</span> in full. We will request{" "}
              {money(chargeShortfall, chargeFor?.currency ?? "KES")} from the phone below, then apply it to the invoice
              as soon as M-Pesa confirms.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Paying phone number</Label>
            <Input value={chargePhone} onChange={(e) => setChargePhone(e.target.value)} placeholder="0712 345 678" />
            {chargeProgress && <p className="text-xs text-muted-foreground">{chargeProgress}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChargeFor(null)} disabled={settling !== null}>Cancel</Button>
            <Button
              onClick={() => chargeFor && chargeNow(chargeFor, chargePhone)}
              disabled={settling !== null || chargePhone.trim().length < 9}
            >
              {settling !== null ? "Waiting for M-Pesa…" : "Send payment request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receiptFor} onOpenChange={(o) => !o && setReceiptFor(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Upload payment receipt</DialogTitle>
            <DialogDescription>
              Settle <span className="font-mono">{receiptFor?.invoice_number}</span> by submitting your M-Pesa Paybill
              confirmation. Finance verifies the proof and posts it against the invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">M-Pesa code *</Label>
              <Input value={mpesaCode} onChange={e => setMpesaCode(e.target.value)} placeholder="QXY1ABC23D" />
            </div>
            <div>
              <Label className="text-xs">Amount (KES) *</Label>
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Payer phone</Label>
              <Input value={payerPhone} onChange={e => setPayerPhone(e.target.value)} placeholder="2547…" />
            </div>
            <div>
              <Label className="text-xs">Paid at</Label>
              <Input type="datetime-local" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Receipt file (optional)</Label>
              <Input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReceiptFor(null)}>Cancel</Button>
            <Button onClick={submitReceipt} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit for verification"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
