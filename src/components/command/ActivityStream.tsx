/**
 * Intelligent activity stream — the domain's live pulse. Rows link to the
 * underlying record so the operator can act on what they just saw.
 */
import { Link } from "react-router-dom";
import { Activity } from "lucide-react";
import type { CommandActivityEvent } from "./types";

function time(at: string) {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function ActivityStream({
  events,
  title = "Activity stream",
}: {
  events: CommandActivityEvent[];
  title?: string;
}) {
  return (
    <section aria-label={title} className="glass-panel rounded-xl border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Activity className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold uppercase tracking-wider">{title}</h2>
      </header>
      {events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No recorded activity in this window.</p>
      ) : (
        <ol className="divide-y">
          {events.map((e) => {
            const row = (
              <div className="flex items-baseline gap-3">
                <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={e.at}>
                  {time(e.at)}
                </time>
                <span className="min-w-0 flex-1 truncate text-sm">{e.summary}</span>
                {e.actor && (
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{e.actor}</span>
                )}
              </div>
            );
            return (
              <li key={e.id} className="px-4 py-2.5">
                {e.to ? (
                  <Link to={e.to} className="block rounded hover:bg-muted/60">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
