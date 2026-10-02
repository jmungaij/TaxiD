/**
 * Company invoices: trip lines → issued & sent → payment reported by the
 * company → confirmed paid by TaxiD finance. Every step is a guarded database
 * action; this component only reads and calls them.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Line { ref: string; employee: string | null; from: string | null; to: string | null; total_cents: number; wallet_cents: number | null; credit_cents: number | null }
interface Ev { event: string; amount_cents: number | null; reference: string | null; note: string | null; recipients: string[] | null; at: string }
interface Invoice {
  id: string; invoice_number: string; status: string; total_cents: number; paid_cents: number; balance_cents: number;
  issued_at: string | null; due_at: string | null; paid_at: string | null; lines: Line[]; events: Ev[];
}

const kes = (c: number | null | undefined) => `KES ${((c ?? 0) / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS: Record<string, string> = {
  DRAFT: "Collecting trips", ISSUED: "Sent — awaiting payment", PARTIALLY_PAID: "Part paid", PAID: "Paid", OVERDUE: "Overdue", VOIDED: "Cancelled",
};
const EVENT: Record<string, string> = {
  TRIP_ADDED: "Trip added", ISSUED: "Invoice issued", SENT: "Sent to company finance", PAYMENT_REPORTED: "Company reported payment",
  PAYMENT_CONFIRMED: "TaxiD finance confirmed payment", PAID: "Marked paid",
};
const ERR: Record<string, string> = {
  INVOICE_EMPTY: "There are no trips on this invoice yet.", ALREADY_ISSUED: "This invoice was already issued.",
  NOT_AWAITING_PAYMENT: "This invoice isn't waiting for payment.", REFERENCE_AND_AMOUNT_REQUIRED: "Enter the amount and the M-Pesa or bank reference.",
};

export default function CorporateInvoices({ corporateId, isFinance, onChange }: { corporateId: string; isFinance: boolean; onChange?: () => void }) {
  const [list, setList] = useState<Invoice[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [ref, setRef] = useState(""); const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db.rpc("corporate_invoices_board", { _corporate_id: corporateId });
    if (error) { toast.error(error.message); return; }
    setList(data ?? []);
  }, [corporateId]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    const { data, error } = await db.rpc(fn, args);
    setBusy(false);
    if (error || !data?.ok) { toast.error(error?.message ?? ERR[data?.error] ?? data?.error); return; }
    toast.success(ok); setRef(""); setAmt(""); load(); onChange?.();
  }

  if (!list) return <p className="text-xs text-muted-foreground">Loading invoices…</p>;
  if (list.length === 0) return <p className="text-xs text-muted-foreground">No invoices yet. One starts automatically when the first company trip finishes.</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold flex items-center gap-1"><FileText className="h-3.5 w-3.5" />Invoices</p>
      {list.map((i) => {
        const expanded = open === i.id;
        const awaiting = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(i.status);
        return (
          <div key={i.id} className="rounded-md border text-xs">
            <button className="w-full grid grid-cols-2 md:grid-cols-5 gap-2 px-2 py-1.5 text-left hover:bg-muted/40" onClick={() => setOpen(expanded ? null : i.id)}>
              <span className="font-mono">{i.invoice_number}</span>
              <span className={i.status === "PAID" ? "text-status-success font-semibold" : ""}>{STATUS[i.status] ?? i.status}</span>
              <span>Total {kes(i.total_cents)}</span>
              <span>Owing {kes(i.balance_cents)}</span>
              <span>{i.due_at && i.status !== "DRAFT" ? `Due ${new Date(i.due_at).toLocaleDateString()}` : `${i.lines.length} trip(s)`}</span>
            </button>
            {expanded && (
              <div className="border-t p-2 space-y-3">
                <div className="space-y-1">
                  {i.lines.map((l) => (
                    <div key={l.ref} className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <span className="font-mono truncate">{l.ref}</span><span className="truncate">{l.employee ?? "—"} · {l.from} → {l.to}</span>
                      <span>{kes(l.total_cents)}</span>
                      <span className="text-muted-foreground">{(l.wallet_cents ?? 0) > 0 && `Wallet ${kes(l.wallet_cents)}`}{(l.wallet_cents ?? 0) > 0 && (l.credit_cents ?? 0) > 0 && " + "}{(l.credit_cents ?? 0) > 0 && `Credit ${kes(l.credit_cents)}`}</span>
                    </div>
                  ))}
                </div>
                <ol className="space-y-0.5 border-l pl-3">
                  {i.events.map((e, k) => (
                    <li key={k}>
                      <span className="font-medium">{EVENT[e.event] ?? e.event}</span>
                      {e.amount_cents != null && ` · ${kes(e.amount_cents)}`}{e.reference && ` · ref ${e.reference}`}
                      {e.recipients && e.recipients.length > 0 && ` · to ${e.recipients.join(", ")}`}
                      <span className="text-muted-foreground"> · {new Date(e.at).toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
                {i.status === "DRAFT" && isFinance && (
                  <button disabled={busy} onClick={() => act("corporate_invoice_issue", { _invoice_id: i.id }, "Invoice issued and sent")}
                    className="rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50">Issue & send to company finance</button>
                )}
                {awaiting && (
                  <div className="flex flex-wrap items-end gap-2">
                    <input className="rounded-md border bg-background px-2 py-1" placeholder={`Amount (KES), owing ${(i.balance_cents / 100).toFixed(2)}`} inputMode="decimal"
                      value={amt} onChange={(e) => setAmt(e.target.value)} />
                    <input className="rounded-md border bg-background px-2 py-1" placeholder="M-Pesa or bank reference" maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} />
                    <button disabled={busy} onClick={() => act("corporate_invoice_report_payment", { _invoice_id: i.id, _amount_cents: Math.round(Number(amt) * 100), _reference: ref }, "Payment reported to TaxiD finance")}
                      className="rounded-md border px-3 py-1 hover:bg-muted disabled:opacity-50">Report payment</button>
                    {isFinance && (
                      <button disabled={busy} onClick={() => act("corporate_invoice_confirm_payment", { _invoice_id: i.id, _amount_cents: Math.round(Number(amt) * 100), _reference: ref }, "Payment confirmed")}
                        className="rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50">Confirm received</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
