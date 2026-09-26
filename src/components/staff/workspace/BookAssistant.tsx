/**
 * SAFARID SALES ASSISTANT — the answering surface for the commercial book.
 *
 * It does not generate prose about your book: it reads it. Every answer is
 * computed from the same records the book renders — the ranked next best
 * actions, the pipeline inspection rows, the raised signals and the day close —
 * and every line carries the evidence that produced it. When the records cannot
 * answer, it says so instead of guessing.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { NextBestAction } from "@/lib/intelligence/nextBestAction";
import type { InspectionRow } from "@/lib/intelligence/pipelineInspection";
import type { CommercialSignal } from "@/lib/intelligence/signals";
import type { SalesDayClose } from "@/lib/sales/dayClose";
import { KES } from "@/lib/sales/dayClose";

const SUGGESTIONS = [
  "What should I do next?",
  "Which deals have gone quiet?",
  "Where is my gap to target?",
  "Which customers are at risk?",
  "Which deals have no value recorded?",
];

interface Answer {
  headline: string;
  lines: string[];
  link?: { label: string; to: string };
}

export interface AssistantInput {
  actions: NextBestAction[];
  rows: InspectionRow[];
  signals: CommercialSignal[];
  close: SalesDayClose | null;
}

/** Deterministic intent match — no model call, no invented figures. */
export function answerBookQuestion(question: string, input: AssistantInput): Answer {
  const q = question.trim().toLowerCase();
  const { actions, rows, signals, close } = input;

  if (!q) {
    return { headline: "Ask about your book", lines: ["For example: what should I do next?"] };
  }

  if (/(gap|target|quota|behind|month)/.test(q)) {
    if (!close) {
      return {
        headline: "No commercial desk record for you",
        lines: ["Your monthly position can only be read once your commercial record exists, so no gap is stated."],
      };
    }
    const m = close.month;
    return {
      headline:
        m.remaining_kes == null
          ? "No monthly target is recorded against your position"
          : m.remaining_kes <= 0
            ? "Your target for this month is met"
            : `${KES(m.remaining_kes)} still to find this month`,
      lines: [
        `Recognised so far: ${KES(m.figures.revenue_won_kes)} of ${m.target_kes == null ? "no recorded target" : KES(m.target_kes)}.`,
        `Open pipeline ${KES(m.figures.open_pipeline_kes)} across ${m.figures.open_count} deal(s); weighted ${KES(m.figures.weighted_pipeline_kes)}.`,
        m.figures.stale_count > 0
          ? `${m.figures.stale_count} deal(s) have not moved recently and are the first place to look for the gap.`
          : "No deal in your book is currently stale.",
      ],
      link: { label: "Open the daily close", to: "/staff/workspace/book?tab=close" },
    };
  }

  if (/(quiet|stalled|stall|idle|no activity|not moving)/.test(q)) {
    const quiet = rows.filter((r) => r.momentum.idle || r.momentum.band === "stalled" || r.momentum.band === "slowing");
    return {
      headline: quiet.length === 0 ? "Nothing in your book has gone quiet" : `${quiet.length} deal(s) have gone quiet`,
      lines:
        quiet.length === 0
          ? ["Every deal has movement inside the allowance for its stage and size."]
          : quiet
              .slice(0, 6)
              .map(
                (r) =>
                  `${r.opportunity.customer_label ?? r.opportunity.title} — ${r.momentum.headline}${
                    r.momentum.idleDays == null
                      ? " (nothing dated on the record)"
                      : ` (${r.momentum.idleDays} day(s) idle against an allowance of ${r.momentum.idleThresholdDays})`
                  }`,
              ),
      link: { label: "Open pipeline inspection", to: "/staff/workspace/pipeline" },
    };
  }

  if (/(risk|unhappy|complain|issue|service)/.test(q)) {
    const open = signals.filter((s) => s.status === "open" || s.status === "acknowledged");
    const byCustomer = new Map<string, number>();
    for (const s of open) {
      const key = s.customerLabel ?? "Customer not named on the record";
      byCustomer.set(key, (byCustomer.get(key) ?? 0) + 1);
    }
    return {
      headline: open.length === 0 ? "No customer is carrying an open issue" : `${byCustomer.size} account(s) carrying issues`,
      lines:
        open.length === 0
          ? ["Nothing has been raised against a customer, so no account is flagged at risk."]
          : [...byCustomer.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([customer, count]) => `${customer} — ${count} open item(s)`),
      link: { label: "Open the exception centre", to: "/staff/workspace/exceptions?view=risk" },
    };
  }

  if (/(no value|value not|unpriced|blank value|missing value)/.test(q)) {
    const blank = rows.filter((r) => !r.opportunity.expected_value_cents);
    return {
      headline: blank.length === 0 ? "Every open deal carries a value" : `${blank.length} deal(s) have no value recorded`,
      lines:
        blank.length === 0
          ? ["No forecast in your book depends on a blank figure."]
          : blank
              .slice(0, 8)
              .map((r) => `${r.opportunity.customer_label ?? r.opportunity.title} — value not stated, so it cannot be forecast`),
      link: { label: "Open my opportunities", to: "/staff/workspace/opportunities" },
    };
  }

  // Default: what to do next, straight off the ranked queue.
  if (actions.length === 0) {
    return {
      headline: "Nothing is ranked above what you are already doing",
      lines: ["No record in your book is idle, unready or waiting on you right now."],
    };
  }
  const top = actions[0];
  return {
    headline: top.action,
    lines: [
      `Why: ${top.reason}`,
      ...top.evidence.map((e) => `Evidence: ${e}`),
      `Commercial impact: ${top.impactLine}`,
      `When: ${top.timingReason}`,
    ],
    link: { label: "Open the record", to: top.link },
  };
}

export function BookAssistant(props: AssistantInput) {
  const [value, setValue] = React.useState("");
  const [answer, setAnswer] = React.useState<Answer | null>(null);

  const run = (q: string) => {
    setValue(q);
    setAnswer(answerBookQuestion(q, props));
  };

  return (
    <Card className="border-primary/25 bg-primary/[0.03]">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden /> SAFARID sales assistant
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(value);
          }}
        >
          <label className="sr-only" htmlFor="book-assistant">
            Ask about your book
          </label>
          <Input
            id="book-assistant"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ask about your book — e.g. which deals have gone quiet?"
            className="h-10 min-w-[240px] flex-1 bg-background"
          />
          <Button type="submit">Ask</Button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => run(s)}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>

        {answer && (
          <div className="rounded-md border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{answer.headline}</p>
              <Badge variant="outline" className="text-[10px]">
                From your records
              </Badge>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {answer.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            {answer.link && (
              <Button size="sm" variant="ghost" asChild className="mt-2 px-0 text-primary">
                <Link to={answer.link.to}>
                  {answer.link.label} <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default BookAssistant;
