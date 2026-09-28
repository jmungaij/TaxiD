import React from "react";
import { AlertTriangle, RefreshCw, Home, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildManifest, hasMixedDependencyBundles } from "@/lib/runtime/buildManifest";
import { newCorrelationId, recordDiagnostic, supportReference } from "@/lib/runtime/diagnostics";
import { CONTACT } from "@/config/contact";

export type RuntimeErrorKind =
  | "RUNTIME_ERROR"
  | "BLANK_SCREEN"
  | "ROUTE_ERROR"
  | "CHUNK_LOAD_ERROR"
  | "DEPENDENCY_ERROR"
  | "AUTH_REDIRECT_ERROR";

const RECOVERY_KEY = "yalla.runtime.recovery";
const RECOVERY_WINDOW_MS = 60_000;

/** Classifies a caught error so recovery and messaging match the real cause. */
export function classifyRuntimeError(error: Error): RuntimeErrorKind {
  const text = `${error.name} ${error.message}`;
  if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported/i.test(text)) {
    return "CHUNK_LOAD_ERROR";
  }
  if (/Cannot read properties of null \(reading '(use|React)/i.test(text) || /Invalid hook call|two copies of React/i.test(text)) {
    return "DEPENDENCY_ERROR";
  }
  if (/is not defined|Cannot access .* before initialization/.test(text)) return "RUNTIME_ERROR";
  return "RUNTIME_ERROR";
}

interface RecoveryMarker {
  at: number;
  kind: RuntimeErrorKind;
}

function readMarker(): RecoveryMarker | null {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecoveryMarker;
    if (Date.now() - parsed.at > RECOVERY_WINDOW_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeMarker(kind: RuntimeErrorKind): void {
  try {
    sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ at: Date.now(), kind } satisfies RecoveryMarker));
  } catch {
    /* nothing to persist — recovery simply degrades to the diagnostic fallback */
  }
}

/**
 * One controlled recovery attempt for stale-bundle failures. The short-lived
 * marker guarantees the browser cannot reload itself repeatedly: if a marker is
 * already present we fall through to the diagnostic fallback instead.
 */
export async function attemptStaleBundleRecovery(kind: RuntimeErrorKind): Promise<boolean> {
  const recoverable = kind === "CHUNK_LOAD_ERROR" || kind === "DEPENDENCY_ERROR";
  if (!recoverable) return false;
  if (readMarker()) return false;
  writeMarker(kind);

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* cache clearing is best effort */
  }

  window.location.reload();
  return true;
}

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  kind: RuntimeErrorKind;
  reference: string;
  recovering: boolean;
}

/**
 * GLOBAL APPLICATION ERROR BOUNDARY.
 *
 * Wraps the whole React tree so a render, component, route or unexpected
 * runtime failure produces a diagnostic fallback with a support reference —
 * never a blank screen. Stale-bundle failures get exactly one controlled
 * recovery reload before the fallback is shown.
 */
export class GlobalErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, kind: "RUNTIME_ERROR", reference: "", recovering: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, kind: classifyRuntimeError(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const kind = classifyRuntimeError(error);
    const correlationId = newCorrelationId();
    const reference = supportReference(correlationId);
    const manifest = buildManifest();

    recordDiagnostic({
      category: kind === "CHUNK_LOAD_ERROR" || kind === "DEPENDENCY_ERROR" ? "DEPLOYMENT" : "RUNTIME",
      severity: "CRITICAL",
      operation: kind.toLowerCase(),
      message: error.message || "Unhandled render error",
      correlationId,
      errorCode: kind,
      metadata: {
        reference,
        error_name: error.name,
        error_message: error.message,
        stack: (error.stack ?? "").split("\n").slice(0, 20).join("\n"),
        component_stack: (info.componentStack ?? "").split("\n").slice(0, 20).join("\n"),
        route: window.location.pathname,
        browser: navigator.userAgent,
        mixed_dependency_bundles: hasMixedDependencyBundles(),
        ...manifest,
      },
      persist: true,
    });

    this.setState({ reference, recovering: true });
    void attemptStaleBundleRecovery(kind).then((reloading) => {
      if (!reloading) this.setState({ recovering: false });
    });
  }

  private reset = () => this.setState({ error: null, recovering: false });

  render() {
    const { error, kind, reference, recovering } = this.state;
    if (!error) return this.props.children;

    const manifest = buildManifest();
    const staleBundle = kind === "CHUNK_LOAD_ERROR" || kind === "DEPENDENCY_ERROR";

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-xl" role="alert" data-testid="global-error-boundary">
          <CardHeader className="flex flex-row items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-1 shrink-0" aria-hidden="true" />
            <div>
              <CardTitle className="text-lg">Something went wrong</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                The TaxiD application encountered an unexpected error.
                {staleBundle && " This looks like an out-of-date copy of the app in your browser."}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-3 font-mono text-xs">
              <dt className="text-muted-foreground">Reference</dt>
              <dd>{reference || "pending"}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd>{kind}</dd>
              <dt className="text-muted-foreground">Build</dt>
              <dd>{manifest.build_id}</dd>
              <dt className="text-muted-foreground">Environment</dt>
              <dd>{manifest.environment}</dd>
            </dl>

            {recovering && <p className="text-muted-foreground">Attempting automatic recovery…</p>}

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => window.location.reload()} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reload
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => { this.reset(); window.location.assign("/dashboard"); }}>
                <Home className="h-3.5 w-3.5" aria-hidden="true" /> Return to dashboard
              </Button>
              <Button variant="ghost" asChild className="gap-2">
                <a href={`mailto:${CONTACT.supportEmail}?subject=${encodeURIComponent(`App error ${reference}`)}`}>
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" /> Report issue
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}

export default GlobalErrorBoundary;
