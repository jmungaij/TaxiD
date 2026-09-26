/**
 * Admin view: recent KYB export audit trail, grouped by request_token.
 *
 * Every corporate KYB CSV/PDF export writes an `export_audit_log` row into
 * `corporate_document_audit_log` with the computed idempotency token in
 * `detail.request_token`. Dedupe hits (Retry storms, reused tokens) show up
 * as multiple rows sharing the same token — grouping by token lets an
 * operator see, at a glance, which exports actually hit the network and
 * which were reused, and confirm no filter drift.
 *
 * Mismatch rows (`export_audit_log_mismatch`) are surfaced as a distinct
 * red group at the top so the on-call has zero ambiguity when a token was
 * replayed with a different filter set.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, AlertTriangle, FileDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Detail = {
  format?: "csv" | "pdf";
  request_token?: string;
  event_count?: number;
  document_ids?: string[];
  filters?: unknown;
  conflict_field?: string;
  prior?: unknown;
  current?: unknown;
};

type Row = {
  id: string;
  corporate_id: string | null;
  action: string;
  actor_id: string | null;
  actor_role: string | null;
  detail: Detail;
  created_at: string;
};

type Group = {
  token: string;
  fmt: "csv" | "pdf" | "unknown";
  first_at: string;
  last_at: string;
  attempts: Row[];
  successes: number;
  deduped_reuses: number;
  mismatches: Row[];
};

function groupByToken(rows: Row[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const token = r.detail?.request_token ?? "(no-token)";
    const fmt = (r.detail?.format as Group["fmt"]) ?? "unknown";
    let g = map.get(token);
    if (!g) {
      g = { token, fmt, first_at: r.created_at, last_at: r.created_at,
            attempts: [], successes: 0, deduped_reuses: 0, mismatches: [] };
      map.set(token, g);
    }
    g.attempts.push(r);
    if (r.created_at < g.first_at) g.first_at = r.created_at;
    if (r.created_at > g.last_at) g.last_at = r.created_at;
    if (r.action === "export_audit_log_mismatch") g.mismatches.push(r);
    else g.successes++;
    if (fmt !== "unknown") g.fmt = fmt;
  }
  // A group with >1 success is a real dedupe reuse (multiple attempts audited
  // for the same request intent). Mismatches are counted separately.
  for (const g of map.values()) {
    g.deduped_reuses = Math.max(0, g.successes - 1);
  }
  return Array.from(map.values()).sort((a, b) => b.last_at.localeCompare(a.last_at));
}

export default function AdminExportAuditTrail() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(200);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from("corporate_document_audit_log")
      .select("id, corporate_id, action, actor_id, actor_role, detail, created_at")
      .in("action", ["export_audit_log", "export_audit_log_mismatch"])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) setError(error.message);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => groupByToken(rows), [rows]);
  const mismatchGroups = groups.filter((g) => g.mismatches.length > 0);
  const dedupedGroups = groups.filter((g) => g.mismatches.length === 0 && g.deduped_reuses > 0);
  const cleanGroups = groups.filter((g) => g.mismatches.length === 0 && g.deduped_reuses === 0);

  const toggle = (token: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary">KYB Export Audit Trail</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recent CSV/PDF exports, grouped by request token. Multiple attempts on the same token
            indicate retries collapsed by the idempotency guard. Mismatches surface at the top.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                  className="h-9 rounded-md border bg-background px-2 text-sm">
            {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>Last {n}</option>)}
          </select>
          <Button size="sm" onClick={load} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border bg-status-danger/10 dark:bg-status-danger/20 p-3 text-sm text-status-danger dark:text-status-danger">
          {error}
        </div>
      )}

      {mismatchGroups.length > 0 && (
        <Card className="border-status-danger/30 dark:border-status-danger/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-status-danger dark:text-status-danger">
              <AlertTriangle className="h-5 w-5" />
              Token / filter mismatches ({mismatchGroups.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {mismatchGroups.map((g) => (
              <GroupRow key={g.token} g={g} expanded={expanded.has(g.token)} onToggle={() => toggle(g.token)} tone="mismatch" />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5 text-primary" />
            Reused (deduped) tokens ({dedupedGroups.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dedupedGroups.length === 0 && (
            <div className="text-sm text-muted-foreground">No dedupe reuses in the current window.</div>
          )}
          {dedupedGroups.map((g) => (
            <GroupRow key={g.token} g={g} expanded={expanded.has(g.token)} onToggle={() => toggle(g.token)} tone="dedupe" />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Single-attempt exports ({cleanGroups.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {cleanGroups.map((g) => (
            <GroupRow key={g.token} g={g} expanded={expanded.has(g.token)} onToggle={() => toggle(g.token)} tone="clean" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function GroupRow({
  g, expanded, onToggle, tone,
}: { g: Group; expanded: boolean; onToggle: () => void; tone: "mismatch" | "dedupe" | "clean" }) {
  const border = tone === "mismatch"
    ? "border-status-danger/30 dark:border-status-danger/30"
    : tone === "dedupe" ? "border-status-warning/30 dark:border-status-warning/30" : "border-border";
  return (
    <div className={cn("rounded-lg border bg-card", border)}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted/30"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-90")} />
          <code className="text-xs font-mono truncate">{g.token}</code>
          <Badge variant="outline" className="uppercase text-[10px]">{g.fmt}</Badge>
          {g.mismatches.length > 0 && (
            <Badge className="bg-status-danger hover:bg-status-danger">{g.mismatches.length} mismatch</Badge>
          )}
          {g.deduped_reuses > 0 && (
            <Badge className="bg-status-warning hover:bg-status-warning">{g.deduped_reuses} reuse</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {new Date(g.first_at).toISOString().slice(0, 19).replace("T", " ")}
          {g.first_at !== g.last_at && <> → {new Date(g.last_at).toISOString().slice(11, 19)}</>}
          {" · "}{g.attempts.length} row{g.attempts.length === 1 ? "" : "s"}
        </div>
      </button>
      {expanded && (
        <div className="border-t px-4 py-3 space-y-2 bg-muted/10">
          {g.attempts.map((r) => (
            <div key={r.id} className="text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{new Date(r.created_at).toISOString().slice(0, 19).replace("T", " ")}</span>
                <Badge variant={r.action === "export_audit_log_mismatch" ? "destructive" : "secondary"} className="text-[10px]">
                  {r.action}
                </Badge>
                <span className="text-muted-foreground">actor={r.actor_role ?? "?"} · {r.actor_id?.slice(0, 8) ?? "?"}</span>
              </div>
              <pre className="mt-1 p-2 rounded bg-background border overflow-x-auto text-[11px]">
{JSON.stringify(r.detail, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { groupByToken };
