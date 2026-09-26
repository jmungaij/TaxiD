import { useMemo } from "react";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFlightHub } from "@/lib/charter/useFlightHub";
import { buildCompliance, complianceScore } from "@/lib/charter/flightHub";
import { downloadAuditCsv } from "@/lib/charter/auditExport";
import { CheckCircle2, AlertTriangle, ShieldAlert, Download } from "lucide-react";
import { cn } from "@/lib/utils";

const SEV = {
  ok: { icon: CheckCircle2, cls: "text-status-success", chip: "bg-status-success/12 text-status-success", label: "Clear" },
  watch: { icon: AlertTriangle, cls: "text-status-warning", chip: "bg-status-warning/12 text-status-warning", label: "Watch" },
  breach: { icon: ShieldAlert, cls: "text-status-danger", chip: "bg-status-danger/12 text-status-danger", label: "Breach" },
} as const;

export default function Compliance() {
  const { data, loading, error, reload } = useFlightHub();
  const checks = useMemo(() => buildCompliance(data), [data]);
  const score = complianceScore(checks);

  return (
    <FlightHubPage
      eyebrow="Flight Hub · Assurance"
      title="Aviation Compliance"
      subtitle="Evidence integrity, operator accountability and regulator-facing traceability across every chartered flight."
      loading={loading}
      error={error}
      onReload={reload}
      actions={
        <Button data-analytics="compliance.export"
          size="sm" variant="secondary"
          className="gap-2 bg-primary-foreground/12 text-primary-foreground hover:bg-primary-foreground/20 border-0"
          onClick={() => downloadAuditCsv(data.audit)}
          disabled={data.audit.length === 0}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export audit CSV
        </Button>
      }
      metrics={[
        { label: "Compliance score", value: `${score}%` },
        { label: "Breaches", value: String(checks.filter((c) => c.severity === "breach").length) },
        { label: "Watch items", value: String(checks.filter((c) => c.severity === "watch").length) },
        { label: "Audit entries", value: String(data.audit.length) },
      ]}
    >
      <HubSection title="Control checks" description="Continuously evaluated against live charter data.">
        <ul className="grid gap-3 md:grid-cols-2">
          {checks.map((c) => {
            const s = SEV[c.severity];
            return (
              <li key={c.id} className="flex gap-3 rounded-xl border border-border bg-card p-4">
                <s.icon className={cn("mt-0.5 h-5 w-5 shrink-0", s.cls)} aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{c.title}</h3>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", s.chip)}>{s.label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{c.count}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </HubSection>

      <HubSection title="Recent pricing & evidence audit" description="Most recent governed changes with attached evidence.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.audit.slice(0, 15).map((a) => (
                <TableRow key={a.id} className="row-hover">
                  <TableCell className="text-sm text-muted-foreground">{new Date(a.created_at).toLocaleString()}</TableCell>
                  <TableCell className="font-medium">{a.action}</TableCell>
                  <TableCell className="font-mono text-xs">{a.reference ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.actor_email ?? "system"}</TableCell>
                  <TableCell className="text-sm">
                    {a.evidence_url
                      ? <span className="text-status-success">Attached</span>
                      : <span className="text-status-warning">Missing</span>}
                  </TableCell>
                </TableRow>
              ))}
              {data.audit.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No audit entries visible for your role.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </HubSection>
    </FlightHubPage>
  );
}
