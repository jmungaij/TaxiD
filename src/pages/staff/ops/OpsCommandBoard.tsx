import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StaffPageHeader } from "@/components/staff/primitives";
import WorkItemDrawer from "@/components/staff/ops/WorkItemDrawer";
import { PriorityBadge, QueueBadge, SlaBadge, StateBadge, EntityRef } from "@/components/staff/ops/opsPrimitives";
import { useOpsWork } from "@/hooks/useOpsWork";
import { OPS_QUEUES, QUEUE_LABEL, type OpsQueue } from "@/lib/orchestration/rules";
import type { DecoratedWork } from "@/lib/orchestration/api";
import { cn } from "@/lib/utils";

/**
 * OPERATIONS COMMAND BOARD — live, actionable, not decorative.
 *
 * Columns follow the marketplace chain: demand and matching, independent supply,
 * fulfilment, money, trust. Every tile is a filter into real work a person can
 * open and action; no tile is a static number.
 */
const COLUMNS: { title: string; caption: string; queues: OpsQueue[] }[] = [
  { title: "Demand & matching", caption: "Requirements that cannot yet be served by independent supply", queues: ["dispatch_fulfilment", "sales_revenue"] },
  { title: "Independent supply", caption: "Provider onboarding, eligibility and performance interventions", queues: ["supply_operations"] },
  { title: "Fulfilment", caption: "Rides, parcels, freight, rentals and charter missions in flight", queues: ["delivery_logistics", "rental_leasing", "charter_aviation"] },
  { title: "Money", caption: "Payments, settlements to providers, corporate billing", queues: ["finance", "corporate_operations"] },
  { title: "Trust & customers", caption: "Safety, fraud, compliance and service recovery", queues: ["trust_safety", "customer_operations"] },
];

export default function OpsCommandBoard() {
  const { items, loading, error, reload, myQueues } = useOpsWork();
  const [queueFilter, setQueueFilter] = useState<OpsQueue | null>(null);
  const [selected, setSelected] = useState<DecoratedWork | null>(null);

  const byQueue = useMemo(() => {
    const map = new Map<OpsQueue, DecoratedWork[]>();
    for (const q of OPS_QUEUES) map.set(q, []);
    for (const w of items) if (w.ops_queue) map.get(w.ops_queue)?.push(w);
    return map;
  }, [items]);

  const open = items.filter((w) => w.lifecycle_state !== "resolved" && w.lifecycle_state !== "closed");
  const breached = open.filter((w) => w.sla.status === "breached").length;
  const atRisk = open.filter((w) => w.sla.status === "at_risk").length;
  const escalated = open.filter((w) => w.lifecycle_state === "escalated").length;
  const approvals = open.filter((w) => w.needs_approval).length;

  const visible = queueFilter ? (byQueue.get(queueFilter) ?? []) : open;

  return (
    <>
      <StaffPageHeader
        eyebrow="SAFARID Operations Centre"
        title="Operations command board"
        lede="The live state of the marketplace where humans are needed. SAFARID orchestrates demand and independent supply — this board shows where that orchestration needs a person."
        actions={<Button variant="outline" size="sm" onClick={reload}>Refresh</Button>}
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Open work", value: open.length },
          { label: "SLA breached", value: breached, tone: "destructive" },
          { label: "SLA at risk", value: atRisk, tone: "warning" },
          { label: "Escalated", value: escalated, tone: "destructive" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-5">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className={cn("mt-1 text-2xl font-semibold",
                k.tone === "destructive" && k.value > 0 && "text-destructive",
                k.tone === "warning" && k.value > 0 && "text-warning")}>{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        {COLUMNS.map((col) => (
          <Card key={col.title} className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{col.title}</CardTitle>
              <p className="text-xs text-muted-foreground">{col.caption}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {col.queues.map((q) => {
                const rows = (byQueue.get(q) ?? []).filter((w) => w.lifecycle_state !== "closed" && w.lifecycle_state !== "resolved");
                const granted = myQueues.length === 0 || myQueues.includes(q);
                return (
                  <button
                    key={q}
                    type="button"
                    disabled={!granted}
                    onClick={() => setQueueFilter(queueFilter === q ? null : q)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors",
                      queueFilter === q ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                      !granted && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <div className="text-sm font-medium">{QUEUE_LABEL[q]}</div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{rows.length} open</span>
                      {rows.some((w) => w.sla.status === "breached") && (
                        <span className="text-destructive">{rows.filter((w) => w.sla.status === "breached").length} breached</span>
                      )}
                    </div>
                    {!granted && <div className="mt-1 text-[11px] text-muted-foreground">Not in your remit</div>}
                  </button>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {queueFilter ? QUEUE_LABEL[queueFilter] : "All open work in my remit"}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{visible.length} items · {approvals} awaiting approval</span>
          </h2>
          {queueFilter && <Button variant="ghost" size="sm" onClick={() => setQueueFilter(null)}>Clear filter</Button>}
        </div>

        <div className="mt-4 space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading work…</p>}
          {!loading && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">No work outstanding — automation is handling the routine flow.</p>
          )}
          {visible.map((w) => (
            <Card key={w.id}>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{w.title}</div>
                    <div className="mt-1"><EntityRef type={w.entity_type} id={w.entity_id} entityRef={w.entity_ref} /></div>
                    {w.required_action && <p className="mt-2 text-sm text-muted-foreground">{w.required_action}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <QueueBadge queue={w.ops_queue} />
                    <StateBadge state={w.lifecycle_state} />
                    <PriorityBadge priority={w.priority} />
                    <SlaBadge sla={w.sla} />
                    <Button size="sm" onClick={() => setSelected(w)}>Action</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <WorkItemDrawer work={selected} open={!!selected} onOpenChange={(v) => !v && setSelected(null)} onChanged={reload} />
    </>
  );
}
