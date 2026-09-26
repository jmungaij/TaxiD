import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, RefreshCw, PlayCircle } from "lucide-react";

interface OutboxStat {
  status: string;
  source_table: string;
  count: number;
}

interface OutboxRow {
  id: string;
  source_table: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  exported_at: string | null;
}

export default function AnalyticsExport() {
  const [stats, setStats] = useState<OutboxStat[]>([]);
  const [recent, setRecent] = useState<OutboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draining, setDraining] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from("analytics_export_outbox")
      .select("id, source_table, status, attempts, last_error, created_at, exported_at")
      .order("created_at", { ascending: false })
      .limit(50);
    setRecent(rows ?? []);

    // Aggregate counts client-side
    const { data: all } = await supabase
      .from("analytics_export_outbox")
      .select("status, source_table");
    const agg = new Map<string, OutboxStat>();
    (all ?? []).forEach((r: any) => {
      const k = `${r.status}|${r.source_table}`;
      const cur = agg.get(k) ?? { status: r.status, source_table: r.source_table, count: 0 };
      cur.count++;
      agg.set(k, cur);
    });
    setStats(Array.from(agg.values()));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const drain = async () => {
    setDraining(true);
    try {
      const { data, error } = await supabase.functions.invoke("bigquery-export");
      if (error) throw error;
      toast.success(`Drained: ${data?.exported ?? 0} rows${data?.dry_run ? " (dry-run)" : ""}`);
      await load();
    } catch (e) {
      toast.error(e.message ?? "Drain failed");
    } finally {
      setDraining(false);
    }
  };

  const pending = stats.filter(s => s.status === "PENDING").reduce((a, s) => a + s.count, 0);
  const exported = stats.filter(s => s.status === "EXPORTED").reduce((a, s) => a + s.count, 0);
  const failed = stats.filter(s => s.status === "FAILED").reduce((a, s) => a + s.count, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">BigQuery Analytics Export</h1>
          <p className="text-muted-foreground mt-1">
            Outbox-driven warehouse sync for ledger, journals, M-Pesa, settlements and audit hashes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={drain} disabled={draining}>
            {draining ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
            Drain queue now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle>Pending</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-status-warning">{pending}</div></CardContent></Card>
        <Card><CardHeader><CardTitle>Exported</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-status-success">{exported}</div></CardContent></Card>
        <Card><CardHeader><CardTitle>Failed</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-status-danger">{failed}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Queue by source table</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Count</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {stats.map((s) => (
                <TableRow key={`${s.source_table}-${s.status}`}>
                  <TableCell className="font-mono text-sm">{s.source_table}</TableCell>
                  <TableCell><Badge variant={s.status === "EXPORTED" ? "default" : s.status === "FAILED" ? "destructive" : "secondary"}>{s.status}</Badge></TableCell>
                  <TableCell className="text-right">{s.count}</TableCell>
                </TableRow>
              ))}
              {stats.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No queued events yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent events (50)</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead>Attempts</TableHead>
                <TableHead>Created</TableHead><TableHead>Exported</TableHead><TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.source_table}</TableCell>
                  <TableCell><Badge variant={r.status === "EXPORTED" ? "default" : r.status === "FAILED" ? "destructive" : "secondary"}>{r.status}</Badge></TableCell>
                  <TableCell>{r.attempts}</TableCell>
                  <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{r.exported_at ? new Date(r.exported_at).toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-xs text-status-danger max-w-[240px] truncate">{r.last_error ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
