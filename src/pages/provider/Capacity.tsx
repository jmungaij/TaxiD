/**
 * PROVIDER PORTAL — where an operator offers capacity and sees the demand.
 *
 * An operator records what they can offer, submits it, and once our team
 * approves it the listing appears in the marketplace search. Customer enquiries
 * against each listing appear here with the request reference so the operator
 * can acknowledge and close them. Approval authority is never granted here: the
 * review queue only appears for staff who already hold it.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { SeoHead } from "@/components/seo/SeoHead";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { AlertCircle, CheckCircle2, Inbox, Plus, ShieldCheck } from "lucide-react";
import CapacityPhotos from "@/components/provider/CapacityPhotos";

import {
  CAPACITY_STATUS_LABEL, CAPACITY_STATUS_MEANING, PROVIDER_KINDS, RATE_BASES,
  decideCapacity, explainRefusal, loadProviderPortal, retireCapacity, saveCapacity,
  submitCapacity, updateEnquiry,
  type CapacityDraft, type CapacityStatus, type ProviderCapacityRow,
} from "@/lib/provider/capacity";
import { FAMILY_LABEL, SERVICE_FAMILIES, type ServiceFamily } from "@/lib/marketplace/search";
import ProviderBookings from "@/components/provider/ProviderBookings";
import ProviderEarnings from "@/components/provider/ProviderEarnings";
import ProviderPayoutAccount from "@/components/provider/ProviderPayoutAccount";
import ProviderPayoutNumbers from "@/components/provider/ProviderPayoutNumbers";
import ProviderInvoices from "@/components/provider/ProviderInvoices";
import ProviderDocuments from "@/components/provider/ProviderDocuments";
import ProviderOverview from "@/components/provider/ProviderOverview";
import DriverRides from "@/components/provider/DriverRides";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


const TONE: Record<CapacityStatus, string> = {
  DRAFT: "border-border bg-muted text-muted-foreground",
  PENDING_APPROVAL:
    "border-[hsl(var(--status-warning)/0.5)] bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))]",
  PUBLISHED:
    "border-[hsl(var(--status-success)/0.45)] bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))]",
  SENT_BACK: "border-destructive/40 bg-destructive/10 text-destructive",
  RETIRED: "border-border bg-muted text-muted-foreground",
};

const EMPTY: CapacityDraft = {
  provider_name: "",
  provider_kind: "DRIVER",
  family: "ride",
  title: "",
  vehicle_type: "",
  spec: "",
  seats: "",
  units: "1",
  base_city: "",
  coverage_area: "",
  rate_amount: "",
  rate_basis: "per_day",
  currency: "KES",
  available_from: "",
  available_to: "",
  registration_ref: "",
  notes: "",
};

const money = (v: number | null, currency: string) =>
  v === null ? "Rate on request" : `${currency} ${Number(v).toLocaleString("en-KE")}`;

const dt = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

function CapacityForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: CapacityDraft;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = React.useState<CapacityDraft>(initial);
  const set =
    (k: keyof CapacityDraft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => saveCapacity(form),
    onSuccess: () => {
      toast({ title: "Saved", description: "Your listing is saved as a draft." });
      onSaved();
    },
    onError: (e: Error) =>
      toast({ title: "Not saved", description: explainRefusal(e.message), variant: "destructive" }),
  });

  const valid =
    form.provider_name.trim() && form.title.trim() && form.vehicle_type.trim() && form.base_city.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{initial.id ? "Edit listing" : "Offer capacity"}</CardTitle>
        <CardDescription>
          Give us the vehicle, where it is based and what you charge. Our team reviews it before
          customers can see it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pc-provider">Operator name</Label>
            <Input id="pc-provider" value={form.provider_name} onChange={set("provider_name")} />
          </div>
          <div>
            <Label htmlFor="pc-kind">You are</Label>
            <Select
              value={form.provider_kind}
              onValueChange={(v) => setForm((f) => ({ ...f, provider_kind: v }))}
            >
              <SelectTrigger id="pc-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROVIDER_KINDS.map((k) => (
                  <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pc-family">Service</Label>
            <Select value={form.family} onValueChange={(v) => setForm((f) => ({ ...f, family: v }))}>
              <SelectTrigger id="pc-family"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVICE_FAMILIES.map((f) => (
                  <SelectItem key={f} value={f}>{FAMILY_LABEL[f as ServiceFamily]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pc-title">Listing title</Label>
            <Input id="pc-title" placeholder="e.g. 33-seat executive coach" value={form.title} onChange={set("title")} />
          </div>
          <div>
            <Label htmlFor="pc-vehicle">Vehicle type</Label>
            <Input id="pc-vehicle" placeholder="e.g. Bus or coach" value={form.vehicle_type} onChange={set("vehicle_type")} />
          </div>
          <div>
            <Label htmlFor="pc-spec">Specification</Label>
            <Input id="pc-spec" placeholder="e.g. 2021 Isuzu, air conditioned" value={form.spec} onChange={set("spec")} />
          </div>
          <div>
            <Label htmlFor="pc-seats">Seats</Label>
            <Input id="pc-seats" type="number" min={0} value={form.seats} onChange={set("seats")} />
          </div>
          <div>
            <Label htmlFor="pc-units">Vehicles available</Label>
            <Input id="pc-units" type="number" min={1} value={form.units} onChange={set("units")} />
          </div>
          <div>
            <Label htmlFor="pc-city">Base city</Label>
            <Input id="pc-city" placeholder="e.g. Nairobi" value={form.base_city} onChange={set("base_city")} />
          </div>
          <div>
            <Label htmlFor="pc-coverage">Areas you cover</Label>
            <Input id="pc-coverage" placeholder="e.g. Nairobi, Nakuru, Mombasa" value={form.coverage_area} onChange={set("coverage_area")} />
          </div>
          <div>
            <Label htmlFor="pc-rate">Rate</Label>
            <Input id="pc-rate" type="number" min={0} value={form.rate_amount} onChange={set("rate_amount")} />
          </div>
          <div>
            <Label htmlFor="pc-basis">Charged</Label>
            <Select value={form.rate_basis} onValueChange={(v) => setForm((f) => ({ ...f, rate_basis: v }))}>
              <SelectTrigger id="pc-basis"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RATE_BASES.map((b) => (
                  <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pc-currency">Currency</Label>
            <Input id="pc-currency" value={form.currency} onChange={set("currency")} />
          </div>
          <div>
            <Label htmlFor="pc-reg">Vehicle registration</Label>
            <Input id="pc-reg" placeholder="e.g. KDA 123A" value={form.registration_ref} onChange={set("registration_ref")} />
          </div>
          <div>
            <Label htmlFor="pc-from">Available from</Label>
            <Input id="pc-from" type="date" value={form.available_from} onChange={set("available_from")} />
          </div>
          <div>
            <Label htmlFor="pc-to">Available to</Label>
            <Input id="pc-to" type="date" value={form.available_to} onChange={set("available_to")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="pc-notes">Anything else we should know</Label>
            <Textarea id="pc-notes" rows={3} value={form.notes} onChange={set("notes")} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CapacityCard({
  row,
  onChanged,
  onEdit,
}: {
  row: ProviderCapacityRow;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [reason, setReason] = React.useState("");

  const act = useMutation({
    mutationFn: (a: { kind: "submit" | "retire" }) =>
      a.kind === "submit" ? submitCapacity(row.id) : retireCapacity(row.id, reason),
    onSuccess: () => {
      toast({ title: "Updated", description: "Your listing has been updated." });
      setReason("");
      onChanged();
    },
    onError: (e: Error) =>
      toast({ title: "Not updated", description: explainRefusal(e.message), variant: "destructive" }),
  });

  const editable = row.status === "DRAFT" || row.status === "SENT_BACK";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{row.title}</CardTitle>
            <CardDescription>
              {FAMILY_LABEL[row.family as ServiceFamily] ?? row.family} · {row.vehicle_type} · {row.base_city}
            </CardDescription>
          </div>
          <Badge variant="outline" className={TONE[row.status]}>
            {CAPACITY_STATUS_LABEL[row.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{CAPACITY_STATUS_MEANING[row.status]}</p>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <div><dt className="inline text-muted-foreground">Rate: </dt><dd className="inline">{money(row.rate_amount, row.currency)}</dd></div>
          <div><dt className="inline text-muted-foreground">Vehicles: </dt><dd className="inline">{row.units}</dd></div>
          {row.seats !== null && (
            <div><dt className="inline text-muted-foreground">Seats: </dt><dd className="inline">{row.seats}</dd></div>
          )}
          {row.registration_ref && (
            <div><dt className="inline text-muted-foreground">Registration: </dt><dd className="inline">{row.registration_ref}</dd></div>
          )}
          <div><dt className="inline text-muted-foreground">Enquiries: </dt><dd className="inline">{row.enquiry_count} ({row.open_enquiries} open)</dd></div>
          {row.published_at && (
            <div><dt className="inline text-muted-foreground">Live since: </dt><dd className="inline">{dt(row.published_at)}</dd></div>
          )}
        </dl>

        <CapacityPhotos
          capacityId={row.id}
          paths={row.photo_paths ?? []}
          editable={row.status !== "RETIRED"}
          onChanged={onChanged}
        />

        {row.status === "SENT_BACK" && row.decision_reason && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive">
            {row.decision_reason}
          </p>
        )}


        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <>
              <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
              <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ kind: "submit" })}>
                Submit for approval
              </Button>
            </>
          )}
          {row.status !== "RETIRED" && (
            <>
              <Input
                className="h-9 w-52"
                placeholder="Reason to retire"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!reason.trim() || act.isPending}
                onClick={() => act.mutate({ kind: "retire" })}
              >
                Retire
              </Button>
            </>
          )}
        </div>

        {row.history.length > 0 && (
          <>
            <Separator />
            <ol className="space-y-1 text-xs text-muted-foreground">
              {row.history.slice(0, 5).map((h, i) => (
                <li key={i}>
                  {dt(h.created_at)} — {h.action.replace(/_/g, " ").toLowerCase()}
                  {h.reason ? ` — “${h.reason}”` : ""}
                </li>
              ))}
            </ol>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProviderCapacityPortal() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<CapacityDraft | null>(null);
  const [decisionReason, setDecisionReason] = React.useState<Record<string, string>>({});
  const [enquiryNote, setEnquiryNote] = React.useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ["provider-capacity-portal"],
    queryFn: loadProviderPortal,
    enabled: Boolean(user),
  });

  const refresh = () => {
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["provider-capacity-portal"] });
  };

  const decide = useMutation({
    mutationFn: (a: { id: string; decision: "APPROVE" | "SEND_BACK" }) =>
      decideCapacity(a.id, a.decision, decisionReason[a.id]),
    onSuccess: (_r, a) => {
      toast({
        title: a.decision === "APPROVE" ? "Published" : "Sent back",
        description:
          a.decision === "APPROVE"
            ? "The listing is now live in the marketplace."
            : "The operator has been asked to make a change.",
      });
      refresh();
    },
    onError: (e: Error) =>
      toast({ title: "No decision recorded", description: explainRefusal(e.message), variant: "destructive" }),
  });

  const enquiry = useMutation({
    mutationFn: (a: { id: string; status: "ACKNOWLEDGED" | "CLOSED" }) =>
      updateEnquiry(a.id, a.status, enquiryNote[a.id]),
    onSuccess: () => { toast({ title: "Enquiry updated" }); refresh(); },
    onError: (e: Error) =>
      toast({ title: "Not updated", description: explainRefusal(e.message), variant: "destructive" }),
  });

  if (loading || (isLoading && user)) {
    return (
      <MarketingLayout>
        <div className="container mx-auto space-y-4 px-4 py-16">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MarketingLayout>
    );
  }

  if (!user) {
    return (
      <MarketingLayout>
       <div className="container mx-auto px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Please sign in</CardTitle>
          <CardDescription>Sign in to offer your capacity and see your enquiries.</CardDescription>
        </CardHeader>
      </Card>
       </div>
      </MarketingLayout>
    );
  }

  if (error) {
    return (
      <MarketingLayout>
       <div className="container mx-auto px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your capacity could not be loaded</CardTitle>
          <CardDescription>{explainRefusal((error as Error).message)}</CardDescription>
        </CardHeader>
      </Card>
       </div>
      </MarketingLayout>
    );
  }

  const portal = data!;

  return (
    <MarketingLayout>
    <div className="container mx-auto space-y-6 px-4 py-12">
      <SeoHead
        path="/provider/capacity"
        title="Provider Portal — Offer Your Capacity"
        description="Drivers, fleet operators, charter operators and logistics operators submit capacity for approval and see customer enquiries."
      />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My capacity</h1>
          <p className="text-sm text-muted-foreground">
            Offer what you can supply. Once our team approves a listing, customers find it in the
            marketplace and their enquiries land here.
          </p>
        </div>
        {portal.accredited && !editing && (
          <Button onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Offer capacity
          </Button>
        )}
      </header>

      {!portal.accredited && (
        <Card className="border-[hsl(var(--status-warning)/0.5)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-[hsl(var(--status-warning))]" aria-hidden />
              Your operator record is not on the platform yet
            </CardTitle>
            <CardDescription>
              Register as a driver or complete carrier onboarding first. Once your record is approved
              you can list capacity here.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild><Link to="/driver/apply">Register as a driver</Link></Button>
            <Button asChild variant="outline" data-analytics="provider_capacity_apply_operator"><Link to="/partners/apply">Apply as an operator</Link></Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rides">My rides</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles &amp; availability</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="earnings">Earnings</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <ProviderOverview
            summary={portal.summary}
            openEnquiries={portal.enquiries.filter((e) => e.status !== "CLOSED").length}
            accredited={portal.accredited}
          />
        </TabsContent>

        <TabsContent value="rides" className="space-y-4">
          <DriverRides />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          {portal.accredited ? (
            <ProviderDocuments />
          ) : (
            <Card>
              <CardHeader>
                <CardDescription>
                  Once your operator record is approved you can upload your licence, insurance and
                  inspection here.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="vehicles" className="space-y-4">
        <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{portal.summary.total} listings</Badge>
        <Badge variant="outline">{portal.summary.published} live</Badge>
        <Badge variant="outline">{portal.summary.awaiting} awaiting approval</Badge>
        <Badge variant="outline">{portal.summary.drafts} drafts</Badge>
        <Badge variant="outline">{portal.summary.units_live} vehicles live</Badge>
      </div>

      {editing && (
        <CapacityForm initial={editing} onSaved={refresh} onCancel={() => setEditing(null)} />
      )}

      {portal.capacity.length === 0 && !editing && portal.accredited && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">You have not listed any capacity yet</CardTitle>
            <CardDescription>
              Add your first vehicle or service and submit it for approval.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {portal.capacity.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {portal.capacity.map((row) => (
            <CapacityCard
              key={row.id}
              row={row}
              onChanged={refresh}
              onEdit={() =>
                setEditing({
                  id: row.id,
                  provider_name: row.provider_name,
                  provider_kind: row.provider_kind,
                  family: row.family,
                  title: row.title,
                  vehicle_type: row.vehicle_type,
                  spec: row.spec ?? "",
                  seats: row.seats === null ? "" : String(row.seats),
                  units: String(row.units),
                  base_city: row.base_city,
                  coverage_area: row.coverage_area ?? "",
                  rate_amount: row.rate_amount === null ? "" : String(row.rate_amount),
                  rate_basis: row.rate_basis,
                  currency: row.currency,
                  available_from: row.available_from ?? "",
                  available_to: row.available_to ?? "",
                  registration_ref: row.registration_ref ?? "",
                  notes: row.notes ?? "",
                })
              }
            />
          ))}
        </div>
      )}
        </TabsContent>

        <TabsContent value="assignments" className="space-y-4">
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Inbox className="h-4 w-4" aria-hidden /> Enquiries from customers
        </h2>
        {portal.enquiries.length === 0 ? (
          <Card>
            <CardHeader>
              <CardDescription>
                No customer enquiries yet. They appear here the moment someone requests one of your
                live listings.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {portal.enquiries.map((e) => (
              <Card key={e.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{e.capacity_title}</CardTitle>
                      <CardDescription>
                        {e.organisation_name ?? "Customer"}
                        {e.lead_ref ? ` · ${e.lead_ref}` : ""}
                        {e.service_date ? ` · ${e.service_date}` : ""}
                      </CardDescription>
                    </div>
                    <Badge variant="outline">{e.status.toLowerCase()}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {e.passengers !== null && <p>{e.passengers} passengers</p>}
                  {e.requirement && <p className="whitespace-pre-line text-muted-foreground">{e.requirement}</p>}
                  <Input
                    className="h-9"
                    placeholder="Note back to our team"
                    value={enquiryNote[e.id] ?? ""}
                    onChange={(ev) => setEnquiryNote((s) => ({ ...s, [e.id]: ev.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={e.status !== "NEW" || enquiry.isPending}
                      onClick={() => enquiry.mutate({ id: e.id, status: "ACKNOWLEDGED" })}
                    >
                      Acknowledge
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={e.status === "CLOSED" || enquiry.isPending}
                      onClick={() => enquiry.mutate({ id: e.id, status: "CLOSED" })}
                    >
                      Close
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <ProviderBookings enquiries={portal.enquiries} onChanged={refresh} />
        </TabsContent>

        <TabsContent value="earnings" className="space-y-4">
          <ProviderEarnings />
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4">
          <ProviderInvoices />
        </TabsContent>

        <TabsContent value="payouts" className="space-y-4">
          <ProviderPayoutNumbers />
          <ProviderPayoutAccount />
        </TabsContent>

      </Tabs>




      {portal.can_approve && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Capacity awaiting approval
          </h2>
          {portal.awaiting_review.length === 0 ? (
            <Card>
              <CardHeader>
                <CardDescription>Nothing is waiting for a decision.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {portal.awaiting_review.map((r) => (
                <Card key={r.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{r.title}</CardTitle>
                    <CardDescription>
                      {r.provider_name} · {FAMILY_LABEL[r.family as ServiceFamily] ?? r.family} ·{" "}
                      {r.vehicle_type} · {r.base_city}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>
                      {money(r.rate_amount, r.currency)} · {r.units} vehicle(s)
                      {r.seats ? ` · ${r.seats} seats` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">Submitted {dt(r.submitted_at)}</p>
                    {r.is_own && (
                      <p className="text-xs text-[hsl(var(--status-warning))]">
                        This is your own listing — another approver is required.
                      </p>
                    )}
                    <Input
                      className="h-9"
                      placeholder="Reason (required to send back)"
                      value={decisionReason[r.id] ?? ""}
                      onChange={(ev) => setDecisionReason((s) => ({ ...s, [r.id]: ev.target.value }))}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, decision: "APPROVE" })}
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Approve and publish
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!(decisionReason[r.id] ?? "").trim() || decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, decision: "SEND_BACK" })}
                      >
                        Send back
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
    </MarketingLayout>
  );
}
