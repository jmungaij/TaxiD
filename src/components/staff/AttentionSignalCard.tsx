import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AttentionSignal } from "@/lib/staff/intelligenceData";
import { EvidencePanel } from "@/components/staff/EvidencePanel";
import { bundleFromNarrative } from "@/lib/staff/evidence";

const SEVERITY_STYLE: Record<AttentionSignal["severity"], string> = {
  critical: "border-destructive/40 text-destructive",
  watch: "border-warning/40 text-warning",
  info: "border-info/40 text-info",
};

/**
 * Renders one leadership attention signal against the full recommendation
 * contract: why, evidence, confidence, expected impact, action and owner.
 */
export function AttentionSignalCard({ signal }: { signal: AttentionSignal }) {
  const evidence = bundleFromNarrative({
    key: signal.id,
    title: signal.title,
    source: signal.source,
    evidence: signal.evidence,
    confidence: signal.confidence,
  });
  return (
    <Card className="h-full">
      <CardContent className="space-y-3 pt-5 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold text-foreground">{signal.title}</div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wide", SEVERITY_STYLE[signal.severity])}>
              {signal.severity}
            </Badge>
            <EvidencePanel bundle={evidence} />
          </div>
        </div>
        <Field label="Why">{signal.why}</Field>
        <div>
          <FieldLabel>Evidence</FieldLabel>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {signal.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
        <Field label="Confidence">{Math.round(signal.confidence * 100)}%</Field>
        <Field label="Expected impact">{signal.expected_impact}</Field>
        <Field label="Recommended action">{signal.recommended_action}</Field>
        <Field label="Owner">{signal.owner}</Field>
        <div className="border-t pt-2 text-[11px] text-muted-foreground">Source: {signal.source}</div>
      </CardContent>
    </Card>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-0.5 text-muted-foreground">{children}</div>
    </div>
  );
}
