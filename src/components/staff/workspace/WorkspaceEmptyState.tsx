/**
 * Polished, actionable empty state for personal work and approval surfaces.
 * An employee with nothing assigned is given the next legitimate step rather
 * than a blank card — and never a fabricated item.
 */
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Inbox } from "lucide-react";

export interface EmptyAction {
  label: string;
  to: string;
}

export function WorkspaceEmptyState({
  title,
  message,
  actions = [],
}: {
  title: string;
  message?: string;
  actions?: EmptyAction[];
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card p-8 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        {message && (
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
        )}
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {actions.map((a, i) => (
            <Button key={a.to} size="sm" variant={i === 0 ? "default" : "outline"} asChild>
              <Link to={a.to}>{a.label}</Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export default WorkspaceEmptyState;
