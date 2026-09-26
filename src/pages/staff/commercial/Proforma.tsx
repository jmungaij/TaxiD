/**
 * Proforma invoices — /staff/commercial/proforma
 *
 * Staff key the customer details and the priced items, the system does the
 * arithmetic, issues the official number and emails the document. Once issued
 * the figures are locked, and the file that reaches the customer is fingerprinted
 * against the record.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Plus, Send, ShieldAlert, Trash2, Download, Ban } from "lucide-react";
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
  PROFORMA_STATUS_LABEL, PROFORMA_STATUS_TONE, computeTotals, decideProforma, getProforma, issueProforma,
  listProformas, money, saveProforma, sendProforma, submitProforma, voidProforma,
  type Proforma, type ProformaLine, type ProformaList,
} from "@/lib/commercial/proforma";
import { buildProformaPdf, proformaPdfFilename, sha256Hex } from "@/lib/commercial/proformaPdf";

const blankLine = (): ProformaLine => ({ description: "", qty: 1, unit_rate_cents: 0, service_date: null, vehicle_category: null });

function badgeTone(tone: string): string {
  const t = toneClasses(tone);
  return cn(t.bg, t.text, t.border, "border");
}

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

interface FormState {
  customer_company: string;
  customer_contact_person: string;
  customer_email: string;
  customer_phone: string;
  booked_for: string;
  booked_by: string;
  customer_address: string;
  customer_pin: string;
  customer_ref: string;
  quote_reference: string;
  contract_reference: string;
  service_from: string;
  service_to: string;
  valid_until: string;
  payment_terms: string;
  currency: string;
  vat_rate: number;
  vat_inclusive: boolean;
  notes: string;
  authorised_name: string;
  authorised_title: string;
  lines: ProformaLine[];
}

const emptyForm = (): FormState => ({
  customer_company: "", customer_contact_person: "", customer_email: "", customer_phone: "",
  booked_for: "", booked_by: "",
  customer_address: "", customer_pin: "", customer_ref: "", quote_reference: "", contract_reference: "",
  service_from: "", service_to: "", valid_until: "",
  payment_terms: "50% Advance, Balance within 30 Days", currency: "KES",
  vat_rate: 16, vat_inclusive: false, notes: "", authorised_name: "", authorised_title: "",
  lines: [blankLine()],
});

const fromRecord = (p: Proforma): FormState => ({
  customer_company: p.customer_company ?? "",
  customer_contact_person: p.customer_contact_person ?? "",
  customer_email: p.customer_email ?? "",
  customer_phone: p.customer_phone ?? "",
  booked_for: p.booked_for ?? "",
  booked_by: p.booked_by ?? "",
  customer_address: p.customer_address ?? "",
  customer_pin: p.customer_pin ?? "",
  customer_ref: p.customer_ref ?? "",
  quote_reference: p.quote_reference ?? "",
  contract_reference: p.contract_reference ?? "",
  service_from: p.service_from ?? "",
  service_to: p.service_to ?? "",
  valid_until: p.valid_until ?? "",
  payment_terms: p.payment_terms ?? "",
  currency: p.currency ?? "KES",
  vat_rate: Number(p.vat_rate ?? 16),
  vat_inclusive: !!p.vat_inclusive,
  notes: p.notes ?? "",
  authorised_name: p.authorised_name ?? "",
  authorised_title: p.authorised_title ?? "",
  lines: (p.lines ?? []).length ? p.lines.map((l) => ({ ...l })) : [blankLine()],
});

export default function ProformaInvoices() {
  const [list, setList] = useState<ProformaList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Proforma | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [busy, setBusy] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sendNote, setSendNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await listProformas());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The proforma register could not be loaded.");
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
  const setLine = (i: number, patch: Partial<ProformaLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  const open = async (id: string) => {
    setBusy("open");
    try {
      const p = await getProforma(id);
      setCurrent(p);
      setForm(fromRecord(p));
      setSendTo(p.customer_email ?? "");
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

  const save = async () => {
    setBusy("save");
    try {
      const p = await saveProforma({
        id: current?.id ?? null,
        ...form,
        service_from: form.service_from || null,
        service_to: form.service_to || null,
        valid_until: form.valid_until || null,
        lines: form.lines.filter((l) => l.description.trim()),
      });
      setCurrent(p);
      setForm(fromRecord(p));
      setSendTo(p.customer_email ?? "");
      toast({ title: "Saved", description: "The draft has been saved with the recalculated totals." });
      await load();
    } catch (e) {
      toast({ title: "Not saved", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!current) return;
    setBusy("submit");
    try {
      const p = await submitProforma(current.id);
      setCurrent(p);
      setForm(fromRecord(p));
      toast({ title: "Sent for approval", description: "An approver must sign this off before it can be issued." });
      await load();
    } catch (e) {
      toast({ title: "Not sent for approval", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const decide = async (approve: boolean) => {
    if (!current) return;
    let note: string | undefined;
    if (!approve) {
      const reason = window.prompt("Why is this proforma being sent back?")?.trim();
      if (!reason) return;
      note = reason;
    }
    setBusy(approve ? "approve" : "reject");
    try {
      const p = await decideProforma(current.id, approve, note);
      setCurrent(p);
      setForm(fromRecord(p));
      toast({ title: approve ? "Approved" : "Sent back to the preparer" });
      await load();
    } catch (e) {
      toast({ title: "Decision not recorded", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const issue = async () => {
    if (!current) return;
    setBusy("issue");
    try {
      const p = await issueProforma(current.id);
      setCurrent(p);
      setForm(fromRecord(p));
      toast({ title: `Issued as ${p.proforma_no}`, description: "The figures are now locked." });
      await load();
    } catch (e) {
      toast({ title: "Not issued", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!current) return;
    setBusy("pdf");
    try {
      const bytes = await buildProformaPdf(current);
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = proformaPdfFilename(current);
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
      const pdf = await buildProformaPdf(current);
      const sha = await sha256Hex(pdf);
      const p = await sendProforma({
        proforma: current,
        pdf,
        sha256: sha,
        filename: proformaPdfFilename(current),
        to: current.customer_email ?? "",
        message: sendNote.trim() || undefined,
      });
      setCurrent(p);
      toast({ title: "Sent", description: `${p.proforma_no} was emailed to ${current.customer_email ?? ""}.` });
      await load();
    } catch (e) {
      toast({ title: "Not sent", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const voidIt = async () => {
    if (!current) return;
    const reason = window.prompt("Why is this proforma being voided?")?.trim();
    if (!reason) return;
    setBusy("void");
    try {
      const p = await voidProforma(current.id, reason);
      setCurrent(p);
      toast({ title: "Voided" });
      await load();
    } catch (e) {
      toast({ title: "Not voided", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <FileText className="h-6 w-6 text-primary" /> Proforma invoices
          </h1>
          <p className="text-sm text-muted-foreground">
            Key the customer and the priced items. The system does the arithmetic, issues the number and emails the document.
          </p>
        </div>
        <Button onClick={startNew} variant="outline">
          <Plus className="mr-2 h-4 w-4" /> New proforma
        </Button>
      </div>

      <AsyncState loading={loading} error={error} onRetry={() => void load()}>
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardHeader><CardTitle className="text-base">Register</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!list?.invoices.length && (
                <p className="text-sm text-muted-foreground">No proforma invoices have been raised yet.</p>
              )}
              {list?.invoices.map((p) => (
                <button
                  key={p.id}
                  onClick={() => void open(p.id)}
                  className={cn(
                    "w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50",
                    current?.id === p.id && "border-primary bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{p.proforma_no ?? "Draft"}</span>
                    <Badge className={badgeTone(PROFORMA_STATUS_TONE[p.status])}>
                      {PROFORMA_STATUS_LABEL[p.status]}
                    </Badge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{p.customer_company || "Unnamed customer"}</p>
                  <p className="text-xs text-muted-foreground">{money(p.total_cents, p.currency)}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-6">
            {locked && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                <ShieldAlert className="mt-0.5 h-4 w-4 text-primary" />
                <span>
                  {current?.proforma_no} has been issued, so its figures are locked. Void it and raise a new one if the
                  amounts must change.
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
                  <Input aria-label="Email" disabled={locked} type="email" value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input aria-label="Phone" disabled={locked} value={form.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>KRA PIN / VAT number</Label>
                  <Input aria-label="KRA PIN / VAT number" disabled={locked} value={form.customer_pin} onChange={(e) => set("customer_pin", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Customer reference / LPO</Label>
                  <Input aria-label="Customer reference / LPO" disabled={locked} value={form.customer_ref} onChange={(e) => set("customer_ref", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>For (traveller / passenger)</Label>
                  <Input aria-label="For" disabled={locked} value={form.booked_for} onChange={(e) => set("booked_for", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Booked by</Label>
                  <Input aria-label="Booked by" disabled={locked} value={form.booked_by} onChange={(e) => set("booked_by", e.target.value)} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Address</Label>
                  <Textarea aria-label="Address" disabled={locked} rows={2} value={form.customer_address} onChange={(e) => set("customer_address", e.target.value)} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Document details</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Service from</Label>
                  <Input aria-label="Service from" disabled={locked} type="date" value={form.service_from} onChange={(e) => set("service_from", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Service to</Label>
                  <Input aria-label="Service to" disabled={locked} type="date" value={form.service_to} onChange={(e) => set("service_to", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Valid until</Label>
                  <Input aria-label="Valid until" disabled={locked} type="date" value={form.valid_until} onChange={(e) => set("valid_until", e.target.value)} />
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
                  <Label>Currency</Label>
                  <Input aria-label="Currency" disabled={locked} value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Payment terms</Label>
                  <Input aria-label="Payment terms" disabled={locked} value={form.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>VAT rate (%)</Label>
                  <Input aria-label="VAT rate (%)" disabled={locked} type="number" min={0} max={100} step={0.5}
                    value={form.vat_rate} onChange={(e) => set("vat_rate", Number(e.target.value))} />
                </div>
                <div className="flex items-center gap-3 md:col-span-3">
                  <Switch disabled={locked} checked={form.vat_inclusive} onCheckedChange={(v) => set("vat_inclusive", v)} />
                  <span className="text-sm">Rates already include VAT</span>
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
                  <div key={i} className="grid gap-2 rounded-md border p-3 md:grid-cols-12">
                    <div className="space-y-1.5 md:col-span-5">
                      <Label className="text-xs">Description</Label>
                      <Input aria-label="Description" disabled={locked} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs">Date</Label>
                      <Input aria-label="Date" disabled={locked} type="date" value={l.service_date ?? ""} onChange={(e) => setLine(i, { service_date: e.target.value || null })} />
                    </div>
                    <div className="space-y-1.5 md:col-span-1">
                      <Label className="text-xs">Qty</Label>
                      <Input aria-label="Qty" disabled={locked} type="number" min={0} step={0.5} value={l.qty}
                        onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs">Unit rate ({form.currency})</Label>
                      <Input disabled={locked} type="number" min={0} step={0.01}
                        value={(l.unit_rate_cents ?? 0) / 100}
                        onChange={(e) => setLine(i, { unit_rate_cents: Math.round(Number(e.target.value) * 100) })} />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label className="text-xs">Amount</Label>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm font-medium">
                          {money(Math.round((l.qty || 0) * (l.unit_rate_cents || 0)), form.currency)}
                        </span>
                        {!locked && form.lines.length > 1 && (
                          <Button variant="ghost" size="icon" onClick={() => set("lines", form.lines.filter((_, idx) => idx !== i))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                <div className="ml-auto w-full max-w-xs space-y-1 rounded-md bg-muted/50 p-3 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><span>{money(totals.subtotal_cents, form.currency)}</span></div>
                  <div className="flex justify-between"><span>VAT {form.vat_rate}%</span><span>{money(totals.vat_cents, form.currency)}</span></div>
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <span>Total</span><span>{money(totals.total_cents, form.currency)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Notes and authorisation</CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Notes shown on the document</Label>
                  <Textarea aria-label="Notes shown on the document" disabled={locked} rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
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
              {current?.status === "pending_approval" && list?.can_approve && (
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
                <Button variant="outline" data-analytics="staff_proforma_download_pdf" onClick={() => void download()} disabled={busy === "pdf"}>
                  <Download className="mr-2 h-4 w-4" /> Download PDF
                </Button>
              )}
              {current && current.status !== "void" && (
                <Button variant="ghost" onClick={() => void voidIt()} disabled={busy === "void"}>
                  <Ban className="mr-2 h-4 w-4" /> Void
                </Button>
              )}
            </div>

            {current && ["issued", "sent"].includes(current.status) && (
              <Card>
                <CardHeader><CardTitle className="text-base">Send to the customer</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Send to</Label>
                      <Input aria-label="Send to" type="email" value={current?.customer_email ?? ""} readOnly title="Proforma invoices only go to the customer email on the record." />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Message (optional)</Label>
                      <Input aria-label="Message (optional)" value={sendNote} onChange={(e) => setSendNote(e.target.value)} placeholder="A short covering note" />
                    </div>
                  </div>
                  <Button onClick={() => void send()} disabled={busy === "send"}>
                    {busy === "send" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Email the proforma
                  </Button>
                  {current.sent_at && (
                    <p className="text-xs text-muted-foreground">
                      Last sent {when(current.sent_at)} to {current.sent_to}. File fingerprint {current.pdf_sha256?.slice(0, 16)}…
                    </p>
                  )}
                  {current.recipient_flagged && (
                    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                      Flagged: this proforma was sent to an address that is not the customer's verified email
                      {current.recipient_flag_reason ? ` (${current.recipient_flag_reason.replace(/_/g, " ").toLowerCase()})` : ""}.
                    </p>
                  )}
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
      </AsyncState>
    </div>
  );
}
