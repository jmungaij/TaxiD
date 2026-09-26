import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** Human-readable name of the section (e.g. "Approvals", "Cash Ledger"). */
  sectionName: string;
  children: React.ReactNode;
}

interface State { error: Error | null }

/**
 * Wraps a corporate dashboard section so any thrown render / query error
 * is displayed as a friendly card instead of crashing the whole page.
 */
export class SectionErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
     
    console.error(`[CorporateDashboard/${this.props.sectionName}] render error`, error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-destructive">
                {this.props.sectionName} could not be displayed
              </h3>
              <p className="text-sm text-destructive/80 mt-1 break-words">
                {this.state.error.message || "An unexpected error occurred."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 gap-2"
                onClick={this.reset}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
