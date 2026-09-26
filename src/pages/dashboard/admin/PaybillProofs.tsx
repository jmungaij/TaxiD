import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Banknote, Check, X, FileText, ExternalLink, ChevronDown, ChevronRight, Clock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface TimelineEvent {
  id: string;
  event_type: string;
  actor_email: string | null;
  notes: string | null;
  created_at: string;
}

interface Proof {
  id: string;
  corporate_id: string;
  mpesa_code: string;
  amount_cents: number;
  currency: string;
  payer_phone: string | null;
  paid_at: string | null;
  proof_file_path: string | null;
  paybill_reference: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  corporate_accounts?: { legal_name: string } | null;
}

export default function AdminPaybillProofs() {
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [rows, setRows] = useState<Proof[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Record<string, TimelineEvent[]>>({});

  async function loadTimeline(p: Proof) {
    if (timeline[p.id]) return;
    const { data } = await supabase.from("corporate_cash_ledger_audit")
      .select("id, event_type, actor_email, notes, created_at")
      .eq("corporate_id", p.corporate_id)
      .eq("proof_id", p.id)
      .order("created_at", { ascending: true });
    setTimeline((t) => ({ ...t, [p.id]: (data ?? []) as TimelineEvent[] }));
  }

  async function load() {
    const { data } = await supabase
      .from("corporate_paybill_proofs")
      .select("*, corporate_accounts(legal_name)")
      .eq("status", tab)
      .order("created_at", { ascending: false }).limit(200);
    setRows((data ?? []) as unknown as Proof[]);
  }
  useEffect(() => { load();   }, [tab]);

  async function approve(p: Proof) {
    const notes = window.prompt("Approval notes (optional):") ?? null;
    setBusy(p.id);
    const { error } = await supabase.rpc("approve_corporate_paybill_proof", { _proof_id: p.id, _notes: notes });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Approved and posted to Cash Ledger");
    load();
  }

  async function reject(p: Proof) {
    const notes = window.prompt("Reason for rejection (required):");
    if (!notes) return;
    setBusy(p.id);
    const { error } = await supabase.rpc("reject_corporate_paybill_proof", { _proof_id: p.id, _notes: notes });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Rejected");
    load();
  }

  async function viewFile(path: string | null) {
    if (!path) return;
    const { data, error } = await supabase.storage.from("paybill-proofs").createSignedUrl(path, 300);
    if (error || !data) { toast.error("Could not load file"); return; }
    window.open(data.signedUrl, "_blank");
  }

  const fmt = (c: number) => `KES ${(c / 100).toLocaleString()}`;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Banknote className="h-6 w-6 text-primary" />Paybill Payment Proofs</h1>
        <p className="text-xs text-muted-foreground">Paybill 4148095 · Yalla Beena Limited</p>
      </div>

      <div className="inline-flex rounded-lg border bg-card p-1 text-sm">
        {(["pending", "approved", "rejected"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-1.5 rounded ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-8"></th>
              <th className="text-left px-4 py-2">Submitted</th>
              <th className="text-left px-4 py-2">Corporate</th>
              <th className="text-left px-4 py-2">Paybill ref</th>
              <th className="text-left px-4 py-2">M-Pesa code</th>
              <th className="text-left px-4 py-2">Payer</th>
              <th className="text-right px-4 py-2">Amount</th>
              <th className="text-left px-4 py-2">Proof</th>
              <th className="text-right px-4 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="text-center text-muted-foreground py-8">No {tab} proofs.</td></tr>}
            {rows.map(p => {
              const open = expanded === p.id;
              const events = timeline[p.id] ?? [];
              return (
                <Fragment key={p.id}>
                  <tr className="border-t">
                    <td className="px-2 text-center">
                      <button onClick={() => { setExpanded(open ? null : p.id); if (!open) loadTimeline(p); }} className="p-1 rounded hover:bg-muted">
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap">{new Date(p.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2">{p.corporate_accounts?.legal_name ?? p.corporate_id.slice(0, 8)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{p.paybill_reference}</td>
                    <td className="px-4 py-2 font-mono">{p.mpesa_code}</td>
                    <td className="px-4 py-2 text-xs">{p.payer_phone ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-semibold">{fmt(p.amount_cents)}</td>
                    <td className="px-4 py-2">
                      {p.proof_file_path ? (
                        <button onClick={() => viewFile(p.proof_file_path)} className="text-primary text-xs inline-flex items-center gap-1 underline">
                          <FileText className="h-3 w-3" />View <ExternalLink className="h-3 w-3" />
                        </button>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {tab === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => reject(p)} className="gap-1">
                            <X className="h-3 w-3" />Reject
                          </Button>
                          <Button size="sm" disabled={busy === p.id} onClick={() => approve(p)} className="gap-1">
                            <Check className="h-3 w-3" />Approve & post
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{p.review_notes ?? "—"}</span>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-muted/20">
                      <td></td>
                      <td colSpan={8} className="px-4 py-3">
                        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                          Immutable status timeline · <span className="font-mono">{p.paybill_reference}</span>
                        </div>
                        <ol className="space-y-1.5 pl-2 border-l-2 border-primary/30">
                          <li className="text-xs flex gap-2">
                            <span className="text-muted-foreground w-40">{new Date(p.created_at).toLocaleString()}</span>
                            <span className="px-1.5 rounded bg-status-warning/10 text-status-warning dark:bg-status-warning/40 dark:text-status-warning">submitted</span>
                            <span className="text-muted-foreground">M-Pesa code {p.mpesa_code} · {fmt(p.amount_cents)}</span>
                          </li>
                          {events.map(ev => (
                            <li key={ev.id} className="text-xs flex gap-2">
                              <span className="text-muted-foreground w-40">{new Date(ev.created_at).toLocaleString()}</span>
                              <span className={`px-1.5 rounded ${ev.event_type === "proof_approved" ? "bg-status-success/10 text-status-success dark:bg-status-success/40 dark:text-status-success" : "bg-status-danger/10 text-status-danger dark:bg-status-danger/40 dark:text-status-danger"}`}>
                                {ev.event_type.replace("proof_", "")}
                              </span>
                              <span className="text-muted-foreground">by {ev.actor_email ?? "system"}{ev.notes ? ` · ${ev.notes}` : ""}</span>
                            </li>
                          ))}
                          {events.length === 0 && p.status === "pending" && (
                            <li className="text-xs flex gap-2 text-muted-foreground"><Clock className="h-3 w-3 mt-0.5" />Awaiting review.</li>
                          )}
                        </ol>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
