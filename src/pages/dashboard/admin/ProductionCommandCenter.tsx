/**
 * PRODUCTION READINESS COMMAND CENTER.
 *
 * DISCOVER → CLASSIFY → EXECUTE REMEDIATION → COLLECT EVIDENCE → VALIDATE →
 * CLEAR → RE-EVALUATE → ADVANCE STATE.
 *
 * The page never exposes a "mark as passed" control. Every blocker offers a
 * single RESOLVE action which launches the workflow its classification dictates.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import { useReadinessExecution } from "@/hooks/useReadinessExecution";
import { ResolveBlockerDialog } from "@/components/logistics/ResolveBlockerDialog";
import { CLASS_LABEL } from "@/lib/logistics/readiness/classification";
import type { CommandCenterControl } from "@/lib/logistics/readiness/execution";
import type { ReadinessTrack } from "@/lib/logistics/readiness/controlPlane";
import { buildBusinessReadiness } from "@/lib/logistics/readiness/businessReadiness";
import { BusinessReadinessPanel, ServiceReadinessCard } from "@/components/logistics/BusinessReadinessPanel";
import { StCertificationPanel } from "@/components/logistics/StCertificationPanel";
import { ReadinessReconciliationPanel } from "@/components/logistics/ReadinessReconciliationPanel";
import { FinancialReadinessPanel } from "@/components/logistics/FinancialReadinessPanel";
import { ReadinessClosurePanel } from "@/components/logistics/ReadinessClosurePanel";
import { LegalDossierPanel } from "@/components/logistics/LegalDossierPanel";

const TABS = [
  { key: "command", label: "Command centre" },
  { key: "closure", label: "Readiness closure" },
  { key: "business", label: "Business readiness" },
  { key: "services", label: "Service readiness" },
  { key: "blockers", label: "Blockers" },
  { key: "infrastructure", label: "Infrastructure" },
  { key: "staging", label: "ST certification" },
  { key: "finance", label: "Financial certification" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "legal", label: "Legal & compliance" },
  { key: "operations", label: "Operations certification" },
  { key: "approvals", label: "Approvals" },
  { key: "pilot", label: "Controlled pilot" },
  { key: "certification", label: "Certification" },
] as const;

const STATUS_TONE: Record<string, string> = {
  PASS: "bg-status-success/15 text-status-success",
  HOLD: "bg-status-warning/15 text-status-warning",
  BLOCKED: "bg-muted text-muted-foreground",
  BUSINESS_APPROVAL_REQUIRED: "bg-status-info/15 text-status-info",
  NOT_TESTED: "bg-muted text-muted-foreground",
  EXPIRED: "bg-destructive/10 text-destructive",
  FAIL: "bg-destructive/15 text-destructive",
};

function ControlRow({ c, onResolve }: { c: CommandCenterControl; onResolve: (c: CommandCenterControl) => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold">{c.control_id}</span>
          <Badge className={STATUS_TONE[c.status] ?? ""} variant="secondary">{c.status.split("_").join(" ")}</Badge>
          <Badge variant="outline" className="text-[10px]">{CLASS_LABEL[c.classification.remediation_class]}</Badge>
          {c.awaiting_execution && <Badge variant="outline" className="text-[10px]">prerequisite met — awaiting execution</Badge>}
        </div>
        <p className="mt-1 text-sm">{c.description}</p>
        <p className="mt-1 text-xs text-muted-foreground"><strong>Why:</strong> {c.classification.why}</p>
        <p className="text-xs text-muted-foreground"><strong>Who:</strong> {c.classification.who} · <strong>Action:</strong> {c.classification.action}</p>
      </div>
      {c.status !== "PASS" && (
        <Button size="sm" onClick={() => onResolve(c)} data-analytics="admin.readiness.resolve">Resolve</Button>
      )}
    </div>
  );
}

export default function ProductionCommandCenter() {
  const { view, evidence, audit, loading, error, refresh, submitEvidence, decide, recordPilotRun, registerTarget } = useReadinessExecution();
  const { tab, goTo } = useTabDeepLink(TABS.map((t) => t.key), "command");
  const [active, setActive] = React.useState<CommandCenterControl | null>(null);

  const cert = view.certification;
  const business = React.useMemo(
    () => buildBusinessReadiness(view.controls, view.infraReady),
    [view.controls, view.infraReady],
  );
  const resolveById = React.useCallback(
    (id: string) => setActive(view.controls.find((c) => c.control_id === id) ?? null),
    [view.controls],
  );
  const byTrack = (tracks: ReadinessTrack[]) => view.controls.filter((c) => tracks.includes(c.track));

  const list = (controls: CommandCenterControl[]) => (
    <div className="space-y-2">
      {controls.length === 0 && <p className="text-sm text-muted-foreground">Nothing outstanding in this register.</p>}
      {controls.map((c) => <ControlRow key={c.control_id} c={c} onResolve={setActive} />)}
    </div>
  );

  return (
    <div className="container mx-auto max-w-7xl space-y-5 p-4 md:p-8">
      <header className="hero-band px-6 py-6">
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">Production certification</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold sm:text-3xl">
              <ShieldCheck className="h-6 w-6" aria-hidden /> {cert.productionStatus}
            </h1>
            <p className="mt-1 max-w-2xl text-sm opacity-85">
              State {cert.state.split("_").join(" ")} · engineering maturity {cert.scores.engineeringMaturity}/100 · production readiness{" "}
              {cert.scores.productionReadiness}/100 · {view.blockers.length} mandatory controls outstanding.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-1 h-4 w-4" aria-hidden />}
            Re-evaluate
          </Button>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>The evidence register could not be read — outstanding items shown may be incomplete. {error}</span>
        </div>
      )}

      <nav aria-label="Command centre sections" className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            onClick={() => goTo(t.key)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              t.key === tab ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "command" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Why am I still on {cert.productionStatus}?</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {view.whyHold.length === 0 && <p className="text-sm text-muted-foreground">No outstanding mandatory controls.</p>}
              {view.whyHold.map((w) => (
                <button
                  key={w.reason}
                  type="button"
                  onClick={() => goTo(w.route.replace("?tab=", ""))}
                  className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left text-sm hover:bg-muted"
                >
                  <span className="capitalize">{w.reason}</span>
                  <Badge variant="secondary">{w.count}</Badge>
                </button>
              ))}
              <div className="pt-2">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remediation classification</p>
                {view.byClass.map((b) => (
                  <div key={b.remediation_class} className="flex items-center justify-between py-0.5 text-xs">
                    <span>{CLASS_LABEL[b.remediation_class]}</span>
                    <span className="font-semibold">{b.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Critical path</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {view.criticalPath.map((s) => (
                <button
                  key={s.order}
                  type="button"
                  onClick={() => goTo(s.route.replace("?tab=", ""))}
                  className="flex w-full items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted"
                >
                  {s.satisfied ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-status-success" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-status-warning" aria-hidden />}
                  <span className="min-w-0 flex-1 text-sm">
                    {s.order}. {s.label}
                    {!s.satisfied && s.outstanding > 0 && <span className="ml-2 text-xs text-muted-foreground">{s.outstanding} outstanding</span>}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Track verdicts</CardTitle></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {cert.trackSummary.map((t) => (
                <div key={t.track} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t.label}</span>
                    <Badge className={STATUS_TONE[t.verdict] ?? ""} variant="secondary">{t.verdict}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.counts.PASS} pass · {Object.entries(t.counts).filter(([k, v]) => k !== "PASS" && v > 0).map(([k, v]) => `${v} ${k.toLowerCase().split("_").join(" ")}`).join(" · ") || "no outstanding"}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "business" && (
        <BusinessReadinessPanel
          report={business}
          onResolve={resolveById}
          onNavigate={(route) => goTo(route.replace("?tab=", ""))}
        />
      )}

      {tab === "services" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Service-level readiness — each service carries its own bookability</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A missing approval on one service never disables another. Bookability is computed from the catalogue
              capability record and the activation dependencies below — no UI flag can override it.
            </p>
            {business.services.map((s) => <ServiceReadinessCard key={s.code} service={s} />)}
          </CardContent>
        </Card>
      )}

      {tab === "blockers" && (
        <Card><CardHeader><CardTitle className="text-base">All outstanding mandatory controls ({view.blockers.length})</CardTitle></CardHeader>
          <CardContent>{list(view.blockers)}</CardContent></Card>
      )}

      {tab === "infrastructure" && (
        <Card><CardHeader><CardTitle className="text-base">Isolated environments & database certification</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {view.infraReady
                ? "Isolated staging and restore targets are registered and isolation-verified. Database tests can now be executed and recorded."
                : "No isolated staging / restore pair is registered. Every database-dependent control stays blocked; simulations are not accepted as evidence."}
            </p>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/admin/infrastructure-di00">Open the DI-00 infrastructure control plane</Link>
            </Button>
            {list(byTrack(["DATABASE_INFRASTRUCTURE"]))}
          </CardContent></Card>

      )}

      {tab === "closure" && (
        <ReadinessClosurePanel
          view={view}
          onResolve={resolveById}
          onOpenRecoveryTargets={() => goTo("reconciliation")}
        />
      )}

      {tab === "staging" && <StCertificationPanel />}

      {tab === "finance" && (
        <FinancialReadinessPanel controls={view.controls} onResolve={resolveById} />
      )}

      {tab === "reconciliation" && (
        <ReadinessReconciliationPanel
          view={view}
          evidence={evidence}
          audit={audit}
          onSubmitEvidence={submitEvidence}
          onDecide={decide}
        />
      )}

      {tab === "legal" && (
        <div className="space-y-4">
          <LegalDossierPanel view={view} onResolve={resolveById} />
          <Card><CardHeader><CardTitle className="text-base">Legal readiness register</CardTitle></CardHeader>
            <CardContent>{list(byTrack(["LEGAL_REGULATORY"]))}</CardContent></Card>
        </div>
      )}

      {tab === "operations" && (
        <Card><CardHeader><CardTitle className="text-base">Operations certification — SOP, owner, SLA, escalation, training</CardTitle></CardHeader>
          <CardContent>{list(byTrack(["OPERATIONS"]))}</CardContent></Card>
      )}

      {tab === "approvals" && (
        <Card><CardHeader><CardTitle className="text-base">Commercial, financial, support, partner &amp; incident acceptance</CardTitle></CardHeader>
          <CardContent>{list(byTrack(["COMMERCIAL", "FINANCIAL_CONTROLS", "CUSTOMER_SUPPORT", "PARTNER_COMPLIANCE", "INCIDENT_RECOVERY"]))}</CardContent></Card>
      )}

      {tab === "pilot" && (
        <Card><CardHeader><CardTitle className="text-base">Controlled pilot — PL-01…PL-17</CardTitle></CardHeader>
          <CardContent>{list(byTrack(["OPERATIONAL_PILOT"]))}</CardContent></Card>
      )}

      {tab === "certification" && (
        <Card><CardHeader><CardTitle className="text-base">State transition gates</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {cert.gates.map((g) => (
              <div key={g.state} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{g.state.split("_").join(" ")}</span>
                  <Badge className={g.satisfied ? STATUS_TONE.PASS : STATUS_TONE.HOLD} variant="secondary">
                    {g.satisfied ? "satisfied" : `${g.missing.length} outstanding`}
                  </Badge>
                </div>
                {!g.satisfied && <p className="mt-1 break-words text-xs text-muted-foreground">{g.missing.slice(0, 12).join(", ")}{g.missing.length > 12 ? "…" : ""}</p>}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              The state advances automatically the moment every mandatory gate is genuinely satisfied. There is no manual transition control.
            </p>
          </CardContent></Card>
      )}

      <ResolveBlockerDialog
        control={active}
        onClose={() => setActive(null)}
        onSubmitEvidence={submitEvidence}
        onDecide={decide}
        onRecordPilotRun={recordPilotRun}
        onRegisterTarget={registerTarget}
      />
    </div>
  );
}
