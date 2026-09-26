/**
 * Failure population reconciliation panel.
 *
 * The 31 Aug incident was reported with three different numbers (30, 40, 68)
 * because three different populations were being counted. This panel makes the
 * accounting explicit and auditable: every API error event lands in exactly one
 * class, every refusal lands in exactly one class, and event counts are shown
 * separately from unique candidates so "68 refusals" can never be read as "68
 * candidates". If either total fails to close, the panel says so instead of
 * presenting numbers as authoritative.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchFailureReconciliation,
  reconciliationBalances,
} from "@/lib/recruitment/publicHealth";

const Row = ({ label, value }: { label: string; value: number | string }) => (
  <div className="flex items-center justify-between gap-4 py-1 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-semibold tabular-nums">{value}</span>
  </div>
);

export default function FailureReconciliationPanel({ hours = 24 }: { hours?: number }) {
  const q = useQuery({
    queryKey: ["rec", "failureReconciliation", hours],
    queryFn: () => fetchFailureReconciliation(hours),
    staleTime: 0,
    refetchOnMount: "always",
  });

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Reconciliation could not be computed: {(q.error as Error | undefined)?.message ?? "unknown error"}.
        </CardContent>
      </Card>
    );
  }

  const r = q.data;
  const balances = reconciliationBalances(r);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Scale className="h-4 w-4" /> Failure population reconciliation ({r.window_hours}h)
          <Badge variant={balances ? "secondary" : "destructive"} className="ml-auto">
            {balances ? (
              <>
                <CheckCircle2 className="mr-1 h-3 w-3" /> accounting closes
              </>
            ) : (
              <>
                <AlertTriangle className="mr-1 h-3 w-3" /> unbalanced — not authoritative
              </>
            )}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Public API events</p>
          <Row label="Total requests" value={r.api.total_requests} />
          <Row label="Successful" value={r.api.successful} />
          <Row label="Error events" value={r.api.error_events} />
          <div className="mt-2 border-t pt-2">
            {Object.entries(r.api.by_class).map(([k, v]) => (
              <Row key={k} label={k.replace(/_/g, " ").toLowerCase()} value={v} />
            ))}
            {Object.keys(r.api.by_class).length === 0 ? (
              <p className="text-xs text-muted-foreground">No error events in the window.</p>
            ) : null}
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Refused submissions</p>
          <Row label="Refusal events" value={r.refusals.refusal_events} />
          <Row label="Business validation" value={r.refusals.business_validation} />
          <Row label="Candidate action required" value={r.refusals.candidate_action_required} />
          <Row label="Technical failures" value={r.refusals.technical_failures} />
          <Row label="Security failures" value={r.refusals.security_failures} />
          <Row label="Other / unclassified" value={r.refusals.other} />
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Populations (events ≠ people)</p>
          <Row label="Unique candidates" value={r.identity.unique_candidates} />
          <Row label="Unique vacancies" value={r.identity.unique_vacancies} />
          <Row label="Unique sessions" value={r.identity.unique_sessions} />
          <Row label="Total attempts" value={r.identity.total_attempts} />
          <Row label="Remediation cases" value={r.identity.remediation_cases} />
          <div className="mt-2 border-t pt-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Refusals by careers build</p>
            {Object.entries(r.refusals.by_build).map(([k, v]) => (
              <Row key={k} label={k} value={v} />
            ))}
            {Object.keys(r.refusals.by_build).length === 0 ? (
              <p className="text-xs text-muted-foreground">No refusals in the window.</p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
