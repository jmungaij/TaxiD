import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, ScanLine } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import * as rec from "@/lib/recruitment/api";

/**
 * Physical interview evaluation forms and the suitability determination that
 * sits on top of them. Ratings are shown exactly as written on the paper form
 * (1–10); the portal's own canonical score is 1–5, so both are labelled.
 * Nothing here is computed or inferred — a missing rating stays missing.
 */

const VERDICT_TONE: Record<string, string> = {
  SUITABLE: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  NOT_SUITABLE: "bg-destructive/10 text-destructive",
  EVIDENCE_INSUFFICIENT: "bg-muted text-muted-foreground",
  CONFLICTING_EVIDENCE: "bg-warning/15 text-warning",
};

function label(value: string) {
  return value.replace(/_/g, " ").toLowerCase();
}

export default function PaperAssessmentPanel({
  candidateName,
}: {
  candidateName: (candidateId: string) => string;
}) {
  const papers = useQuery({ queryKey: ["rec", "paper-assessments"], queryFn: () => rec.listPaperAssessments() });
  const suitability = useQuery({
    queryKey: ["rec", "suitability"],
    queryFn: () => rec.listSuitabilityDeterminations(),
  });

  const papersByApp = useMemo(() => {
    const map = new Map<string, rec.RecPaperAssessment[]>();
    for (const p of papers.data ?? []) {
      map.set(p.application_id, [...(map.get(p.application_id) ?? []), p]);
    }
    return map;
  }, [papers.data]);

  const rows = suitability.data ?? [];
  const loading = papers.isLoading || suitability.isLoading;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ScanLine className="h-4 w-4" aria-hidden="true" />
          Interview forms on file &amp; suitability ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No suitability determination has been recorded yet.
          </p>
        ) : (
          rows.map((s) => {
            const forms = papersByApp.get(s.application_id) ?? [];
            return (
              <div key={s.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{candidateName(s.candidate_id)}</p>
                  <Badge className={VERDICT_TONE[s.verdict] ?? ""}>{label(s.verdict)}</Badge>
                  <Badge variant="outline">evidence: {label(s.evidence_status)}</Badge>
                  {s.average_form_score != null && (
                    <span className="text-xs text-muted-foreground">
                      form average {s.average_form_score} · {s.score_scale}
                    </span>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">{s.rationale}</p>

                {forms.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No interview evaluation form on file.</p>
                ) : (
                  <div className="space-y-3">
                    {forms.map((f) => (
                      <div key={f.id} className="rounded-md bg-muted/40 p-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="font-medium">{f.form_reference}</span>
                          <span className="text-muted-foreground">
                            {f.interview_date ?? "no date on form"} · applied for:{" "}
                            {f.position_as_written ?? "not stated"}
                          </span>
                          <Badge variant="outline">
                            marked: {f.recommendation_as_marked ?? "nothing marked"}
                          </Badge>
                          <Badge variant="outline">transcription: {f.transcription_confidence}</Badge>
                        </div>

                        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                          {f.criteria_ratings.map((c) => (
                            <li key={c.criterion} className="flex items-baseline justify-between gap-2 text-xs">
                              <span>{c.criterion}</span>
                              <span className="font-semibold tabular-nums">{c.rating}/10</span>
                            </li>
                          ))}
                          {f.unrated_criteria.map((c) => (
                            <li key={c} className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                              <span>{c}</span>
                              <span className="italic">not rated</span>
                            </li>
                          ))}
                        </ul>

                        {f.interviewer_comments && (
                          <p className="text-xs italic">“{f.interviewer_comments}”</p>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          Name as written: {f.name_as_written}
                          {f.highest_education_as_written ? ` · education: ${f.highest_education_as_written}` : ""}
                          {f.interviewer_signature_present ? " · signed" : " · unsigned"}
                        </p>
                        {f.transcription_notes && (
                          <p className="text-[11px] text-muted-foreground">{f.transcription_notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {s.conflicts.length > 0 && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
                    <p className="text-xs font-semibold flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Conflicting evidence
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-xs">
                      {s.conflicts.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                )}

                {s.missing_evidence.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold">Missing assessment data</p>
                    <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                      {s.missing_evidence.map((m) => <li key={m}>{m}</li>)}
                    </ul>
                  </div>
                )}

                {s.requires_hr_action && (
                  <p className="text-xs"><span className="font-semibold">Action required: </span>{s.requires_hr_action}</p>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
