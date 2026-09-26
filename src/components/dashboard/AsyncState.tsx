import { ReactNode } from "react";
import { Loader2, AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared loading / error / empty state wrapper for dashboard panels.
 * Keeps every module rendering cleanly when the API is slow, fails, or returns nothing.
 */
export function AsyncState({
  loading,
  error,
  isEmpty,
  emptyTitle = "Nothing here yet",
  emptyMessage,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-10 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 flex flex-col items-center gap-3 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        <div>
          <p className="font-medium">Couldn't load this section</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">{error}</p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
        )}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="rounded-xl border bg-card p-10 flex flex-col items-center gap-2 text-center text-muted-foreground">
        <Inbox className="h-6 w-6" aria-hidden />
        <p className="font-medium text-foreground">{emptyTitle}</p>
        {emptyMessage && <p className="text-sm max-w-md">{emptyMessage}</p>}
      </div>
    );
  }
  return <>{children}</>;
}
