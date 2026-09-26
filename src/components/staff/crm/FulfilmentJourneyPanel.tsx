import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarClock, CheckCircle2, CircleDashed, FileText, Handshake, ListChecks, Target, TriangleAlert,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import * as crm from "@/lib/crm/api";
import * as journey from "@/lib/crm/journey";
import { titleise } from "@/lib/crm/types";

const STATUS_TONE: Record<journey.JourneyHopStatus, string> = {
  valid: "bg-success/10 text-success border-success/30",
  missing: "bg-destructive/10 text-destructive border-destructive/30",
  not_yet_reached: "border-border text-muted-foreground",
  invalid: "bg-warning/10 text-warning-foreground border-warning/30",
};

/**
 * Customer fulfilment control view. Extends Account 360 rather than adding a
 * parallel surface: everything shown is read from the existing spine, and the
 * only write offered is "create the recommended next action", which goes through
 * crm_create_next_action so the CRM pointer and the work item stay atomic.
 */
export default function FulfilmentJourneyPanel({
  accountId,
  accountName,
  ownerStaffId,
}: {
  accountId: string;
  accountName: string;
  ownerStaffId: string | null;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const nbaQ = useQuery({ queryKey: ["crm", "nba", accountId], queryFn: () => journey.nextBestAction(accountId) });
  const chainQ = useQuery({ queryKey: ["crm", "journey", accountId], queryFn: () => journey.verifyJourneyChain(accountId) });
  const commitQ = useQuery({ queryKey: ["crm", "commitments", accountId], queryFn: () => journey.listCommitments(accountId) });
  const artefactQ = useQuery({ queryKey: ["crm", "artefacts", accountId], queryFn: () => journey.listSharedArtefacts(accountId) });
  const workQ = useQuery({ queryKey: ["crm", "account-work", accountId], queryFn: () => journey.listAccountWork(accountId) });

  const hops = chainQ.data ?? [];
  const commitments = commitQ.data ?? [];
  const artefacts = artefactQ.data ?? [];
  const work = workQ.data ?? [];
  const nba = nbaQ.data;

  const score = useMemo(
    () => journey.buildScoreboard({ hops, commitments, work, artefacts }),
    [hops, commitments, work, artefacts],
  );

  const schedule = useMutation({
    mutationFn: async () => {
      if (!nba?.action || !ownerStaffId) throw new Error("No owning employee is assigned to this account.");
      return crm.createNextAction({
        accountId,
        staffId: ownerStaffId,
        title: nba.action,
        dueAt: nba.due_at ?? null,
        priority: nba.priority ?? "medium",
        opportunityId: nba.opportunity_id ?? null,
        slaMinutes: 2880,
      });
    },
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: (r) => {
      toast.success(`Next action created — work item ${r.workItemId.slice(0, 8)}`);
      qc.invalidateQueries({ queryKey: ["crm"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (chainQ.isLoading || nbaQ.isLoading) return <Skeleton className="h-96 w-full" />;

  const alreadyOwned = nba?.kind === "execute_existing";

  return (
    <div className="space-y-6">
      {/* NEXT BEST ACTION */}
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Target className="h-4 w-4 text-primary" /> Next best action
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-base font-semibold">{nba?.action ?? "No action derivable from the recorded state."}</p>
          <p className="text-sm text-muted-foreground">{nba?.rationale}</p>
          {nba?.expected_outcome ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Expected outcome: </span>
              {nba.expected_outcome}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {nba?.priority ? <Badge variant="outline">{titleise(nba.priority)} priority</Badge> : null}
            {nba?.due_at ? (
              <Badge variant="outline">
                <CalendarClock className="mr-1 h-3 w-3" /> Due {new Date(nba.due_at).toLocaleDateString()}
              </Badge>
            ) : null}
            {nba?.work_item_id ? (
              <Badge variant="outline">Work item <span className="ml-1 font-mono">{nba.work_item_id.slice(0, 8)}</span></Badge>
            ) : null}
            <Badge variant="outline">Capture {nba?.capture_completeness_pct ?? 0}%</Badge>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              disabled={busy || alreadyOwned || !nba?.action || !ownerStaffId}
              onClick={() => schedule.mutate()}
            >
              {alreadyOwned ? "Already owned as work" : "Accept — create owned work"}
            </Button>
            {!ownerStaffId ? (
              <span className="self-center text-xs text-destructive">
                Assign an owning employee before work can be created.
              </span>
            ) : null}
          </div>
          {alreadyOwned ? (
            <p className="text-xs text-muted-foreground">
              An owned next action already exists — execute or reschedule it in My Workspace rather than creating a duplicate.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* SCOREBOARD */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <ListChecks className="h-4 w-4" /> {accountName} fulfilment scoreboard
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4 lg:grid-cols-6 text-sm">
          <Stat label="Stages proven" value={`${score.reachedStages}/${hops.length}`} />
          <Stat label="Missing links" value={score.missingLinks} tone={score.missingLinks ? "bad" : "ok"} />
          <Stat label="Documents shared" value={score.documentsShared} />
          <Stat label="Commitments fulfilled" value={`${score.commitmentsFulfilled}/${score.commitmentsTotal}`} />
          <Stat label="Open commitments" value={score.commitmentsOpen} />
          <Stat label="SLA breached work" value={score.slaAtRisk} tone={score.slaAtRisk ? "bad" : "ok"} />
        </CardContent>
      </Card>

      {/* CUSTOMER COMMITMENTS */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Handshake className="h-4 w-4" /> Customer commitments
          </CardTitle>
        </CardHeader>
        <CardContent>
          {commitments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No customer commitment recorded. Commitments are promises to the customer — not internal tasks.
            </p>
          ) : (
            <ul className="space-y-2">
              {commitments.map((c) => {
                const overdue = journey.commitmentIsOverdue(c);
                return (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.commitment}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.direction === "yalla_to_customer" ? "Yalla → customer" : "Customer → Yalla"}
                        {c.expected_outcome ? ` · ${c.expected_outcome}` : ""}
                        {c.evidence_ref ? ` · Evidence: ${c.evidence_ref}` : " · Evidence: not yet captured"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {overdue ? (
                        <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                          <TriangleAlert className="mr-1 h-3 w-3" /> Overdue
                        </Badge>
                      ) : null}
                      <Badge
                        variant="outline"
                        className={c.status === "fulfilled" ? "border-success/30 bg-success/10 text-success" : undefined}
                      >
                        {c.status === "fulfilled" ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <CircleDashed className="mr-1 h-3 w-3" />}
                        {titleise(c.status)}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* SHARED ARTEFACTS */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4" /> Exactly what the customer received
          </CardTitle>
        </CardHeader>
        <CardContent>
          {artefacts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No document version has been shared yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead><TableHead>Version</TableHead>
                  <TableHead>Approval</TableHead><TableHead>Shared</TableHead><TableHead>Channel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {artefacts.map((a) => (
                  <TableRow key={a.shareId}>
                    <TableCell className="font-medium">{a.documentTitle}</TableCell>
                    <TableCell className="font-mono text-xs">{a.versionLabel}</TableCell>
                    <TableCell><Badge variant="outline">{titleise(a.approvalState)}</Badge></TableCell>
                    <TableCell>{new Date(a.sharedAt).toLocaleDateString()}</TableCell>
                    <TableCell>{titleise(a.channel)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* LINKED WORK */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Linked executable work</CardTitle>
        </CardHeader>
        <CardContent>
          {work.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No work item is linked to this account.</p>
          ) : (
            <ul className="space-y-2">
              {work.map((w) => (
                <li key={w.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{w.title}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline">{titleise(w.priority)}</Badge>
                      <Badge variant="outline">{titleise(w.lifecycle_state)}</Badge>
                      {w.sla_due_at ? <Badge variant="outline">SLA {new Date(w.sla_due_at).toLocaleDateString()}</Badge> : null}
                    </div>
                  </div>
                  {w.description ? <p className="mt-1 text-xs text-muted-foreground">{w.description}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* CHAIN PROOF */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Journey chain verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Completion is never assumed: a stage is proven only when a real record exists. Stages ahead of the
            current position are reported as not yet reached, not as failures.
          </p>
          <Separator />
          <ul className="divide-y divide-border">
            {hops.map((h) => (
              <li key={h.hop} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {journey.JOURNEY_HOP_LABELS[h.hop] ?? titleise(h.hop)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {h.detail ?? "—"} · <span className="font-mono">{h.entity}</span>
                  </p>
                </div>
                <Badge variant="outline" className={STATUS_TONE[h.status]}>
                  {journey.JOURNEY_STATUS_LABEL[h.status] ?? h.status}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "bad" }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${tone === "bad" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}
