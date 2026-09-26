import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Banknote, FileText, ExternalLink, CheckCircle2, XCircle, Clock, Download } from "lucide-react";
import { toast } from "sonner";

interface Proof {
  id: string;
  mpesa_code: string;
  amount_cents: number;
  currency: string;
  payer_phone: string | null;
  paid_at: string | null;
  proof_file_path: string | null;
  paybill_reference: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

export default function CorporateMyPaybillProofs({ corporateId }: { corporateId: string | null }) {
  const [rows, setRows] = useState<Proof[]>([]);
  const [paybillRef, setPaybillRef] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  useEffect(() => {
    if (!corporateId) return;
    (async () => {
      const { data: corp } = await supabase.from("corporate_accounts")
        .select("paybill_reference").eq("id", corporateId).maybeSingle();
      setPaybillRef(corp?.paybill_reference ?? "");

      const { data } = await supabase.from("corporate_paybill_proofs")
        .select("id, mpesa_code, amount_cents, currency, payer_phone, paid_at, proof_file_path, paybill_reference, status, reviewed_at, review_notes, created_at")
        .eq("corporate_id", corporateId)
        .order("created_at", { ascending: false }).limit(200);
      setRows((data ?? []) as Proof[]);
    })();
  }, [corporateId]);

  async function viewFile(path: string | null) {
    if (!path) return;
    const { data, error } = await supabase.storage.from("paybill-proofs").createSignedUrl(path, 300);
    if (error || !data) { toast.error("Could not load file"); return; }
    window.open(data.signedUrl, "_blank");
  }

  async function exportCsv() {
    const filtered = filter === "all" ? rows : rows.filter(r => r.status === filter);
    // Look up approver email from immutable audit log
    const proofIds = filtered.map(r => r.id);
    const approverByProof = new Map<string, { email: string | null; decided_at: string | null }>();
    if (proofIds.length && corporateId) {
      const { data: audit } = await supabase.from("corporate_cash_ledger_audit")
        .select("proof_id, actor_email, created_at, event_type")
        .eq("corporate_id", corporateId)
        .in("event_type", ["proof_approved", "proof_rejected"])
        .in("proof_id", proofIds);
      (audit ?? []).forEach((a) => {
        if (a.proof_id) approverByProof.set(a.proof_id, { email: a.actor_email, decided_at: a.created_at });
      });
    }

    const header = ["paybill_reference","corp_ref","upload_timestamp","mpesa_code","amount_cents","currency","payer_phone","paid_at","approval_status","approver_email","decision_timestamp","review_notes"];
    const data = filtered.map(r => {
      const ap = approverByProof.get(r.id);
      return [
        r.paybill_reference || paybillRef, paybillRef,
        r.created_at, r.mpesa_code, r.amount_cents, r.currency,
        r.payer_phone ?? "", r.paid_at ?? "",
        r.status, ap?.email ?? "", ap?.decided_at ?? r.reviewed_at ?? "",
        (r.review_notes ?? "").replace(/"/g, "''"),
      ];
    });
    const csv = [header, ...data].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `paybill-proofs-${paybillRef}.csv`; a.click();
  }

  const fmt = (c: number) => `KES ${(c / 100).toLocaleString()}`;
  const visible = filter === "all" ? rows : rows.filter(r => r.status === filter);

  const counts = {
    pending: rows.filter(r => r.status === "pending").length,
    approved: rows.filter(r => r.status === "approved").length,
    rejected: rows.filter(r => r.status === "rejected").length,
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Banknote className="h-4 w-4 text-primary" />My Paybill Top-up Proofs</h3>
          <p className="text-xs text-muted-foreground">
            Track approval status of M-Pesa top-up proofs submitted under{" "}
            <span className="font-mono font-semibold">{paybillRef || "—"}</span> · Paybill 4148095 (Yalla Beena Limited).
          </p>
        </div>
        <button data-analytics="mypaybillproofs.export_csv" onClick={exportCsv} className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted flex items-center gap-1.5">
          <Download className="h-4 w-4" />Export CSV
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Tile icon={<Clock className="h-4 w-4 text-status-warning" />} label="Pending" value={counts.pending} />
        <Tile icon={<CheckCircle2 className="h-4 w-4 text-status-success" />} label="Approved" value={counts.approved} />
        <Tile icon={<XCircle className="h-4 w-4 text-status-danger" />} label="Rejected" value={counts.rejected} />
      </div>

      <div className="inline-flex rounded-lg border bg-card p-1 text-sm">
        {(["all","pending","approved","rejected"] as const).map(t => (
          <button key={t} onClick={() => setFilter(t)}
                  className={`px-3 py-1 rounded ${filter === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {t[0].toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Submitted</th>
              <th className="text-left px-4 py-2">M-Pesa code</th>
              <th className="text-left px-4 py-2">Paybill ref</th>
              <th className="text-right px-4 py-2">Amount</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Reviewed</th>
              <th className="text-left px-4 py-2">Notes / Proof</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={7} className="text-center text-muted-foreground py-8">No proofs in this view.</td></tr>}
            {visible.map(p => (
              <tr key={p.id} className="border-t">
                <td className="px-4 py-2 text-xs whitespace-nowrap">{new Date(p.created_at).toLocaleString()}</td>
                <td className="px-4 py-2 font-mono">{p.mpesa_code}</td>
                <td className="px-4 py-2 font-mono text-xs">{p.paybill_reference}</td>
                <td className="px-4 py-2 text-right font-semibold">{fmt(p.amount_cents)}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{p.reviewed_at ? new Date(p.reviewed_at).toLocaleString() : "—"}</td>
                <td className="px-4 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    {p.proof_file_path && (
                      <button onClick={() => viewFile(p.proof_file_path)} className="text-primary inline-flex items-center gap-1 underline">
                        <FileText className="h-3 w-3" />View<ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                    {p.review_notes && <span className="text-muted-foreground truncate max-w-xs">{p.review_notes}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">{label}{icon}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Proof["status"] }) {
  const styles = {
    pending: "bg-status-warning/10 text-status-warning dark:bg-status-warning/40 dark:text-status-warning",
    approved: "bg-status-success/10 text-status-success dark:bg-status-success/40 dark:text-status-success",
    rejected: "bg-status-danger/10 text-status-danger dark:bg-status-danger/40 dark:text-status-danger",
  } as const;
  return <span className={`px-2 py-0.5 rounded text-xs ${styles[status]}`}>{status}</span>;
}
