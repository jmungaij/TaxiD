/**
 * Concierge approval audit trail (admin).
 *
 * Immutable, append-only record of every approval request drafted by the AI
 * mobility concierge: the drafted policy/contract clauses, submitter identity,
 * timestamps and workflow status transitions.
 */
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SeoHead } from "@/components/seo/SeoHead";
import { ReportExportMenu } from "@/components/executive/ReportExportMenu";
import { FileLock2, RefreshCw, ShieldCheck } from "lucide-react";
import {
  groupByReference, loadConciergeApprovalAudit, type ConciergeAuditRow,
} from "@/lib/corporate/conciergeApprovalAudit";
import type { ReportTable } from "@/lib/corporate/executiveExports";

const EVENT_TONE: Record<string, string> = {
  submitted: "bg-primary/15 text-primary border-primary/30",
  drafted: "bg-muted text-muted-foreground",
  submit_failed: "bg-destructive/15 text-destructive border-destructive/30",
  status_changed: "bg-primary/10 text-primary border-primary/30",
};

function auditReport(rows: ConciergeAuditRow[]): ReportTable {
  return {
    id: "concierge-approval-audit",
    title: "SAFARID · concierge approval audit trail",
    subtitle: "Append-only record of AI-drafted approval requests",
    meta: [["Entries", String(rows.length)]],
    columns: ["Timestamp", "Reference", "Event", "From", "To", "Submitter", "Amount KES", "Clauses"],
    rows: rows.map((r) => [
      r.created_at,
      r.reference,
      r.event,
      r.from_status ?? "",
      r.to_status ?? "",
      r.actor_email ?? r.actor_id ?? "",
      r.amount_kes ?? "",
      r.clauses.map((c) => c.title).join("; "),
    ]),
  };
}

export default function ConciergeApprovalAudit() {
  const [rows, setRows] = React.useState<ConciergeAuditRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [event, setEvent] = React.useState("all");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadConciergeApprovalAudit({
        reference: search.trim() || undefined,
        event: event === "all" ? undefined : event,
      });
      setRows(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load audit trail");
    } finally {
      setLoading(false);
    }
  }, [search, event]);

  React.useEffect(() => { void load();   }, [event]);

  const groups = React.useMemo(() => groupByReference(rows), [rows]);

  return (
    <div className="space-y-6">
      <SeoHead
        title="Concierge Approval Audit | SAFARID"
        description="Immutable audit trail of AI concierge-generated corporate approval requests, clauses, submitters and workflow transitions."
        path="/dashboard/admin/concierge-approval-audit"
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FileLock2 className="h-5 w-5" aria-hidden /> Concierge approval audit
          </h1>
          <p className="text-sm text-muted-foreground">
            Append-only trail — entries can never be edited or deleted.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load(); }}
            placeholder="Search reference…"
            className="h-9 w-[200px]"
            aria-label="Search by reference"
          />
          <Select value={event} onValueChange={setEvent}>
            <SelectTrigger className="h-9 w-[170px]" aria-label="Filter by event">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              <SelectItem value="drafted">Drafted</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="submit_failed">Submit failed</SelectItem>
              <SelectItem value="status_changed">Status changed</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="sr-only">Refresh</span>
          </Button>
          <ReportExportMenu label="Export trail" build={() => auditReport(rows)} disabled={!rows.length} />
        </div>
      </header>

      {loading && rows.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No concierge approval activity recorded yet.
          </CardContent>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.reference}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden /> {g.reference}
                </CardTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {g.status && <Badge variant="outline">{g.status}</Badge>}
                  <span>{g.events.length} entries</span>
                  <time dateTime={g.latestAt}>{new Date(g.latestAt).toLocaleString("en-KE")}</time>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 border-l border-border/60 pl-4">
                {g.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-2 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
                    <div className="rounded-md border border-border/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={EVENT_TONE[e.event] ?? EVENT_TONE.drafted}>
                          {e.event.replace(/_/g, " ")}
                        </Badge>
                        {(e.from_status || e.to_status) && (
                          <span className="text-xs text-muted-foreground">
                            {e.from_status ?? "—"} → {e.to_status ?? "—"}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {e.actor_email ?? e.actor_id ?? "system"}
                        </span>
                        <time className="text-xs text-muted-foreground" dateTime={e.created_at}>
                          {new Date(e.created_at).toLocaleString("en-KE")}
                        </time>
                        {e.amount_kes != null && (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            KES {Number(e.amount_kes).toLocaleString("en-KE")}
                          </span>
                        )}
                      </div>
                      {e.clauses.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {e.clauses.map((c) => (
                            <li key={c.id}>
                              <span className="font-medium text-foreground">{c.title}</span>
                              {c.clause ? ` — ${c.clause}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                      {typeof e.payload.justification === "string" && (
                        <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">
                          {e.payload.justification}
                        </p>
                      )}
                      {typeof e.payload.error === "string" && (
                        <p className="mt-2 text-xs text-destructive">{e.payload.error}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
