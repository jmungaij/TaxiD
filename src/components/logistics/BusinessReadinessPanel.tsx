/**
 * BUSINESS READINESS PANEL.
 *
 * Presents the blocker contract, the separated readiness ladder and the
 * per-service activation checklists. It contains no control that can clear a
 * blocker — every action routes to the authoritative workflow.
 */
import * as React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BLOCKER_TYPE_LABEL, FAMILY_LABEL, type BlockerRecord } from "@/lib/logistics/readiness/blockerContract";
import type { BusinessReadinessReport, ServiceReadiness } from "@/lib/logistics/readiness/businessReadiness";

const VERDICT_TONE: Record<string, string> = {
  READY: "bg-status-success/15 text-status-success",
  PARTIAL: "bg-status-warning/15 text-status-warning",
  HOLD: "bg-muted text-muted-foreground",
};

const BOOKABILITY_TONE: Record<string, string> = {
  BOOKABLE: "bg-status-success/15 text-status-success",
  PILOT_ONLY: "bg-status-warning/15 text-status-warning",
  ENQUIRY_ONLY: "bg-status-info/15 text-status-info",
  NOT_BOOKABLE: "bg-muted text-muted-foreground",
};

function Check({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden />
  ) : (
    <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden />
  );
}

export function ReadinessDimensions({ report }: { report: BusinessReadinessReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Independent readiness dimensions</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {report.dimensions.map((d) => (
          <div key={d.dimension} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{d.label}</span>
              <Badge variant="secondary" className={VERDICT_TONE[d.verdict]}>
                {d.verdict} · {d.score}%
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{d.meaning}</p>
            {d.outstanding.length > 0 && (
              <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
                {d.outstanding.slice(0, 10).join(", ")}
                {d.outstanding.length > 10 ? ` +${d.outstanding.length - 10}` : ""}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ReadinessLadder({ report }: { report: BusinessReadinessReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">State ladder — these states are not the same thing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {report.ladder.map((r) => (
          <div key={r.state} className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Check ok={r.satisfied} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{r.state.split("_").join(" ")}</span>
                <Badge variant="secondary" className={r.satisfied ? VERDICT_TONE.READY : VERDICT_TONE.HOLD}>
                  {r.satisfied ? "satisfied" : `${r.outstanding.length} outstanding`}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{r.definition}</p>
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Current state <strong>{report.state.split("_").join(" ")}</strong>. Production certification is never inferred
          from any of the earlier rungs.
        </p>
      </CardContent>
    </Card>
  );
}

export function BlockerContractCard({
  blocker,
  onResolve,
  onNavigate,
}: {
  blocker: BlockerRecord;
  onResolve: (controlId: string) => void;
  onNavigate: (route: string) => void;
}) {
  const b = blocker;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">{b.control_id}</span>
        <Badge variant="outline" className="text-[10px]">{BLOCKER_TYPE_LABEL[b.blocker_type]} blocker</Badge>
        <Badge variant="secondary" className="text-[10px]">{b.clearance_family.split("_").join(" ").toLowerCase()}</Badge>
        <Badge variant="outline" className="text-[10px]">evidence {b.evidence_status.toLowerCase()}</Badge>
        {b.approval_required && (
          <Badge variant="outline" className="text-[10px]">approval {b.approval_status.split("_").join(" ").toLowerCase()}</Badge>
        )}
        {b.meta_tasks.map((m) => (
          <Badge key={m} variant="destructive" className="text-[10px]">{m.split("_").join(" ").toLowerCase()}</Badge>
        ))}
      </div>
      <p className="mt-1 text-sm">{b.control_name}</p>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div><dt className="inline font-semibold">Why blocked: </dt><dd className="inline">{b.root_cause}</dd></div>
        <div><dt className="inline font-semibold">Parent dependency: </dt><dd className="inline">{b.parent_dependency ?? "none"}</dd></div>
        <div><dt className="inline font-semibold">Accountable owner: </dt><dd className="inline">{b.accountable_owner}</dd></div>
        <div><dt className="inline font-semibold">Unlocks: </dt><dd className="inline">{b.child_dependencies.length > 0 ? b.child_dependencies.join(", ") : "no downstream control"}</dd></div>
        {b.system_action && <div><dt className="inline font-semibold">System will: </dt><dd className="inline">{b.system_action}</dd></div>}
        {b.human_action && <div><dt className="inline font-semibold">Human must: </dt><dd className="inline">{b.human_action}</dd></div>}
        {b.external_action && <div><dt className="inline font-semibold">External party must: </dt><dd className="inline">{b.external_action}</dd></div>}
        <div><dt className="inline font-semibold">Evidence that clears it: </dt><dd className="inline">{b.evidence_required}</dd></div>
        <div><dt className="inline font-semibold">Production impact: </dt><dd className="inline">{b.production_impact}</dd></div>
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs"><strong>Next action:</strong> {b.next_action}</p>
        <Button size="sm" variant="outline" onClick={() => onNavigate(b.route)} data-analytics="admin.readiness.open_workflow">
          Open workflow <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button size="sm" onClick={() => onResolve(b.control_id)} data-analytics="admin.readiness.resolve_contract">
          Resolve
        </Button>
      </div>
    </div>
  );
}

export function ServiceReadinessCard({ service }: { service: ServiceReadiness }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{service.name}</span>
            <Badge variant="secondary" className={BOOKABILITY_TONE[service.bookability]}>
              {service.bookability.split("_").join(" ")}
            </Badge>
            <span className="font-mono text-[11px] text-muted-foreground">{service.code}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {service.family} · booking {service.bookingMode.toLowerCase()} · quote {service.quoteMode.toLowerCase()} ·{" "}
            {service.satisfied}/{service.total} activation dependencies satisfied
          </p>
        </div>
      </div>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {service.checklist.map((c) => (
          <li key={c.requirement} className="flex items-start gap-2 text-xs">
            <Check ok={c.satisfied} />
            <span className="min-w-0">
              <span className="font-medium">{c.requirement}</span>
              <span className="text-muted-foreground"> — {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs"><strong>Next action:</strong> {service.nextAction}</p>
    </div>
  );
}

export function BusinessReadinessPanel({
  report,
  onResolve,
  onNavigate,
}: {
  report: BusinessReadinessReport;
  onResolve: (controlId: string) => void;
  onNavigate: (route: string) => void;
}) {
  const [family, setFamily] = React.useState<string>("ALL");
  const blockers = report.register.blockers.filter((b) => family === "ALL" || b.clearance_family === family);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadinessDimensions report={report} />
        <ReadinessLadder report={report} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clearance families — who can actually clear what</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {report.register.byFamily.map((f) => (
            <button
              key={f.family}
              type="button"
              onClick={() => setFamily(f.family)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border p-3 text-left text-sm hover:bg-muted"
            >
              <span>{FAMILY_LABEL[f.family]}</span>
              <Badge variant="secondary">{f.count}</Badge>
            </button>
          ))}
          <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
            <span>System-clearable remaining: <strong>{report.systemClearableRemaining}</strong></span>
            <span>· Human queue: <strong>{report.humanQueue}</strong></span>
            <span>· External queue: <strong>{report.externalQueue}</strong></span>
            <span>· Execution queue: <strong>{report.executionQueue}</strong></span>
          </div>
          {!report.noDeadEnds && (
            <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {report.register.deadEnds.length} blocker(s) lack a next action — these are themselves system tasks.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Blocker contract ({blockers.length})</CardTitle>
          {family !== "ALL" && (
            <Button size="sm" variant="ghost" onClick={() => setFamily("ALL")}>Clear filter</Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {blockers.length === 0 && <p className="text-sm text-muted-foreground">No outstanding blockers in this family.</p>}
          {blockers.map((b) => (
            <BlockerContractCard key={b.control_id} blocker={b} onResolve={onResolve} onNavigate={onNavigate} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
