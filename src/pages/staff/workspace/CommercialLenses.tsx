/**
 * MY WORKSPACE — COMMERCIAL LENSES (Accounts · Opportunities · Quotes · Contracts).
 *
 * Execution layer only: every row is a personal projection of an authoritative
 * commercial record, carries the signal that made it actionable, and opens its
 * system of record. Nothing here stores commercial state.
 */
import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, Building2, FileSignature, FileText, Loader2, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useStaffAccess } from "@/components/staff/StaffAccessProvider";
import {
  deriveMyAccounts,
  fetchMyContracts,
  fetchMyOpportunities,
  fetchMyQuotes,
  type LensSignal,
  type MyContract,
  type MyOpportunity,
  type MyQuote,
} from "@/lib/workspace/lenses";
import ContractExecutionPanel from "@/components/staff/commercial/ContractExecutionPanel";
import ClientPortalPanel from "@/components/staff/commercial/ClientPortalPanel";
import RevenueByEmployeePanel from "@/components/staff/commercial/RevenueByEmployeePanel";

const LENS_BY_PATH: Record<string, string> = {
  "/staff/workspace/accounts": "accounts",
  "/staff/workspace/opportunities": "opportunities",
  "/staff/workspace/quotes": "quotes",
  "/staff/workspace/contracts": "contracts",
};

const SEVERITY_VARIANT: Record<LensSignal["severity"], "destructive" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "secondary",
  info: "outline",
};

function SignalBadges({ signals }: { signals: LensSignal[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {signals.map((s, i) => (
        <Badge key={i} variant={SEVERITY_VARIANT[s.severity]} className="text-[10px]">
          {s.label}
        </Badge>
      ))}
    </div>
  );
}

function LensEmpty({ title, note }: { title: string; note: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function Withheld({ domain }: { domain: string }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="py-8 text-center">
        <p className="text-sm font-semibold">{domain} is not released to your account</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Your commercial data permission does not cover this domain, so nothing is shown rather than an
          approximation. Ask an administrator to grant commercial read access.
        </p>
      </CardContent>
    </Card>
  );
}

function OpenSource({ path, label }: { path: string; label: string }) {
  const navigate = useNavigate();
  return (
    <Button size="sm" variant="ghost" onClick={() => navigate(path)}>
      {label} <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
    </Button>
  );
}

export default function CommercialLenses() {
  const { user } = useAuth();
  const { identity } = useStaffAccess();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [loading, setLoading] = React.useState(true);
  const [opportunities, setOpportunities] = React.useState<MyOpportunity[]>([]);
  const [quotes, setQuotes] = React.useState<MyQuote[]>([]);
  const [contracts, setContracts] = React.useState<MyContract[]>([]);
  const [authorised, setAuthorised] = React.useState({ opportunities: true, quotes: true, contracts: true });

  const tab = LENS_BY_PATH[pathname] ?? "accounts";

  React.useEffect(() => {
    if (!user?.id) return;
    let live = true;
    setLoading(true);
    void (async () => {
      const [o, q, c] = await Promise.all([
        fetchMyOpportunities(user.id),
        identity?.staffId ? fetchMyQuotes(identity.staffId) : Promise.resolve(null),
        identity?.staffId ? fetchMyContracts(identity.staffId) : Promise.resolve(null),
      ]);
      if (!live) return;
      setOpportunities(o.items);
      setQuotes(q?.items ?? []);
      setContracts(c?.items ?? []);
      setAuthorised({
        opportunities: o.authorised,
        quotes: q?.authorised ?? false,
        contracts: c?.authorised ?? false,
      });
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [user?.id, identity?.staffId]);

  const accounts = React.useMemo(
    () => deriveMyAccounts(opportunities, quotes, contracts),
    [opportunities, quotes, contracts],
  );

  const attention =
    opportunities.filter((o) => o.signals.some((s) => s.kind !== "healthy")).length +
    quotes.filter((q) => q.signals.some((s) => s.kind !== "healthy")).length +
    contracts.filter((c) => c.signals.some((s) => s.kind !== "healthy")).length;

  return (
    <div className="space-y-5">
      <header className="hero-band px-6 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">My workspace</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">My commercial book</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-85">
          Your accounts, opportunities, quotes and contracts — projected from the commercial system of record, with
          the reason each one needs you. {attention > 0 ? `${attention} items need attention.` : "Nothing is flagged."}
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => navigate(`/staff/workspace/${v}`)}>
        <TabsList>
          <TabsTrigger value="accounts">
            <Building2 className="mr-1.5 h-4 w-4" /> Accounts
          </TabsTrigger>
          <TabsTrigger value="opportunities">
            <Target className="mr-1.5 h-4 w-4" /> Opportunities
          </TabsTrigger>
          <TabsTrigger value="quotes">
            <FileText className="mr-1.5 h-4 w-4" /> Quotes &amp; proposals
          </TabsTrigger>
          <TabsTrigger value="contracts">
            <FileSignature className="mr-1.5 h-4 w-4" /> Contracts
          </TabsTrigger>
        </TabsList>

        {loading && (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading your commercial records…
          </div>
        )}

        {!loading && (
          <>
            <TabsContent value="accounts" className="mt-4 space-y-3">
              {accounts.length === 0 ? (
                <LensEmpty
                  title="No accounts are attributed to you yet"
                  note="Accounts appear here as soon as an opportunity, quote or contract in the commercial system names you as owner."
                />
              ) : (
                accounts.map((a) => (
                  <Card key={a.key}>
                    <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{a.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {a.openOpportunities} open opportunities · {a.openQuotes} live quotes · {a.contracts} contracts
                          {a.pipelineLabel ? ` · ${a.pipelineLabel}` : ""}
                        </p>
                        {a.attention.length > 0 && <SignalBadges signals={a.attention.slice(0, 4)} />}
                      </div>
                      <OpenSource path="/staff/customers/accounts" label="Account 360" />
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="opportunities" className="mt-4 space-y-3">
              {!authorised.opportunities ? (
                <Withheld domain="Opportunity data" />
              ) : opportunities.length === 0 ? (
                <LensEmpty
                  title="You own no open opportunities"
                  note="When an opportunity in the Sales Portal is assigned to you it appears here with its stage, value and the signal that makes it actionable."
                />
              ) : (
                opportunities.map((o) => (
                  <Card key={o.id}>
                    <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{o.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {o.customer ?? "Customer not recorded"} · Stage {o.stage}
                          {o.probability != null ? ` · ${o.probability}% probability` : ""}
                          {o.value ? ` · ${o.value}` : ""}
                        </p>
                        <SignalBadges signals={o.signals} />
                      </div>
                      <OpenSource path={o.sourcePath} label="Sales Portal" />
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="quotes" className="mt-4 space-y-3">
              {!authorised.quotes ? (
                <Withheld domain="Quotation data" />
              ) : quotes.length === 0 ? (
                <LensEmpty
                  title="No quotes are in your name"
                  note="Quotes and proposals you own appear here by state — draft, awaiting approval, sent, negotiation, accepted — with validity warnings."
                />
              ) : (
                quotes.map((q) => (
                  <Card key={q.id}>
                    <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{q.number ?? "Unnumbered quote"}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {q.status}
                          {q.value ? ` · ${q.value}` : ""}
                          {q.validUntil ? ` · valid until ${new Date(q.validUntil).toLocaleDateString()}` : ""}
                        </p>
                        <SignalBadges signals={q.signals} />
                      </div>
                      <OpenSource path={q.sourcePath} label="Quotation record" />
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="contracts" className="mt-4 space-y-4">
              <ClientPortalPanel />
              <RevenueByEmployeePanel />
              <ContractExecutionPanel />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
