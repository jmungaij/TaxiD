/**
 * MY SERVICE REQUESTS — the corporate customer's own view.
 *
 * A signed-in company contact submits a mobility requirement and tracks it
 * through a simple lifecycle. What is shown is deliberately narrow: the request
 * as it was submitted, where it stands, who at SAFARID is looking after it, and
 * anything we need back. Internal pricing, notes, ownership and pipeline
 * intelligence are never sent to this page.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { recordCapacityEnquiry } from "@/lib/provider/capacity";
import { AlertCircle, CheckCircle2, Clock, Plus, Send, UserRound } from "lucide-react";
import {
  CUSTOMER_STATE_LABEL,
  CUSTOMER_STATE_MEANING,
  listMyRequests,
  respondToRequest,
  submitRequest,
  type CustomerRequest,
  type CustomerState,
} from "@/lib/customer/requests";

const TONE: Record<CustomerState, string> = {
  SUBMITTED: "border-border bg-muted text-muted-foreground",
  UNDER_REVIEW: "border-primary/30 bg-primary/10 text-primary",
  INFORMATION_REQUIRED: "border-[hsl(var(--status-warning)/0.5)] bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))]",
  QUALIFICATION: "border-primary/30 bg-primary/10 text-primary",
  COMMERCIAL_REVIEW: "border-primary/30 bg-primary/10 text-primary",
  CONTRACTING: "border-primary/40 bg-primary/15 text-primary",
  ACCOUNT_SETUP: "border-primary/40 bg-primary/15 text-primary",
  ACTIVE: "border-[hsl(var(--status-success)/0.45)] bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))]",
  CLOSED: "border-border bg-muted text-muted-foreground",
};

const dt = (v: string) =>
  new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });

function StatusBadge({ status }: { status: CustomerState }) {
  return (
    <Badge variant="outline" className={TONE[status] ?? TONE.SUBMITTED}>
      {CUSTOMER_STATE_LABEL[status] ?? status}
    </Badge>
  );
}

const SERVICES = [
  "Employee transport",
  "Airport transfers",
  "Staff shuttle",
  "Executive chauffeur",
  "Corporate car rental",
  "Event transport",
  "Freight movement",
];

/** The four service families, matching the marketplace search. */
const FAMILIES = [
  { key: "ride", label: "Ride", hint: "Everyday rides, airport transfers, scheduled journeys" },
  { key: "charter", label: "Charter", hint: "Bus, coach, aircraft, helicopter or marine charter" },
  { key: "rental", label: "Rental or lease", hint: "Vehicles, equipment or machinery on hire" },
  { key: "logistics", label: "Delivery or logistics", hint: "Parcels, courier work, freight and distribution" },
] as const;

type FamilyKey = (typeof FAMILIES)[number]["key"];

const FAMILY_LABEL: Record<FamilyKey, string> = {
  ride: "Ride",
  charter: "Charter",
  rental: "Rental or lease",
  logistics: "Delivery or logistics",
};

/** Composes the operational detail into the requirement note the desk reads. */
function composeRequirement(f: {
  family: FamilyKey;
  vehicle_type: string;
  passengers: string;
  vehicles: string;
  return_date: string;
  capacity_of_interest: string;
  requirement: string;
}): string {
  const lines: string[] = [`Service family: ${FAMILY_LABEL[f.family]}`];
  if (f.vehicle_type.trim()) lines.push(`Vehicle type: ${f.vehicle_type.trim()}`);
  if (f.passengers.trim()) lines.push(`Passengers: ${f.passengers.trim()}`);
  if (f.vehicles.trim()) lines.push(`Vehicles required: ${f.vehicles.trim()}`);
  if (f.return_date) lines.push(`Return / end date: ${f.return_date}`);
  if (f.capacity_of_interest.trim()) lines.push(`Capacity of interest: ${f.capacity_of_interest.trim()}`);
  if (f.requirement.trim()) lines.push("", f.requirement.trim());
  return lines.join("\n");
}

const EMPTY_FORM = {
  family: "ride" as FamilyKey,
  organisation_name: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  service_interest: "",
  vehicle_type: "",
  passengers: "",
  vehicles: "",
  origin_label: "",
  destination_label: "",
  service_date: "",
  return_date: "",
  capacity_of_interest: "",
  capacity_id: "",
  requirement: "",
};

function NewRequestForm({
  onDone,
  prefill,
  startOpen,
}: {
  onDone: () => void;
  prefill?: Partial<typeof EMPTY_FORM>;
  startOpen?: boolean;
}) {
  const { user } = useAuth();
  const [open, setOpen] = React.useState(Boolean(startOpen));
  const [form, setForm] = React.useState({ ...EMPTY_FORM, ...prefill });
  const [confirmed, setConfirmed] = React.useState<{ reference: string; duplicate: boolean } | null>(null);

  React.useEffect(() => {
    if (prefill && Object.keys(prefill).length > 0) {
      setForm((f) => ({ ...f, ...prefill }));
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(prefill ?? {})]);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      submitRequest({
        organisation_name: form.organisation_name.trim(),
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim() || user?.email || undefined,
        contact_phone: form.contact_phone.trim() || undefined,
        service_interest: form.service_interest.trim(),
        origin_label: form.origin_label.trim() || undefined,
        destination_label: form.destination_label.trim() || undefined,
        service_date: form.service_date || undefined,
        requirement: composeRequirement(form),
      }),
    onSuccess: (res) => {
      toast({
        title: res.duplicate ? "You already have this request open" : "Request submitted",
        description: `Reference ${res.lead_ref}`,
      });
      setConfirmed({ reference: res.lead_ref, duplicate: res.duplicate });
      // Let the operator whose listing was chosen see the enquiry in their portal.
      if (form.capacity_id) {
        void recordCapacityEnquiry({
          capacity_id: form.capacity_id,
          lead_ref: res.lead_ref,
          organisation_name: form.organisation_name.trim() || undefined,
          contact_name: form.contact_name.trim() || undefined,
          service_date: form.service_date || undefined,
          passengers: form.passengers || undefined,
          requirement: composeRequirement(form),
        }).catch(() => undefined);
      }
      setOpen(false);
      setForm({ ...EMPTY_FORM });
      onDone();
    },
    onError: (e: Error) =>
      toast({
        title: "Request not submitted",
        description:
          e.message === "INCOMPLETE_REQUEST_CONTRACT"
            ? "Please give your organisation, your name and what you need."
            : e.message === "NO_SALES_OWNER_AVAILABLE"
              ? "No SAFARID contact is available to receive this right now. Please try again shortly."
              : e.message,
        variant: "destructive",
      }),
  });

  const valid =
    form.organisation_name.trim() && form.contact_name.trim() && form.service_interest.trim();

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-2">
        <Button onClick={() => { setConfirmed(null); setOpen(true); }}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New request
        </Button>
        {confirmed && (
          <p className="max-w-xs text-right text-xs text-[hsl(var(--status-success))]">
            {confirmed.duplicate
              ? `This requirement is already open as ${confirmed.reference}.`
              : `Received. Your reference is ${confirmed.reference} and it appears below.`}
          </p>
        )}
      </div>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-base">Tell us what you need</CardTitle>
        <CardDescription>
          A SAFARID contact is assigned to your request and you can follow it here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">What kind of service is this?</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {FAMILIES.map((f) => {
              const on = form.family === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setForm((s) => ({ ...s, family: f.key }))}
                  className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                    on ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                  }`}
                >
                  <span className="font-medium">{f.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{f.hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="cr-org">Your organisation</Label>
            <Input id="cr-org" value={form.organisation_name} onChange={set("organisation_name")} />
          </div>
          <div>
            <Label htmlFor="cr-name">Your name</Label>
            <Input id="cr-name" value={form.contact_name} onChange={set("contact_name")} />
          </div>
          <div>
            <Label htmlFor="cr-email">Email</Label>
            <Input
              id="cr-email"
              type="email"
              placeholder={user?.email ?? ""}
              value={form.contact_email}
              onChange={set("contact_email")}
            />
          </div>
          <div>
            <Label htmlFor="cr-phone">Phone</Label>
            <Input id="cr-phone" value={form.contact_phone} onChange={set("contact_phone")} />
          </div>
          <div>
            <Label htmlFor="cr-service">What you need</Label>
            <Input
              id="cr-service"
              list="cr-services"
              placeholder="e.g. Employee transport"
              value={form.service_interest}
              onChange={set("service_interest")}
            />
            <datalist id="cr-services">
              {SERVICES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="cr-vehicle">Vehicle type</Label>
            <Input
              id="cr-vehicle"
              placeholder="e.g. Bus or coach"
              value={form.vehicle_type}
              onChange={set("vehicle_type")}
            />
          </div>
          <div>
            <Label htmlFor="cr-pax">Passengers</Label>
            <Input
              id="cr-pax"
              type="number"
              min={0}
              value={form.passengers}
              onChange={set("passengers")}
            />
          </div>
          <div>
            <Label htmlFor="cr-veh-count">Vehicles required</Label>
            <Input
              id="cr-veh-count"
              type="number"
              min={0}
              value={form.vehicles}
              onChange={set("vehicles")}
            />
          </div>
          <div>
            <Label htmlFor="cr-from">From</Label>
            <Input id="cr-from" value={form.origin_label} onChange={set("origin_label")} />
          </div>
          <div>
            <Label htmlFor="cr-to">To</Label>
            <Input id="cr-to" value={form.destination_label} onChange={set("destination_label")} />
          </div>
          <div>
            <Label htmlFor="cr-date">Start date</Label>
            <Input id="cr-date" type="date" value={form.service_date} onChange={set("service_date")} />
          </div>
          <div>
            <Label htmlFor="cr-return">Return or end date</Label>
            <Input id="cr-return" type="date" value={form.return_date} onChange={set("return_date")} />
          </div>
          {form.capacity_of_interest && (
            <div className="sm:col-span-2">
              <Label htmlFor="cr-capacity">Capacity you selected</Label>
              <Input
                id="cr-capacity"
                value={form.capacity_of_interest}
                onChange={set("capacity_of_interest")}
              />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="cr-req">Anything else we should know</Label>
            <Textarea id="cr-req" rows={3} value={form.requirement} onChange={set("requirement")} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


function RequestCard({ request, onChanged }: { request: CustomerRequest; onChanged: () => void }) {
  const [reply, setReply] = React.useState("");
  const mutation = useMutation({
    mutationFn: () => respondToRequest(request.id, reply.trim()),
    onSuccess: () => {
      toast({ title: "Sent to your SAFARID contact" });
      setReply("");
      onChanged();
    },
    onError: (e: Error) => toast({ title: "Not sent", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{request.service_interest}</CardTitle>
            <CardDescription>
              <span className="font-mono">{request.reference}</span> · submitted {dt(request.submitted_at)}
            </CardDescription>
          </div>
          <StatusBadge status={request.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{CUSTOMER_STATE_MEANING[request.status]}</p>

        <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
          <span>Organisation: {request.organisation_name}</span>
          <span>
            {request.origin_label || request.destination_label
              ? `Route: ${request.origin_label ?? "—"} → ${request.destination_label ?? "—"}`
              : "Route: not stated"}
          </span>
          <span>Service date: {request.service_date ?? "not stated"}</span>
          <span className="inline-flex items-center gap-1">
            <UserRound className="h-3.5 w-3.5" aria-hidden />
            {request.relationship_contact
              ? `Your SAFARID contact: ${request.relationship_contact}${request.relationship_email ? ` · ${request.relationship_email}` : ""}`
              : "Your SAFARID contact is being assigned"}
          </span>
        </div>

        {request.information_request && (
          <div className="space-y-2 rounded-md border border-[hsl(var(--status-warning)/0.4)] bg-[hsl(var(--status-warning)/0.08)] p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--status-warning))]">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden /> We need something from you
            </p>
            <p>{request.information_request}</p>
            <Textarea
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Your reply"
              aria-label="Your reply"
            />
            <Button
              size="sm"
              disabled={!reply.trim() || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {mutation.isPending ? "Sending…" : "Send reply"}
            </Button>
          </div>
        )}

        {request.timeline?.length > 0 && (
          <>
            <Separator />
            <ol className="space-y-1.5 text-xs text-muted-foreground">
              {request.timeline.map((t, i) => (
                <li key={`${t.at}-${i}`} className="flex flex-wrap items-center gap-2">
                  {t.status === "ACTIVE" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--status-success))]" aria-hidden />
                  ) : (
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                  )}
                  <span className="font-mono">{dt(t.at)}</span>
                  <span className="font-medium text-foreground">
                    {CUSTOMER_STATE_LABEL[t.status] ?? t.status}
                  </span>
                  {t.customer_note && <span className="italic">“{t.customer_note}”</span>}
                </li>
              ))}
            </ol>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function CustomerRequests() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const [params] = useSearchParams();

  // A brief carried over from the marketplace search, so nothing is retyped.
  const prefill = React.useMemo(() => {
    const family = params.get("family");
    const out: Record<string, string> = {};
    if (family && ["ride", "charter", "rental", "logistics"].includes(family)) out.family = family;
    const city = params.get("city");
    if (city) out.origin_label = city;
    const date = params.get("date");
    if (date) out.service_date = date;
    const vehicle = params.get("vehicle");
    if (vehicle) out.vehicle_type = vehicle;
    const capacity = params.get("capacity");
    if (capacity) out.capacity_of_interest = capacity;
    const capacityId = params.get("capacity_id");
    if (capacityId) out.capacity_id = capacityId;
    return out;
  }, [params]);
  const hasPrefill = Object.keys(prefill).length > 0;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["customer-requests"],
    queryFn: listMyRequests,
    enabled: Boolean(user),
  });

  const onChanged = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ["customer-requests"] });
  };

  if (loading) return <Skeleton className="h-40 w-full" />;

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in to submit a request</CardTitle>
          <CardDescription>
            Your requests and their status are tied to your account, so you need to be signed in.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const requests = data ?? [];
  const openCount = requests.filter(
    (r) => r.status !== "CLOSED" && r.status !== "ACTIVE",
  ).length;
  const needsYou = requests.filter((r) => r.status === "INFORMATION_REQUIRED").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My service requests</h1>
          <p className="text-sm text-muted-foreground">
            Submit a corporate mobility requirement and follow it from request to active service.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <a href="/dashboard/my-account">My account</a>
          </Button>
          <NewRequestForm onDone={onChanged} prefill={prefill} startOpen={hasPrefill} />
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{requests.length} total</Badge>
        <Badge variant="outline">{openCount} in progress</Badge>
        {needsYou > 0 && (
          <Badge
            variant="outline"
            className="border-[hsl(var(--status-warning)/0.5)] text-[hsl(var(--status-warning))]"
          >
            {needsYou} waiting on you
          </Badge>
        )}
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}
      {error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your requests could not be loaded</CardTitle>
            <CardDescription>{(error as Error).message}</CardDescription>
          </CardHeader>
        </Card>
      )}
      {!isLoading && !error && requests.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No requests yet</CardTitle>
            <CardDescription>
              Submit your first requirement and a SAFARID contact will pick it up.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4">
        {requests.map((r) => (
          <RequestCard key={r.id} request={r} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}
