/**
 * STAGE 8 — ACCOUNT 360.
 *
 * Everything known about one customer on one page: revenue, active services,
 * open opportunities, proposals, contracts, service orders and issues — each
 * read from its system of record. A withheld or empty domain says so; no
 * section ever shows an invented number.
 */
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  FileSignature,
  FileText,
  Loader2,
  PackageCheck,
  Target,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceEmptyState } from "@/components/staff/workspace/WorkspaceEmptyState";
import {
  fetchAccount360,
  formatKes,
  isOpenOpportunity,
  type Account360 as Account360Model,
  type Section,
} from "@/lib/workspace/account360";
import { ReadingBadge } from "@/components/staff/workspace/ReadingBadge";
import { contractMilestone } from "@/lib/workspace/contractMilestones";
import { listSignals, setSignalStatus, type CommercialSignal } from "@/lib/intelligence/signals";
import {
  accountEngagement,
  fetchAccountInteractions,
  opportunityHealth,
  proposalMomentum,
  renewalRisk,
  worstReading,
  type InteractionInput,
  type Reading,
} from "@/lib/workspace/commercialIntelligence";

const date = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

function Note({ section }: { section: Section<unknown> }) {
  if (!section.reason) return null;
  return (
    <Card className={section.authorised ? "" : "border-destructive/40 bg-destructive/5"}>
      <CardContent className="py-8 text-center">
        <p className="text-sm font-semibold">
          {section.authorised ? "Nothing recorded yet" : "Not released to your account"}
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{section.reason}</p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Row({
  title,
  meta,
  right,
  badges,
  to,
}: {
  title: string;
  meta?: string;
  right?: string;
  badges?: string[];
  to?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {meta && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>}
        {badges && badges.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <Badge key={b} variant="outline" className="text-[10px]">
                {b}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {right && <span className="text-sm font-semibold tabular-nums">{right}</span>}
        {to && (
          <Button size="sm" variant="ghost" asChild>
            <Link to={to}>
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Issues raised against this customer from the field or the exception centre.
 * They are read from the shared signal register, so a flag raised anywhere
 * appears here on the customer's own page, and closing it here closes it there.
 */
function RaisedIssues({ accountId, customerLabel }: { accountId: string; customerLabel: string }) {
  const [items, setItems] = React.useState<CommercialSignal[] | null>(null);

  const load = React.useCallback(() => {
    void listSignals({ accountId, statuses: ["open", "acknowledged"], limit: 50 })
      .then(setItems)
      .catch(() => setItems([]));
  }, [accountId]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (!items || items.length === 0) return null;

  return (
    <Card className="border-destructive/40 bg-destructive/[0.03]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Issues raised against {customerLabel} ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((s) => (
          <div key={s.id} className="rounded-lg border bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{s.headline}</span>
              <Badge variant="outline" className="text-[10px] capitalize">
                {s.type.replace(/_/g, " ")}
              </Badge>
              <Badge variant="outline" className="text-[10px] capitalize">
                {s.severity}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-xs"
                onClick={() => {
                  void setSignalStatus(s.id, "actioned", "Resolved from the customer's account page.").then(load);
                }}
              >
                Mark resolved
              </Button>
            </div>
            {s.evidence?.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {s.evidence.map((e) => `${e.label}: ${e.value}`).join(" · ")}
              </p>
            )}
            {s.recommendedAction && <p className="mt-1 text-xs">Next: {s.recommendedAction}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function Account360Page() {
  const { accountId = "" } = useParams();
  const [model, setModel] = React.useState<Account360Model | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [interactions, setInteractions] = React.useState<InteractionInput[]>([]);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    void fetchAccount360(accountId).then((m) => {
      if (!live) return;
      setModel(m);
      setLoading(false);
    });
    void fetchAccountInteractions(accountId).then((r) => {
      if (live) setInteractions(r.items);
    });
    return () => {
      live = false;
    };
  }, [accountId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the account…
      </div>
    );
  }

  if (!model?.account) {
    return (
      <div className="p-6">
        <WorkspaceEmptyState
          title="Account not available"
          message={model?.error ?? "This account does not exist, or it has not been released to your login."}
          actions={[{ label: "Back to the commercial book", to: "/staff/workspace/book" }]}
        />
      </div>
    );
  }

  const a = model.account;
  const openOpportunities = model.opportunities.data.filter((o) => isOpenOpportunity(o.stage));
  const openIssues = model.issues.data.filter((i) => !["resolved", "closed"].includes(i.status.toLowerCase()));
  const revenue = model.revenue.data;

  /* ------------------------- Stage 10 commercial intelligence ------------------------- */
  const engagement = accountEngagement(interactions);
  const opportunityReadings = openOpportunities.map((o) => ({
    label: o.ref ?? o.title,
    reading: opportunityHealth({
      stage: o.stage,
      updatedAt: null,
      valueCents: o.valueCents,
      probabilityPct: o.probability,
      hasProposal: model.quotations.data.length > 0,
    }),
  }));
  const proposalReadings = model.quotations.data.map((q) => ({
    label: q.quote_number,
    reading: proposalMomentum({
      status: q.status,
      approvalStatus: q.approval_status,
      createdAt: q.created_at,
      validUntil: q.valid_until,
      totalAmount: q.total_amount,
    }),
  }));
  const contractReadings = model.contracts.data.map((c) => ({
    label: c.customer_legal_name ?? c.template,
    reading: renewalRisk({
      status: c.status,
      effectiveDate: c.effective_date,
      contractTerm: c.contract_term,
      hasApprovedSchedule: (c.schedules ?? []).some((s) => s.approval_status?.toLowerCase() === "approved"),
    }) as Reading,
  }));
  const intelligence: { label: string; reading: Reading }[] = [
    { label: "Engagement", reading: engagement },
    ...(worstReading(opportunityReadings)
      ? [{ label: "Weakest opportunity", reading: worstReading(opportunityReadings)!.reading }]
      : []),
    ...(worstReading(proposalReadings)
      ? [{ label: "Weakest proposal", reading: worstReading(proposalReadings)!.reading }]
      : []),
    ...(worstReading(contractReadings)
      ? [{ label: "Renewal risk", reading: worstReading(contractReadings)!.reading }]
      : []),
  ];

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{a.account_ref}</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Building2 className="h-5 w-5 text-primary" aria-hidden /> {a.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[a.industry, a.city, a.country].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="text-[10px] capitalize">
              {a.lifecycle_stage.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="text-[10px] capitalize">
              {a.importance_tier}
            </Badge>
            {!a.corporate_id && (
              <Badge variant="outline" className="text-[10px]">
                No billing entity linked
              </Badge>
            )}
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link to="/staff/workspace/book">Commercial book</Link>
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Billed to date"
          value={revenue ? (formatKes(revenue.billedCents, revenue.currency) ?? "—") : "Not available"}
          hint={revenue ? `${revenue.settledOrders} settled service events` : (model.revenue.reason ?? undefined)}
        />
        <Stat
          label="Platform revenue"
          value={revenue ? (formatKes(revenue.platformRevenueCents, revenue.currency) ?? "—") : "Not available"}
          hint={revenue && revenue.incompleteEconomics > 0 ? `${revenue.incompleteEconomics} awaiting finance` : undefined}
        />
        <Stat
          label="Open opportunities"
          value={model.opportunities.authorised ? String(openOpportunities.length) : "Not available"}
          hint={
            model.opportunities.authorised
              ? (formatKes(
                  openOpportunities.reduce((s, o) => s + (o.valueCents ?? 0), 0),
                  openOpportunities[0]?.currency ?? "KES",
                ) ?? undefined)
              : undefined
          }
        />
        <Stat
          label="Open issues"
          value={model.issues.authorised ? String(openIssues.length) : "Not available"}
          hint={model.activeServices.length > 0 ? `${model.activeServices.length} services live` : "No live service yet"}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Commercial intelligence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {intelligence.map((i) => (
              <ReadingBadge key={i.label} label={i.label} reading={i.reading} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {engagement.lastContactDays == null
              ? "No email, call or meeting is recorded against this account yet."
              : `Last recorded contact ${engagement.lastContactDays} day(s) ago · ${engagement.interactions30d} interaction(s) in the last 30 days · ${engagement.inbound30d} from the customer.`}
            {" Tap a badge to see the recorded facts behind it."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Active services</CardTitle>
        </CardHeader>
        <CardContent>
          {model.activeServices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No service is live under a signed contract and approved schedule yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {model.activeServices.map((s) => (
                <Badge key={s} className="text-[11px] capitalize">
                  {s.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Issues raised from the field or the exception centre, against this customer. */}
      <RaisedIssues accountId={accountId} customerLabel={a.name} />

      <Tabs defaultValue="opportunities">
        <TabsList className="flex-wrap">
          <TabsTrigger value="opportunities">
            <Target className="mr-1.5 h-4 w-4" aria-hidden /> Opportunities
          </TabsTrigger>
          <TabsTrigger value="proposals">
            <FileText className="mr-1.5 h-4 w-4" aria-hidden /> Proposals
          </TabsTrigger>
          <TabsTrigger value="contracts">
            <FileSignature className="mr-1.5 h-4 w-4" aria-hidden /> Contracts
          </TabsTrigger>
          <TabsTrigger value="orders">
            <PackageCheck className="mr-1.5 h-4 w-4" aria-hidden /> Service orders
          </TabsTrigger>
          <TabsTrigger value="issues">
            <AlertTriangle className="mr-1.5 h-4 w-4" aria-hidden /> Issues
          </TabsTrigger>
          <TabsTrigger value="people">
            <Users className="mr-1.5 h-4 w-4" aria-hidden /> People
          </TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities" className="mt-4">
          {model.opportunities.data.length === 0 ? (
            <Note section={model.opportunities} />
          ) : (
            <Card>
              <CardContent className="py-2">
                {model.opportunities.data.map((o) => (
                  <Row
                    key={o.id}
                    title={o.title}
                    meta={`${o.ref ?? "—"} · ${o.stage.replace(/_/g, " ")}${o.probability ? ` · ${o.probability}% likely` : ""}`}
                    right={formatKes(o.valueCents, o.currency) ?? undefined}
                    to="/staff/workspace/opportunities"
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="proposals" className="mt-4">
          {model.quotations.data.length === 0 ? (
            <Note section={model.quotations} />
          ) : (
            <Card>
              <CardContent className="py-2">
                {model.quotations.data.map((q) => (
                  <Row
                    key={q.id}
                    title={q.quote_number}
                    meta={`${q.status} · valid to ${date(q.valid_until)} · issued ${date(q.created_at)}`}
                    badges={q.approval_status === "required" ? ["Approval required"] : undefined}
                    right={q.total_amount != null ? `${q.currency ?? "KES"} ${Number(q.total_amount).toLocaleString()}` : undefined}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="contracts" className="mt-4">
          {model.contracts.data.length === 0 ? (
            <Note section={model.contracts} />
          ) : (
            <div className="space-y-3">
              {model.contracts.data.map((c) => (
                <Card key={c.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {c.template} <span className="font-normal text-muted-foreground">v{c.template_version}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="text-muted-foreground">
                      {c.customer_legal_name} · {c.status} · effective {date(c.effective_date)} · {c.contract_term ?? "term not set"}
                    </p>
                    {(() => {
                      const m = contractMilestone(c);
                      return (
                        <div
                          className={`rounded-lg border px-3 py-2 text-xs ${m.overdue ? "border-destructive/40 bg-destructive/5" : "bg-muted/30"}`}
                        >
                          <p className="font-semibold">Next action</p>
                          <p className="mt-0.5 text-muted-foreground">{m.action}</p>
                          <p className="mt-0.5 text-muted-foreground">
                            {m.deadline === null
                              ? "No date recorded on the contract."
                              : m.overdue
                                ? `Due ${date(m.deadline)} · overdue by ${Math.abs(m.daysRemaining ?? 0)} day(s)`
                                : `Due ${date(m.deadline)} · ${m.daysRemaining} day(s) remaining`}
                          </p>
                        </div>
                      );
                    })()}
                    <div className="flex flex-wrap gap-1.5">
                      {(c.selected_services ?? []).map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px] capitalize">
                          {s.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                    {c.schedules.length > 0 && (
                      <div className="rounded-lg border p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schedules</p>
                        {c.schedules.map((s) => (
                          <Row
                            key={s.id}
                            title={s.title}
                            meta={`${(s.services ?? []).join(", ") || "no service listed"} · ${s.validity ?? "validity not set"}`}
                            badges={[s.approval_status]}
                          />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          {model.orders.data.length === 0 ? (
            <Note section={model.orders} />
          ) : (
            <Card>
              <CardContent className="py-2">
                {model.orders.data.map((o) => (
                  <Row
                    key={o.id}
                    title={`${o.ref} · ${o.serviceLine.replace(/_/g, " ")}`}
                    meta={`${o.status} · ${o.paymentStatus ?? "payment not recorded"} · ${date(o.createdAt)}`}
                    right={formatKes(o.customerChargeCents, o.currency) ?? "economics pending"}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="issues" className="mt-4">
          {model.issues.data.length === 0 ? (
            <Note section={model.issues} />
          ) : (
            <Card>
              <CardContent className="py-2">
                {model.issues.data.map((i) => (
                  <Row
                    key={i.id}
                    title={`${i.ref ?? i.kind} · ${i.kind.replace(/_/g, " ")}`}
                    meta={`${i.status} · ${i.stage} · due ${date(i.slaDueAt)}${i.recommendedAction ? ` · ${i.recommendedAction}` : ""}`}
                    badges={[i.severity]}
                    right={formatKes(i.valueAtRiskCents, i.currency) ?? undefined}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="people" className="mt-4 space-y-3">
          {model.contacts.data.length === 0 ? (
            <Note section={model.contacts} />
          ) : (
            <Card>
              <CardContent className="py-2">
                {model.contacts.data.map((c) => (
                  <Row
                    key={c.id}
                    title={c.full_name}
                    meta={[c.job_title, c.email, c.phone].filter(Boolean).join(" · ")}
                    badges={[c.contact_role.replace(/_/g, " ")]}
                  />
                ))}
              </CardContent>
            </Card>
          )}
          {model.nextActions.data.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Next actions</CardTitle>
              </CardHeader>
              <CardContent className="py-0">
                {model.nextActions.data.map((n) => (
                  <Row key={n.id} title={n.title} meta={`${n.status} · due ${date(n.due_at)}`} badges={[n.priority]} />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
