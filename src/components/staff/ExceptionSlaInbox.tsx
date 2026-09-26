/**
 * Operator SLA inbox for Phase 8.5 exceptions.
 *
 * Assignment, acknowledge, triage, resolve and escalate are server-authorised:
 * the controls only render when the database says this operator may act, and
 * every action writes an append-only audit entry visible in the timeline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClock, ArrowUpRight, CheckCircle2, ClipboardList, History, Inbox as InboxIcon,
  RefreshCw, ShieldAlert, Siren, UserCheck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatCents } from "@/lib/staff/phase85/closureEngine";
import {
  ACTION_LABELS, acknowledgeException, assignException, escalateException, loadExceptionInbox,
  loadExceptionTimeline, resolveException, slaLabel, sweepSlaBreaches, triageException,
  type AuditEntry, type Inbox, type InboxAssignee, type InboxItem, type InboxScope,
} from "@/lib/staff/phase85/exceptionInbox";

const SCOPES: { key: InboxScope; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "breached", label: "SLA breached" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

function StatusBadge({ status }: { status: string }) {
  const tone = status === "resolved" || status === "closed"
    ? "border-success/30 bg-success/15 text-success"
    : status === "escalated"
      ? "border-destructive/30 bg-destructive/15 text-destructive"
      : status === "in_progress" || status === "acknowledged"
        ? "border-info/30 bg-info/10 text-info"
        : "border-border bg-muted text-muted-foreground";
  return <Badge variant="outline" className={tone}>{status.replace(/_/g, " ")}</Badge>;
}

export default function ExceptionSlaInbox({ onTrace }: { onTrace?: (ref: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<InboxScope>("open");
  const [assignee, setAssignee] = useState<InboxAssignee>("any");
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [selected, setSelected] = useState<InboxItem | null>(null);
  const [timeline, setTimeline] = useState<AuditEntry[]>([]);
  const [mode, setMode] = useState<"triage" | "resolve" | null>(null);
  const [rootCause, setRootCause] = useState("");
  const [recommended, setRecommended] = useState("");
  const [severity, setSeverity] = useState<string>("keep");
  const [resolution, setResolution] = useState("");
  const [impact, setImpact] = useState("");
  const [learning, setLearning] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await loadExceptionInbox(scope, assignee);
    setInbox(res);
    setLoading(false);
    if (!res.ok) toast.error(res.error === "not_authorised" ? "You do not have access to the exception inbox." : (res.error ?? "Inbox unavailable."));
  }, [scope, assignee]);

  useEffect(() => { void load(); }, [load]);

  const canAct = inbox?.canAct === true;
  const stats = inbox?.stats;

  const openTimeline = async (item: InboxItem) => {
    setSelected(item);
    setTimeline([]);
    const res = await loadExceptionTimeline(item.id);
    if (res.ok) setTimeline(res.entries);
    else toast.error(res.error ?? "Timeline unavailable.");
  };

  const after = (message: string) => {
    toast.success(message);
    void load();
  };

  const doAssign = async (item: InboxItem) => {
    setBusy(true);
    const res = await assignException(item.id);
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Assignment refused."); return; }
    after(`${item.exception_ref} assigned to you.`);
  };

  const doAck = async (item: InboxItem) => {
    setBusy(true);
    const res = await acknowledgeException(item.id);
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Acknowledgement refused."); return; }
    after(`${item.exception_ref} acknowledged.`);
  };

  const doEscalate = async (item: InboxItem) => {
    setBusy(true);
    const res = await escalateException(item.id, "Manual escalation from operator inbox");
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Escalation refused."); return; }
    after(`${item.exception_ref} escalated to level ${res.escalationLevel ?? "next"}.`);
  };

  const doSweep = async () => {
    setBusy(true);
    const res = await sweepSlaBreaches();
    setBusy(false);
    if (!res.ok) { toast.error(res.error ?? "Sweep refused."); return; }
    after(res.escalated === 0 ? "No unescalated SLA breaches found." : `${res.escalated} breached exception(s) escalated and audited.`);
  };

  const openForm = (item: InboxItem, which: "triage" | "resolve") => {
    setSelected(item);
    setMode(which);
    setRootCause(item.root_cause ?? "");
    setRecommended(item.recommended_action ?? "");
    setSeverity("keep");
    setResolution("");
    setImpact("");
    setLearning("");
  };

  const submitForm = async () => {
    if (!selected || !mode) return;
    setBusy(true);
    const res = mode === "triage"
      ? await triageException({
          exceptionId: selected.id, rootCause: rootCause.trim(),
          recommendedAction: recommended.trim() || undefined,
          severity: severity === "keep" ? undefined : severity,
        })
      : await resolveException({
          exceptionId: selected.id, resolution: resolution.trim(),
          financialImpactCents: impact.trim() ? Math.round(Number(impact) * 100) : null,
          learning: learning.trim() || undefined,
        });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error === "root_cause_required" ? "A root cause is required to triage."
        : res.error === "resolution_required" ? "A resolution note is required."
        : (res.error ?? "Action refused."));
      return;
    }
    const ref = selected.exception_ref;
    setMode(null);
    setSelected(null);
    after(mode === "triage" ? `${ref} triaged.` : `${ref} resolved${res.resolvedAfterBreach ? " after SLA breach" : ""}.`);
  };

  const tiles = useMemo(() => ([
    { label: "Open", value: stats?.open ?? 0, icon: InboxIcon },
    { label: "Unassigned", value: stats?.unassigned ?? 0, icon: ClipboardList },
    { label: "Assigned to me", value: stats?.mine ?? 0, icon: UserCheck },
    { label: "SLA breached", value: stats?.breached ?? 0, icon: Siren },
    { label: "Open exposure", value: formatCents(stats?.exposure_cents ?? 0), icon: AlarmClock },
  ]), [stats]);

  return (
    <div className="space-y-4">
      {!loading && !canAct ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Read-only view. Assignment, acknowledgement, triage, resolution and escalation require operations,
            finance or admin authority and are refused server-side for other roles.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2 text-xs">
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-xl font-semibold tabular-nums">{t.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base">Operator SLA inbox</CardTitle>
            <CardDescription>
              Ranked by SLA breach first, then by priority score. Every action is recorded in an append-only audit
              trail with the operator's identity.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Select value={assignee} onValueChange={(v) => setAssignee(v as InboxAssignee)}>
              <SelectTrigger className="w-[11rem]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Anyone</SelectItem>
                <SelectItem value="me">Assigned to me</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => void doSweep()} disabled={busy || !canAct}>
              <Siren className="mr-2 h-4 w-4" /> Escalate breaches
            </Button>
            <Button size="icon" variant="outline" onClick={() => void load()} aria-label="Refresh inbox">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={scope} onValueChange={(v) => setScope(v as InboxScope)}>
            <TabsList className="flex-wrap">
              {SCOPES.map((s) => <TabsTrigger key={s.key} value={s.key}>{s.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>

          {loading ? <Skeleton className="h-48 w-full" /> : (inbox?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing in this queue.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Exception</TableHead><TableHead>Stage / kind</TableHead>
                    <TableHead className="text-right">At risk</TableHead>
                    <TableHead>SLA</TableHead><TableHead>Status</TableHead><TableHead>Owner</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inbox?.items.map((item) => {
                    const closed = item.status === "resolved" || item.status === "closed";
                    return (
                      <TableRow key={item.id} className={item.breached ? "bg-destructive/5" : undefined}>
                        <TableCell>
                          <div className="font-medium">{item.exception_ref}</div>
                          {item.transaction_ref ? (
                            onTrace ? (
                              <button className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                                onClick={() => onTrace(item.transaction_ref as string)}>
                                {item.transaction_ref} <ArrowUpRight className="inline h-3 w-3" />
                              </button>
                            ) : <div className="text-xs text-muted-foreground">{item.transaction_ref}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="capitalize">{item.stage?.replace(/_/g, " ")}</div>
                          <div className="text-muted-foreground">{item.kind} · {item.severity}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCents(item.value_at_risk_cents ?? 0)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={item.breached ? "font-medium text-destructive" : "text-muted-foreground"}>
                            {slaLabel(item)}
                          </span>
                          {item.escalation_level ? (
                            <div className="text-muted-foreground">escalation L{item.escalation_level}</div>
                          ) : null}
                        </TableCell>
                        <TableCell><StatusBadge status={item.status} /></TableCell>
                        <TableCell className="max-w-[12rem] truncate text-xs">
                          {item.assignee_email ?? item.owner_team ?? "unassigned"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => void openTimeline(item)}>
                              <History className="h-3.5 w-3.5" />
                            </Button>
                            {canAct && !closed ? (
                              <>
                                {!item.assigned_to ? (
                                  <Button size="sm" variant="outline" disabled={busy}
                                    onClick={() => void doAssign(item)}>Take</Button>
                                ) : null}
                                {!item.acknowledged_at ? (
                                  <Button size="sm" variant="outline" disabled={busy}
                                    onClick={() => void doAck(item)}>Ack</Button>
                                ) : null}
                                <Button size="sm" variant="outline" disabled={busy}
                                  onClick={() => openForm(item, "triage")}>Triage</Button>
                                <Button size="sm" disabled={busy}
                                  onClick={() => openForm(item, "resolve")}>Resolve</Button>
                                {item.breached ? (
                                  <Button size="sm" variant="ghost" disabled={busy}
                                    onClick={() => void doEscalate(item)}>Escalate</Button>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Triage / resolve */}
      <Dialog open={mode !== null} onOpenChange={(o) => { if (!o) { setMode(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "triage" ? "Triage exception" : "Resolve exception"} — {selected?.exception_ref}
            </DialogTitle>
            <DialogDescription>
              {mode === "triage"
                ? "Record the root cause and the action you recommend. This is written to the audit trail."
                : "State how the exception was resolved. The financial impact is optional but recommended when money moved."}
            </DialogDescription>
          </DialogHeader>
          {mode === "triage" ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="rc">Root cause</Label>
                <Textarea id="rc" value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={3} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ra">Recommended action</Label>
                <Textarea id="ra" value={recommended} onChange={(e) => setRecommended(e.target.value)} rows={2} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sev">Severity</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger id="sev"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Leave unchanged</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="res">Resolution</Label>
                <Textarea id="res" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="imp">Financial impact (KES)</Label>
                <Input id="imp" type="number" value={impact} onChange={(e) => setImpact(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lrn">Learning captured</Label>
                <Textarea id="lrn" value={learning} onChange={(e) => setLearning(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
            <Button onClick={() => void submitForm()} disabled={busy}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {mode === "triage" ? "Save triage" : "Resolve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit timeline */}
      <Dialog open={selected !== null && mode === null} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audit trail — {selected?.exception_ref}</DialogTitle>
            <DialogDescription>
              Append-only record of every operator action, including SLA state at the time.
            </DialogDescription>
          </DialogHeader>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No actions recorded yet for this exception.</p>
          ) : (
            <ol className="space-y-3">
              {timeline.map((e) => (
                <li key={e.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</span>
                    {e.sla_state ? <Badge variant="outline" className="text-xs">{e.sla_state.replace(/_/g, " ")}</Badge> : null}
                    <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {e.actor_email ?? "system"} · {e.source}
                    {e.status_before || e.status_after
                      ? ` · ${e.status_before ?? "—"} → ${e.status_after ?? "—"}` : ""}
                  </div>
                  {e.note ? <p className="mt-2 text-xs">{e.note}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
