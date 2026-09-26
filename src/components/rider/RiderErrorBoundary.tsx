import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props {
  /** Human-readable name of the wrapped area (e.g. "Booking map"). */
  sectionName?: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes in rider components (e.g. a missing/undefined
 * child component) so the booking flow shows a recovery UI instead of a
 * blank screen.
 */
export class RiderErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
     
    console.error(`[Rider/${this.props.sectionName ?? "Section"}] render error`, error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <Card
          role="alert"
          aria-live="polite"
          data-testid="rider-error-boundary"
          className="p-6 border-destructive/30 bg-destructive/5"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-sm mb-1">
                {this.props.sectionName ?? "This section"} could not be displayed
              </h2>
              <p className="text-sm text-muted-foreground break-words">
                {this.state.error.message || "An unexpected error occurred."}
              </p>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={this.reset} data-testid="rider-error-boundary-retry">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Try again
                </Button>
                <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
                  Reload page
                </Button>
              </div>
            </div>
          </div>
        </Card>
      );
    }
    return this.props.children;
  }
}
