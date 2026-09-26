import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StaffPageHeader } from "@/components/staff/primitives";
import { fetchRecentEvents, type OpsEventRow } from "@/lib/orchestration/api";
import { EVENT_LABEL, type EventType } from "@/lib/orchestration/events";
import { QUEUE_LABEL, type OpsQueue } from "@/lib/orchestration/rules";
import { cn } from "@/lib/utils";

const DISPOSITION_LABEL: Record<string, string> = {
  auto: "Handled automatically",
  staff_work: "Staff work created",
  approval: "Approval required",
  escalate: "Escalated on creation",
  notify_only: "Notification only",
  no_action: "No action",
};

/**
 * ORCHESTRATION STREAM — the audit of the decision layer itself.
 *
 * For every platform event: which portal it came from, which canonical record it
 * concerns, what the rules decided, and why. This is how the Staff Portal proves
 * it operationalises Super Admin information rather than duplicating it.
 */
export default function OrchestrationStream() {
  const [rows, setRows] = useState<OpsEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchRecentEvents(150)
      .then((r) => { setRows(r); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load events"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const autoCount = rows.filter((r) => r.disposition === "auto").length;

  return (
    <>
      <StaffPageHeader
        eyebrow="SAFARID Operations Centre"
        title="Orchestration stream"
        lede="Every platform event and the routing decision taken on it. Automation absorbs the routine; only exceptions become staff work."
        actions={<Button variant="outline" size="sm" onClick={load}>Refresh</Button>}
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-5">
          <div className="text-xs text-muted-foreground">Events shown</div>
          <div className="mt-1 text-2xl font-semibold">{rows.length}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="text-xs text-muted-foreground">Absorbed by automation</div>
          <div className="mt-1 text-2xl font-semibold">{autoCount}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="text-xs text-muted-foreground">Routed to people</div>
          <div className="mt-1 text-2xl font-semibold">{rows.length - autoCount}</div>
        </CardContent></Card>
      </div>

      <div className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Loading events…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No platform events recorded yet.</p>
        )}
        {rows.map((r) => (
          <Card key={r.id}>
            <CardContent className="pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {EVENT_LABEL[r.event_type as EventType] ?? r.event_type.replace(/_/g, " ")}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(r.occurred_at).toLocaleString()} · {r.source_portal.replace(/_/g, " ")} portal ·{" "}
                    {r.chain_stage.replace(/_/g, " ")} stage · {r.entity_type.replace(/_/g, " ")}
                    {r.entity_id ? ` ${r.entity_id.slice(0, 8)}…` : ""}
                  </div>
                  {r.decision_reasons?.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                      {r.decision_reasons.map((reason, i) => <li key={i}>· {reason}</li>)}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      r.disposition === "auto" && "border-success/50 text-success",
                      (r.disposition === "escalate") && "border-destructive/50 text-destructive",
                      r.disposition === "approval" && "border-warning/50 text-warning",
                    )}
                  >
                    {DISPOSITION_LABEL[r.disposition] ?? r.disposition}
                  </Badge>
                  {r.ops_queue && (
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                      {QUEUE_LABEL[r.ops_queue as OpsQueue] ?? r.ops_queue}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">SLA {r.sla_minutes}m</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
