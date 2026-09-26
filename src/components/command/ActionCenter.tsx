/**
 * Action centre — "what needs attention now?" Each row is bound to the real
 * workflow that resolves it. Severity ordering is enforced here so every domain
 * presents the same triage language.
 */
import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CommandAction } from "./types";

const ORDER: Record<CommandAction["severity"], number> = { critical: 0, high: 1, medium: 2, info: 3 };

const SEVERITY_CLASS: Record<CommandAction["severity"], string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  high: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  medium: "border-primary/30 bg-primary/10 text-primary",
  info: "border-border bg-muted text-muted-foreground",
};

export function ActionCenter({
  actions,
  title = "Action centre",
}: {
  actions: CommandAction[];
  title?: string;
}) {
  const sorted = [...actions].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return (
    <section aria-label={title} className="glass-panel rounded-xl border">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wider">{title}</h2>
        </span>
        <Badge variant="secondary">{sorted.length}</Badge>
      </header>
      {sorted.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Nothing requires attention on this domain right now.
        </p>
      ) : (
        <ul className="divide-y">
          {sorted.map((a) => (
            <li key={a.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span
                    className={cn(
                      "inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                      SEVERITY_CLASS[a.severity],
                    )}
                  >
                    {a.severity}
                  </span>
                  <p className="mt-1.5 text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">{a.detail}</p>
                </div>
                <Link
                  to={a.to}
                  className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                >
                  {a.actionLabel}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
