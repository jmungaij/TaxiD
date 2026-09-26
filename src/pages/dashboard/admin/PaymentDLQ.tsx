import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RefreshCcw, Play, AlertTriangle, PackagePlus } from "lucide-react";

type DLRow = {
  id: string;
  kind: string;
  payment_attempt_id: string | null;
  payload: Record<string, unknown>;
  last_error: string | null;
  attempts: number;
  status: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "secondary",
  REPLAYING: "outline",
  RESOLVED: "default",
  BLOCKED: "destructive",
};

const KIND_OPTIONS = [
  "missing_callback_success",
  "stale_stk_no_resolution",
  "daraja_success_local_incomplete",
  "wallet_missing_for_completed",
  "orphan_wallet_credit",
  "amount_variance",
];

export default function PaymentDLQ() {
  const [rows, setRows] = useState<DLRow[]>([]);
  const [stats, setStats] = useState({ pending: 0, replaying: 0, blocked: 0, resolved_24h: 0 });
  const [loading, setLoading] = useState(true);
  const [filterKind, setFilterKind] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<
    | { mode: "single"; row: DLRow }
    | { mode: "bulk"; ids: string[] }
    | { mode: "filtered"; kind?: string; status: "PENDING" | "BLOCKED"; limit: number }
    | null
  >(null);
  const [note, setNote] = useState("");
  const [replaying, setReplaying] = useState(false);

  async function load() {
    setLoading(true);
    let q = supabase.from("payment_dead_letters").select("*").order("created_at", { ascending: false }).limit(500);
    if (filterKind !== "all") q = q.eq("kind", filterKind);
    if (filterStatus !== "all") q = q.eq("status", filterStatus);
    const { data } = await q;
    setRows((data ?? []) as DLRow[]);
    setSelectedIds(new Set());

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [{ count: p }, { count: r }, { count: b }, { count: s }] = await Promise.all([
      supabase.from("payment_dead_letters").select("*", { count: "exact", head: true }).eq("status", "PENDING"),
      supabase.from("payment_dead_letters").select("*", { count: "exact", head: true }).eq("status", "REPLAYING"),
      supabase.from("payment_dead_letters").select("*", { count: "exact", head: true }).eq("status", "BLOCKED"),
      supabase.from("payment_dead_letters").select("*", { count: "exact", head: true }).eq("status", "RESOLVED").gte("resolved_at", since),
    ]);
    setStats({ pending: p ?? 0, replaying: r ?? 0, blocked: b ?? 0, resolved_24h: s ?? 0 });
    setLoading(false);
  }

  useEffect(() => { void load();   }, [filterKind, filterStatus]);

  const visible = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter((r) =>
      r.id.includes(s) || r.kind.includes(s) || (r.payment_attempt_id ?? "").includes(s) ||
      (r.last_error ?? "").toLowerCase().includes(s));
  }, [rows, search]);

  const eligibleIds = useMemo(
    () => visible.filter((r) => r.status === "PENDING").map((r) => r.id),
    [visible],
  );
  const allChecked = eligibleIds.length > 0 && eligibleIds.every((id) => selectedIds.has(id));

  function toggleAll() {
    const next = new Set(selectedIds);
    if (allChecked) eligibleIds.forEach((id) => next.delete(id));
    else eligibleIds.forEach((id) => next.add(id));
    setSelectedIds(next);
  }
  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function runReplay() {
    if (!dialog) return;
    if (!note.trim() || note.trim().length < 5) {
      toast.error("Note is required (min 5 chars) for audit trail");
      return;
    }
    setReplaying(true);
    try {
      const body: Record<string, unknown> = { note: note.trim() };
      if (dialog.mode === "single") body.dead_letter_id = dialog.row.id;
      else if (dialog.mode === "bulk") body.dead_letter_ids = dialog.ids;
      else {
        body.filter = { status: dialog.status, ...(dialog.kind ? { kind: dialog.kind } : {}) };
        body.limit = dialog.limit;
      }
      const { data, error } = await supabase.functions.invoke("payment-dlq-replay", { body });
      if (error) {
        toast.error("Replay failed: " + error.message);
      } else if (data?.results) {
        const c = data.counts ?? {};
        toast.success(`Batch done — resolved ${c.RESOLVED ?? 0}, blocked ${c.BLOCKED ?? 0}, skipped ${c.SKIPPED ?? 0}, failed ${c.PENDING ?? 0}`);
      } else if (data?.outcome === "BLOCKED") {
        toast.warning(`Blocked: ${data.note}`);
      } else {
        toast.success(`Replay ${data?.outcome ?? "queued"}: ${data?.note ?? ""}`);
      }
      setDialog(null); setNote("");
      await load();
    } finally {
      setReplaying(false);
    }
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Payment Dead-Letter Queue</h1>
          <p className="text-sm text-muted-foreground">Recover stuck M-Pesa payments. Every action is written to the immutable payment audit log.</p>
        </div>
        <Button variant="outline" onClick={() => load()} disabled={loading}>
          <RefreshCcw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Pending" value={stats.pending} tone="warn" />
        <StatCard label="Replaying" value={stats.replaying} />
        <StatCard label="Blocked" value={stats.blocked} tone="danger" />
        <StatCard label="Resolved (24h)" value={stats.resolved_24h} tone="ok" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Dead letters ({visible.length})</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="Search id / attempt / error…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
              <Select value={filterKind} onValueChange={setFilterKind}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Kind" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All kinds</SelectItem>
                  {KIND_OPTIONS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="REPLAYING">Replaying</SelectItem>
                  <SelectItem value="BLOCKED">Blocked</SelectItem>
                  <SelectItem value="RESOLVED">Resolved</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="secondary"
                disabled={selectedCount === 0}
                onClick={() => setDialog({ mode: "bulk", ids: Array.from(selectedIds) })}
              >
                <Play className="h-4 w-4 mr-2" />Replay selected ({selectedCount})
              </Button>
              <Button
                variant="outline"
                onClick={() => setDialog({
                  mode: "filtered",
                  kind: filterKind === "all" ? undefined : filterKind,
                  status: "PENDING",
                  limit: 25,
                })}
              >
                <PackagePlus className="h-4 w-4 mr-2" />Replay filtered
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Select all pending" />
                </TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Attempt ID</TableHead>
                <TableHead>Last error</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => {
                const canReplay = r.status === "PENDING" || r.status === "BLOCKED";
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Checkbox
                        disabled={r.status !== "PENDING"}
                        checked={selectedIds.has(r.id)}
                        onCheckedChange={() => toggleOne(r.id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.kind}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                    <TableCell>{r.attempts}</TableCell>
                    <TableCell className="font-mono text-xs">{r.payment_attempt_id?.slice(0, 8) ?? "—"}</TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground">{r.last_error ?? "—"}</TableCell>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={r.status === "BLOCKED" ? "outline" : "default"}
                        disabled={!canReplay || r.status === "RESOLVED"}
                        onClick={() => setDialog({ mode: "single", row: r })}
                      >
                        <Play className="h-3 w-3 mr-1" />Replay
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {visible.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No dead-letter entries.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) { setDialog(null); setNote(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              {dialog?.mode === "single" && "Replay dead letter"}
              {dialog?.mode === "bulk" && `Replay ${dialog.ids.length} selected`}
              {dialog?.mode === "filtered" && "Replay filtered set"}
            </DialogTitle>
            <DialogDescription>
              Each row is claimed atomically (PENDING → REPLAYING) so double-clicks and
              parallel operators cannot double-post. Skipped rows are safe.
            </DialogDescription>
          </DialogHeader>
          {dialog?.mode === "single" && (
            <div className="space-y-3 text-sm">
              <div><span className="text-muted-foreground">Kind:</span> <span className="font-mono">{dialog.row.kind}</span></div>
              <div><span className="text-muted-foreground">Attempts so far:</span> {dialog.row.attempts}</div>
              <div><span className="text-muted-foreground">Last error:</span> {dialog.row.last_error ?? "—"}</div>
              <pre className="text-xs bg-muted p-3 rounded max-h-56 overflow-auto">{JSON.stringify(dialog.row.payload, null, 2)}</pre>
            </div>
          )}
          {dialog?.mode === "bulk" && (
            <div className="text-sm text-muted-foreground">
              {dialog.ids.length} row(s) will be replayed serially. Non-PENDING rows are skipped.
            </div>
          )}
          {dialog?.mode === "filtered" && (
            <div className="text-sm text-muted-foreground space-y-2">
              <div>Server will pull up to <strong>{dialog.limit}</strong> rows matching:</div>
              <div className="font-mono text-xs bg-muted p-2 rounded">
                status = {dialog.status}{dialog.kind ? ` · kind = ${dialog.kind}` : ""}
              </div>
              <div className="text-xs">Rate limit: 30 rows / minute / admin. Idempotency-guarded.</div>
            </div>
          )}
          <div>
            <label className="text-sm font-medium">Audit note (required, min 5 chars)</label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="e.g. Daraja confirmed receipt out-of-band; replaying to close DLQ." />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setDialog(null); setNote(""); }}>Cancel</Button>
            <Button disabled={replaying || note.trim().length < 5} onClick={runReplay}>
              {replaying ? "Replaying…" : "Confirm replay"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "danger" }) {
  const color = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-status-warning" : tone === "ok" ? "text-status-success" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
