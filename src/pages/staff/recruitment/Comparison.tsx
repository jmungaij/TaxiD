import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import * as rec from "@/lib/recruitment/api";
import * as engine from "@/lib/recruitment/assessment";
import { BAND_LABEL, type ScoreBand } from "@/lib/recruitment/assessmentScoring";

const COMPETENCIES: { code: string; label: string }[] = [
  { code: "verified_sales", label: "Sales" },
  { code: "prospecting", label: "Prospecting" },
  { code: "sales_process", label: "Conversion" },
  { code: "objection_handling", label: "Objections" },
  { code: "yalla_solution", label: "Yalla solution" },
  { code: "customer_management", label: "Customer" },
  { code: "crm_discipline", label: "Operations" },
  { code: "productivity", label: "Productivity" },
  { code: "mobility_problem_solving", label: "Problem solving" },
  { code: "sales_simulation", label: "Simulation" },
];

/**
 * Candidate comparison. Only submitted assessments produce a ranking; anyone
 * without one is shown as unassessed rather than as a zero score. The order is
 * produced by the server, including the published tie-break sequence.
 */
export default function RecruitmentComparison() {
  const [vacancyId, setVacancyId] = useState<string>("");
  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });

  const rows = useQuery({
    queryKey: ["rec", "comparison", vacancyId],
    queryFn: () => engine.candidateComparison(vacancyId),
    enabled: Boolean(vacancyId),
  });

  const data = rows.data ?? [];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Candidate comparison"
        lede="Ranked on submitted, evidence-backed assessments only. Candidates without a completed assessment are listed as unassessed."
      />

      <Card>
        <CardContent className="p-4">
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="vacancy">Vacancy</Label>
            <Select value={vacancyId} onValueChange={setVacancyId}>
              <SelectTrigger id="vacancy"><SelectValue placeholder="Select a vacancy" /></SelectTrigger>
              <SelectContent>
                {(vacancies.data ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {!vacancyId ? (
            <div className="p-10 text-center">
              <BarChart3 className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm text-muted-foreground">
                Select a vacancy to compare its assessed candidates.
              </p>
            </div>
          ) : rows.isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : rows.error ? (
            <p className="p-6 text-sm text-destructive" role="alert">
              Comparison could not be loaded: {(rows.error as Error).message}
            </p>
          ) : data.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No applications exist for this vacancy yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Score</TableHead>
                    {COMPETENCIES.map((c) => <TableHead key={c.code} className="text-center">{c.label}</TableHead>)}
                    <TableHead>Gates</TableHead>
                    <TableHead>Evidence</TableHead>
                    <TableHead>Recommendation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((r) => (
                    <TableRow key={r.application_id}>
                      <TableCell className="text-sm">
                        <span className="font-medium">{r.candidate_name}</span>
                        <p className="text-xs text-muted-foreground">
                          {r.application_no ?? "—"} · {r.application_status.replace(/_/g, " ")}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {r.assessed ? (
                          <>
                            <span className="font-semibold">{r.total_score}</span>
                            <span className="text-muted-foreground"> / {r.max_score}</span>
                            <p className="text-xs text-muted-foreground">
                              {BAND_LABEL[(r.band ?? "unassessed") as ScoreBand]}
                            </p>
                          </>
                        ) : (
                          <Badge variant="outline">Unassessed</Badge>
                        )}
                      </TableCell>
                      {COMPETENCIES.map((c) => (
                        <TableCell key={c.code} className="text-center text-sm tabular-nums">
                          {r.competencies?.[c.code]
                            ? `${r.competencies[c.code].score ?? "—"}/${r.competencies[c.code].max}`
                            : "—"}
                        </TableCell>
                      ))}
                      <TableCell>
                        {r.assessed ? (
                          <Badge variant={r.gates_passed ? "secondary" : "destructive"}>
                            {r.gates_passed ? "Passed" : "Failed"}
                          </Badge>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.assessed ? r.evidence_confidence : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.recommendation ? r.recommendation.replace(/_/g, " ") : "—"}
                      </TableCell>
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
