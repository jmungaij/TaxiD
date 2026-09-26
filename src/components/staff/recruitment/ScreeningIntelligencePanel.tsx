/**
 * Recruitment 360 — screening intelligence panel.
 *
 * Ranked screening results with evidence citations, an actionable discrepancy
 * report, exports (CSV/PDF), and the manual adjudication workflow. The AI score
 * is decision support; the recorded human decision remains authoritative.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Gavel, ListChecks, Loader2, UserRoundSearch } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AppButton } from "@/components/nav/AppButton";
import ReportExportMenu from "@/components/executive/ReportExportMenu";
import ContactRecoveryDialog from "@/components/staff/recruitment/ContactRecoveryDialog";
import DiscrepancyChecklist from "@/components/staff/recruitment/DiscrepancyChecklist";

import {
  ADJUDICATION_DECISION_LABEL, ADJUDICATION_REASONS, adjudicateEvidence,
  adjudicationTrailTable, CONTACT_STATUS_LABEL, contactRecoveryTable, coverageConfidence,
  discrepancyReportTable, listAdjudications, listEvidenceFacts,
  loadScreeningReport, screeningDiscrepancies, screeningReportTable,
  type AdjudicationDecision, type ScreeningReportRow,
} from "@/lib/recruitment/screening";

const ELIG_TONE: Record<string, string> = {
  eligible: "bg-success/10 text-success border-success/30",
  requires_review: "bg-warning/10 text-warning-foreground border-warning/30",
  not_eligible: "bg-destructive/10 text-destructive border-destructive/30",
};
const SEV_TONE: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  high: "bg-warning/10 text-warning-foreground border-warning/30",
  medium: "bg-info/10 text-info border-info/30",
  low: "bg-muted text-muted-foreground border-border",
};
const humanise = (v: string) => v.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

export interface ScreeningIntelligencePanelProps {
  vacancyId: string;
  batchId?: string | null;
  unresolvedDuplicates?: number;
}

export default function ScreeningIntelligencePanel({
  vacancyId, batchId, unresolvedDuplicates = 0,
}: ScreeningIntelligencePanelProps) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<ScreeningReportRow | null>(null);
  const [contactTarget, setContactTarget] = useState<ScreeningReportRow | null>(null);
  const [checklistId, setChecklistId] = useState<string | null>(null);
  const [attribute, setAttribute] = useState("");
  const [decision, setDecision] = useState<AdjudicationDecision>("override");
  const [reasonCode, setReasonCode] = useState(ADJUDICATION_REASONS[0].code as string);
  const [valueText, setValueText] = useState("");
  const [valueNumeric, setValueNumeric] = useState("");
  const [notes, setNotes] = useState("");

  const report = useQuery({
    queryKey: ["rec", "screening", "report", vacancyId, batchId ?? null],
    queryFn: () => loadScreeningReport(vacancyId, batchId ?? null),
    enabled: !!vacancyId,
  });
  const facts = useQuery({
    queryKey: ["rec", "screening", "facts", target?.application_id],
    queryFn: () => listEvidenceFacts(target!.application_id),
    enabled: !!target,
  });
  const trail = useQuery({
    queryKey: ["rec", "screening", "adjudications", target?.application_id],
    queryFn: () => listAdjudications(target!.application_id),
    enabled: !!target,
  });

  const discrepancies = useMemo(
    () => (report.data ? screeningDiscrepancies(report.data, { unresolvedDuplicates }) : []),
    [report.data, unresolvedDuplicates],
  );

  const adjudicate = useMutation({
    mutationFn: () =>
      adjudicateEvidence({
        applicationId: target!.application_id,
        attribute: decision === "set_rejection_reason" ? "__rejection_reason__" : attribute.trim(),
        decision,
        reasonCode,
        valueText: valueText.trim() || null,
        valueNumeric: valueNumeric.trim() === "" ? null : Number(valueNumeric),
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Adjudication recorded — screening re-scored");
      setValueText("");
      setValueNumeric("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["rec", "screening"] });
      void qc.invalidateQueries({ queryKey: ["rec", "migration", "progress"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Adjudication failed"),
  });

  if (report.isLoading) return <Skeleton className="h-72 w-full" />;
  if (report.error || !report.data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Screening report unavailable</AlertTitle>
        <AlertDescription>
          {report.error instanceof Error ? report.error.message : "Could not load screening results."}
        </AlertDescription>
      </Alert>
    );
  }

  const data = report.data;
  const rows = data.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{data.vacancy.title} — screening results</h3>
          <p className="text-sm text-muted-foreground">
            {rows.length} candidate{rows.length === 1 ? "" : "s"} ranked by evidence-weighted score.
            The final employment decision stays with the authorised hiring decision-maker.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReportExportMenu label="Screening report" build={() => screeningReportTable(data)} />
          <ReportExportMenu
            label="Discrepancy report"
            variant="secondary"
            build={() => discrepancyReportTable(data, discrepancies)}
          />
          <ReportExportMenu
            label="Contact recovery register"
            variant="ghost"
            build={() => contactRecoveryTable(data.vacancy.title, rows)}
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" /> Candidate ranking
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Eligibility</TableHead>
                <TableHead>Recommendation</TableHead>
                <TableHead>Gaps</TableHead>
                <TableHead>Human decision</TableHead>
                <TableHead className="text-right">Adjudicate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.application_id}>
                  <TableCell className="tabular-nums">{r.rank}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.full_name}</div>
                    <div className="text-xs text-muted-foreground">{r.location ?? "Location unknown"}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{[r.email, r.phone].filter(Boolean).join(" · ") || "Not supplied"}</div>
                    {(!r.email || !r.phone) && (
                      <div className="text-muted-foreground">
                        {r.contact_request_status
                          ? CONTACT_STATUS_LABEL[r.contact_request_status]
                          : "Recovery not requested"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums font-semibold">
                    {r.score == null ? "—" : Number(r.score).toFixed(1)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={ELIG_TONE[r.eligibility ?? ""] ?? ""}>
                      {r.eligibility ? humanise(r.eligibility) : "Not evaluated"}
                    </Badge>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {coverageConfidence(r).coveragePct}% evidenced
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{r.recommendation ? humanise(r.recommendation) : "—"}</TableCell>
                  <TableCell className="max-w-[14rem] text-xs text-muted-foreground">
                    {[...(r.gate_failures ?? []), ...(r.missing_evidence ?? [])].join(", ") || "None"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.human_decision ? humanise(r.human_decision) : "Pending"}
                    {r.adjudications > 0 ? ` · ${r.adjudications} adjudication(s)` : ""}
                  </TableCell>
                  <TableCell className="space-y-1 text-right">
                    <AppButton
                      analytics="rec_screening_checklist_open"
                      action="dialog"
                      size="sm"
                      variant="ghost"
                      onClick={() => setChecklistId(checklistId === r.application_id ? null : r.application_id)}
                      aria-label={`${checklistId === r.application_id ? "Hide" : "Show"} resolution checklist for ${r.full_name}`}
                    >
                      <ListChecks className="mr-2 h-4 w-4" />
                      {checklistId === r.application_id ? "Hide checklist" : "Resolution checklist"}
                    </AppButton>
                    <AppButton
                      analytics="rec_screening_contact_open"
                      action="dialog"
                      size="sm"
                      variant="secondary"
                      onClick={() => setContactTarget(r)}
                      aria-label={`Recover contact details for ${r.full_name}`}
                    >
                      <UserRoundSearch className="mr-2 h-4 w-4" /> Recover contact
                    </AppButton>
                    <AppButton
                      analytics="rec_screening_adjudicate_open"
                      action="dialog"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTarget(r);
                        setAttribute("");
                        setDecision("override");
                      }}
                      aria-label={`Adjudicate evidence for ${r.full_name}`}
                    >
                      <Gavel className="mr-2 h-4 w-4" /> Adjudicate evidence
                    </AppButton>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                    No screened applications for this vacancy yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {checklistId && rows.find((r) => r.application_id === checklistId) && (
        <DiscrepancyChecklist
          row={rows.find((r) => r.application_id === checklistId)!}
          onCollectContact={(r) => setContactTarget(r)}
          onAdjudicate={(r) => {
            setTarget(r);
            setAttribute("");
            setDecision("override");
          }}
        />
      )}

      <ContactRecoveryDialog row={contactTarget} onClose={() => setContactTarget(null)} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base">Actionable discrepancies</CardTitle>
          <Badge variant="outline">{discrepancies.length} finding(s)</Badge>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead>Attribute</TableHead>
                <TableHead>Finding</TableHead>
                <TableHead>Required action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {discrepancies.map((f, i) => (
                <TableRow key={`${f.applicationId}-${f.kind}-${i}`}>
                  <TableCell>
                    <Badge variant="outline" className={SEV_TONE[f.severity]}>{humanise(f.severity)}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{f.candidate}</TableCell>
                  <TableCell className="text-xs">{f.attribute ?? "—"}</TableCell>
                  <TableCell className="max-w-[22rem] text-xs">{f.finding}</TableCell>
                  <TableCell className="max-w-[22rem] text-xs text-muted-foreground">{f.action}</TableCell>
                </TableRow>
              ))}
              {discrepancies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No discrepancies — every candidate has complete, high-confidence evidence.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Adjudicate evidence — {target?.full_name}</DialogTitle>
            <DialogDescription>
              Overrides are recorded append-only with your identity and reason, then the candidate is
              re-scored against the published scorecard.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adj-decision">Decision</Label>
              <Select value={decision} onValueChange={(v) => setDecision(v as AdjudicationDecision)}>
                <SelectTrigger id="adj-decision"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ADJUDICATION_DECISION_LABEL) as AdjudicationDecision[]).map((d) => (
                    <SelectItem key={d} value={d}>{ADJUDICATION_DECISION_LABEL[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-attribute">Evidence attribute</Label>
              <Select
                value={attribute}
                onValueChange={setAttribute}
                disabled={decision === "set_rejection_reason"}
              >
                <SelectTrigger id="adj-attribute">
                  <SelectValue placeholder="Select the attribute" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(new Set((facts.data ?? []).map((f) => f.attribute))).map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-value">Verified value (text)</Label>
              <Input
                id="adj-value"
                value={valueText}
                onChange={(e) => setValueText(e.target.value)}
                placeholder="e.g. Nairobi, Kenya"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-numeric">Verified value (number)</Label>
              <Input
                id="adj-numeric"
                inputMode="decimal"
                value={valueNumeric}
                onChange={(e) => setValueNumeric(e.target.value)}
                placeholder="e.g. 3"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="adj-reason">Reason</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger id="adj-reason"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADJUDICATION_REASONS.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="adj-notes">Notes for the audit trail</Label>
              <Textarea
                id="adj-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What you verified, and where"
              />
            </div>
          </div>

          <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-border p-3 text-xs">
            <p className="font-medium">Adjudication history</p>
            {(trail.data ?? []).length === 0 && (
              <p className="text-muted-foreground">No manual adjudications recorded for this candidate.</p>
            )}
            {(trail.data ?? []).map((a) => (
              <p key={a.id} className="text-muted-foreground">
                {new Date(a.adjudicated_at).toLocaleString()} · {a.adjudicator_email ?? "unknown"} ·{" "}
                {ADJUDICATION_DECISION_LABEL[a.decision]} · {a.attribute}
                {a.before_value ? ` · was “${a.before_value}”` : ""}
                {a.after_value ? ` → “${a.after_value}”` : ""} · {a.reason_code}
              </p>
            ))}
          </div>

          <DialogFooter className="gap-2">
            {(trail.data ?? []).length > 0 && (
              <ReportExportMenu
                label="Adjudication trail"
                variant="ghost"
                build={() => adjudicationTrailTable(data.vacancy.title, trail.data ?? [])}
              />
            )}
            <AppButton
              analytics="rec_screening_adjudicate_submit"
              action="submit"
              disabled={
                adjudicate.isPending ||
                (decision !== "set_rejection_reason" && !attribute) ||
                (decision === "set_rejection_reason" && !valueText.trim())
              }
              onClick={() => adjudicate.mutate()}
              aria-label="Record adjudication and re-score candidate"
            >
              {adjudicate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record adjudication
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
