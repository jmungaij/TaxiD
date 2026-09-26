/**
 * Corporate admin audit log — every `corporate_admin_actions` event with
 * filters (corporate, action, result, actor, date range) and CSV export so a
 * governance reviewer can reconstruct exactly what an admin did and when.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { invokeCorporateConsole } from "@/lib/corporate/manageAs";
import { downloadCsv, toCsv } from "@/lib/csv";

interface AuditRow {
  id: string;
  admin_user_id?: string | null;
  corporate_id?: string | null;
  session_id?: string | null;
  action: string;
  payload?: Record<string, unknown> | null;
  result?: string | null;
  error_reason?: string | null;
  correlation_id?: string | null;
  created_at?: string | null;
}

const when = (v?: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

const ANY = "__any__";

export default function CorporateAdminAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState(ANY);
  const [result, setResult] = useState(ANY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invokeCorporateConsole<{
        actions: AuditRow[];
        corporate_names: Record<string, string>;
        known_actions: string[];
      }>({
        op: "audit_log",
        limit: 1000,
        ...(action !== ANY ? { action } : {}),
        ...(result !== ANY ? { result } : {}),
        ...(from ? { from: new Date(from).toISOString() } : {}),
        ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
      });
      setRows(res.actions ?? []);
      setNames(res.corporate_names ?? {});
      setActions(res.known_actions ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [action, result, from, to]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.action, r.result, r.correlation_id, r.admin_user_id, names[r.corporate_id ?? ""], JSON.stringify(r.payload ?? {})]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, query, names]);

  function exportCsv() {
    if (!visible.length) {
      toast({ title: "Nothing to export", description: "No audit events match the current filters." });
      return;
    }
    downloadCsv(
      `corporate-admin-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(visible.map((r) => ({
        created_at: r.created_at ?? "",
        action: r.action,
        result: r.result ?? "",
        corporate: r.corporate_id ? names[r.corporate_id] ?? r.corporate_id : "",
        corporate_id: r.corporate_id ?? "",
        admin_user_id: r.admin_user_id ?? "",
        session_id: r.session_id ?? "",
        correlation_id: r.correlation_id ?? "",
        error_reason: r.error_reason ?? "",
        payload: JSON.stringify(r.payload ?? {}),
      }))),
    );
    toast({ title: "Export ready", description: `${visible.length} audit events downloaded.` });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Corporate admin audit log</h1>
          <p className="text-sm text-muted-foreground">
            Immutable record of every admin action taken on a corporate account or booking decision.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" data-analytics="admin.corporate_admin_audit.export_csv" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="audit-action">Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="audit-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All actions</SelectItem>
                {actions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-result">Result</Label>
            <Select value={result} onValueChange={setResult}>
              <SelectTrigger id="audit-result"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All results</SelectItem>
                <SelectItem value="applied">Applied</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-from">From</Label>
            <Input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-to">To</Label>
            <Input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-search">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="audit-search"
                className="pl-8"
                placeholder="Actor, payload, correlation…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{visible.length} events</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 flex items-center gap-2 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" /> {error}
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Corporate</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Loading audit trail…
                </TableCell></TableRow>
              )}
              {!loading && visible.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No audit events for these filters.
                </TableCell></TableRow>
              )}
              {visible.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{when(r.created_at)}</TableCell>
                  <TableCell className="font-medium">{r.action}</TableCell>
                  <TableCell>
                    {r.corporate_id ? (
                      <Link className="underline-offset-2 hover:underline" to={`/dashboard/admin/corporates/${r.corporate_id}`}>
                        {names[r.corporate_id] ?? r.corporate_id.slice(0, 8)}
                      </Link>
                    ) : <span className="text-muted-foreground">Platform</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.result === "failed" ? "destructive" : "outline"}>
                      {r.result ?? "applied"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[420px] truncate text-xs text-muted-foreground">
                    {r.error_reason ?? JSON.stringify(r.payload ?? {})}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
