import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight } from "lucide-react";
import { ASK_YALLA_SUGGESTIONS, type AskYallaAnswer } from "@/lib/workspace";

/**
 * ASK SAFARID — a command bar, not a chatbot.
 *
 * Answers are computed deterministically from the authorised records already in
 * the employee's cockpit. If the records cannot answer, it says so rather than
 * inventing an answer.
 */
export function AskYalla({
  ask,
  onOpenWork,
  seedQuestion,
}: {
  ask: (question: string) => AskYallaAnswer;
  onOpenWork: (workId: string) => void;
  /** A question pushed in from elsewhere in the cockpit (e.g. "Ask SAFARID" on Focus Now). */
  seedQuestion?: string | null;
}) {
  const [value, setValue] = useState("");
  const [answer, setAnswer] = useState<AskYallaAnswer | null>(null);

  const run = (q: string) => {
    setValue(q);
    setAnswer(ask(q));
  };

  useEffect(() => {
    if (!seedQuestion) return;
    setValue(seedQuestion);
    setAnswer(ask(seedQuestion));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuestion]);

  return (
    <Card className="border-primary/25 bg-primary/[0.03] backdrop-blur-sm">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden /> What would you like to accomplish?
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(value);
          }}
        >
          <label className="sr-only" htmlFor="ask-yalla">
            Ask SAFARID
          </label>
          <Input
            id="ask-yalla"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ask anything — e.g. what should I focus on now?"
            className="h-10 flex-1 min-w-[240px] bg-background"
          />
          <Button type="submit">Ask SAFARID</Button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {ASK_YALLA_SUGGESTIONS.map((s) => (
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
              <div className="text-sm font-semibold">{answer.headline}</div>
              <Badge variant="outline" className="text-[10px]">
                From your records
              </Badge>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {answer.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            {answer.workId && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 px-0 text-primary"
                onClick={() => onOpenWork(answer.workId!)}
              >
                Open the item <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
