import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, ShieldCheck, Download } from "lucide-react";
import {
  certifyProductionReadiness,
  renderReadinessMarkdown,
} from "@/lib/platform/productionGoNoGo";

const DECISION_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  GO: "default",
  CONDITIONAL_GO: "secondary",
  NO_GO: "destructive",
};

export default function ProductionReadiness() {
  const report = useMemo(() => certifyProductionReadiness(), []);

  const download = () => {
    const blob = new Blob([renderReadinessMarkdown(report)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "yalla-production-readiness.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Production Readiness — Go/No-Go
          </h1>
          <p className="text-sm text-muted-foreground">
            Deterministic certification of the enterprise audit phases, navigation reachability and RBAC matrix.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={DECISION_VARIANT[report.decision]} className="text-sm">
            {report.decision.replace("_", " ")} · {report.score}/100
          </Badge>
          <Button variant="outline" size="sm" data-analytics="admin.production_readiness.download_certificate" onClick={download}>
            <Download className="mr-2 h-4 w-4" /> Download readiness certificate
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Gate checks</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {report.checks.map((c) => (
            <div key={c.id} className="flex items-start gap-3 rounded-md border border-border p-3">
              {c.passed
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                : <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.label}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {c.mandatory ? "mandatory" : "advisory"}
                  </Badge>
                </div>
                <p className="break-words text-xs text-muted-foreground">{c.detail}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Phase certifications</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {report.phases.map((p) => (
            <div key={p.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={p.passed ? "default" : "destructive"} className="text-[10px] uppercase">
                  {p.passed ? "pass" : "fail"}
                </Badge>
                <span className="text-sm font-medium">{p.title}</span>
                <span className="text-xs text-muted-foreground">{p.id}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.scope}</p>
              <ul className="mt-2 space-y-1">
                {p.evidence.map((e) => (
                  <li key={e} className="text-xs text-muted-foreground">• {e}</li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      {(report.blockers.length > 0 || report.conditions.length > 0) && (
        <Card>
          <CardHeader><CardTitle className="text-base">Open items</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {report.blockers.map((b) => (
              <p key={b} className="text-xs text-destructive">Blocker — {b}</p>
            ))}
            {report.conditions.map((c) => (
              <p key={c} className="text-xs text-muted-foreground">Condition — {c}</p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
