/**
 * STAGE 24 — EXCEPTION CENTRE.
 *
 * Everything in your book that has left its expected path, ordered by
 * consequence: broken customer promises first, then breached commitments,
 * lapsing prices and contracts, blocked decisions, stalled deals.
 *
 * The centre owns no state — resolving an exception in its system of record
 * removes it from here on the next read.
 */
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Check, Clock, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceIntelligence } from "@/hooks/useWorkspaceIntelligence";
import { WorkspaceEmptyState } from "@/components/staff/workspace/WorkspaceEmptyState";
import { FlagServiceIssueDialog } from "@/components/staff/workspace/FlagServiceIssueDialog";
import { EXCEPTION_CLASS_LABEL, type ExceptionSeverity, type WorkspaceException } from "@/lib/workspace/exceptions";
import { listSignals, setSignalStatus, type CommercialSignal } from "@/lib/intelligence/signals";
import { listBookAccounts } from "@/lib/workspace/commercialBook";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const VIEWS = ["all", "customers", "commercial", "accounts", "risk"] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABEL: Record<View, string> = {
  all: "All exceptions",
  customers: "Unhappy customers",
  commercial: "Deals & contracts",
  accounts: "By customer",
  risk: "Accounts at risk",
};

const SEVERITY_LABEL: Record<ExceptionSeverity, string> = {
  act_now: "Act now",
  act_today: "Act today",
  monitor: "Monitor",
};

function relativeDue(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  if (days < 0) return `${Math.abs(days)} day(s) overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

function ExceptionRow({ exception }: { exception: WorkspaceException }) {
  const due = relativeDue(exception.dueAt);
  return (
    <Card
      className={cn(
        "border-l-4",
        exception.severity === "act_now"
          ? "border-l-destructive"
          : exception.severity === "act_today"
            ? "border-l-primary"
            : "border-l-border",
      )}
    >
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={exception.severity === "act_now" ? "destructive" : "secondary"} className="text-[10px]">
            {SEVERITY_LABEL[exception.severity]}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {EXCEPTION_CLASS_LABEL[exception.exceptionClass]}
          </Badge>
          {exception.customer && (
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {exception.customer}
            </span>
          )}
          {due && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden /> {due}
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">Priority {exception.priority}</span>
        </div>

        <p className="font-semibold leading-snug">{exception.title}</p>
        <p className="text-sm text-muted-foreground">{exception.why}</p>
        {exception.impact && <p className="text-sm font-medium">{exception.impact}</p>}
        <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          {exception.consequence}
        </p>

        <Button size="sm" asChild>
          <Link to={exception.action.to}>
            {exception.action.label}
            <ArrowUpRight className="ml-1 h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function List({ items, empty }: { items: WorkspaceException[]; empty: React.ReactNode }) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <div className="space-y-3">
      {items.map((e) => (
        <ExceptionRow key={e.key} exception={e} />
      ))}
    </div>
  );
}

/** A signal raised against an account — including the ones raised from the field. */
function RaisedIssueCard({
  signal,
  busy,
  onResolve,
}: {
  signal: CommercialSignal;
  busy: boolean;
  onResolve: (signal: CommercialSignal) => void;
}) {
  return (
    <Card className={cn("border-l-4", signal.severity === "critical" || signal.severity === "high" ? "border-l-destructive" : "border-l-primary")}>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={signal.severity === "high" || signal.severity === "critical" ? "destructive" : "secondary"} className="text-[10px]">
            {signal.severity}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {signal.type.replace(/_/g, " ")}
          </Badge>
          <span className="text-xs text-muted-foreground">{signal.status}</span>
        </div>
        <p className="font-semibold leading-snug">{signal.headline}</p>
        {signal.recommendedAction && <p className="text-sm text-muted-foreground">{signal.recommendedAction}</p>}
        <ul className="space-y-1 text-xs text-muted-foreground">
          {signal.evidence.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{e.label}:</span> {e.value}
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onResolve(signal)}>
          {busy ? "Closing…" : (
            <>
              <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Mark resolved
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ExceptionCentre() {
  const intel = useWorkspaceIntelligence();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const viewParam = params.get("view");
  const view: View = (VIEWS as readonly string[]).includes(viewParam ?? "") ? (viewParam as View) : "all";

  const [signals, setSignals] = React.useState<CommercialSignal[]>([]);
  const [customers, setCustomers] = React.useState<{ id: string | null; label: string }[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const loadRaised = React.useCallback(async () => {
    try {
      const open = await listSignals({ statuses: ["open", "acknowledged"], limit: 200 });
      setSignals(open);
    } catch {
      setSignals([]);
    }
  }, []);

  React.useEffect(() => {
    void loadRaised();
    void listBookAccounts()
      .then((rows) => setCustomers(rows.map((a) => ({ id: a.id, label: a.name }))))
      .catch(() => setCustomers([]));
  }, [loadRaised]);

  const resolve = async (signal: CommercialSignal) => {
    setBusyId(signal.id);
    try {
      await setSignalStatus(signal.id, "actioned", "Resolved from the exception centre.");
      toast({ title: "Marked resolved", description: signal.headline });
      await loadRaised();
    } catch (err) {
      toast({
        title: "Not closed",
        description: err instanceof Error ? err.message : "The issue could not be closed.",
        variant: "destructive",
      });
    }
    setBusyId(null);
  };

  const setView = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === "all") p.delete("view");
    else p.set("view", next);
    setParams(p, { replace: true });
  };

  const register = intel.exceptions;
  const commercial = register.items.filter(
    (e) => e.exceptionClass === "stalled_opportunity" || e.exceptionClass === "expiring_commercial",
  );

  /**
   * Accounts at risk: every customer carrying either a raised issue or a
   * customer-facing exception, worst first. Nothing is scored — the reading is
   * the records themselves.
   */
  const atRisk = React.useMemo(() => {
    const map = new Map<string, { customer: string; signals: CommercialSignal[]; exceptions: WorkspaceException[] }>();
    for (const s of signals) {
      const key = s.customerLabel ?? "Customer not named on the record";
      const entry = map.get(key) ?? { customer: key, signals: [], exceptions: [] };
      entry.signals.push(s);
      map.set(key, entry);
    }
    for (const e of register.customerFacing) {
      if (!e.customer) continue;
      const entry = map.get(e.customer) ?? { customer: e.customer, signals: [], exceptions: [] };
      entry.exceptions.push(e);
      map.set(e.customer, entry);
    }
    return [...map.values()].sort(
      (a, b) =>
        b.signals.length + b.exceptions.length - (a.signals.length + a.exceptions.length) ||
        a.customer.localeCompare(b.customer),
    );
  }, [signals, register.customerFacing]);

  const withheldDomains = [
    intel.withheld.opportunities && "Opportunities",
    intel.withheld.quotes && "Quotes",
    intel.withheld.contracts && "Contracts",
  ].filter((d): d is string => !!d);


  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Exception centre</h1>
          <p className="text-sm text-muted-foreground">{register.headline}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FlagServiceIssueDialog customers={customers} onRaised={() => void loadRaised()} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              intel.reload();
              void loadRaised();
            }}
            disabled={intel.loading}
          >
            {intel.loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
            )}
            Refresh
          </Button>
        </div>
      </header>

      {intel.identityMissing ? (
        <WorkspaceEmptyState
          title="Your employee record is not linked yet"
          message="Exceptions can only be read once your staff profile is linked to your login."
          actions={[{ label: "Open my workspace", to: "/staff/workspace" }]}
        />
      ) : (
        <>
          {withheldDomains.length > 0 && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="py-4 text-sm">
                <p className="font-semibold">Part of your book is not released to this account</p>
                <p className="mt-1 text-muted-foreground">
                  {withheldDomains.join(", ")} could not be read for you, so no exception is raised from{" "}
                  {withheldDomains.length > 1 ? "them" : "it"} rather than being estimated.
                </p>
              </CardContent>
            </Card>
          )}

          {register.byClass.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {register.byClass.map((c) => (
                <Badge key={c.exceptionClass} variant="outline" className="text-[11px]">
                  {c.label} · {c.count}
                </Badge>
              ))}
            </div>
          )}

          {intel.loading && register.items.length === 0 ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking your records…
            </div>
          ) : (
            <Tabs value={view} onValueChange={setView}>
              <TabsList className="flex-wrap">
                <TabsTrigger value="risk">
                  {VIEW_LABEL.risk}
                  <span className="ml-1.5 text-xs text-muted-foreground">{atRisk.length}</span>
                </TabsTrigger>
                <TabsTrigger value="all">
                  {VIEW_LABEL.all}
                  <span className="ml-1.5 text-xs text-muted-foreground">{register.items.length}</span>
                </TabsTrigger>
                <TabsTrigger value="customers">
                  {VIEW_LABEL.customers}
                  <span className="ml-1.5 text-xs text-muted-foreground">{register.customerFacing.length}</span>
                </TabsTrigger>
                <TabsTrigger value="commercial">
                  {VIEW_LABEL.commercial}
                  <span className="ml-1.5 text-xs text-muted-foreground">{commercial.length}</span>
                </TabsTrigger>
                <TabsTrigger value="accounts">
                  {VIEW_LABEL.accounts}
                  <span className="ml-1.5 text-xs text-muted-foreground">{register.accounts.length}</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-4">
                <List
                  items={register.items}
                  empty={
                    <WorkspaceEmptyState
                      title="Nothing has left its expected path"
                      message="No promise is late, no deal is stalled, no price or contract is lapsing, and no decision is blocking anyone."
                      actions={[{ label: "Open the work queue", to: "/staff/workspace/work-queue" }]}
                    />
                  }
                />
              </TabsContent>

              <TabsContent value="customers" className="mt-4">
                <List
                  items={register.customerFacing}
                  empty={
                    <WorkspaceEmptyState
                      title="No customer is currently let down"
                      message="Nothing in your book is late to a customer, breaching a committed time, or lapsing on them."
                      actions={[{ label: "See all exceptions", to: "/staff/workspace/exceptions" }]}
                    />
                  }
                />
              </TabsContent>

              <TabsContent value="commercial" className="mt-4">
                <List
                  items={commercial}
                  empty={
                    <WorkspaceEmptyState
                      title="No deal is stalled and nothing is lapsing"
                      message="Every opportunity has recent movement and no quote or contract is inside its expiry window."
                      actions={[{ label: "Open my opportunities", to: "/staff/workspace/opportunities" }]}
                    />
                  }
                />
              </TabsContent>

              <TabsContent value="accounts" className="mt-4 space-y-4">
                {register.accounts.length === 0 ? (
                  <WorkspaceEmptyState
                    title="No customer has an open exception"
                    message="Exceptions are grouped by customer here so you can fix a relationship in one conversation."
                    actions={[{ label: "See all exceptions", to: "/staff/workspace/exceptions" }]}
                  />
                ) : (
                  register.accounts.map((a) => (
                    <section key={a.customer} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold">{a.customer}</h2>
                        <Badge variant={a.severity === "act_now" ? "destructive" : "secondary"} className="text-[10px]">
                          {SEVERITY_LABEL[a.severity]}
                        </Badge>
                        {a.unhappy && (
                          <Badge variant="outline" className="text-[10px]">
                            Felt by the customer
                          </Badge>
                        )}
                      </div>
                      <List items={a.exceptions} empty={null} />
                    </section>
                  ))
                )}
              </TabsContent>

              <TabsContent value="risk" className="mt-4 space-y-5">
                {atRisk.length === 0 ? (
                  <WorkspaceEmptyState
                    title="No account is carrying an issue"
                    message="Nothing has been raised against a customer and no customer-facing exception is open. Use “Flag a service issue” the moment something goes wrong in the field."
                    actions={[{ label: "See all exceptions", to: "/staff/workspace/exceptions" }]}
                  />
                ) : (
                  atRisk.map((a) => (
                    <section key={a.customer} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold">{a.customer}</h2>
                        <Badge variant="destructive" className="text-[10px]">
                          {a.signals.length} raised
                        </Badge>
                        {a.exceptions.length > 0 && (
                          <Badge variant="outline" className="text-[10px]">
                            {a.exceptions.length} exception(s) the customer can feel
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-3">
                        {a.signals.map((s) => (
                          <RaisedIssueCard key={s.id} signal={s} busy={busyId === s.id} onResolve={resolve} />
                        ))}
                      </div>
                      <List items={a.exceptions} empty={null} />
                    </section>
                  ))
                )}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}
