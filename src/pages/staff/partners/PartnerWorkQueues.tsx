/**
 * YALLA PARTNERS — staff work queues.
 *
 * Work, not master data: every row is a case tied to a partner, MobilityOrder,
 * journey or settlement, carrying its SLA clock, compliance flags, risk score
 * and the actions the signed-in staff member is authorised to take. State moves
 * only through `partner_case_action`, which validates the transition, demands a
 * reason where one is required and appends an immutable event.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, ShieldAlert, Timer } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  QUEUE_LABEL, actOnCase, caseSla, fetchCaseEvents, fetchCases, fetchQueueLoad, sortCases,
  type CaseAction, type CaseQueue, type PartnerCase,
} from "@/lib/partners/lifecycle";

const QUEUES: CaseQueue[] = ["onboarding", "compliance", "fulfilment", "finance", "risk", "capacity", "support"];

function SlaBadge({ item }: { item: PartnerCase }) {
  const sla = caseSla(item);
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] tracking-wide",
        sla.status === "breached" && "border-destructive/50 text-destructive",
        sla.status === "at_risk" && "border-warning/50 text-warning",
        sla.status === "on_track" && "border-info/50 text-info",
        sla.status === "met" && "border-success/50 text-success",
      )}
    >
      <Timer className="mr-1 h-3 w-3" aria-hidden /> {sla.label}
    </Badge>
  );
}

function CaseRow({ item, onAction }: { item: PartnerCase; onAction: (id: string, action: CaseAction) => void }) {
  const [open, setOpen] = useState(false);
  const events = useQuery({ queryKey: ["yp-case-events", item.id], queryFn: () => fetchCaseEvents(item.id), enabled: open });

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{item.title}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{item.work_code}</span> · {QUEUE_LABEL[item.queue]}
            {item.order_id ? " · order case" : item.journey_id ? " · journey case" : ""}
            {item.partner_id ? (
              <>
                {" · "}
                <Link to={`/staff/partners/${item.partner_id}`} className="underline hover:no-underline">Partner 360</Link>
              </>
            ) : null}
          </p>
          {item.detail ? <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p> : null}
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[10px] uppercase">{item.priority}</Badge>
            <Badge variant="outline" className="text-[10px] uppercase">{item.state.split("_").join(" ")}</Badge>
            <SlaBadge item={item} />
            {item.compliance_flags.map((f) => (
              <Badge key={f} variant="outline" className="border-warning/50 text-[10px] text-warning">
                <ShieldAlert className="mr-1 h-3 w-3" aria-hidden /> {f.split("_").join(" ")}
              </Badge>
            ))}
            {Number(item.risk_score) > 0 && (
              <Badge variant="outline" className="text-[10px]">risk {Number(item.risk_score)}</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {item.state === "open" && <Button size="sm" variant="outline" onClick={() => onAction(item.id, "claim")}>Claim</Button>}
          {item.state !== "escalated" && item.state !== "closed" && (
            <Button size="sm" variant="outline" onClick={() => onAction(item.id, "escalate")}>
              <ArrowUpRight className="mr-1 h-3.5 w-3.5" aria-hidden /> Escalate
            </Button>
          )}
          {item.state !== "waiting" && <Button size="sm" variant="outline" onClick={() => onAction(item.id, "wait")}>Wait</Button>}
          <Button size="sm" onClick={() => onAction(item.id, "resolve")}>Resolve</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Hide trail" : "Trail"}</Button>
        </div>
      </div>

      {open && (
        <ol className="ml-1 space-y-1.5 border-l-2 border-border pl-3">
          {(events.data ?? []).map((e) => (
            <li key={e.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{e.action}</span>
              {e.from_state ? ` · ${e.from_state} → ${e.to_state}` : ""} · {new Date(e.created_at).toLocaleString()}
              {e.note ? <span className="block">{e.note}</span> : null}
            </li>
          ))}
          {(events.data ?? []).length === 0 && <li className="text-xs text-muted-foreground">No recorded actions yet.</li>}
        </ol>
      )}
    </li>
  );
}

export default function PartnerWorkQueues() {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const cases = useQuery({ queryKey: ["yp-cases"], queryFn: () => fetchCases({ openOnly: true }) });
  const load = useQuery({ queryKey: ["yp-queue-load"], queryFn: fetchQueueLoad });

  const act = useMutation({
    mutationFn: (v: { id: string; action: CaseAction }) => actOnCase(v.id, v.action, reason),
    onSuccess: (_d, v) => {
      toast.success(`Case ${v.action}d.`);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["yp-cases"] });
      void qc.invalidateQueries({ queryKey: ["yp-queue-load"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Action failed."),
  });

  const rows = useMemo(() => sortCases(cases.data ?? []), [cases.data]);
  const breached = rows.filter((r) => caseSla(r).status === "breached").length;

  const onAction = (id: string, action: CaseAction) => {
    if (["wait", "escalate", "resolve", "close"].includes(action) && !reason.trim()) {
      toast.error("Record a reason before changing case state.");
      return;
    }
    act.mutate({ id, action });
  };

  if (cases.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-9 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="Yalla Partners Operations System"
        title="Partner work queues"
        lede="Every open partner case with its SLA clock, compliance flags and escalation path. Actions are recorded against the case forever."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(load.data ?? []).slice(0, 4).map((l) => (
          <div key={l.queue} className="glass-panel rounded-xl border border-border/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{QUEUE_LABEL[l.queue]}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{l.open_cases}</p>
            <p className="mt-1 text-xs text-muted-foreground">{l.breached} overdue · {l.escalated} escalated</p>
          </div>
        ))}
        {(load.data ?? []).length === 0 && (
          <div className="glass-panel rounded-xl border border-border/60 p-4 text-sm text-muted-foreground">
            No partner cases have been raised yet.
          </div>
        )}
      </div>

      {breached > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden /> {breached} case(s) are past their SLA target.
        </p>
      )}

      <div className="max-w-xl">
        <Label htmlFor="yp-case-reason" className="text-xs">Reason (required to wait, escalate, resolve or close)</Label>
        <Input id="yp-case-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did you find, and what did you do?" />
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="all">All open ({rows.length})</TabsTrigger>
          {QUEUES.map((q) => (
            <TabsTrigger key={q} value={q}>{QUEUE_LABEL[q]}</TabsTrigger>
          ))}
        </TabsList>

        {["all", ...QUEUES].map((tab) => {
          const list = tab === "all" ? rows : rows.filter((r) => r.queue === tab);
          return (
            <TabsContent key={tab} value={tab}>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{tab === "all" ? "All open partner cases" : `${QUEUE_LABEL[tab as CaseQueue]} queue`}</CardTitle>
                </CardHeader>
                <CardContent>
                  {list.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing open in this queue.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {list.map((item) => <CaseRow key={item.id} item={item} onAction={onAction} />)}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
