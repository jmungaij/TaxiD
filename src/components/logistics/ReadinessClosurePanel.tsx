/**
 * READINESS CLOSURE WORKSPACE.
 *
 * One surface over the EXISTING readiness engine, evidence register, approval
 * RPCs and append-only audit. It adds no engine and no PASS control: every row
 * routes to the existing Resolve workflow, whose submit/decide RPCs enforce a
 * mandatory evidence reference and separation of duties server-side.
 */
import * as React from "react";
import { Download, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  buildClosureInventory,
  closureInventoryCsv,
  matchesClosureFilter,
  CLOSURE_FILTERS,
  CLOSURE_STATE_LABEL,
  type ClosureFilter,
  type ClosureRow,
} from "@/lib/logistics/readiness/closure";
import type { CommandCenterView } from "@/lib/logistics/readiness/execution";

const STATE_TONE: Record<string, string> = {
  PASS: "bg-status-success/15 text-status-success",
  FAIL: "bg-destructive/15 text-destructive",
  EXPIRED: "bg-destructive/10 text-destructive",
  INVALIDATED: "bg-destructive/10 text-destructive",
  DEPENDENCY_BLOCKED: "bg-muted text-muted-foreground",
  OWNER_APPROVAL_REQUIRED: "bg-status-info/15 text-status-info",
  LEGAL_APPROVAL_REQUIRED: "bg-status-info/15 text-status-info",
  EVIDENCE_REQUIRED: "bg-status-warning/15 text-status-warning",
  SOFTWARE_REQUIRED: "bg-status-warning/15 text-status-warning",
  CONFIGURATION_REQUIRED: "bg-status-warning/15 text-status-warning",
  PROVIDER_CONFIGURATION_REQUIRED: "bg-status-info/15 text-status-info",
  EXTERNAL_EXECUTION_REQUIRED: "bg-status-info/15 text-status-info",
};

function Row({ r, onResolve }: { r: ClosureRow; onResolve: (id: string) => void }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold">{r.control_id}</span>
            <Badge variant="secondary" className={STATE_TONE[r.state] ?? ""}>{CLOSURE_STATE_LABEL[r.state]}</Badge>
            <Badge variant="outline" className="text-[10px]">{r.domain}</Badge>
            <Badge variant="outline" className="text-[10px]">{r.severity}</Badge>
            {r.in_wave && <Badge variant="outline" className="text-[10px]">closure wave</Badge>}
          </div>
          <p className="mt-1 text-sm">{r.acceptance_criterion}</p>
          {r.why_blocked && <p className="mt-1 text-xs text-muted-foreground"><strong>Why blocked:</strong> {r.why_blocked}</p>}
          <p className="text-xs text-muted-foreground"><strong>Required evidence:</strong> {r.required_evidence}</p>
          <p className="text-xs text-muted-foreground">
            <strong>Owner:</strong> {r.owner || "unassigned"} · <strong>Approver:</strong> {r.approver || "unassigned"}
          </p>
          <p className="text-xs text-muted-foreground">
            <strong>Depends on:</strong> {r.dependencies.join(", ") || "none"} · <strong>Unlocks:</strong>{" "}
            {r.downstream_impact.join(", ") || "none"}
          </p>
          <p className="text-xs text-muted-foreground">
            <strong>Evidence:</strong> {r.evidence_validity.split("_").join(" ").toLowerCase()}
            {r.evidence_reference ? ` (${r.evidence_reference.slice(0, 24)})` : ""} · <strong>Last verified:</strong>{" "}
            {r.last_verified?.slice(0, 10) ?? "never"} · <strong>Expiry:</strong> {r.expiry?.slice(0, 10) ?? "none"} ·{" "}
            <strong>Audit:</strong> {r.audit_status.toLowerCase()}
          </p>
          <p className="mt-1 text-xs"><strong>Next action:</strong> {r.next_action}</p>
        </div>
        {r.state !== "PASS" && (
          <Button size="sm" onClick={() => onResolve(r.control_id)} data-analytics="admin.readiness.closure.resolve">
            Resolve
          </Button>
        )}
      </div>
    </div>
  );
}

export function ReadinessClosurePanel({
  view,
  onResolve,
  onOpenRecoveryTargets,
}: {
  view: CommandCenterView;
  onResolve: (controlId: string) => void;
  onOpenRecoveryTargets: () => void;
}) {
  const [filter, setFilter] = React.useState<ClosureFilter>("ALL");
  const [search, setSearch] = React.useState("");

  const inventory = React.useMemo(() => buildClosureInventory(view), [view]);
  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inventory.rows.filter(
      (r) =>
        matchesClosureFilter(r, filter) &&
        (!needle ||
          `${r.control_id} ${r.acceptance_criterion} ${r.required_evidence} ${r.owner} ${r.approver}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [inventory.rows, filter, search]);

  const download = () => {
    const blob = new Blob([closureInventoryCsv(inventory)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yalla-readiness-closure-inventory-${inventory.generated_at.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const t = inventory.totals;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Readiness closure — authoritative outstanding register</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onOpenRecoveryTargets}>
              <ExternalLink className="mr-1 h-4 w-4" aria-hidden /> RPO/RTO approval (ST-12 / ST-13)
            </Button>
            <Button size="sm" variant="outline" onClick={download} data-analytics="admin.readiness.closure.export">
              <Download className="mr-1 h-4 w-4" aria-hidden /> Export inventory
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["Total controls", t.total],
              ["Pass", t.pass],
              ["Outstanding (mandatory)", t.outstanding],
              ["Evidence required", t.evidence_required],
              ["Owner / legal approval", t.owner_approval],
              ["Provider configuration", t.provider_configuration],
              ["External execution", t.external_execution],
              ["Dependency blocked", t.dependency_blocked],
              ["Software / configuration", t.software_required],
              ["Fail", t.fail],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-border p-2">
                <p className="text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Every state below is computed from the evidence register, sealed executions and recorded pilot runs. There is no
            control here that marks a gate as passed: submission requires an evidence reference, and approval is refused
            server-side when the approver is the submitter.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {CLOSURE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  filter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search control, criterion, owner or approver"
            aria-label="Search readiness closure register"
          />
        </CardContent>
      </Card>

      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No control matches this filter.</p>}
        {rows.map((r) => <Row key={r.control_id} r={r} onResolve={onResolve} />)}
      </div>
    </div>
  );
}
