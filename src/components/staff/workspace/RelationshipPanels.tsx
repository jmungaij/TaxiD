import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Handshake, Users, TrendingDown, Sunset } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AccountMomentum,
  CommitmentHealth,
  DayCloseSummary,
  PersonalCommitment,
  WaitingCustomer,
} from "@/lib/workspace";

const dateText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" }) : "No date";

/* ------------------------------------------------------- commitment tracker */

export function CommitmentTracker({
  health,
  commitments,
  onFulfil,
}: {
  health: CommitmentHealth;
  commitments: PersonalCommitment[];
  onFulfil: (id: string) => void;
}) {
  const open = commitments.filter((c) => c.status === "open" || c.status === "in_progress");
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Handshake className="h-4 w-4 text-primary" /> My promises
          </CardTitle>
          <Badge
            variant="outline"
            className={cn(
              health.state === "critical" && "border-destructive/50 text-destructive",
              health.state === "slipping" && "border-warning/50 text-warning",
              health.state === "healthy" && "border-primary/40 text-primary",
            )}
          >
            {health.state === "unknown" ? "No data" : health.state}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{health.note}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Stat label="Open" value={health.open} />
          <Stat label="Overdue" value={health.overdue} tone={health.overdue ? "bad" : undefined} />
          <Stat label="Kept" value={health.keptRatePct === null ? "—" : `${health.keptRatePct}%`} />
        </div>
        {open.length === 0 && (
          <p className="text-sm text-muted-foreground">No open promises recorded against you.</p>
        )}
        <ul className="space-y-2">
          {open.slice(0, 6).map((c) => (
            <li key={c.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{c.commitment}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {c.account_name ?? "Unnamed account"} · due {dateText(c.due_at)} ·{" "}
                    {c.direction === "yalla_to_customer" ? "we owe them" : "they owe us"}
                  </div>
                </div>
                {c.direction === "yalla_to_customer" && (
                  <Button size="sm" variant="outline" onClick={() => onFulfil(c.id)}>
                    Mark kept
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "bad" }) {
  return (
    <div className="rounded-md border p-2">
      <div className={cn("text-lg font-semibold", tone === "bad" && "text-destructive")}>{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------- customers waiting */

export function CustomerWaitingQueue({ waiting }: { waiting: WaitingCustomer[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" /> Customers waiting on me
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ordered by broken promises first, then by how long they have waited.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {waiting.length === 0 && (
          <p className="text-sm text-muted-foreground">No customer is currently waiting on you.</p>
        )}
        {waiting.map((w) => (
          <div key={w.accountId} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{w.accountName}</div>
              <div className="text-xs text-muted-foreground">
                {w.openPromises} open promise(s)
                {w.overduePromises > 0 && ` · ${w.overduePromises} overdue`}
                {w.waitingHours !== null && ` · waiting ${w.waitingHours} h`}
              </div>
            </div>
            {w.overduePromises > 0 && <Badge variant="destructive">Overdue</Badge>}
            <Button size="sm" variant="ghost" asChild>
              <Link to={`/staff/customers/accounts?account=${w.accountId}`}>Open account</Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------- opportunity momentum */

export function MomentumPanel({ momentum }: { momentum: AccountMomentum[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-primary" /> Relationship momentum
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Derived from recorded movement on your accounts. Stalled relationships appear first.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {momentum.length === 0 && (
          <p className="text-sm text-muted-foreground">No accounts are assigned to you yet.</p>
        )}
        {momentum.slice(0, 6).map((m) => (
          <div key={m.accountId} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{m.accountName}</div>
              <div className="text-xs text-muted-foreground">
                {m.openWork} open item(s) · {m.openPromises} promise(s)
                {m.staleDays !== null ? ` · last movement ${m.staleDays} d ago` : " · no movement recorded"}
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn(
                m.state === "stalled" && "border-destructive/50 text-destructive",
                m.state === "cooling" && "border-warning/50 text-warning",
                m.state === "moving" && "border-primary/40 text-primary",
              )}
            >
              {m.state}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------- day close */

export function DayCloseCard({ close, onReplan }: { close: DayCloseSummary; onReplan: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sunset className="h-4 w-4 text-primary" /> Close the day
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          An honest close is what lets tomorrow be planned instead of guessed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center text-xs">
          <Stat label="Completed" value={close.completedToday} />
          <Stat label="Still open" value={close.stillOpen} />
          <Stat label="Carried over" value={close.carriedOver} />
          <Stat
            label="Breached"
            value={close.breachedOpen}
            tone={close.breachedOpen ? "bad" : undefined}
          />
        </div>

        {close.blockers.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
            <div className="font-semibold">Resolve before closing</div>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {close.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tomorrow opens with
          </div>
          <ol className="mt-2 space-y-1">
            {close.tomorrowFirstThree.length === 0 && (
              <li className="text-muted-foreground">Nothing queued for tomorrow.</li>
            )}
            {close.tomorrowFirstThree.map((t, i) => (
              <li key={t.workId} className="rounded-md border p-2">
                <span className="mr-2 font-mono text-xs text-muted-foreground">{i + 1}</span>
                <span className="font-medium">{t.title}</span>
                <div className="text-xs text-muted-foreground">{t.why}</div>
              </li>
            ))}
          </ol>
          {close.promisesDueTomorrow > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {close.promisesDueTomorrow} customer promise(s) fall due tomorrow.
            </p>
          )}
        </div>

        <Button variant="outline" onClick={onReplan}>
          Prepare tomorrow
        </Button>
      </CardContent>
    </Card>
  );
}
