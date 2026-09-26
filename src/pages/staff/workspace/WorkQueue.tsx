/**
 * STAGE 3 — THE UNIFIED NOW EXECUTION SURFACE.
 *
 * NOW is primary: the system triages, the employee executes. WAITING, UPCOMING
 * and ALL are secondary lenses on the same canonical work set — not separate
 * inboxes. Nothing here owns state: every card resolves to its system of
 * record, and withheld domains are declared rather than approximated.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceIntelligence } from "@/hooks/useWorkspaceIntelligence";
import { PriorityCard, WorkloadStrip } from "@/components/staff/workspace/PriorityCard";
import { WorkspaceEmptyState } from "@/components/staff/workspace/WorkspaceEmptyState";
import { AiPanel } from "@/components/staff/workspace/AiPanel";
import { CommandCentre, useCommandCentre } from "@/components/staff/workspace/CommandCentre";
import type { DependencyGroup, WorkspaceItem } from "@/lib/workspace/intelligence";
import type { DailyBrief } from "@/lib/workspace/aiBrief";

const LANES = ["now", "waiting", "upcoming", "all"] as const;
type Lane = (typeof LANES)[number];

const LANE_LABEL: Record<Lane, string> = {
  now: "Now",
  waiting: "Waiting",
  upcoming: "Upcoming",
  all: "All",
};

function Withheld({ domains }: { domains: string[] }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="py-4 text-sm">
        <p className="font-semibold">Some of your book is not released to this account</p>
        <p className="mt-1 text-muted-foreground">
          {domains.join(", ")} could not be read for you, so nothing from {domains.length > 1 ? "them" : "it"} is
          triaged here rather than shown as an estimate. Ask an administrator for commercial read access.
        </p>
      </CardContent>
    </Card>
  );
}

/** STAGE 5 — the day-level brief: the shape of the day from real counts. */
function DayBrief({ brief }: { brief: DailyBrief }) {
  return (
    <Card className="border-primary/25 bg-primary/5">
      <CardContent className="space-y-1.5 p-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden /> {brief.headline}
        </p>
        {brief.lines.map((l) => (
          <p key={l} className="text-sm text-muted-foreground">
            {l}
          </p>
        ))}
        {brief.leadWith && <p className="pt-1 text-sm font-medium text-foreground">{brief.leadWith}</p>}
      </CardContent>
    </Card>
  );
}

function DependencyPanel({ groups }: { groups: DependencyGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-sm font-semibold">Who progress depends on</p>
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <Badge key={g.waitingOn} variant="outline" className="text-[11px]">
              {g.waitingOn} · {g.items.length}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LaneList({ items, empty }: { items: WorkspaceItem[]; empty: React.ReactNode }) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <PriorityCard key={item.key} item={item} />
      ))}
    </div>
  );
}

export default function WorkQueue() {
  const intel = useWorkspaceIntelligence();
  const commandCentre = useCommandCentre();
  const [params, setParams] = useSearchParams();
  const laneParam = params.get("lane");
  const lane: Lane = (LANES as readonly string[]).includes(laneParam ?? "") ? (laneParam as Lane) : "now";

  const setLane = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === "now") p.delete("lane");
    else p.set("lane", next);
    setParams(p, { replace: true });
  };

  const withheldDomains = [
    intel.withheld.opportunities && "Opportunities",
    intel.withheld.quotes && "Quotes",
    intel.withheld.contracts && "Contracts",
  ].filter((d): d is string => !!d);

  const nowItems = intel.lanes.now;
  const rest = nowItems.slice(1);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Work queue</h1>
          <p className="text-sm text-muted-foreground">
            Triaged for you from your work, promises, opportunities, quotes and contracts.
          </p>
        </div>
        <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => commandCentre.setOpen(true)}>
          <Search className="mr-1 h-3.5 w-3.5" aria-hidden />
          Search
          <kbd className="ml-2 rounded border bg-muted px-1 text-[10px] font-medium text-muted-foreground">
            &#8984;K
          </kbd>
        </Button>
        <Button size="sm" variant="outline" onClick={intel.reload} disabled={intel.loading}>
          {intel.loading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
          )}
          Refresh
        </Button>
        </div>
      </header>

      <CommandCentre
        open={commandCentre.open}
        onOpenChange={commandCentre.setOpen}
        index={intel.commandIndex}
        blindSpots={intel.blindSpots}
        loading={intel.loading}
      />

      {intel.identityMissing ? (
        <WorkspaceEmptyState
          title="Your employee record is not linked yet"
          message="Personal work can only be triaged once your staff profile is linked to your login."
          actions={[{ label: "Open my workspace", to: "/staff/workspace" }]}
        />
      ) : (
        <>
          {withheldDomains.length > 0 && <Withheld domains={withheldDomains} />}
          <DayBrief brief={intel.brief} />
          <AiPanel model={intel.aiPanel} />
          <WorkloadStrip workload={intel.workload} />

          {intel.loading && intel.items.length === 0 ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading your records…
            </div>
          ) : (
            <Tabs value={lane} onValueChange={setLane}>
              <TabsList>
                {LANES.map((l) => (
                  <TabsTrigger key={l} value={l}>
                    {LANE_LABEL[l]}
                    <span className="ml-1.5 text-xs text-muted-foreground">{intel.lanes[l].length}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="now" className="mt-4 space-y-4">
                {nowItems.length === 0 ? (
                  <WorkspaceEmptyState
                    title="Nothing needs you right now"
                    message="No overdue promise, stalled deal, expiring quote or unsigned contract is waiting on you. Waiting and Upcoming show what is in flight."
                    actions={[
                      { label: "See what you are waiting on", to: "/staff/workspace/work-queue?lane=waiting" },
                      { label: "Open my opportunities", to: "/staff/workspace/opportunities" },
                    ]}
                  />
                ) : (
                  <>
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Next best action
                      </p>
                      <PriorityCard item={nowItems[0]} lead />
                    </div>
                    {rest.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Then
                        </p>
                        <LaneList items={rest} empty={null} />
                      </div>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="waiting" className="mt-4 space-y-4">
                <DependencyPanel groups={intel.dependencies} />
                <LaneList
                  items={intel.lanes.waiting}
                  empty={
                    <WorkspaceEmptyState
                      title="Nothing is blocked on someone else"
                      message="No quote, contract or promise is currently sitting with a customer or an internal approver."
                      actions={[{ label: "Back to Now", to: "/staff/workspace/work-queue" }]}
                    />
                  }
                />
              </TabsContent>

              <TabsContent value="upcoming" className="mt-4">
                <LaneList
                  items={intel.lanes.upcoming}
                  empty={
                    <WorkspaceEmptyState
                      title="Nothing dated ahead"
                      message="Promises and dated commitments will appear here before they become due."
                      actions={[{ label: "Back to Now", to: "/staff/workspace/work-queue" }]}
                    />
                  }
                />
              </TabsContent>

              <TabsContent value="all" className="mt-4">
                <LaneList
                  items={intel.lanes.all}
                  empty={
                    <WorkspaceEmptyState
                      title="Your queue is empty"
                      message="Once work, promises or commercial records need action they are triaged here automatically."
                      actions={[{ label: "Open my workspace", to: "/staff/workspace" }]}
                    />
                  }
                />
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
