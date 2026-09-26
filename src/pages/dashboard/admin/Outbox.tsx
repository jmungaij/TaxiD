import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RefreshCcw, RotateCcw, Play } from "lucide-react";

type OutboxRow = {
  id: string; aggregate: string; aggregate_id: string; event_type: string;
  status: string; attempts: number; last_error: string | null;
  next_attempt_at: string; created_at: string; processed_at: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "secondary", PROCESSING: "outline", RETRY: "outline",
  SUCCESS: "default", DLQ: "destructive",
};

export default function OutboxDashboard() {
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [stats, setStats] = useState({ pending: 0, retry: 0, dlq: 0, success_24h: 0 });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("event_outbox")
      .select("id, aggregate, aggregate_id, event_type, status, attempts, last_error, next_attempt_at, created_at, processed_at")
      .order("created_at", { ascending: false })
      .limit(200);
    setRows((data ?? []) as OutboxRow[]);

    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [{ count: p }, { count: r }, { count: d }, { count: s }] = await Promise.all([
      supabase.from("event_outbox").select("*", { count: "exact", head: true }).eq("status", "PENDING"),
      supabase.from("event_outbox").select("*", { count: "exact", head: true }).eq("status", "RETRY"),
      supabase.from("event_outbox").select("*", { count: "exact", head: true }).eq("status", "DLQ"),
      supabase.from("event_outbox").select("*", { count: "exact", head: true }).eq("status", "SUCCESS").gte("processed_at", since),
    ]);
    setStats({ pending: p ?? 0, retry: r ?? 0, dlq: d ?? 0, success_24h: s ?? 0 });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function runProcessor() {
    const { error } = await supabase.functions.invoke("outbox-processor", { body: {} });
    if (error) toast.error("Processor failed: " + error.message);
    else { toast.success("Processor run complete"); load(); }
  }

  async function replay(id: string) {
    const { error } = await supabase.rpc("replay_outbox_event", { _event_id: id });
    if (error) toast.error(error.message);
    else { toast.success("Replay queued"); load(); }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Event Outbox</h1>
          <p className="text-muted-foreground">At-least-once delivery, dead-letter queue, manual replay.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCcw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          <Button onClick={runProcessor}>
            <Play className="w-4 h-4 mr-2" /> Run processor
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Pending", v: stats.pending, tone: "text-foreground" },
          { label: "Retrying", v: stats.retry, tone: "text-status-warning" },
          { label: "DLQ", v: stats.dlq, tone: "text-destructive" },
          { label: "Delivered (24h)", v: stats.success_24h, tone: "text-status-success" },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{s.label}</CardTitle></CardHeader>
            <CardContent><div className={`text-3xl font-semibold ${s.tone}`}>{s.v}</div></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Recent events</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Aggregate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Next attempt</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.event_type}</TableCell>
                  <TableCell className="text-xs">{r.aggregate}<br /><span className="text-muted-foreground">{r.aggregate_id.slice(0, 8)}</span></TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge></TableCell>
                  <TableCell>{r.attempts}</TableCell>
                  <TableCell className="text-xs">{r.processed_at ? "—" : new Date(r.next_attempt_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate text-destructive">{r.last_error}</TableCell>
                  <TableCell>
                    {(r.status === "DLQ" || r.status === "RETRY") && (
                      <Button size="sm" variant="outline" onClick={() => replay(r.id)}>
                        <RotateCcw className="w-3 h-3 mr-1" /> Replay
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No events yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
