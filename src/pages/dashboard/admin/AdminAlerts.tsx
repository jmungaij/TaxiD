import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Bell, Filter } from "lucide-react";

interface AlertEvent {
  id: string;
  rule_id: string | null;
  rule_name: string;
  stream: string;
  metric_key: string;
  observed_value: number | null;
  threshold: number | null;
  operator: string | null;
  severity: string;
  message: string;
  is_test: boolean;
  channels_dispatched: string[];
  created_at: string;
}

const SEVS = ["all", "info", "warning", "critical"];
const STREAMS = ["all", "trip", "driver", "finance"];

export default function AdminAlerts() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [severity, setSeverity] = useState("all");
  const [stream, setStream] = useState("all");
  const [ruleId, setRuleId] = useState("");
  const [rows, setRows] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const PAGE_SIZE = 100;

  async function load() {
    setLoading(true);
    setLoadError(null);
    const start = page * PAGE_SIZE;
    let q = (supabase as any).from("alerts_events")
      .select("*", { count: "exact" })
      .gte("created_at", `${from}T00:00:00Z`)
      .lte("created_at", `${to}T23:59:59Z`)
      .order("created_at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);
    if (severity !== "all") q = q.eq("severity", severity);
    if (stream !== "all") q = q.eq("stream", stream);
    if (ruleId) q = q.eq("rule_id", ruleId);
    const { data, count, error } = await q;
    if (error) {
      setLoadError(error.message);
      setRows([]);
      setTotal(null);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as AlertEvent[]);
    setTotal(count ?? null);
    setLoading(false);
  }

  useEffect(() => { setPage(0); }, [from, to, severity, stream, ruleId]);
  useEffect(() => { void load(); }, [from, to, severity, stream, ruleId, page]);

  useEffect(() => {
    const ch = supabase.channel(`alerts-events-live-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "alerts_events" },
        () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [from, to, severity, stream, ruleId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { info: 0, warning: 0, critical: 0, test: 0 };
    rows.forEach((r) => {
      c[r.severity] = (c[r.severity] ?? 0) + 1;
      if (r.is_test) c.test++;
    });
    return c;
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary" /> Executive Alerts Console
        </h1>
        <p className="text-sm text-muted-foreground">
          Review every alert fired across trip, driver, and finance streams — including simulated test events.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Critical</div>
          <div className="text-2xl font-bold text-destructive">{counts.critical ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Warning</div>
          <div className="text-2xl font-bold text-status-warning">{counts.warning ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Info</div>
          <div className="text-2xl font-bold">{counts.info ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Tests</div>
          <div className="text-2xl font-bold">{counts.test ?? 0}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div><Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div><Label className="text-xs">Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SEVS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label className="text-xs">Stream</Label>
              <Select value={stream} onValueChange={setStream}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STREAMS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label className="text-xs">Rule ID</Label>
              <Input placeholder="uuid" value={ruleId} onChange={(e) => setRuleId(e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">
          Events ({total ?? rows.length}{total !== null && total > PAGE_SIZE ? ` — showing ${rows.length}` : ""})
        </CardTitle></CardHeader>
        <CardContent>
          {loadError && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Alert events failed to load — this list is not authoritative. {loadError}
            </div>
          )}
          <Table>
            <TableHeader><TableRow>
              <TableHead>When</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Stream</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Channels</TableHead>
              <TableHead>Message</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={7}>Loading…</TableCell></TableRow>}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-muted-foreground">No alerts in range.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{r.rule_name}{r.is_test && <Badge variant="outline" className="ml-1">TEST</Badge>}</TableCell>
                  <TableCell><Badge variant="outline">{r.stream}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={r.severity === "critical" ? "destructive" : r.severity === "warning" ? "secondary" : "outline"}>
                      {r.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{r.observed_value ?? "—"} {r.operator} {r.threshold ?? ""}</TableCell>
                  <TableCell className="text-xs">{(r.channels_dispatched ?? []).join(", ") || "—"}</TableCell>
                  <TableCell className="text-xs max-w-md truncate">{r.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between pt-4">
            <span className="text-xs text-muted-foreground">
              Page {page + 1}{total !== null ? ` of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}` : ""}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={loading || page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || (total !== null && (page + 1) * PAGE_SIZE >= total)}
                onClick={() => setPage((p) => p + 1)}
              >Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
