import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RefreshCcw, ShieldAlert } from "lucide-react";
import { applyGuardedTransition, CONFLICT_MESSAGE } from "@/lib/platform/guardedTransition";

type Case = {
  id: string;
  case_number: string;
  payment_ref: string | null;
  entity_type: string;
  entity_id: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  severity: string;
  signals: unknown;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
};

const SEV_COLOR: Record<string, string> = {
  low: "bg-status-success/10 text-status-success",
  medium: "bg-status-warning/10 text-status-warning",
  high: "bg-status-warning/10 text-status-warning",
  critical: "bg-status-danger/10 text-status-danger",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "secondary",
  reviewing: "outline",
  confirmed: "destructive",
  dismissed: "default",
  escalated: "destructive",
};


export default function FraudCases() {
  const [rows, setRows] = useState<Case[]>([]);
  const [stats, setStats] = useState({ open: 0, investigating: 0, critical: 0, resolved_24h: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Case | null>(null);
  const [note, setNote] = useState("");
  const [resolving, setResolving] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("payment_fraud_cases")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) setLoadError(error.message);
    setRows((data ?? []) as Case[]);

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [o, i, c, s] = await Promise.all([
      supabase.from("payment_fraud_cases").select("*", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("payment_fraud_cases").select("*", { count: "exact", head: true }).eq("status", "reviewing"),
      supabase.from("payment_fraud_cases").select("*", { count: "exact", head: true }).eq("severity", "critical").in("status", ["open", "reviewing"]),
      supabase.from("payment_fraud_cases").select("*", { count: "exact", head: true }).in("status", ["dismissed", "confirmed", "escalated"]).gte("resolved_at", since),
    ]);
    const statErr = [o, i, c, s].find((r) => r.error)?.error;
    if (statErr && !error) setLoadError(statErr.message);
    setStats({ open: o.count ?? 0, investigating: i.count ?? 0, critical: c.count ?? 0, resolved_24h: s.count ?? 0 });
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function resolve(status: "dismissed" | "confirmed" | "reviewing") {
    if (!selected) return;
    setResolving(true);
    try {
      const patch: Record<string, unknown> = {
        status,
        notes: note ? `${selected.notes ?? ""}\n[admin] ${note}` : selected.notes,
        ...(status === "dismissed" || status === "confirmed" ? { resolved_at: new Date().toISOString() } : {}),
      };
      const res = await applyGuardedTransition({
        table: "payment_fraud_cases",
        id: selected.id,
        expectedStates: ["open", "reviewing"],
        patch,
        audit: { flow: "fraud_case_review", action: `fraud_case.${status}`, entity_type: "payment_fraud_cases" },
      });
      if (res.outcome === "error") toast.error(res.message ?? "Update failed");
      else if (res.outcome === "conflict") toast.warning(res.message ?? CONFLICT_MESSAGE);
      else {
        toast.success(`Case ${selected.case_number} → ${status}`);
        if (res.auditFailed) toast.warning("Transition applied but the audit entry was rejected.");
      }
      if (res.outcome !== "error") {
        setSelected(null);
        setNote("");
      }
      await load();
    } finally {
      setResolving(false);
    }

  }


  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Fraud Cases</h1>
          <p className="text-sm text-muted-foreground">Triage cases opened by fraud-engine-v2. Clearing/confirming updates the case audit trail.</p>
        </div>
        <Button variant="outline" onClick={() => load()} disabled={loading}>
          <RefreshCcw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Failed to load fraud cases — counts below may be incomplete. {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Open" value={stats.open} tone="warn" />
        <Stat label="Investigating" value={stats.investigating} />
        <Stat label="Critical active" value={stats.critical} tone="danger" />
        <Stat label="Resolved (24h)" value={stats.resolved_24h} tone="ok" />
      </div>

      <Card>
        <CardHeader><CardTitle>Cases ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.case_number}</TableCell>
                  <TableCell><span className={`px-2 py-0.5 rounded text-xs ${SEV_COLOR[r.severity] ?? ""}`}>{r.severity}</span></TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                  <TableCell>{r.amount ? `${r.currency} ${r.amount.toLocaleString()}` : "—"}</TableCell>
                  <TableCell className="text-xs">{r.entity_type}</TableCell>
                  <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => { setSelected(r); setNote(""); }}>
                      <ShieldAlert className="h-3 w-3 mr-1" />Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No fraud cases.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Case {selected?.case_number}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex gap-2 text-sm">
                <Badge variant={STATUS_VARIANT[selected.status] ?? "outline"}>{selected.status}</Badge>
                <span className={`px-2 py-0.5 rounded text-xs ${SEV_COLOR[selected.severity] ?? ""}`}>{selected.severity}</span>
              </div>
              <div className="text-sm text-muted-foreground">{selected.notes}</div>
              <div>
                <div className="text-xs font-medium mb-1">Signals</div>
                <pre className="text-xs bg-muted p-3 rounded max-h-64 overflow-auto">{JSON.stringify(selected.signals, null, 2)}</pre>
              </div>
              <div>
                <label className="text-sm font-medium">Investigator note</label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={800} rows={3} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
            <Button variant="outline" disabled={resolving} onClick={() => resolve("reviewing")}>Mark reviewing</Button>
            <Button variant="default" disabled={resolving} onClick={() => resolve("dismissed")}>Dismiss</Button>
            <Button variant="destructive" disabled={resolving} onClick={() => resolve("confirmed")}>Confirm fraud</Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "danger" }) {
  const color = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-status-warning" : tone === "ok" ? "text-status-success" : "text-foreground";
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
    </CardContent></Card>
  );
}
