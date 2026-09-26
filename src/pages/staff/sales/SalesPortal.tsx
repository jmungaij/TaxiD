/**
 * SALES PORTAL — the Corporate Sales Specialist's own working surface.
 *
 * The pipeline shown here is the specialist's live record, read under row-level
 * security: a specialist sees their own leads, a sales manager sees the whole
 * desk. Stage movement is executed by the database, so this page can only offer
 * transitions the stage graph actually allows.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Briefcase, Plus, ArrowRight, History } from "lucide-react";
import BookMovementDialog from "@/components/sales/BookMovementDialog";
import FulfilmentPanel from "@/components/sales/FulfilmentPanel";
import ClaimsPanel from "@/components/sales/ClaimsPanel";
import SlaBoard from "@/components/sales/SlaBoard";
import SalesGovernancePanel from "@/components/sales/SalesGovernancePanel";
import TeamPerformance from "@/components/sales/TeamPerformance";
import LeadAllocationBoard from "@/components/sales/LeadAllocationBoard";
import LeadFollowUpQueue from "@/components/sales/LeadFollowUpQueue";
import LeadKpiBand from "@/components/sales/LeadKpiBand";
import LeadJourneyBoard from "@/components/sales/LeadJourneyBoard";
import DeskFiguresBand from "@/components/sales/DeskFiguresBand";
import BulkLeadImportPanel from "@/components/sales/BulkLeadImportPanel";
import LeadRemindersPanel from "@/components/sales/LeadRemindersPanel";
import TeamLeaderOverview from "@/components/sales/TeamLeaderOverview";
import LeadDeliveryTracking from "@/components/sales/LeadDeliveryTracking";

import ClientRequestQueue from "@/components/sales/ClientRequestQueue";
import TargetSettingsPanel from "@/components/sales/TargetSettingsPanel";
import CommercialLifecyclePanel from "@/components/commercial/CommercialLifecyclePanel";
import LeadFlowBoard from "@/components/sales/LeadFlowBoard";
import ClientPortalLinksPanel from "@/components/sales/ClientPortalLinksPanel";
import PartnerPortalLinksPanel from "@/components/sales/PartnerPortalLinksPanel";
import DayCloseCommandCentre from "@/components/sales/DayCloseCommandCentre";
import MyDayView from "@/components/sales/MyDayView";
import ManagementDashboard from "@/components/sales/ManagementDashboard";

import { useAuth } from "@/hooks/useAuth";
import {
  attachBooking,
  convertLeadToOpportunity,
  createLead,
  listLeadEvents,
  listMyLeads,
  requestLeadInformation,
  moveLeadStage,
  NEXT_STAGES,
  pipelineSummary,
  STAGE_LABEL,
  type LeadStage,
  type SalesLead,
} from "@/lib/sales/pipeline";


const KES = (n: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

function StageBadge({ stage }: { stage: LeadStage }) {
  const tone =
    stage === "CLOSED_WON"
      ? "bg-success/10 text-success border-success/30"
      : stage === "CLOSED_LOST" || stage === "DISQUALIFIED"
        ? "bg-muted text-muted-foreground"
        : stage === "BOOKED" || stage === "FULFILLED"
          ? "bg-primary/10 text-primary border-primary/30"
          : "bg-accent/10 text-accent-foreground border-border";
  return (
    <Badge variant="outline" className={tone}>
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

function NewLeadDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    organisation_name: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    service_interest: "",
    origin_label: "",
    destination_label: "",
    service_date: "",
    estimated_value_kes: "",
    notes: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      createLead({
        organisation_name: form.organisation_name.trim(),
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim() || undefined,
        contact_phone: form.contact_phone.trim() || undefined,
        service_interest: form.service_interest.trim(),
        origin_label: form.origin_label.trim() || undefined,
        destination_label: form.destination_label.trim() || undefined,
        service_date: form.service_date || undefined,
        estimated_value_kes: form.estimated_value_kes ? Number(form.estimated_value_kes) : undefined,
        notes: form.notes.trim() || undefined,
      }),
    onSuccess: (res) => {
      const ref = (res as { lead_ref?: string })?.lead_ref;
      toast({ title: "Lead created", description: ref ? `Reference ${ref}` : undefined });
      setOpen(false);
      setForm({
        organisation_name: "",
        contact_name: "",
        contact_email: "",
        contact_phone: "",
        service_interest: "",
        origin_label: "",
        destination_label: "",
        service_date: "",
        estimated_value_kes: "",
        notes: "",
      });
      onDone();
    },
    onError: (e: Error) =>
      toast({ title: "Lead not created", description: e.message, variant: "destructive" }),
  });

  const valid =
    form.organisation_name.trim() && form.contact_name.trim() && form.service_interest.trim();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New lead
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New corporate lead</DialogTitle>
          <DialogDescription>
            Record the client exactly as they identified themselves. Nothing is inferred on your
            behalf.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="org">Organisation</Label>
            <Input id="org" value={form.organisation_name} onChange={set("organisation_name")} />
          </div>
          <div>
            <Label htmlFor="contact">Contact person</Label>
            <Input id="contact" value={form.contact_name} onChange={set("contact_name")} />
          </div>
          <div>
            <Label htmlFor="email">Contact email</Label>
            <Input id="email" type="email" value={form.contact_email} onChange={set("contact_email")} />
          </div>
          <div>
            <Label htmlFor="phone">Contact phone</Label>
            <Input id="phone" value={form.contact_phone} onChange={set("contact_phone")} />
          </div>
          <div>
            <Label htmlFor="service">Service required</Label>
            <Input
              id="service"
              placeholder="e.g. staff transport, freight movement"
              value={form.service_interest}
              onChange={set("service_interest")}
            />
          </div>
          <div>
            <Label htmlFor="origin">From</Label>
            <Input id="origin" value={form.origin_label} onChange={set("origin_label")} />
          </div>
          <div>
            <Label htmlFor="dest">To</Label>
            <Input id="dest" value={form.destination_label} onChange={set("destination_label")} />
          </div>
          <div>
            <Label htmlFor="date">Service date</Label>
            <Input id="date" type="date" value={form.service_date} onChange={set("service_date")} />
          </div>
          <div>
            <Label htmlFor="value">Estimated value (KES)</Label>
            <Input
              id="value"
              type="number"
              min="0"
              value={form.estimated_value_kes}
              onChange={set("estimated_value_kes")}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} value={form.notes} onChange={set("notes")} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Saving…" : "Create lead"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LeadHistory({ leadId }: { leadId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["sales-lead-events", leadId],
    queryFn: () => listLeadEvents(leadId),
  });
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!data?.length) return <p className="text-xs text-muted-foreground">No history recorded yet.</p>;
  return (
    <ul className="space-y-1.5 text-xs">
      {data.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span className="font-mono">{new Date(e.created_at).toLocaleString("en-KE")}</span>
          <span className="font-medium text-foreground">{e.action.split("_").join(" ").toLowerCase()}</span>
          {e.stage_from && e.stage_to && (
            <span>
              {e.stage_from} → {e.stage_to}
            </span>
          )}
          {e.note && <span className="italic">“{e.note}”</span>}
        </li>
      ))}
    </ul>
  );
}

function LeadRow({ lead, onChanged }: { lead: SalesLead; onChanged: () => void }) {
  const [note, setNote] = React.useState("");
  const [bookingRef, setBookingRef] = React.useState("");
  const [infoNote, setInfoNote] = React.useState("");
  const [showHistory, setShowHistory] = React.useState(false);

  const run = (fn: () => Promise<unknown>, label: string) => async () => {
    try {
      await fn();
      toast({ title: label });
      setNote("");
      setBookingRef("");
      onChanged();
    } catch (e) {
      toast({
        title: "Not accepted",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const next = NEXT_STAGES[lead.stage];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{lead.organisation_name}</CardTitle>
            <CardDescription>
              <span className="font-mono">{lead.lead_ref}</span> · {lead.service_interest}
              {lead.service_date ? ` · ${lead.service_date}` : ""}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lead.source === "customer_portal" && (
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                Submitted by customer
              </Badge>
            )}
            <StageBadge stage={lead.stage} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
          <span>
            Contact: {lead.contact_name}
            {lead.contact_phone ? ` · ${lead.contact_phone}` : ""}
            {lead.contact_email ? ` · ${lead.contact_email}` : ""}
          </span>
          <span>
            {lead.origin_label || lead.destination_label
              ? `Route: ${lead.origin_label ?? "—"} → ${lead.destination_label ?? "—"}`
              : "Route: not stated"}
          </span>
          <span>
            Estimated value:{" "}
            {lead.estimated_value_kes ? KES(lead.estimated_value_kes) : "NOT STATED"}
          </span>
          <span>Booking: {lead.booking_ref ?? "not yet booked"}</span>
        </div>

        {lead.information_request ? (
          <p className="rounded-md border border-[hsl(var(--status-warning)/0.4)] bg-[hsl(var(--status-warning)/0.08)] p-3">
            Waiting on the customer: {lead.information_request}
          </p>
        ) : (
          <div className="space-y-2 rounded-md border bg-muted/20 p-3">
            <Label htmlFor={`info-${lead.id}`} className="text-xs">
              Ask the customer for something
            </Label>
            <Textarea
              id={`info-${lead.id}`}
              rows={2}
              value={infoNote}
              onChange={(e) => setInfoNote(e.target.value)}
              placeholder="What you need from them, in plain words"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!infoNote.trim()}
              onClick={run(
                () => requestLeadInformation(lead.id, infoNote.trim()),
                "The customer has been asked",
              )}
            >
              Request information
            </Button>
          </div>
        )}


        {next.length > 0 && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <Label htmlFor={`note-${lead.id}`} className="text-xs">
              Note for the next step
            </Label>
            <Textarea
              id={`note-${lead.id}`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What changed, in your own words"
            />
            <div className="flex flex-wrap gap-2">
              {next.map((s) =>
                s === "OPPORTUNITY" ? (
                  <Button
                    key={s}
                    size="sm"
                    onClick={run(() => convertLeadToOpportunity(lead.id), "Opportunity created")}
                  >
                    Convert to opportunity <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                  </Button>
                ) : (
                  <Button
                    key={s}
                    size="sm"
                    variant={s === "CLOSED_LOST" || s === "DISQUALIFIED" ? "outline" : "default"}
                    onClick={run(
                      () => moveLeadStage(lead.id, s, note || undefined),
                      `Moved to ${STAGE_LABEL[s]}`,
                    )}
                  >
                    {STAGE_LABEL[s]}
                  </Button>
                ),
              )}
            </div>
            {(lead.stage === "ACCEPTED" || lead.stage === "OPPORTUNITY" || lead.stage === "QUOTED") && (
              <div className="space-y-2 pt-1">
                <BookMovementDialog lead={lead} onBooked={onChanged} />
                <div className="flex flex-wrap items-end gap-2">
                  <div className="grow">
                    <Label htmlFor={`bk-${lead.id}`} className="text-xs">
                      Or attach a booking already made on the platform
                    </Label>
                    <Input
                      id={`bk-${lead.id}`}
                      value={bookingRef}
                      onChange={(e) => setBookingRef(e.target.value)}
                      placeholder="e.g. ORD-FRT-XXXXXXXXXX"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!bookingRef.trim()}
                    onClick={run(() => attachBooking(lead.id, bookingRef.trim()), "Booking attached")}
                  >
                    Attach booking
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {lead.order_id && (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Fulfilment
            </p>
            <FulfilmentPanel orderId={lead.order_id} />
          </div>
        )}

        <div className="rounded-md border p-3">
          <CommercialLifecyclePanel leadId={lead.id} leadRef={lead.lead_ref} onChanged={onChanged} />
        </div>


        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>
            <History className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {showHistory ? "Hide history" : "History"}
          </Button>
          {showHistory && (
            <div className="mt-2 rounded-md border p-3">
              <LeadHistory leadId={lead.id} />
            </div>
          )}
        </div>

      </CardContent>
    </Card>
  );
}

export default function SalesPortal() {
  const qc = useQueryClient();
  const { isAdmin, isSuperAdmin } = useAuth();
  const canGovern = isAdmin || isSuperAdmin;
  const [view, setView] = React.useState<
    | "myday"
    | "dayclose"
    | "partnerlinks"
    | "journey"
    | "reminders"
    | "overview"
    | "followups"
    | "requests"
    | "flow"
    | "portal"
    | "pipeline"
    | "bulk"
    | "allocated"
    | "tracking"
    | "clocks"
    | "management"
    | "team"
    | "targets"
    | "governance"
  >("myday");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sales-leads"],
    queryFn: listMyLeads,
  });
  const onChanged = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ["sales-lead-events"] });
    void qc.invalidateQueries({ queryKey: ["sales-sla-board"] });
    void qc.invalidateQueries({ queryKey: ["lead-journey"] });
    void qc.invalidateQueries({ queryKey: ["sales-desk-figures"] });
  };

  const leads = data ?? [];
  const summary = pipelineSummary(leads);

  const tab = (
    key: typeof view,
    label: string,
  ) => (
    <Button key={key} size="sm" variant={view === key ? "secondary" : "ghost"} onClick={() => setView(key)}>
      {label}
    </Button>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <Briefcase className="h-3.5 w-3.5" aria-hidden /> Sales desk
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">My leads</h1>
          <p className="text-sm text-muted-foreground">
            New lead → meeting held → quote shared → contract signed → won, with the revenue behind
            it. A loss always carries its reason.
          </p>
        </div>
        <NewLeadDialog onDone={onChanged} />
      </header>

      {view !== "myday" && view !== "dayclose" && <DeskFiguresBand showLosses={canGovern} />}

      <div className="inline-flex flex-wrap rounded-lg border p-0.5">
        {tab("myday", "My day")}
        {tab("dayclose", "Day close")}
        {tab("journey", "My leads")}
        {tab("reminders", "Reminders")}
        {tab("followups", "Follow-ups")}
        {tab("requests", "Client requests")}
        {tab("flow", "Lead to revenue")}
        {/* Issuing and withdrawing private links is a desk-governance action:
            only people who can read and manage customer records see it. */}
        {canGovern && tab("portal", "Client links")}
        {canGovern && tab("partnerlinks", "Partner links")}
        {canGovern && (
          <>
            {tab("management", "Management")}
            {tab("overview", "Team overview")}
            {tab("bulk", "Add leads in bulk")}
            {tab("allocated", "Whole desk")}
            {tab("tracking", "Delivery tracking")}
            {tab("clocks", "Response times")}
            {tab("team", "My team")}
            {tab("targets", "Targets")}
            {tab("governance", "Quotas & governance")}
            {tab("pipeline", "Detailed pipeline")}
          </>
        )}
      </div>

      {view === "myday" && <MyDayView />}
      {view === "management" && canGovern && <ManagementDashboard />}
      {view === "journey" && <LeadJourneyBoard />}
      {view === "reminders" && <LeadRemindersPanel />}
      {view === "overview" && canGovern && <TeamLeaderOverview />}
      {view === "bulk" && canGovern && <BulkLeadImportPanel />}
      {view === "flow" && <LeadFlowBoard />}
      {view === "portal" && canGovern && <ClientPortalLinksPanel />}
      {view === "partnerlinks" && canGovern && <PartnerPortalLinksPanel />}
      {view === "dayclose" && <DayCloseCommandCentre />}




      {view === "allocated" && (
        <div className="space-y-4">
          <LeadKpiBand />
          <LeadAllocationBoard />
        </div>
      )}
      {view === "followups" && <LeadFollowUpQueue />}

      {view === "requests" && <ClientRequestQueue />}

      {view === "tracking" && (
        <div className="space-y-4">
          <LeadKpiBand />
          <LeadDeliveryTracking />
        </div>
      )}


      {view === "clocks" && <SlaBoard />}
      {view === "team" && <TeamPerformance />}
      {view === "targets" && canGovern && <TargetSettingsPanel />}
      {view === "governance" && canGovern && <SalesGovernancePanel />}

      {view === "pipeline" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Open leads", value: summary.open ? String(summary.open) : "NO OPEN LEADS" },
              { label: "Qualified", value: String(summary.qualified) },
              { label: "Booked", value: String(summary.booked) },
              {
                label: "Estimated open value",
                value: summary.estimatedOpenValue ? KES(summary.estimatedOpenValue) : "NOT STATED",
              },
            ].map((k) => (
              <Card key={k.label}>
                <CardContent className="pt-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {k.label}
                  </p>
                  <p className="mt-1 text-xl font-semibold tracking-tight">{k.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {isLoading && <Skeleton className="h-40 w-full" />}

          {error && (
            <Card className="border-destructive/40">
              <CardContent className="pt-6 text-sm">
                <p className="font-medium">Your pipeline could not be read.</p>
                <p className="text-muted-foreground">{(error as Error).message}</p>
              </CardContent>
            </Card>
          )}

          {!isLoading && !error && leads.length === 0 && (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                NO PIPELINE ACTIVITY YET. Create your first lead to begin — nothing has been
                generated on your behalf.
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            {leads.map((l) => (
              <LeadRow key={l.id} lead={l} onChanged={onChanged} />
            ))}
          </div>

          <ClaimsPanel />
        </>
      )}
    </div>
  );
}
