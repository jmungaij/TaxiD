import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  /** Surface name shown in the fallback, e.g. "Staff 360". */
  area?: string;
}

interface State {
  error: Error | null;
}

/**
 * Error boundary for the staff portal.
 *
 * A staff surface must never fail to a blank screen. When a render throws —
 * including the classic hot-reload "X is not defined" for a missing module
 * constant — this states what failed and what to do next, and keeps the rest of
 * the portal reachable.
 */
export class StaffErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
     
    console.error(`[staff] ${this.props.area ?? "portal"} render failed`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isMissingBinding = /is not defined|Cannot access .* before initialization/.test(error.message);

    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {this.props.area ?? "This staff surface"} could not render
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="rounded-md border bg-muted/40 p-3 font-mono text-xs break-words">{error.message}</p>

            <div>
              <p className="font-medium">What to do</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
                {isMissingBinding && (
                  <li>
                    This is usually a stale hot-reload module. Do a hard reload (Cmd/Ctrl + Shift + R) —
                    the page will pick up the current build.
                  </li>
                )}
                <li>Retry the surface below; your session and data are untouched.</li>
                <li>
                  If it repeats, open{" "}
                  <Link className="underline" to="/staff/workspace">
                    your workspace
                  </Link>{" "}
                  and report the message above to platform engineering — nothing was written.
                </li>
              </ol>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={this.reset}>Retry this surface</Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Hard reload
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/staff/360">Back to Staff 360</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}

export default StaffErrorBoundary;
