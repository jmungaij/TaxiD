/**
 * Tax invoices and receipts — /staff/commercial/invoices
 *
 * Staff key the customer and the priced items; the system does the arithmetic,
 * an approver signs the invoice off, the official number is issued and the
 * document is emailed. Money received is recorded as a receipt against the
 * invoice, which prints on the same letterhead.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Download, FileText, Loader2, Plus, Receipt, Send, ShieldAlert, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { toneClasses } from "@/lib/design/statusTone";
import { cn } from "@/lib/utils";
import {
  INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, PAYMENT_METHODS, PAYMENT_METHOD_LABEL,
  cancelInvoice, computeTotals, decideInvoice, getInvoice, issueInvoice, listInvoices, money,
  recordReceipt, saveInvoice, sendDocument, submitInvoice,
  type Invoice, type InvoiceLine, type InvoiceList, type PaymentMethod, type PaymentReceipt,
} from "@/lib/commercial/invoice";
import {
  buildInvoicePdf, buildReceiptPdf, invoicePdfFilename, receiptPdfFilename, sha256Hex,
} from "@/lib/commercial/invoicePdf";

const blankLine = (): InvoiceLine => ({ description: "", qty: 1, unit_rate_cents: 0, service_date: null, vehicle_category: null });

const badgeTone = (tone: string) => {
  const t = toneClasses(tone);
  return cn(t.bg, t.text, t.border, "border");
};

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

interface FormState {
  customer_company: string;
  customer_contact_person: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  customer_pin: string;
  customer_ref: string;
  lpo_reference: string;
  quote_reference: string;
  contract_reference: string;
  service_from: string;
  service_to: string;
  due_date: string;
  payment_terms: string;
  currency: string;
  vat_rate: number;
  vat_inclusive: boolean;
  notes: string;
  authorised_name: string;
  authorised_title: string;
  lines: InvoiceLine[];
}

const emptyForm = (): FormState => ({
  customer_company: "", customer_contact_person: "", customer_email: "", customer_phone: "",
  customer_address: "", customer_pin: "", customer_ref: "", lpo_reference: "",
  quote_reference: "", contract_reference: "", service_from: "", service_to: "", due_date: "",
  payment_terms: "Payment due within 14 days of invoice date", currency: "KES",
  vat_rate: 16, vat_inclusive: false, notes: "", authorised_name: "", authorised_title: "",
  lines: [blankLine()],
});

const fromRecord = (i: Invoice): FormState => ({
  customer_company: i.customer_company ?? "",
  customer_contact_person: i.customer_contact_person ?? "",
  customer_email: i.customer_email ?? "",
  customer_phone: i.customer_phone ?? "",
  customer_address: i.customer_address ?? "",
  customer_pin: i.customer_pin ?? "",
  customer_ref: i.customer_ref ?? "",
  lpo_reference: i.lpo_reference ?? "",
  quote_reference: i.quote_reference ?? "",
  contract_reference: i.contract_reference ?? "",
  service_from: i.service_from ?? "",
  service_to: i.service_to ?? "",
  due_date: i.due_date ?? "",
  payment_terms: i.payment_terms ?? "",
  currency: i.currency ?? "KES",
  vat_rate: Number(i.vat_rate ?? 16),
  vat_inclusive: !!i.vat_inclusive,
  notes: i.notes ?? "",
  authorised_name: i.authorised_name ?? "",
  authorised_title: i.authorised_title ?? "",
  lines: i.lines?.length ? i.lines.map((l) => ({ ...l })) : [blankLine()],
});

export default function Invoices() {
  const [list, setList] = useState<InvoiceList | null>(null);
  const [current, setCurrent] = useState<Invoice | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendNote, setSendNote] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await listInvoices());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The invoice register could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const locked = !!current && current.status !== "draft";
  const totals = useMemo(
    () => computeTotals(form.lines, form.vat_rate, form.vat_inclusive),
    [form.lines, form.vat_rate, form.vat_inclusive],
  );

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, patch: Partial<InvoiceLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  const refresh = async (i: Invoice) => {
    setCurrent(i);
    setForm(fromRecord(i));
    setSendTo(i.customer_email ?? "");
    await load();
  };

  const open = async (id: string) => {
    setBusy("open");
    try {
      const i = await getInvoice(id);
      setCurrent(i);
      setForm(fromRecord(i));
      setSendTo(i.customer_email ?? "");
      setPayAmount("");
      setPayRef("");
    } catch (e) {
      toast({ title: "Could not open", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const startNew = () => {
    setCurrent(null);
    setForm(emptyForm());
    setSendTo("");
    setSendNote("");
  };

  const act = async (key: string, fn: () => Promise<Invoice>, ok: (i: Invoice) => string, fail: string) => {
    setBusy(key);
    try {
      const i = await fn();
      await refresh(i);
      toast({ title: ok(i) });
    } catch (e) {
      toast({ title: fail, description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    act("save", () => saveInvoice({
      id: current?.id ?? null,
      ...form,
      service_from: form.service_from || null,
      service_to: form.service_to || null,
      due_date: form.due_date || null,
      lines: form.lines.filter((l) => l.description.trim()),
    }), () => "Saved with the recalculated totals", "Not saved");

  const submit = () => {
    if (!current) return;
    return act("submit", () => submitInvoice(current.id), () => "Sent for approval", "Not sent for approval");
  };

  const decide = (approve: boolean) => {
    if (!current) return;
    let note: string | undefined;
    if (!approve) {
      const reason = window.prompt("Why is this invoice being sent back?")?.trim();
      if (!reason) return;
      note = reason;
    }
    return act(approve ? "approve" : "reject", () => decideInvoice(current.id, approve, note),
      () => (approve ? "Approved" : "Sent back to the preparer"), "Decision not recorded");
  };

  const issue = () => {
    if (!current) return;
    return act("issue", () => issueInvoice(current.id),
      (i) => `Issued as ${i.invoice_no}`, "Not issued");
  };

  const cancel = () => {
    if (!current) return;
    const reason = window.prompt("Why is this invoice being cancelled?")?.trim();
    if (!reason) return;
    return act("cancel", () => cancelInvoice(current.id, reason), () => "Cancelled", "Not cancelled");
  };

  const download = async () => {
    if (!current) return;
    setBusy("pdf");
    try {
      const bytes = await buildInvoicePdf(current);
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = invoicePdfFilename(current);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Could not build the document", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!current) return;
    setBusy("send");
    try {
      const pdf = await buildInvoicePdf(current);
      await sendDocument({
        kind: "invoice", id: current.id, pdf, sha256: await sha256Hex(pdf),
        filename: invoicePdfFilename(current), to: sendTo.trim(), message: sendNote.trim() || undefined,
      });
      await refresh(await getInvoice(current.id));
      toast({ title: "Sent", description: `${current.invoice_no} was emailed to ${sendTo.trim()}.` });
    } catch (e) {
      toast({ title: "Not sent", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const receipt = async () => {
    if (!current) return;
    const amount = Math.round(Number(payAmount) * 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter the amount received", variant: "destructive" });
      return;
    }
    setBusy("receipt");
    try {
      const r = await recordReceipt({
        invoice_id: current.id,
        amount_cents: amount,
        method: payMethod,
        payment_reference: payRef.trim() || undefined,
        received_on: payDate || undefined,
        authorised_name: form.authorised_name || undefined,
        authorised_title: form.authorised_title || undefined,
      });
      setPayAmount("");
      setPayRef("");
      await refresh(await getInvoice(current.id));
      toast({ title: `Receipt ${r.receipt_no} recorded` });
    } catch (e) {
      toast({ title: "Not recorded", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const receiptPdf = async (r: PaymentReceipt, email: boolean) => {
    setBusy(`receipt-${r.id}`);
    try {
      const full = { ...r, invoice: r.invoice ?? (current ? {
        id: current.id, invoice_no: current.invoice_no, status: current.status,
        total_cents: current.total_cents, paid_cents: current.paid_cents,
        customer_company: current.customer_company, customer_email: current.customer_email,
        customer_address: current.customer_address, customer_pin: current.customer_pin,
      } : undefined) } as PaymentReceipt;
      const pdf = await buildReceiptPdf(full);
      if (email) {
        await sendDocument({
          kind: "receipt", id: r.id, pdf, sha256: await sha256Hex(pdf),
          filename: receiptPdfFilename(r), to: (current?.customer_email ?? "").trim(),
        });
        await refresh(await getInvoice(current!.id));
        toast({ title: `${r.receipt_no} emailed to the customer` });
      } else {
        const url = URL.createObjectURL(new Blob([pdf as unknown as BlobPart], { type: "application/pdf" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = receiptPdfFilename(r);
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      toast({ title: "Receipt not produced", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <FileText className="h-6 w-6 text-primary" /> Tax invoices and receipts
          </h1>
          <p className="text-sm text-muted-foreground">
            Key the customer and the priced items. An approver signs the invoice off before it is issued, and money
            received is receipted against it.
          </p>
        </div>
        <Button onClick={startNew} variant="outline">
          <Plus className="mr-2 h-4 w-4" /> New invoice
        </Button>
      </div>

      <AsyncState loading={loading} error={error} onRetry={() => void load()}>
        {list && (
          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-3">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Outstanding</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold text-foreground">{money(list.outstanding_cents)}</p>
                  <p className="text-xs text-muted-foreground">
                    Issued and part-paid invoices {list.scope === "all" ? "across the business" : "you own"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Register</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {list.invoices.length === 0 && (
                    <p className="text-sm text-muted-foreground">No invoices yet.</p>
                  )}
                  {list.invoices.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => void open(i.id)}
                      className={cn(
                        "w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/60",
                        current?.id === i.id && "border-primary/50 bg-primary/5",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{i.invoice_no ?? "Draft"}</span>
                        <Badge className={badgeTone(INVOICE_STATUS_TONE[i.status])}>
                          {INVOICE_STATUS_LABEL[i.status]}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{i.customer_company || "No customer yet"}</p>
                      <p className="text-xs text-muted-foreground">
                        {money(i.total_cents, i.currency)}
                        {i.paid_cents > 0 && ` · ${money(i.total_cents - i.paid_cents, i.currency)} due`}
                      </p>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-5">
              {locked && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                  <ShieldAlert className="mt-0.5 h-4 w-4" />
                  <span>
                    This invoice is {INVOICE_STATUS_LABEL[current!.status].toLowerCase()}, so its figures are locked.
                  </span>
                </div>
              )}

              <Card>
                <CardHeader><CardTitle className="text-base">Customer</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Company name</Label>
                    <Input aria-label="Company name" disabled={locked} value={form.customer_company} onChange={(e) => set("customer_company", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contact person</Label>
                    <Input aria-label="Contact person" disabled={locked} value={form.customer_contact_person} onChange={(e) => set("customer_contact_person", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input aria-label="Email" type="email" disabled={locked} value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input aria-label="Phone" disabled={locked} value={form.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>KRA PIN</Label>
                    <Input aria-label="KRA PIN" disabled={locked} value={form.customer_pin} onChange={(e) => set("customer_pin", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>LPO / purchase order number</Label>
                    <Input aria-label="LPO or purchase order number" disabled={locked} value={form.lpo_reference} onChange={(e) => set("lpo_reference", e.target.value)} />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Address</Label>
                    <Textarea aria-label="Address" rows={2} disabled={locked} value={form.customer_address} onChange={(e) => set("customer_address", e.target.value)} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Invoice details</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Service from</Label>
                    <Input aria-label="Service from" type="date" disabled={locked} value={form.service_from} onChange={(e) => set("service_from", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Service to</Label>
                    <Input aria-label="Service to" type="date" disabled={locked} value={form.service_to} onChange={(e) => set("service_to", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Due date</Label>
                    <Input aria-label="Due date" type="date" disabled={locked} value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Quotation reference</Label>
                    <Input aria-label="Quotation reference" disabled={locked} value={form.quote_reference} onChange={(e) => set("quote_reference", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contract reference</Label>
                    <Input aria-label="Contract reference" disabled={locked} value={form.contract_reference} onChange={(e) => set("contract_reference", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>VAT rate (%)</Label>
                    <Input aria-label="VAT rate" type="number" disabled={locked} value={form.vat_rate} onChange={(e) => set("vat_rate", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Payment terms</Label>
                    <Input aria-label="Payment terms" disabled={locked} value={form.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} />
                  </div>
                  <div className="flex items-center gap-3 pt-6">
                    <Switch aria-label="Rates already include VAT" disabled={locked} checked={form.vat_inclusive} onCheckedChange={(v) => set("vat_inclusive", v)} />
                    <span className="text-sm text-muted-foreground">Rates already include VAT</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Items</CardTitle>
                  {!locked && (
                    <Button variant="outline" size="sm" onClick={() => set("lines", [...form.lines, blankLine()])}>
                      <Plus className="mr-2 h-4 w-4" /> Add item
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {form.lines.map((l, i) => (
                    <div key={i} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_80px_120px_40px]">
                      <Input aria-label={`Item ${i + 1} description`} placeholder="Description" disabled={locked} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                      <Input aria-label={`Item ${i + 1} date`} type="date" disabled={locked} value={l.service_date ?? ""} onChange={(e) => setLine(i, { service_date: e.target.value || null })} />
                      <Input aria-label={`Item ${i + 1} quantity`} type="number" disabled={locked} value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
                      <Input aria-label={`Item ${i + 1} rate`} type="number" disabled={locked} value={l.unit_rate_cents / 100} onChange={(e) => setLine(i, { unit_rate_cents: Math.round(Number(e.target.value) * 100) })} />
                      {!locked && (
                        <Button variant="ghost" size="icon" aria-label={`Remove item ${i + 1}`} onClick={() => set("lines", form.lines.filter((_, idx) => idx !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="ml-auto w-full max-w-xs space-y-1 border-t pt-3 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(totals.subtotal_cents, form.currency)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">VAT {form.vat_rate}%</span><span>{money(totals.vat_cents, form.currency)}</span></div>
                    <div className="flex justify-between font-semibold text-foreground"><span>Total</span><span>{money(totals.total_cents, form.currency)}</span></div>
                    {current && current.paid_cents > 0 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Balance due</span><span>{money(current.total_cents - current.paid_cents, current.currency)}</span></div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Notes and authorisation</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Notes shown on the document</Label>
                    <Textarea aria-label="Notes shown on the document" rows={3} disabled={locked} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Authorised by</Label>
                    <Input aria-label="Authorised by" disabled={locked} value={form.authorised_name} onChange={(e) => set("authorised_name", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Title</Label>
                    <Input aria-label="Title" disabled={locked} value={form.authorised_title} onChange={(e) => set("authorised_title", e.target.value)} />
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-wrap items-center gap-2">
                {!locked && (
                  <Button onClick={() => void save()} disabled={busy === "save"}>
                    {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save draft
                  </Button>
                )}
                {current?.status === "draft" && (
                  <Button variant="secondary" onClick={() => void submit()} disabled={busy === "submit"}>
                    {busy === "submit" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send for approval
                  </Button>
                )}
                {current?.status === "pending_approval" && list.can_approve && (
                  <>
                    <Button variant="secondary" onClick={() => void decide(true)} disabled={busy === "approve"}>
                      {busy === "approve" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Approve
                    </Button>
                    <Button variant="ghost" onClick={() => void decide(false)} disabled={busy === "reject"}>
                      Send back
                    </Button>
                  </>
                )}
                {current?.status === "approved" && (
                  <Button variant="secondary" onClick={() => void issue()} disabled={busy === "issue"}>
                    {busy === "issue" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Issue and lock
                  </Button>
                )}
                {current && (
                  <Button variant="outline" data-analytics="staff_invoice_download_pdf" onClick={() => void download()} disabled={busy === "pdf"}>
                    <Download className="mr-2 h-4 w-4" /> Download PDF
                  </Button>
                )}
                {current && !["cancelled", "paid"].includes(current.status) && current.paid_cents === 0 && (
                  <Button variant="ghost" onClick={() => void cancel()} disabled={busy === "cancel"}>
                    <Ban className="mr-2 h-4 w-4" /> Cancel invoice
                  </Button>
                )}
              </div>

              {current && ["issued", "sent", "part_paid", "paid"].includes(current.status) && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Send to the customer</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Send to</Label>
                        <Input aria-label="Send to" type="email" value={sendTo} onChange={(e) => setSendTo(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Message (optional)</Label>
                        <Input aria-label="Message" value={sendNote} onChange={(e) => setSendNote(e.target.value)} placeholder="A short covering note" />
                      </div>
                    </div>
                    <Button onClick={() => void send()} disabled={busy === "send"}>
                      {busy === "send" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      Email the invoice
                    </Button>
                    {current.sent_at && (
                      <p className="text-xs text-muted-foreground">
                        Last sent {when(current.sent_at)} to {current.sent_to}. File fingerprint {current.pdf_sha256?.slice(0, 16)}…
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {current && ["issued", "sent", "part_paid", "paid"].includes(current.status) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Receipt className="h-4 w-4 text-primary" /> Money received
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {current.status !== "paid" && (
                      <>
                        <div className="grid gap-4 md:grid-cols-4">
                          <div className="space-y-1.5">
                            <Label>Amount ({current.currency})</Label>
                            <Input aria-label="Amount received" type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Method</Label>
                            <select
                              aria-label="Payment method"
                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={payMethod}
                              onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                            >
                              {PAYMENT_METHODS.map((m) => (
                                <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Reference</Label>
                            <Input aria-label="Payment reference" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="M-Pesa code, slip number" />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Date received</Label>
                            <Input aria-label="Date received" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                          </div>
                        </div>
                        <Button onClick={() => void receipt()} disabled={busy === "receipt"}>
                          {busy === "receipt" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Record payment and receipt it
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Outstanding balance {money(current.total_cents - current.paid_cents, current.currency)}. A receipt
                          can never be more than the balance.
                        </p>
                      </>
                    )}
                    {(current.receipts ?? []).map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
                        <div>
                          <p className="font-medium text-foreground">{r.receipt_no} · {money(r.amount_cents, r.currency)}</p>
                          <p className="text-xs text-muted-foreground">
                            {PAYMENT_METHOD_LABEL[r.method] ?? r.method}
                            {r.payment_reference ? ` · ${r.payment_reference}` : ""} · received {r.received_on}
                            {r.sent_at ? ` · emailed ${when(r.sent_at)}` : ""}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => void receiptPdf(r, false)} disabled={busy === `receipt-${r.id}`}>
                            <Download className="mr-2 h-4 w-4" /> Receipt
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => void receiptPdf(r, true)} disabled={busy === `receipt-${r.id}`}>
                            <Send className="mr-2 h-4 w-4" /> Email
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {current?.events?.length ? (
                <Card>
                  <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {current.events.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0">
                        <span>{e.event.replace(/_/g, " ").toLowerCase()}{e.note ? ` — ${e.note}` : ""}</span>
                        <span className="text-xs text-muted-foreground">{when(e.created_at)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        )}
      </AsyncState>
    </div>
  );
}
