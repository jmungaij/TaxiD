import { AlertCircle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  /** Friendly headline shown to the user. */
  title?: string;
  /** Detailed message. Should be reassuring and actionable. */
  message: string;
  /** Optional retry handler — renders a "Try again" button when provided. */
  onRetry?: () => void;
  /** Test id for Playwright assertions. */
  testId?: string;
}

/**
 * Friendly error state used across the rider app when a Supabase / API
 * call fails. Centralised so Playwright forced-failure specs can assert
 * stable copy.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  testId = "rider-error-state",
}: ErrorStateProps) {
  return (
    <Card
      data-testid={testId}
      role="alert"
      aria-live="polite"
      className="p-6 border-destructive/30 bg-destructive/5"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm mb-1">{title}</h2>
          <p className="text-sm text-muted-foreground">{message}</p>
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onRetry}
              data-testid={`${testId}-retry`}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Try again
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
