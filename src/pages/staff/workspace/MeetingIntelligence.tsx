/**
 * STAGE 4 — CALENDAR & MEETING INTELLIGENCE.
 *
 * Meetings are read from the work spine, not a private diary. Each one carries
 * its own workflow: what to know before, what the records demand you cover, and
 * — after — Meeting → Decision → Action → Owner → Deadline. Recording the
 * outcome raises real work, so the queue re-triages itself automatically.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, Clock, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useWorkspaceIntelligence } from "@/hooks/useWorkspaceIntelligence";
import { WorkspaceEmptyState } from "@/components/staff/workspace/WorkspaceEmptyState";
import { followUpFromOutcome, groupByDay, prepareMeeting, type ScheduledMeeting } from "@/lib/workspace/meetings";
import { createSelfWork } from "@/lib/workspace/workEngine";

const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "No time recorded";

function OutcomeForm({ meeting, onRecorded }: { meeting: ScheduledMeeting; onRecorded: () => void }) {
  const [decision, setDecision] = React.useState("");
  const [action, setAction] = React.useState("");
  const [deadline, setDeadline] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!decision.trim() || !action.trim()) {
      toast({ title: "Record the decision and the action", description: "Both are required before follow-up work can be raised.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const draft = followUpFromOutcome(meeting, {
      decision,
      action,
      ownerLabel: "me",
      deadline: deadline ? new Date(`${deadline}T09:00:00`).toISOString() : null,
      notes,
    });
    const res = await createSelfWork({
      workKind: "customer_case",
      title: draft.title,
      requiredAction: draft.requiredAction,
      priority: draft.priority,
      dueAt: draft.dueAt,
      description: draft.description,
      accountId: draft.accountId,
    });
    setBusy(false);
    if (res.ok === false) {
      toast({ title: "Could not raise the follow-up", description: res.error, variant: "destructive" });
      return;
    }
    setDecision("");
    setAction("");
    setDeadline("");
    setNotes("");
    toast({ title: "Follow-up raised", description: "It now appears in your work queue." });
    onRecorded();
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        After the meeting — decision, action, deadline
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`d-${meeting.workId}`}>What was decided</Label>
        <Input id={`d-${meeting.workId}`} value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Customer accepted the revised rate" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`a-${meeting.workId}`}>What happens next</Label>
        <Input id={`a-${meeting.workId}`} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Reissue the quotation at the agreed rate" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`w-${meeting.workId}`}>By when</Label>
        <Input id={`w-${meeting.workId}`} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`n-${meeting.workId}`}>Notes (optional)</Label>
        <Textarea id={`n-${meeting.workId}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button size="sm" onClick={submit} disabled={busy}>
        {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
        Record outcome and raise the follow-up
      </Button>
    </div>
  );
}

export default function MeetingIntelligence() {
  const intel = useWorkspaceIntelligence();
  const days = React.useMemo(() => groupByDay(intel.meetings), [intel.meetings]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
          <p className="text-sm text-muted-foreground">
            Every meeting on your record, with the account context to prepare and the outcome that raises follow-up work.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={intel.reload} disabled={intel.loading}>
          {intel.loading ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
          )}
          Refresh
        </Button>
      </header>

      {intel.identityMissing ? (
        <WorkspaceEmptyState
          title="Your employee record is not linked yet"
          message="Meetings can only be read once your staff profile is linked to your login."
          actions={[{ label: "Open my workspace", to: "/staff/workspace" }]}
        />
      ) : intel.loading && intel.meetings.length === 0 ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading your diary…
        </div>
      ) : intel.meetings.length === 0 ? (
        <WorkspaceEmptyState
          title="No meeting is recorded for you"
          message="When a meeting is raised as work — by you or by the platform — it appears here with the customer context to prepare from."
          actions={[{ label: "Open the work queue", to: "/staff/workspace/work-queue" }]}
        />
      ) : (
        days.map((day) => (
          <section key={day.date} className="space-y-3">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="h-4 w-4 text-primary" aria-hidden /> {day.label}
            </h2>
            {day.meetings.map((m) => {
              const prep = prepareMeeting(m, intel.items);
              return (
                <Card key={m.workId}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" aria-hidden /> {timeOf(m.startsAt)} · {m.minutes} min
                      </span>
                      {m.subject && (
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {m.subject}
                        </span>
                      )}
                      <Badge variant={m.phase === "due" ? "destructive" : "secondary"} className="ml-auto text-[10px]">
                        {m.phase === "before" ? "Upcoming" : m.phase === "due" ? "Today" : "Record the outcome"}
                      </Badge>
                    </div>

                    <p className="font-semibold leading-snug">{m.title}</p>
                    {m.requiredAction && <p className="text-sm text-muted-foreground">{m.requiredAction}</p>}

                    {prep.note ? (
                      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{prep.note}</p>
                    ) : (
                      <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Know before you walk in
                        </p>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {prep.knowBefore.map((k) => (
                            <li key={k}>{k}</li>
                          ))}
                        </ul>
                        {prep.agenda.length > 0 && (
                          <>
                            <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Cover in the meeting
                            </p>
                            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                              {prep.agenda.map((a) => (
                                <li key={a}>{a}</li>
                              ))}
                            </ol>
                          </>
                        )}
                      </div>
                    )}

                    <OutcomeForm meeting={m} onRecorded={intel.reload} />

                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/staff/workspace/work-queue?lane=all`}>
                        Open in the work queue
                        <ArrowUpRight className="ml-1 h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
