import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Ban, HandHelping, History, Hourglass, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { humanizeMinutes, type BlockedItem } from "@/lib/workspace";

type WaitingOnItem = BlockedItem & { waitingMinutes: number };

export type BlockedAction = "resolve" | "decision";

export interface BlockedActionHandlers {
  /** Employee clears the blocker themselves; the reason is recorded. */
  onResolve: (workId: string, reason: string) => void | Promise<void>;
  /** Blocker is somebody else's call; the decision owner is alerted. */
  onRequestDecision: (workId: string, reason: string) => void | Promise<void>;
  /** Opens the audit trail for this item. */
  onOpenAudit: (workId: string) => void;
  /** Work id currently being written, so the row can show progress. */
  busyId?: string | null;
}

const ACTION_COPY: Record<
  BlockedAction,
  { title: string; description: string; label: string; placeholder: string }
> = {
  resolve: {
    title: "Resolve this blocker",
    description:
      "Record what cleared it. The work item moves back into progress and your priority order recomputes from the updated record.",
    label: "Record it",
    placeholder: "e.g. Decagon confirmed the rate card by email — proceeding with the schedule",
  },
  decision: {
    title: "Request a decision",
    description:
      "Every authorised decision owner for this queue is alerted in-app with this work item and your justification.",
    label: "Request decision",
    placeholder: "e.g. Needs commercial authority to apply a 7% discount on the Naivasha van rate",
  },
};

/** Reason capture — no blocked-work action is written without a recorded reason. */
export function BlockedActionDialog({
  open,
  action,
  title,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  action: BlockedAction;
  title: string;
  busy?: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (open) setReason("");
  }, [open, action, title]);
  const copy = ACTION_COPY[action];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="blocked-action-dialog">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-sm font-medium">{title}</div>
          <Textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={copy.placeholder}
            data-testid="blocked-action-reason"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || busy}
            onClick={() => onSubmit(reason.trim())}
            data-testid="blocked-action-submit"
          >
            {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {copy.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionRow({
  item,
  handlers,
  onOpen,
  onAct,
}: {
  item: BlockedItem;
  handlers: BlockedActionHandlers;
  onOpen: (workId: string) => void;
  onAct: (workId: string, action: BlockedAction) => void;
}) {
  const busy = handlers.busyId === item.work.id;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <ImpactBadge impact={item.impact} />
      {item.selfResolvable ? (
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={() => onAct(item.work.id, "resolve")}
          data-testid="blocked-resolve"
        >
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Resolve
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={() => onAct(item.work.id, "decision")}
          data-testid="blocked-request-decision"
        >
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Request decision
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => handlers.onOpenAudit(item.work.id)}
        aria-label="Audit trail"
        data-testid="blocked-audit"
      >
        <History className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpen(item.work.id)}>
        Open
      </Button>
    </div>
  );
}

/** WAITING ON — things preventing the employee from progressing. */
export function WaitingOnPanel({
  items,
  onOpen,
  handlers,
}: {
  items: WaitingOnItem[];
  onOpen: (workId: string) => void;
  handlers: BlockedActionHandlers;
}) {
  const [pending, setPending] = React.useState<{ id: string; action: BlockedAction } | null>(null);
  const target = items.find((i) => i.work.id === pending?.id) ?? null;

  return (
    <Card data-testid="waiting-on">
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Hourglass className="h-3.5 w-3.5 text-primary" /> Waiting on
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Things preventing you from progressing. Press{" "}
          <kbd className="rounded border px-1">R</kbd> to resolve or{" "}
          <kbd className="rounded border px-1">D</kbd> to request a decision on the top item.
        </p>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing you own is parked on someone else.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((b) => (
              <li
                key={b.work.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{b.work.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {b.blocker}
                    {b.work.entity_ref ? ` · ${b.work.entity_ref}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Waiting {humanizeMinutes(b.waitingMinutes)}
                  </div>
                </div>
                <ActionRow
                  item={b}
                  handlers={handlers}
                  onOpen={onOpen}
                  onAct={(id, action) => setPending({ id, action })}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <BlockedActionDialog
        open={!!pending}
        action={pending?.action ?? "resolve"}
        title={target?.work.title ?? ""}
        busy={handlers.busyId === pending?.id}
        onOpenChange={(v) => !v && setPending(null)}
        onSubmit={async (reason) => {
          if (!pending) return;
          const fn = pending.action === "resolve" ? handlers.onResolve : handlers.onRequestDecision;
          setPending(null);
          await fn(pending.id, reason);
        }}
      />
    </Card>
  );
}

/** BLOCKED WORK — never recommended as next action unless self-resolvable. */
export function BlockedWorkPanel({
  items,
  onOpen,
  handlers,
}: {
  items: BlockedItem[];
  onOpen: (workId: string) => void;
  handlers: BlockedActionHandlers;
}) {
  const [pending, setPending] = React.useState<{ id: string; action: BlockedAction } | null>(null);
  const target = items.find((i) => i.work.id === pending?.id) ?? null;

  return (
    <Card data-testid="blocked-work">
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Ban className="h-3.5 w-3.5 text-primary" /> Blocked work
        </div>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No work of yours is blocked.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((b) => (
              <li key={b.work.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{b.work.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {b.blocker}
                    {b.selfResolvable ? " · you can clear this yourself" : " · held by someone else"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {b.selfResolvable && (
                    <Badge variant="outline" className="text-[10px]">
                      <HandHelping className="mr-1 h-3 w-3" /> Actionable
                    </Badge>
                  )}
                  <ActionRow
                    item={b}
                    handlers={handlers}
                    onOpen={onOpen}
                    onAct={(id, action) => setPending({ id, action })}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <BlockedActionDialog
        open={!!pending}
        action={pending?.action ?? "resolve"}
        title={target?.work.title ?? ""}
        busy={handlers.busyId === pending?.id}
        onOpenChange={(v) => !v && setPending(null)}
        onSubmit={async (reason) => {
          if (!pending) return;
          const fn = pending.action === "resolve" ? handlers.onResolve : handlers.onRequestDecision;
          setPending(null);
          await fn(pending.id, reason);
        }}
      />
    </Card>
  );
}

function ImpactBadge({ impact }: { impact: BlockedItem["impact"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] capitalize",
        impact === "high" && "border-destructive/50 text-destructive",
        impact === "medium" && "border-warning/50 text-warning",
      )}
    >
      {impact} impact
    </Badge>
  );
}
