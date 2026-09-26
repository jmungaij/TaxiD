import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Timer } from "lucide-react";
import type { ActiveFocus } from "@/hooks/usePersonalWorkspace";

const mmss = (totalSeconds: number) => {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/**
 * Focus Mode — one item, a running timer, and a recorded outcome.
 *
 * Ending the session writes real effort actuals to the work item's history, so
 * capacity and the work inbox update from measured time rather than estimates.
 */
export function FocusModeDialog({
  focus,
  busy,
  onFinish,
  onCancelSession,
}: {
  focus: ActiveFocus | null;
  busy: boolean;
  onFinish: (opts: { outcomeNote?: string; completed?: boolean; interrupted?: boolean }) => void;
  onCancelSession: () => void;
}) {
  const [note, setNote] = React.useState("");
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!focus) return;
    setNote("");
    const tick = () => setElapsed(Math.floor((Date.now() - focus.startedAtMs) / 1000));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [focus]);

  const plannedSeconds = (focus?.plannedMinutes ?? 0) * 60;
  const pct = plannedSeconds ? Math.min(100, Math.round((elapsed / plannedSeconds) * 100)) : 0;

  return (
    <Dialog open={!!focus} onOpenChange={(v) => !v && onCancelSession()}>
      <DialogContent className="sm:max-w-lg" data-testid="focus-mode">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-primary" /> Focus mode
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm font-medium">{focus?.title}</div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-3xl tabular-nums" data-testid="focus-timer">
              {mmss(elapsed)}
            </span>
            <Badge variant="outline">planned ~{focus?.plannedMinutes ?? 0} min</Badge>
            {plannedSeconds > 0 && elapsed > plannedSeconds && (
              <Badge variant="destructive">over estimate</Badge>
            )}
          </div>
          <Progress value={pct} />
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What changed on the record?
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Recorded outcome — e.g. sent the rate card clarification to Decagon and reset the promise date"
              rows={3}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Pause, cancel or complete — every exit records the measured minutes against this item, so
            your capacity and work inbox update immediately. <kbd className="rounded border px-1">E</kbd>{" "}
            completes, <kbd className="rounded border px-1">Esc</kbd> cancels.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onFinish({ outcomeNote: note || undefined, interrupted: true })}
            data-testid="focus-cancel"
          >
            Cancel — record interruption
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => onFinish({ outcomeNote: note || undefined })}
              data-testid="focus-pause"
            >
              Pause — keep item open
            </Button>
            <Button
              disabled={busy}
              onClick={() => onFinish({ outcomeNote: note || undefined, completed: true })}
              data-testid="focus-complete"
            >
              Done — complete item
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default FocusModeDialog;
