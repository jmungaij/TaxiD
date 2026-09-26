/**
 * Decision Intelligence Platform surface.
 *
 * Governed reports over the mission-control view with CSV download, PDF-ready
 * print output and scheduled delivery windows. Every report is authorized
 * against the zero-trust governance policy bound to it.
 */
import { useMemo, useState } from "react";
import { CalendarClock, Download, FileText, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { authorize } from "@/lib/customerops/governance";
import {
  DECISION_REPORTS, buildMissionControl, reportToCsv,
  type MissionControlInput, type ReportId,
} from "@/lib/customerops/missionControl";
import { AppButton } from "@/components/nav/AppButton";

export interface DecisionIntelligencePanelProps {
  roles: string[];
  input: MissionControlInput;
}

export default function DecisionIntelligencePanel({ roles, input }: DecisionIntelligencePanelProps) {
  const view = useMemo(() => buildMissionControl(input), [input]);
  const [openId, setOpenId] = useState<ReportId>("operational_kpis");

  const reports = useMemo(
    () => DECISION_REPORTS.map((report) => ({ report, decision: authorize(report.policyId, { roles }) })),
    [roles],
  );
  const active = reports.find((r) => r.report.id === openId) ?? reports[0];
  const rows = active?.decision.allowed ? active.report.rows(view) : [];
  const headers = rows.length ? Object.keys(rows[0]) : [];

  const download = (id: ReportId) => {
    const entry = reports.find((r) => r.report.id === id);
    if (!entry) return;
    if (!entry.decision.allowed) {
      toast({ title: "Download blocked", description: entry.decision.reason, variant: "destructive" });
      return;
    }
    const csv = reportToCsv(entry.report, view);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entry.report.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Report downloaded", description: `${entry.report.title} exported as CSV.` });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4" aria-hidden />
            Governed reports
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {reports.map(({ report, decision }) => (
            <button
              key={report.id}
              type="button"
              onClick={() => setOpenId(report.id)}
              className={`w-full rounded-md border p-3 text-left transition-colors ${report.id === openId ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
            >
              <span className="flex items-center justify-between text-sm font-medium">
                {report.title}
                {!decision.allowed && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                {report.formats.map((f) => <Badge key={f} variant="outline" className="uppercase">{f}</Badge>)}
                {report.schedules.map((s) => (
                  <Badge key={s} variant="secondary" className="capitalize">
                    <CalendarClock className="mr-1 h-3 w-3" aria-hidden />{s}
                  </Badge>
                ))}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
          <CardTitle className="text-sm">{active?.report.title ?? "Report"}</CardTitle>
          <div className="flex gap-2">
            <AppButton analytics="customerops_decision_report_pdf_print" action="submit" size="sm" variant="secondary" aria-label="Print decision intelligence report as PDF" onClick={() => window.print()} disabled={!active?.decision.allowed}>
              PDF
            </AppButton>
            <AppButton analytics="customerops_decision_report_csv_download" action="submit" size="sm" aria-label="Download decision intelligence report as CSV" onClick={() => active && download(active.report.id)} disabled={!active?.decision.allowed}>
              <Download className="mr-1 h-4 w-4" aria-hidden />
              CSV
            </AppButton>
          </div>
        </CardHeader>
        <CardContent>
          {!active?.decision.allowed ? (
            <p className="text-sm text-muted-foreground">{active?.decision.reason ?? "Report unavailable for your role."}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {headers.map((h) => <TableHead key={h}>{h.replace(/_/g, " ")}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      {headers.map((h) => <TableCell key={h} className="tabular-nums">{String(row[h] ?? "—")}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
