import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import { sendInterviewInvitation } from "@/lib/recruitment/invitations";
import { scheduleMeeting } from "@/lib/meetings/meetings";
import type { RecInterview } from "@/lib/recruitment/types";

const TIMEZONES = ["Africa/Nairobi", "Africa/Kampala", "Africa/Dar_es_Salaam", "Africa/Kigali", "UTC"];
const STAGES = ["screening_call", "first", "second", "panel", "final"];
const TYPES = ["competency", "technical", "case_study", "culture", "leadership"];
const MODES = ["virtual", "onsite", "phone"];
const PANEL_ROLES = ["interviewer", "chair", "hiring_manager", "hr", "observer"];

/** Converts a `datetime-local` value into an ISO instant. */
const toIso = (local: string) => new Date(local).toISOString();
const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scheduling a first interview for a shortlisted application. */
  applicationId?: string;
  /** Rescheduling / re-panelling an existing interview. */
  interview?: RecInterview | null;
  candidateLabel?: string;
  onDone?: () => void;
}

/**
 * One dialog for both scheduling and rescheduling. Every write goes through the
 * server-side RPCs, so stage rules, mode requirements, panel/candidate
 * double-booking and the audit trail are enforced in the database, not here.
 * A conflict is surfaced as a blocking warning that only an explicit override
 * reason can clear.
 */
export function InterviewScheduleDialog({
  open, onOpenChange, applicationId, interview, candidateLabel, onDone,
}: Props) {
  const qc = useQueryClient();
  const isReschedule = !!interview;

  const staff = useQuery({ queryKey: ["rec", "panel-staff"], queryFn: rec.listPanelStaff, enabled: open });
  const panelRows = useQuery({ queryKey: ["rec", "panel"], queryFn: rec.listInterviewPanel, enabled: open });

  const [when, setWhen] = useState("");
  const [timezone, setTimezone] = useState("Africa/Nairobi");
  const [stage, setStage] = useState("first");
  const [type, setType] = useState("competency");
  const [mode, setMode] = useState("virtual");
  const [duration, setDuration] = useState("45");
  const [location, setLocation] = useState("");
  const [link, setLink] = useState("");
  const [instructions, setInstructions] = useState("");
  const [reason, setReason] = useState("");
  const [panel, setPanel] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<string | null>(null);
  const [override, setOverride] = useState("");

  useEffect(() => {
    if (!open) return;
    setConflict(null);
    setOverride("");
    setReason("");
    if (interview) {
      setWhen(toLocalInput(interview.scheduled_at));
      setTimezone(interview.timezone ?? "Africa/Nairobi");
      setStage(interview.interview_stage);
      setType(interview.interview_type);
      setMode(interview.mode);
      setDuration(String(interview.duration_minutes ?? 45));
      setLocation(interview.location ?? "");
      setLink(interview.meeting_link ?? "");
      setInstructions(interview.instructions ?? "");
      const existing = (panelRows.data ?? []).filter((p) => p.interview_id === interview.id);
      setPanel(Object.fromEntries(existing.map((p) => [p.staff_id, p.panel_role])));
    } else {
      setWhen("");
      setPanel({});
      setStage("first");
      setMode("virtual");
      setDuration("45");
      setLocation("");
      setLink("");
      setInstructions("");
    }
  }, [open, interview, panelRows.data]);

  const panelList = useMemo(
    () => Object.entries(panel).map(([staff_id, panel_role]) => ({ staff_id, panel_role })),
    [panel],
  );

  const done = (message: string) => {
    toast.success(message);
    qc.invalidateQueries({ queryKey: ["rec"] });
    onOpenChange(false);
    onDone?.();
  };

  const fail = (e: Error) => {
    if (rec.isConflictError(e.message)) {
      setConflict(
        "This time clashes with another live interview for the candidate or a panel member. Choose another slot, or record an override reason to proceed.",
      );
      return;
    }
    toast.error(e.message);
  };

  const save = useMutation({
    mutationFn: async (): Promise<{ invited: boolean; note: string }> => {
      if (!when) throw new Error("Pick a date and time for the interview.");
      const minutes = Number(duration);
      if (!Number.isFinite(minutes) || minutes < 10) throw new Error("Duration must be at least 10 minutes.");
      let interviewId: string;
      // An online interview never needs a hand-typed link: Google mints one.
      let joinLink = link.trim();
      if (mode === "virtual" && !joinLink) {
        const minted = await scheduleMeeting({
          title: `Interview — ${stage.replace(/_/g, " ")}`,
          meeting_kind: "interview",
          platform: "google_meet",
          starts_at: toIso(when),
          duration_minutes: minutes,
          timezone,
          attendees: [{ email: "hr@safarid.org" }],
          mint_only: true,
        });
        if (!minted.join_url) throw new Error("The Google Meet link could not be created.");
        joinLink = minted.join_url;
        setLink(joinLink);
      }
      if (isReschedule) {
        if (!reason.trim()) throw new Error("Rescheduling needs a reason for the audit trail.");
        await rec.rescheduleInterview({
          interview_id: interview!.id,
          scheduled_at: toIso(when),
          reason: reason.trim(),
          timezone,
          duration_minutes: minutes,
          override_reason: override.trim() || null,
        });
        await rec.setInterviewPanel(interview!.id, panelList);
        interviewId = interview!.id;
      } else {
        if (!applicationId) throw new Error("No application selected.");
        const created = await rec.scheduleInterview({
          application_id: applicationId,
          scheduled_at: toIso(when),
          timezone,
          interview_stage: stage,
          interview_type: type,
          mode,
          duration_minutes: minutes,
          location: location.trim() || null,
          meeting_link: joinLink || null,
          instructions: instructions.trim() || null,
          panel: panelList,
          override_reason: override.trim() || null,
        });
        interviewId = created.interview_id;
      }

      // The meeting only counts as arranged once the calendar invitation is
      // actually accepted by the email provider. A refusal is reported as such —
      // the interview stays booked, but nobody is told it was sent.
      try {
        const sent = await sendInterviewInvitation(interviewId);
        return {
          invited: true,
          note: `Calendar invitation sent to ${sent.to}${sent.cc.length ? ` (panel copied)` : ""}.`,
        };
      } catch (e) {
        return { invited: false, note: e instanceof Error ? e.message : "The invitation was not delivered." };
      }
    },
    onSuccess: (r) => {
      if (r.invited) {
        done(`${isReschedule ? "Interview rescheduled" : "Interview scheduled"} — ${r.note}`);
        return;
      }
      toast.warning(
        `${isReschedule ? "Interview rescheduled" : "Interview scheduled"}, but no invitation went out: ${r.note}`,
      );
      qc.invalidateQueries({ queryKey: ["rec"] });
      onOpenChange(false);
      onDone?.();
    },
    onError: (e: Error) => fail(e),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            {isReschedule ? "Reschedule interview" : "Schedule interview"}
          </DialogTitle>
          <DialogDescription>
            {candidateLabel ? `${candidateLabel} · ` : ""}
            The server validates the stage, the panel’s availability and the candidate’s calendar before confirming.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="iv-when">Date and time</Label>
              <Input id="iv-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iv-tz">Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="iv-tz"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isReschedule && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="iv-stage">Stage</Label>
                <Select value={stage} onValueChange={setStage}>
                  <SelectTrigger id="iv-stage"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-type">Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="iv-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iv-mode">Mode</Label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger id="iv-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="iv-duration">Duration (minutes)</Label>
              <Input id="iv-duration" type="number" min={10} max={480} value={duration}
                onChange={(e) => setDuration(e.target.value)} />
            </div>
            {!isReschedule && mode === "virtual" && (
              <div className="space-y-1.5">
                <Label htmlFor="iv-link">Meeting link</Label>
                <Input id="iv-link" value={link} onChange={(e) => setLink(e.target.value)}
                  placeholder="Left blank — a Google Meet link is created for you" />
                <p className="text-xs text-muted-foreground">
                  Leave this empty and a Google Meet link is created automatically when the invitation is sent.
                </p>
              </div>
            )}
            {!isReschedule && mode !== "virtual" && (
              <div className="space-y-1.5">
                <Label htmlFor="iv-location">Location</Label>
                <Input id="iv-location" value={location} onChange={(e) => setLocation(e.target.value)}
                  placeholder="SAFARID HQ, Westlands" />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Users className="h-4 w-4" aria-hidden="true" /> Interview panel
            </Label>
            {staff.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading staff…</p>
            ) : (staff.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active staff records are available to form a panel yet.
              </p>
            ) : (
              <ScrollArea className="h-44 rounded-md border">
                <ul className="divide-y divide-border">
                  {(staff.data ?? []).map((s) => {
                    const selected = s.id in panel;
                    return (
                      <li key={s.id} className="flex items-center justify-between gap-3 p-2.5">
                        <label className="flex min-w-0 items-center gap-2.5">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(v) =>
                              setPanel((prev) => {
                                const next = { ...prev };
                                if (v) next[s.id] = next[s.id] ?? "interviewer";
                                else delete next[s.id];
                                return next;
                              })
                            }
                            aria-label={`Add ${s.full_name} to the panel`}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{s.full_name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{s.work_email ?? "—"}</span>
                          </span>
                        </label>
                        {selected && (
                          <Select
                            value={panel[s.id]}
                            onValueChange={(v) => setPanel((prev) => ({ ...prev, [s.id]: v }))}
                          >
                            <SelectTrigger className="w-[150px]" aria-label={`Panel role for ${s.full_name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PANEL_ROLES.map((r) => (
                                <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            )}
            <p className="text-xs text-muted-foreground">
              {panelList.length} panel member{panelList.length === 1 ? "" : "s"} selected
            </p>
          </div>

          {!isReschedule && (
            <div className="space-y-1.5">
              <Label htmlFor="iv-instructions">Candidate instructions</Label>
              <Textarea id="iv-instructions" rows={3} value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="What to prepare, who they will meet, what to bring." />
            </div>
          )}

          {isReschedule && (
            <div className="space-y-1.5">
              <Label htmlFor="iv-reason">Reason for rescheduling</Label>
              <Textarea id="iv-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Panel conflict, candidate request, operational priority…" />
            </div>
          )}

          {conflict && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Scheduling conflict
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{conflict}</p>
              <div className="mt-2 space-y-1.5">
                <Label htmlFor="iv-override">Override reason</Label>
                <Input id="iv-override" value={override} onChange={(e) => setOverride(e.target.value)}
                  placeholder="Why this clash is acceptable" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {conflict && override.trim() && <Badge variant="outline">Override will be audited</Badge>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending
              ? "Saving…"
              : isReschedule ? "Reschedule interview" : "Schedule interview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
