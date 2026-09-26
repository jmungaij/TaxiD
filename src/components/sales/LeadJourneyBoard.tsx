/**
 * LEAD JOURNEY BOARD — the specialist's daily surface.
 *
 * One lead, one row, one next step. Everything shown is a record: the dates
 * come from the database, "won" carries the revenue the database accepted, and
 * a loss carries the reason chosen at the time.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { CalendarClock, Clock, Pencil, Search } from "lucide-react";
import EditLeadDetailsDialog from "@/components/sales/EditLeadDetailsDialog";
import {
  JOURNEY_LABEL,
  JOURNEY_STEPS,
  KES,
  LOSS_ERROR,
  LOSS_REASONS,
  LOSS_REASON_LABEL,
  journeyStep,
  lossDetailProblem,
  lossRequirement,
  matchesLeadSearch,
  missingContact,
  type LossDetail,
  listJourneyLeads,
  logStep,
  markLost,
  markWon,
  nextSteps,
  setWaiting,
  type JourneyLead,
  type JourneyStep,
  type LossReasonCode,
} from "@/lib/sales/journey";

const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE") : null);

function StepBadge({ step }: { step: JourneyStep }) {
  const tone =
    step === "WON"
      ? "bg-success/10 text-success border-success/30"
      : step === "LOST"
        ? "bg-muted text-muted-foreground"
        : step === "CONTRACT"
          ? "bg-primary/10 text-primary border-primary/30"
          : "bg-accent/10 text-accent-foreground border-border";
  return (
    <Badge variant="outline" className={tone}>
      {JOURNEY_LABEL[step]}
    </Badge>
  );
}

function LostDialog({
  lead,
  open,
  onOpenChange,
  onDone,
}: {
  lead: JourneyLead;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [code, setCode] = React.useState<LossReasonCode | "">("");
  const [detail, setDetail] = React.useState<LossDetail>({});
  const need = code ? lossRequirement(code) : null;
  const problem = lossDetailProblem(code, detail);

  const reset = () => {
    setCode("");
    setDetail({});
  };

  const m = useMutation({
    mutationFn: () =>
      markLost(lead.id, code as LossReasonCode, {
        note: detail.note?.trim() || undefined,
        competitor: detail.competitor?.trim() || undefined,
        expected_price_kes: detail.expected_price_kes?.trim() || undefined,
        revisit_date: detail.revisit_date || undefined,
      }),
    onSuccess: () => {
      toast({ title: "Recorded as lost" });
      onOpenChange(false);
      reset();
      onDone();
    },
    onError: (e: Error) =>
      toast({
        title: "Not recorded",
        description: LOSS_ERROR[e.message] ?? e.message,
        variant: "destructive",
      }),
  });

  const set = (k: keyof LossDetail) => (v: string) => setDetail((d) => ({ ...d, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why did we lose {lead.organisation_name}?</DialogTitle>
          <DialogDescription>
            The reason and its detail are both required — that is what makes won-versus-lost
            reporting worth reading.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Reason</Label>
            <Select
              value={code}
              onValueChange={(v) => {
                setCode(v as LossReasonCode);
                setDetail({});
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {LOSS_REASONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {need === "COMPETITOR" && (
            <div>
              <Label htmlFor={`lost-comp-${lead.id}`}>Who won it? (required)</Label>
              <Input
                id={`lost-comp-${lead.id}`}
                value={detail.competitor ?? ""}
                onChange={(e) => set("competitor")(e.target.value)}
                placeholder="Competitor name"
              />
            </div>
          )}

          {need === "PRICE" && (
            <div>
              <Label htmlFor={`lost-price-${lead.id}`}>
                The price they expected or were quoted, in KES (required)
              </Label>
              <Input
                id={`lost-price-${lead.id}`}
                inputMode="numeric"
                value={detail.expected_price_kes ?? ""}
                onChange={(e) => set("expected_price_kes")(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="e.g. 850000"
              />
            </div>
          )}

          {need === "REVISIT_DATE" && (
            <div>
              <Label htmlFor={`lost-revisit-${lead.id}`}>When should we come back? (required)</Label>
              <Input
                id={`lost-revisit-${lead.id}`}
                type="date"
                value={detail.revisit_date ?? ""}
                onChange={(e) => set("revisit_date")(e.target.value)}
              />
            </div>
          )}

          <div>
            <Label htmlFor={`lost-note-${lead.id}`}>
              {need === "NOTE" ? "What happened? (required)" : "Anything worth knowing (optional)"}
            </Label>
            <Textarea
              id={`lost-note-${lead.id}`}
              rows={3}
              value={detail.note ?? ""}
              onChange={(e) => set("note")(e.target.value)}
              placeholder="e.g. quoted 15% lower on the Mombasa run"
            />
          </div>

          {code && problem && <p className="text-xs text-destructive">{problem}</p>}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={Boolean(problem) || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Saving…" : "Record as lost"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WonDialog({
  lead,
  open,
  onOpenChange,
  onDone,
}: {
  lead: JourneyLead;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [value, setValue] = React.useState("");
  const m = useMutation({
    mutationFn: () => markWon(lead.id, Number(value)),
    onSuccess: () => {
      toast({ title: "Won, with revenue recorded" });
      onOpenChange(false);
      setValue("");
      onDone();
    },
    onError: (e: Error) => toast({ title: "Not accepted", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Won — {lead.organisation_name}</DialogTitle>
          <DialogDescription>
            A win counts when there is revenue behind it. Enter the value of the signed job.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor={`won-${lead.id}`}>Revenue (KES)</Label>
          <Input
            id={`won-${lead.id}`}
            type="number"
            min="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!Number(value) || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Saving…" : "Record the win"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WaitingEditor({ lead, onDone }: { lead: JourneyLead; onDone: () => void }) {
  const [party, setParty] = React.useState<"US" | "CLIENT">(lead.waiting_on ?? "CLIENT");
  const [item, setItem] = React.useState(lead.awaiting_item ?? "");
  const [due, setDue] = React.useState(lead.awaiting_due_date ?? "");
  const save = useMutation({
    mutationFn: () => setWaiting(lead.id, party, item.trim(), due || undefined),
    onSuccess: () => {
      toast({ title: "Noted" });
      onDone();
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });
  const clear = useMutation({
    mutationFn: () => setWaiting(lead.id, null),
    onSuccess: () => {
      toast({ title: "Cleared" });
      setItem("");
      setDue("");
      onDone();
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  return (
    <details
      className="rounded-md border bg-muted/20 p-3"
      open={Boolean(lead.waiting_on)}
    >
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {lead.waiting_on ? "What is this waiting on?" : "Waiting on something? Note it"}
      </summary>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Label className="text-xs">Waiting on</Label>
          <Select value={party} onValueChange={(v) => setParty(v as "US" | "CLIENT")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="US">Us</SelectItem>
              <SelectItem value="CLIENT">The client</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grow">
          <Label className="text-xs" htmlFor={`item-${lead.id}`}>
            What exactly
          </Label>
          <Input
            id={`item-${lead.id}`}
            value={item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="e.g. send vehicle specifications"
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor={`due-${lead.id}`}>
            By
          </Label>
          <Input id={`due-${lead.id}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <Button size="sm" disabled={!item.trim() || save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
        {lead.waiting_on && (
          <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}>
            Done waiting
          </Button>
        )}
      </div>
    </details>
  );
}

function LeadCard({ lead, onChanged }: { lead: JourneyLead; onChanged: () => void }) {
  const [note, setNote] = React.useState("");
  const [lostOpen, setLostOpen] = React.useState(false);
  const [wonOpen, setWonOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const gaps = missingContact(lead);
  const step = journeyStep(lead);
  const steps = nextSteps(lead);
  const overdue =
    lead.waiting_on && lead.awaiting_due_date && lead.awaiting_due_date < new Date().toISOString().slice(0, 10);

  const stepMutation = useMutation({
    mutationFn: (kind: Parameters<typeof logStep>[1]) => logStep(lead.id, kind, note.trim() || undefined),
    onSuccess: () => {
      toast({ title: "Recorded" });
      setNote("");
      onChanged();
    },
    onError: (e: Error) => toast({ title: "Not recorded", description: e.message, variant: "destructive" }),
  });

  const done = [
    lead.meeting_held_at && `Meeting ${day(lead.meeting_held_at)}`,
    lead.quote_shared_at && `Quote ${day(lead.quote_shared_at)}`,
    lead.contract_shared_at && `Contract shared ${day(lead.contract_shared_at)}`,
    lead.contract_signed_at && `Contract signed ${day(lead.contract_signed_at)}`,
  ].filter(Boolean) as string[];

  return (
    <Card>
      <CardContent className="space-y-3 pt-5 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{lead.organisation_name}</p>
            <p className="text-xs text-muted-foreground">
              {lead.contact_name || "NO CONTACT NAME"}
              {lead.contact_phone ? ` · ${lead.contact_phone}` : ""}
              {lead.contact_email ? ` · ${lead.contact_email}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Edit details
            </Button>
            {lead.waiting_on && (
              <Badge
                variant="outline"
                className={
                  overdue
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-border bg-muted/40"
                }
              >
                <Clock className="mr-1 h-3 w-3" aria-hidden />
                {lead.waiting_on === "US" ? "Waiting on us" : "Waiting on client"}
                {lead.awaiting_due_date ? ` · ${lead.awaiting_due_date}` : ""}
              </Badge>
            )}
            <StepBadge step={step} />
          </div>
        </div>

        {gaps.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
            <span>Missing {gaps.join(" and ")}.</span>
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              Add {gaps.length === 1 ? "it" : "them"} now
            </Button>
          </div>
        )}
        {done.length > 0 && (
          <p className="text-xs text-muted-foreground">{done.join(" · ")}</p>
        )}
        {lead.waiting_on && lead.awaiting_item && (
          <p className="rounded-md border bg-muted/20 p-2 text-xs">Next: {lead.awaiting_item}</p>
        )}
        {step === "WON" && (
          <p className="text-sm font-medium text-success">
            Revenue recorded: {lead.won_revenue_kes ? KES(Number(lead.won_revenue_kes)) : "NOT STATED"}
          </p>
        )}
        {step === "LOST" && (
          <p className="text-sm text-muted-foreground">
            Lost — {LOSS_REASON_LABEL[lead.lost_reason_code ?? "UNRECORDED"]}
            {lead.lost_reason ? `: ${lead.lost_reason}` : ""}
          </p>
        )}

        {steps.length > 0 && (
          <>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="One line about what happened (optional)"
            />
            <div className="flex flex-wrap gap-2">
              {steps.map((s) => (
                <Button
                  key={s.kind}
                  size="sm"
                  variant="secondary"
                  disabled={stepMutation.isPending}
                  onClick={() => stepMutation.mutate(s.kind)}
                >
                  {s.label}
                </Button>
              ))}
              {lead.contract_signed_at && (
                <Button size="sm" onClick={() => setWonOpen(true)}>
                  Won (record revenue)
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setLostOpen(true)}>
                Lost
              </Button>
            </div>
            <WaitingEditor lead={lead} onDone={onChanged} />
          </>
        )}

        <LostDialog lead={lead} open={lostOpen} onOpenChange={setLostOpen} onDone={onChanged} />
        <WonDialog lead={lead} open={wonOpen} onOpenChange={setWonOpen} onDone={onChanged} />
        <EditLeadDetailsDialog
          lead={lead}
          open={editOpen}
          onOpenChange={setEditOpen}
          onDone={onChanged}
        />
      </CardContent>
    </Card>
  );
}

export default function LeadJourneyBoard() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["lead-journey"],
    queryFn: listJourneyLeads,
  });
  const [filter, setFilter] = React.useState<
    JourneyStep | "OPEN" | "WAITING" | "NEXT_DUE" | "MISSING_CONTACT"
  >("OPEN");
  const [term, setTerm] = React.useState("");

  const onChanged = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ["sales-desk-figures"] });
    void qc.invalidateQueries({ queryKey: ["sales-leads"] });
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">Your leads could not be read.</p>
          <p className="text-muted-foreground">{(error as Error).message}</p>
        </CardContent>
      </Card>
    );

  const leads = data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const stale = (l: JourneyLead) =>
    (Date.now() - new Date(l.updated_at).getTime()) / 86_400_000 > 7;

  const inGroup = (l: JourneyLead, f: typeof filter) => {
    const s = journeyStep(l);
    if (f === "OPEN") return s !== "WON" && s !== "LOST";
    if (f === "WAITING") return Boolean(l.waiting_on);
    if (f === "MISSING_CONTACT") return missingContact(l).length > 0;
    if (f === "NEXT_DUE")
      return (
        s !== "WON" &&
        s !== "LOST" &&
        ((l.awaiting_due_date != null && l.awaiting_due_date < today) || stale(l))
      );
    return s === f;
  };

  const shown = leads.filter((l) => inGroup(l, filter) && matchesLeadSearch(l, term));
  const counts = (f: typeof filter) =>
    leads.filter((l) => inGroup(l, f) && matchesLeadSearch(l, term)).length;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] grow sm:max-w-sm">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search organisation, contact, reference or service"
              aria-label="Search my leads"
              className="pl-8"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {shown.length} of {leads.length} lead{leads.length === 1 ? "" : "s"} shown
          </p>
          {term && (
            <Button size="sm" variant="ghost" onClick={() => setTerm("")}>
              Clear search
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["OPEN", "NEXT_DUE", "WAITING", "MISSING_CONTACT", ...JOURNEY_STEPS] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "secondary" : "ghost"}
              onClick={() => setFilter(f)}
            >
              {f === "OPEN"
                ? "Working"
                : f === "NEXT_DUE"
                  ? "Needs a move"
                  : f === "WAITING"
                    ? "Waiting"
                    : f === "MISSING_CONTACT"
                      ? "Missing email or phone"
                      : JOURNEY_LABEL[f]}
              <span className="ml-1.5 text-xs text-muted-foreground">{counts(f)}</span>
            </Button>
          ))}
        </div>
      </div>


      {shown.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
            <CalendarClock className="h-4 w-4" aria-hidden />
            {leads.length === 0
              ? "NO LEADS HERE YET. Nothing has been generated on your behalf."
              : "Nothing in this group right now."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map((l) => (
            <LeadCard key={l.id} lead={l} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}
