/**
 * Ask Yalla console.
 *
 * One question box over the deterministic intelligence layer. Every answer
 * shows its verdict, its claim classes, the records behind it, the cross-checks
 * that were run and the checks that failed. A refusal is displayed as plainly
 * as an answer — nothing is filled in to make the screen look complete.
 */
import * as React from "react";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  BadgeCheck,
  Brain,
  CheckCircle2,
  Clock,
  Database,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import { askYalla, type IntelligenceAnswer } from "@/lib/intelligence/orchestrator";
import { CLAIM_CLASS_LABEL, countByClass, type Claim } from "@/lib/intelligence/contract";

const SUGGESTIONS = [
  "What is our recognised revenue and how much has been collected?",
  "How healthy is the commercial pipeline right now?",
  "Where is operational SLA pressure building?",
  "Which objectives are behind their expected pace?",
  "What should we focus on next?",
];

const CLASS_STYLE: Record<Claim["classification"], string> = {
  FACT: "border-success/40 text-success",
  ESTIMATE: "border-warning/40 text-warning",
  PREDICTION: "border-info/40 text-info",
  RECOMMENDATION: "border-primary/40 text-primary",
};

const VERDICT_META: Record<
  IntelligenceAnswer["verdict"],
  { label: string; icon: React.ElementType; tone: string }
> = {
  answered: { label: "Answered", icon: CheckCircle2, tone: "text-success" },
  qualified: { label: "Answered with qualifications", icon: AlertTriangle, tone: "text-warning" },
  insufficient_data: { label: "Insufficient data", icon: XCircle, tone: "text-destructive" },
  not_authorised: { label: "Not authorised", icon: ShieldAlert, tone: "text-destructive" },
};

function ClaimRow({ claim }: { claim: Claim }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={CLASS_STYLE[claim.classification]}>
          {CLAIM_CLASS_LABEL[claim.classification]}
        </Badge>
        <span className="text-sm font-medium">{claim.label}</span>
        {claim.confidence !== undefined && (
          <span className="text-xs text-muted-foreground">{claim.confidence}% confidence</span>
        )}
      </div>
      <p className="mt-1.5 text-lg font-semibold tracking-tight">{claim.value}</p>
      <p className="mt-1 text-xs text-muted-foreground">Read from {claim.source}</p>
      {claim.evidence?.length ? (
        <ul className="mt-2 space-y-1">
          {claim.evidence.map((ev, i) => (
            <li key={i} className="text-xs text-muted-foreground">
              • {ev.label}
              {ev.detail ? ` (${ev.detail})` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {claim.assumptions?.length ? (
        <div className="mt-2 rounded-md bg-muted/50 p-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Assumptions
          </p>
          <ul className="mt-1 space-y-1">
            {claim.assumptions.map((a, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                • {a}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function StaffAskYalla() {
  const [question, setQuestion] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [answer, setAnswer] = React.useState<IntelligenceAnswer | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      setAnswer(await askYalla(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The intelligence layer could not complete this question.");
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  };

  const counts = answer ? countByClass(answer.readings) : null;
  const verdict = answer ? VERDICT_META[answer.verdict] : null;
  const VerdictIcon = verdict?.icon ?? Sparkles;

  return (
    <div className="space-y-6">
      <Helmet>
        <title>Ask Yalla — Enterprise Intelligence Console</title>
        <meta
          name="description"
          content="Ask Yalla answers operating questions from authoritative records only, with evidence, freshness and confidence on every claim."
        />
      </Helmet>

      <header className="space-y-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Brain className="h-3.5 w-3.5" aria-hidden /> Yalla Intelligence
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Ask Yalla</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Questions are answered from records you are already permitted to read. Every figure states where it came
          from and when it was last observed. When the records cannot support an answer, you are told so instead of
          being given an estimate dressed as a fact.
        </p>
      </header>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about revenue, pipeline, operational pressure, objectives or what to prioritise next…"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(question);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void submit(question)} disabled={busy || !question.trim()}>
              {busy ? "Reading records…" : "Ask"}
            </Button>
            <span className="text-xs text-muted-foreground">No figure is generated by a model.</span>
          </div>
          <Separator />
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setQuestion(s);
                  void submit(s);
                }}
              >
                {s}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {busy && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      )}

      {answer && !busy && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <VerdictIcon className={`h-4 w-4 ${verdict?.tone}`} aria-hidden />
                <CardTitle className="text-base">{verdict?.label}</CardTitle>
                <Badge variant="outline">{answer.intent.label}</Badge>
                {!answer.intent.resolved && (
                  <Badge variant="outline" className="border-warning/40 text-warning">
                    Intent approximated
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-lg font-semibold tracking-tight">{answer.headline}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Confidence {answer.confidence}%
                </span>
                <span className="inline-flex items-center gap-1">
                  <Database className="h-3.5 w-3.5" aria-hidden /> Data quality {answer.quality.score}/100 ·{" "}
                  {answer.quality.rowsInspected} record(s)
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {answer.quality.freshnessMinutes !== undefined
                    ? `Freshest data ${answer.quality.freshnessMinutes}m old`
                    : "No timestamp on the underlying records"}
                </span>
                <span>{answer.latencyMs}ms</span>
                {!answer.recorded && (
                  <span className="text-warning">This answer could not be written to the audit ledger.</span>
                )}
              </div>
              {counts && (
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(counts) as Claim["classification"][]).map((cls) =>
                    counts[cls] > 0 ? (
                      <Badge key={cls} variant="outline" className={CLASS_STYLE[cls]}>
                        {counts[cls]} {CLAIM_CLASS_LABEL[cls].toLowerCase()}
                        {counts[cls] === 1 ? "" : "s"}
                      </Badge>
                    ) : null,
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {answer.claims.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">What the records say</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {answer.claims.map((claim) => (
                  <ClaimRow key={claim.id} claim={claim} />
                ))}
              </CardContent>
            </Card>
          )}

          {answer.nextBestActions.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Recommended next actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {answer.nextBestActions.map((action) => (
                  <div key={action.id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{action.priority}</Badge>
                      {action.requiresApproval && (
                        <Badge variant="outline" className="border-warning/40 text-warning">
                          Needs authorisation
                        </Badge>
                      )}
                      {!action.grounded && (
                        <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
                          Not grounded
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm">{action.title}</p>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Recommendations are proposals only. Nothing here executes without a person authorising it.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">How this answer was reached</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-1.5">
                {answer.why.map((line, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    • {line}
                  </li>
                ))}
              </ul>
              {answer.crossChecks.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-1.5">
                    {answer.crossChecks.map((check, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        {check.agrees ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success" aria-hidden />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" aria-hidden />
                        )}
                        <span>
                          {check.label}{" "}
                          <span className="text-muted-foreground">— {check.detail}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <Separator />
              <div className="grid gap-1.5 sm:grid-cols-2">
                {answer.gate.checks.map((check) => (
                  <div key={check.id} className="flex items-start gap-2 text-xs">
                    {check.passed ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success" aria-hidden />
                    ) : (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 text-destructive" aria-hidden />
                    )}
                    <span>
                      {check.label}
                      {check.detail ? <span className="text-muted-foreground"> — {check.detail}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
