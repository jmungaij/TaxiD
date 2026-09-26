/**
 * Phase D8.2 — Executive Scorecard Drilldown.
 *
 * Lightweight side drawer that shows canonical metadata for a scorecard
 * item — definition, source, threshold, status, and a deep link back to
 * the operational owner. No new queries; consumes canonical values.
 */
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldAlert, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

export interface ScorecardDrilldown {
  label: string;
  score: number;
  passed: boolean;
  href: string;
  definition: string;
  source: string;             // canonical RPC / report name
  owner: string;              // operational owner surface
  threshold: string;
  previousScore?: number | null;
  lastReconciledAt?: string | null;
  correlationIds?: string[];
  failures?: string[];
}

export function ExecutiveScorecardDrawer({
  open, onOpenChange, item,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: ScorecardDrilldown | null;
}) {
  if (!item) return null;
  const delta = item.previousScore == null ? null : item.score - item.previousScore;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {item.passed
              ? <ShieldCheck className="h-5 w-5 text-status-success" />
              : <ShieldAlert className="h-5 w-5 text-status-warning" />}
            {item.label}
          </SheetTitle>
          <SheetDescription>{item.definition}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Current" value={`${item.score}/100`} tone={item.passed ? "ok" : "warn"} />
            <Stat label="Previous" value={item.previousScore == null ? "—" : `${item.previousScore}/100`} />
            <Stat
              label="Trend"
              value={delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta}`}
              tone={delta == null ? undefined : delta >= 0 ? "ok" : "warn"}
            />
            <Stat label="Threshold" value={item.threshold} />
          </div>

          <Row label="Status">
            <Badge variant={item.passed ? "outline" : "destructive"}>
              {item.passed ? "PASSED" : "REQUIRES ATTENTION"}
            </Badge>
          </Row>
          <Row label="Canonical source">
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{item.source}</code>
          </Row>
          <Row label="Operational owner">
            <span className="text-muted-foreground">{item.owner}</span>
          </Row>
          <Row label="Last reconciled">
            <span className="text-muted-foreground">
              {item.lastReconciledAt ? new Date(item.lastReconciledAt).toLocaleString() : "—"}
            </span>
          </Row>

          {item.correlationIds && item.correlationIds.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Correlation IDs</div>
              <div className="flex flex-wrap gap-1">
                {item.correlationIds.map((c) => (
                  <code key={c} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{c}</code>
                ))}
              </div>
            </div>
          )}

          {item.failures && item.failures.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Blocking failures</div>
              <ul className="list-disc pl-5 space-y-1 text-xs">
                {item.failures.slice(0, 10).map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}

          <div className="pt-2">
            <Button asChild size="sm" className="w-full">
              <Link to={item.href}>
                Open {item.owner} <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-status-success" : tone === "warn" ? "text-status-warning" : "";
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
