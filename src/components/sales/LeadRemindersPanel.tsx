/**
 * STAGE REMINDERS — what has gone quiet, oldest first.
 *
 * A reminder exists only because a step carries a recorded date and the next
 * step does not, past the number of days leadership set. Snoozing needs a date,
 * dismissing needs a reason, and both are written to the lead's history.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { BellRing, Search } from "lucide-react";
import {
  REMINDER_ACTION,
  REMINDER_TITLE,
  dismissReminder,
  listReminders,
  reminderError,
  snoozeReminder,
  type LeadReminder,
} from "@/lib/sales/reminders";

function AckDialog({
  reminder,
  mode,
  onOpenChange,
  onDone,
}: {
  reminder: LeadReminder | null;
  mode: "SNOOZE" | "DISMISS";
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [until, setUntil] = React.useState("");
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    setUntil("");
    setNote("");
  }, [reminder?.lead_id, mode]);

  const m = useMutation({
    mutationFn: () => {
      if (!reminder) throw new Error("NOTHING_SELECTED");
      return mode === "SNOOZE"
        ? snoozeReminder(reminder.lead_id, reminder.reminder_kind, until)
        : dismissReminder(reminder.lead_id, reminder.reminder_kind, note.trim());
    },
    onSuccess: () => {
      toast({ title: mode === "SNOOZE" ? "Reminder snoozed" : "Reminder closed" });
      onOpenChange(false);
      onDone();
    },
    onError: (e: Error) =>
      toast({ title: "Not saved", description: reminderError(e.message), variant: "destructive" }),
  });

  const blocked =
    mode === "SNOOZE"
      ? !until || until <= new Date().toISOString().slice(0, 10)
      : note.trim().length < 5;

  return (
    <Dialog open={Boolean(reminder)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "SNOOZE" ? "Come back to this later" : "This reminder no longer applies"}
          </DialogTitle>
          <DialogDescription>
            {reminder?.organisation_name} · {reminder ? REMINDER_TITLE[reminder.reminder_kind] : ""}
          </DialogDescription>
        </DialogHeader>
        {mode === "SNOOZE" ? (
          <div>
            <Label htmlFor="snooze-until">Remind me again on</Label>
            <Input
              id="snooze-until"
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </div>
        ) : (
          <div>
            <Label htmlFor="dismiss-note">Why is this closed?</Label>
            <Textarea
              id="dismiss-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. client asked us to pause until their board meets"
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={blocked || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Saving…" : mode === "SNOOZE" ? "Snooze" : "Close reminder"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function LeadRemindersPanel({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const [term, setTerm] = React.useState("");
  const [selected, setSelected] = React.useState<LeadReminder | null>(null);
  const [mode, setMode] = React.useState<"SNOOZE" | "DISMISS">("SNOOZE");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sales-lead-reminders"],
    queryFn: listReminders,
  });

  const onDone = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ["lead-journey"] });
  };

  const all = data ?? [];
  const shown = all.filter((r) =>
    !term.trim()
      ? true
      : [r.organisation_name, r.lead_ref, r.staff_name, r.contact_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term.trim().toLowerCase())),
  );
  const list = compact ? shown.slice(0, 5) : shown;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4" aria-hidden /> Nothing forgotten
          {all.length > 0 && <Badge variant="outline">{all.length}</Badge>}
        </CardTitle>
        <CardDescription>
          Leads where the next step is overdue, oldest first. The days come from the dates already
          recorded on the lead.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!compact && all.length > 0 && (
          <div className="relative max-w-sm">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-8"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search these reminders"
              aria-label="Search reminders"
            />
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p className="text-muted-foreground">
            The reminders could not be read: {(error as Error).message}
          </p>
        ) : list.length === 0 ? (
          <p className="text-muted-foreground">
            {all.length === 0
              ? "Nothing is overdue. Every lead has had a step recorded inside the agreed window."
              : "No reminder matches that search."}
          </p>
        ) : (
          <ul className="space-y-2">
            {list.map((r) => (
              <li
                key={`${r.lead_id}-${r.reminder_kind}`}
                className="rounded-lg border p-3 sm:flex sm:items-start sm:justify-between sm:gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{r.organisation_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {REMINDER_TITLE[r.reminder_kind]} ·{" "}
                    {r.days_overdue === 0
                      ? "due today"
                      : `${r.days_overdue} day${r.days_overdue === 1 ? "" : "s"} past due`}
                    {!compact && ` · ${r.staff_name}`}
                  </p>
                  <p className="mt-1 text-xs">
                    {REMINDER_ACTION[r.reminder_kind]}
                    {r.awaiting_item ? ` — waiting for ${r.awaiting_item}` : ""}
                  </p>
                </div>
                <div className="mt-2 flex shrink-0 gap-1.5 sm:mt-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setMode("SNOOZE");
                      setSelected(r);
                    }}
                  >
                    Snooze
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setMode("DISMISS");
                      setSelected(r);
                    }}
                  >
                    Not needed
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {compact && shown.length > list.length && (
          <p className="text-xs text-muted-foreground">
            {shown.length - list.length} more on the sales desk.
          </p>
        )}
      </CardContent>

      <AckDialog
        reminder={selected}
        mode={mode}
        onOpenChange={(v) => !v && setSelected(null)}
        onDone={onDone}
      />
    </Card>
  );
}
