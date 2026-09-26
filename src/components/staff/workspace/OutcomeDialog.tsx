import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  WORK_OUTCOMES,
  outcomeNeedsNextAction,
  recommendedNextAction,
  type WorkOutcome,
} from "@/lib/workspace";

/**
 * OUTCOME-FIRST COMPLETION.
 *
 * Completing work never simply removes it: the employee records WHAT HAPPENED,
 * and the orchestration layer proposes the next action that advances the
 * business process.
 */
export function OutcomeDialog({
  open,
  onOpenChange,
  workTitle,
  subject,
  busy,
  onSubmit,
  nextUpTitle,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workTitle: string;
  subject: string;
  busy?: boolean;
  onSubmit: (input: {
    outcome: WorkOutcome;
    note?: string;
    createNext: boolean;
    advance?: boolean;
  }) => void;
  /** When present, the employee can record and immediately begin this item. */
  nextUpTitle?: string | null;
}) {
  const [outcome, setOutcome] = useState<WorkOutcome | null>(null);
  const [note, setNote] = useState("");
  const [createNext, setCreateNext] = useState(true);


  const proposal = outcome ? recommendedNextAction(outcome, subject) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>What happened?</DialogTitle>
          <DialogDescription>{workTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {WORK_OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOutcome(o)}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  outcome === o ? "border-primary bg-primary/5 font-medium" : "hover:border-primary/40"
                }`}
              >
                {o}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="outcome-note">Result</Label>
            <Textarea
              id="outcome-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was agreed, decided or requested?"
              rows={3}
            />
          </div>

          {outcome && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What next
              </div>
              {proposal && outcomeNeedsNextAction(outcome) ? (
                <>
                  <p className="mt-1">{proposal}</p>
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={createNext}
                      onCheckedChange={(v) => setCreateNext(v === true)}
                      aria-label="Create this next action"
                    />
                    Create this next action on the customer record
                  </label>
                </>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  No further action is required — this closes the process step.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={!outcome || busy}
            onClick={() =>
              outcome && onSubmit({ outcome, note: note.trim() || undefined, createNext })
            }
          >
            Record outcome
          </Button>
          <Button
            disabled={!outcome || busy}
            data-testid="save-and-next"
            onClick={() =>
              outcome &&
              onSubmit({ outcome, note: note.trim() || undefined, createNext, advance: true })
            }
          >
            {busy ? "Saving…" : nextUpTitle ? "Save & next" : "Save & continue"}
          </Button>
        </DialogFooter>
        {nextUpTitle && (
          <p className="text-xs text-muted-foreground">Next up: {nextUpTitle}</p>
        )}

      </DialogContent>
    </Dialog>
  );
}
