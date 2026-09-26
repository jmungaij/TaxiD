/**
 * Payment collections — /staff/commercial/collections
 *
 * Every issued invoice with money still owing, its balance, its due date, how
 * late it is and the next step agreed with the customer. Recording a payment
 * happens on the invoice register; this screen governs the chasing of it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Loader2, Plus, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { toneClasses } from "@/lib/design/statusTone";
import { cn } from "@/lib/utils";
import {
  AGEING_LABEL, AGEING_TONE, COLLECTION_ACTIONS, COLLECTION_ACTION_LABEL,
  bookCollectionAction, closeCollectionAction, fetchCollections, money,
  type CollectionActionType, type CollectionsInvoice, type CollectionsRegister,
} from "@/lib/commercial/collections";

const badgeTone = (tone: string) => {
  const t = toneClasses(tone);
  return cn(t.bg, t.text, t.border, "border");
};

const day = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-KE", { dateStyle: "medium" }) : "—";

const today = () => new Date().toISOString().slice(0, 10);

const BANDS: { key: keyof typeof AGEING_LABEL; total: keyof CollectionsRegister["totals"] }[] = [
  { key: "current", total: "bucket_current_cents" },
  { key: "1_30", total: "bucket_1_30_cents" },
  { key: "31_60", total: "bucket_31_60_cents" },
  { key: "61_90", total: "bucket_61_90_cents" },
  { key: "90_plus", total: "bucket_90_plus_cents" },
];

export default function Collections() {
  const [data, setData] = useState<CollectionsRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [band, setBand] = useState<string>("all");

  const [form, setForm] = useState<{
    action_type: CollectionActionType;
    due_on: string;
    note: string;
    promised_amount: string;
    promised_on: string;
  }>({ action_type: "call", due_on: today(), note: "", promised_amount: "", promised_on: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchCollections());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the collections register.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const invoices = useMemo(() => {
    const rows = (data?.invoices ?? []).filter((i) => i.balance_cents > 0);
    return band === "all" ? rows : rows.filter((i) => i.ageing_band === band);
  }, [data, band]);

  const settled = useMemo(() => (data?.invoices ?? []).filter((i) => i.balance_cents <= 0), [data]);

  const book = async (inv: CollectionsInvoice) => {
    setBusy(true);
    try {
      await bookCollectionAction({
        invoice_id: inv.id,
        action_type: form.action_type,
        due_on: form.due_on || today(),
        note: form.note.trim() || null,
        promised_amount_cents: form.promised_amount ? Math.round(Number(form.promised_amount) * 100) : null,
        promised_on: form.promised_on || null,
      });
      toast({ title: "Next step booked", description: COLLECTION_ACTION_LABEL[form.action_type] });
      setForm({ action_type: "call", due_on: today(), note: "", promised_amount: "", promised_on: "" });
      await load();
    } catch (e) {
      toast({ title: "Not saved", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const close = async (actionId: string, outcome: string, cancel = false) => {
    setBusy(true);
    try {
      await closeCollectionAction(actionId, outcome, null, cancel);
      toast({ title: cancel ? "Step cancelled" : "Step completed" });
      await load();
    } catch (e) {
      toast({ title: "Not saved", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const t = data?.totals;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Payment collections</h1>
        <p className="text-sm text-muted-foreground">
          Every invoice with money still owing, what it is worth, when it was due and the next step agreed with the
          customer. {data?.scope === "mine" ? "You are seeing the invoices you own." : "You are seeing all invoices."}
        </p>
      </header>

      <AsyncState loading={loading} error={error} onRetry={load}>
        {t && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Wallet className="h-4 w-4" /> Owed to us
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{money(t.outstanding_cents)}</p>
                <p className="text-xs text-muted-foreground">{t.invoice_count} unpaid invoice(s)</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <CalendarClock className="h-4 w-4" /> Past due
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{money(t.overdue_cents)}</p>
                <p className="text-xs text-muted-foreground">{t.overdue_count} invoice(s) late</p>
              </CardContent>
            </Card>
            <Card className="sm:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">How old the debt is</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {BANDS.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setBand(band === b.key ? "all" : String(b.key))}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left text-xs transition",
                      band === b.key ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                    )}
                  >
                    <span className="block text-muted-foreground">{AGEING_LABEL[b.key]}</span>
                    <span className="font-semibold">{money(Number(t[b.total] ?? 0))}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Unpaid invoices {band !== "all" && <span className="text-muted-foreground">· {AGEING_LABEL[band]}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {invoices.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing outstanding here.</p>
            )}
            {invoices.map((inv) => (
              <div key={inv.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {inv.invoice_no ?? "Draft"} · {inv.customer_company}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Due {day(inv.due_date)} · owner {inv.owner_name ?? "unassigned"}
                      {inv.lifecycle_state ? ` · deal at ${inv.lifecycle_state.toLowerCase()}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={badgeTone(AGEING_TONE[inv.ageing_band] ?? "neutral")}>
                      {AGEING_LABEL[inv.ageing_band]}
                    </Badge>
                    <div className="text-right">
                      <p className="font-semibold">{money(inv.balance_cents, inv.currency)}</p>
                      <p className="text-xs text-muted-foreground">
                        of {money(inv.total_cents, inv.currency)} · paid {money(inv.paid_cents, inv.currency)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {inv.next_action ? (
                    <span className="rounded-md border border-border bg-muted px-2 py-1">
                      Next: {COLLECTION_ACTION_LABEL[inv.next_action.action_type]} on {day(inv.next_action.due_on)}
                    </span>
                  ) : (
                    <span className="rounded-md border border-border px-2 py-1 text-muted-foreground">
                      No next step booked
                    </span>
                  )}
                  {inv.last_action && (
                    <span className="text-muted-foreground">
                      Last: {COLLECTION_ACTION_LABEL[inv.last_action.action_type]} — {inv.last_action.outcome ?? "done"}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => setOpenId(openId === inv.id ? null : inv.id)}
                  >
                    {openId === inv.id ? "Hide" : "Collections"}
                  </Button>
                </div>

                {openId === inv.id && (
                  <div className="mt-4 space-y-4 border-t border-border pt-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1">
                        <Label className="text-xs">Next step</Label>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={form.action_type}
                          onChange={(e) => setForm({ ...form, action_type: e.target.value as CollectionActionType })}
                        >
                          {COLLECTION_ACTIONS.map((a) => (
                            <option key={a} value={a}>{COLLECTION_ACTION_LABEL[a]}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Do it by</Label>
                        <Input type="date" value={form.due_on} onChange={(e) => setForm({ ...form, due_on: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Amount promised (optional)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={form.promised_amount}
                          onChange={(e) => setForm({ ...form, promised_amount: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Promised by (optional)</Label>
                        <Input type="date" value={form.promised_on} onChange={(e) => setForm({ ...form, promised_on: e.target.value })} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">What was agreed</Label>
                      <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    </div>
                    <Button size="sm" disabled={busy} onClick={() => void book(inv)}>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      Book next step
                    </Button>

                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">History</p>
                      {inv.actions.length === 0 && <p className="text-sm text-muted-foreground">No steps recorded yet.</p>}
                      {inv.actions.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
                          <span className="font-medium">{COLLECTION_ACTION_LABEL[a.action_type]}</span>
                          <span className="text-muted-foreground">due {day(a.due_on)}</span>
                          {a.promised_amount_cents ? (
                            <span className="text-muted-foreground">promised {money(a.promised_amount_cents, inv.currency)}</span>
                          ) : null}
                          {a.note && <span className="text-muted-foreground">· {a.note}</span>}
                          <Badge className={cn("ml-auto", badgeTone(a.status === "done" ? "success" : a.status === "cancelled" ? "neutral" : "warning"))}>
                            {a.status === "done" ? a.outcome ?? "Completed" : a.status === "cancelled" ? "Cancelled" : "Open"}
                          </Badge>
                          {a.status === "open" && (
                            <>
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => void close(a.id, "Customer contacted")}>
                                <CheckCircle2 className="mr-1 h-3 w-3" /> Done
                              </Button>
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void close(a.id, "", true)}>
                                Cancel
                              </Button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    {inv.receipts.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Money received</p>
                        {inv.receipts.map((r) => (
                          <p key={r.receipt_no ?? r.received_on} className="text-xs text-muted-foreground">
                            {r.receipt_no ?? "Receipt"} · {money(r.amount_cents, inv.currency)} · {day(r.received_on)} · {r.method}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {settled.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Settled in full</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {settled.map((i) => (
                <p key={i.id} className="text-sm text-muted-foreground">
                  {i.invoice_no} · {i.customer_company} · {money(i.total_cents, i.currency)} paid
                  {i.lifecycle_state ? ` · deal at ${i.lifecycle_state.toLowerCase()}` : ""}
                </p>
              ))}
            </CardContent>
          </Card>
        )}
      </AsyncState>
    </div>
  );
}
