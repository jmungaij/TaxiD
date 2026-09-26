/**
 * LEAD FOLLOW-UP QUEUE — what was said, when, and the next action due.
 *
 * Follow-ups are appended, never edited: closing one records the outcome and
 * leaves the original note in place, so the chase history stays auditable.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { CalendarClock } from "lucide-react";
import { closeFollowUp, listFollowUps, type LeadFollowUp } from "@/lib/sales/leadDesk";
import { listMyLeads, type SalesLead } from "@/lib/sales/pipeline";

const nairobiToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());

function band(f: LeadFollowUp, today: string) {
  if (f.due_date < today) return "OVERDUE" as const;
  if (f.due_date === today) return "TODAY" as const;
  return "UPCOMING" as const;
}

function Row({
  f,
  lead,
  onChanged,
}: {
  f: LeadFollowUp;
  lead?: SalesLead;
  onChanged: () => void;
}) {
  const [outcome, setOutcome] = React.useState("");
  const close = useMutation({
    mutationFn: (status: "DONE" | "CANCELLED") =>
      closeFollowUp({ followup_id: f.id, outcome: outcome.trim(), status }),
    onSuccess: () => {
      toast({ title: "Follow-up closed" });
      setOutcome("");
      onChanged();
    },
    onError: (e: Error) =>
      toast({ title: "Not closed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {lead ? lead.organisation_name : "Lead"}{" "}
            <span className="text-xs text-muted-foreground">{lead?.lead_ref}</span>
          </p>
          <p className="text-sm text-muted-foreground">{f.next_action}</p>
        </div>
        <Badge variant="outline">Due {f.due_date}</Badge>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
        Logged {f.contact_date}: {f.logged_note}
      </p>
      {f.status === "OPEN" ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Input
            className="max-w-sm"
            placeholder="What happened? (required to close)"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!outcome.trim() || close.isPending}
            onClick={() => close.mutate("DONE")}
          >
            Mark done
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!outcome.trim() || close.isPending}
            onClick={() => close.mutate("CANCELLED")}
          >
            Cancel follow-up
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs">
          <span className="font-medium">{f.status === "DONE" ? "Done" : "Cancelled"}:</span>{" "}
          {f.outcome}
        </p>
      )}
    </div>
  );
}

export default function LeadFollowUpQueue() {
  const qc = useQueryClient();
  const today = nairobiToday();
  const followups = useQuery({ queryKey: ["lead-followups"], queryFn: () => listFollowUps() });
  const leads = useQuery({ queryKey: ["sales-leads"], queryFn: listMyLeads });

  const onChanged = () => {
    void qc.invalidateQueries({ queryKey: ["lead-followups"] });
    void qc.invalidateQueries({ queryKey: ["lead-desk-kpis"] });
  };

  if (followups.isLoading) return <Skeleton className="h-40 w-full" />;
  if (followups.error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">The follow-up queue could not be read.</p>
          <p className="text-muted-foreground">{(followups.error as Error).message}</p>
        </CardContent>
      </Card>
    );

  const all = followups.data ?? [];
  const leadById = new Map((leads.data ?? []).map((l) => [l.id, l]));
  const open = all.filter((f) => f.status === "OPEN");
  const groups: { key: string; title: string; rows: LeadFollowUp[] }[] = [
    { key: "OVERDUE", title: "Overdue", rows: open.filter((f) => band(f, today) === "OVERDUE") },
    { key: "TODAY", title: "Due today", rows: open.filter((f) => band(f, today) === "TODAY") },
    { key: "UPCOMING", title: "Upcoming", rows: open.filter((f) => band(f, today) === "UPCOMING") },
    { key: "CLOSED", title: "Closed", rows: all.filter((f) => f.status !== "OPEN").slice(0, 20) },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" aria-hidden /> Follow-up queue
        </CardTitle>
        <CardDescription>
          {open.length === 0
            ? "NO OPEN FOLLOW-UPS. Log one from a lead in the allocated leads view."
            : `${open.length} open · Nairobi date ${today}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {groups.map((g) =>
          g.rows.length === 0 ? null : (
            <div key={g.key} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {g.title} ({g.rows.length})
              </p>
              {g.rows.map((f) => (
                <Row key={f.id} f={f} lead={leadById.get(f.lead_id)} onChanged={onChanged} />
              ))}
            </div>
          ),
        )}
      </CardContent>
    </Card>
  );
}
