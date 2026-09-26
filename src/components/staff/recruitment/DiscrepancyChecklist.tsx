/**
 * Recruitment 360 — per-candidate discrepancy resolution checklist.
 *
 * Turns the screening report's gaps into an ordered path: contact recovery,
 * weak-extraction adjudication, missing evidence, hard gates, then the human
 * decision. Steps are derived from server state, so they tick themselves off.
 */
import { CheckCircle2, Circle, Gavel, ShieldAlert, UserRoundSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AppButton } from "@/components/nav/AppButton";
import { cn } from "@/lib/utils";

import {
  checklistProgress, coverageConfidence, decisionRationale, resolutionChecklist,
  type ResolutionStep, type ScreeningReportRow,
} from "@/lib/recruitment/screening";

const BAND_TONE: Record<string, string> = {
  strong: "bg-success/10 text-success border-success/30",
  adequate: "bg-info/10 text-info border-info/30",
  thin: "bg-warning/10 text-warning-foreground border-warning/30",
};

export interface DiscrepancyChecklistProps {
  row: ScreeningReportRow;
  onCollectContact: (row: ScreeningReportRow) => void;
  onAdjudicate: (row: ScreeningReportRow) => void;
}

export default function DiscrepancyChecklist({
  row, onCollectContact, onAdjudicate,
}: DiscrepancyChecklistProps) {
  const steps = resolutionChecklist(row);
  const progress = checklistProgress(steps);
  const cov = coverageConfidence(row);

  const action = (s: ResolutionStep) => {
    if (s.done) return null;
    if (s.cta === "collect_contact" || s.cta === "request_contact") {
      return (
        <AppButton
          analytics="rec_checklist_contact_open"
          action="dialog"
          size="sm"
          variant="outline"
          onClick={() => onCollectContact(row)}
          aria-label={`Recover contact details for ${row.full_name}`}
        >
          <UserRoundSearch className="mr-2 h-4 w-4" /> Recover contact
        </AppButton>
      );
    }
    if (s.cta === "adjudicate" || s.cta === "waive_gate") {
      return (
        <AppButton
          analytics="rec_checklist_adjudicate_open"
          action="dialog"
          size="sm"
          variant="outline"
          onClick={() => onAdjudicate(row)}
          aria-label={`Adjudicate evidence for ${row.full_name}`}
        >
          {s.cta === "waive_gate" ? (
            <ShieldAlert className="mr-2 h-4 w-4" />
          ) : (
            <Gavel className="mr-2 h-4 w-4" />
          )}
          {s.cta === "waive_gate" ? "Resolve gate" : "Adjudicate evidence"}
        </AppButton>
      );
    }
    return <span className="text-xs text-muted-foreground">Recorded by the hiring decision-maker</span>;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Resolution checklist — {row.full_name}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{decisionRationale(row)}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant="outline" className={BAND_TONE[cov.band]}>
              {cov.band} evidence coverage
            </Badge>
            <span className="text-xs text-muted-foreground">
              {progress.done}/{progress.total} steps
              {progress.blocked > 0 ? ` · ${progress.blocked} blocking` : ""}
            </span>
          </div>
        </div>
        <Progress value={progress.pct} className="mt-3 h-1.5" aria-label="Resolution progress" />
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.key} className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                {s.done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden="true" />
                ) : (
                  <Circle
                    className={cn("mt-0.5 h-4 w-4", s.blocking ? "text-warning" : "text-muted-foreground")}
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {s.order}. {s.title}
                    {!s.done && s.blocking && (
                      <Badge variant="outline" className="ml-2 border-warning/30 text-[10px] text-warning-foreground">
                        Blocking
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                </div>
              </div>
              {action(s)}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
