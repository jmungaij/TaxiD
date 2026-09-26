import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StaffErrorBoundary } from "@/components/staff/StaffErrorBoundary";
import {
  buildManifest,
  dependencyGenerations,
  hasMixedDependencyBundles,
} from "@/lib/runtime/buildManifest";
import {
  clearDiagnostics,
  diagnosticLog,
  subscribeDiagnostics,
  type DiagnosticCategory,
  type DiagnosticEvent,
} from "@/lib/runtime/diagnostics";

const CATEGORIES: Array<DiagnosticCategory | "ALL"> = [
  "ALL",
  "AUTH",
  "API",
  "BOOKING",
  "DISPATCH",
  "PAYMENT",
  "RUNTIME",
  "ROUTING",
  "DEPLOYMENT",
  "CACHE",
  "SERVICE_ACTIVATION",
];

const severityTone = (s: DiagnosticEvent["severity"]) =>
  s === "CRITICAL" || s === "ERROR"
    ? "destructive"
    : s === "WARNING"
      ? "secondary"
      : "outline";

/**
 * Admin → System → Runtime Diagnostics.
 *
 * One operator surface for the client-side observability pipeline: which build
 * the browser is actually running, whether stale and current dependency bundles
 * are mixed, and the structured event stream (auth redirects, booking refusals,
 * payment, runtime and deployment faults) with correlation ids.
 */
export default function RuntimeDiagnostics() {
  const [events, setEvents] = useState<DiagnosticEvent[]>(() => diagnosticLog());
  const [category, setCategory] = useState<DiagnosticCategory | "ALL">("ALL");
  const manifest = useMemo(() => buildManifest(), []);
  const generations = useMemo(() => dependencyGenerations(), []);
  const mixed = hasMixedDependencyBundles();

  useEffect(() => subscribeDiagnostics(() => setEvents(diagnosticLog())), []);

  const filtered = category === "ALL" ? events : events.filter((e) => e.category === category);
  const authEvents = events.filter((e) => e.category === "AUTH");

  return (
    <StaffErrorBoundary area="Runtime Diagnostics">
      <Helmet>
        <title>Runtime Diagnostics | Yalla Mobility Admin</title>
        <meta
          name="description"
          content="Operator view of the running build, dependency bundle integrity, authentication redirect reasons and the structured runtime event stream."
        />
      </Helmet>

      <div className="p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Runtime Diagnostics</h1>
          <p className="text-sm text-muted-foreground">
            What this browser is running, and every structured runtime event captured in this session.
          </p>
        </header>

        {mixed && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" aria-hidden="true" />
              <div className="text-sm">
                <p className="font-semibold text-destructive">Mixed dependency bundles detected</p>
                <p className="text-muted-foreground">
                  This document references more than one dependency generation ({generations.join(", ")}). Reload to
                  pick up a single build; if it persists the deployment published inconsistent assets.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Build manifest</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3 font-mono">
              {Object.entries(manifest).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="break-words">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Tabs defaultValue="events">
          <TabsList>
            <TabsTrigger value="events">Event stream ({events.length})</TabsTrigger>
            <TabsTrigger value="auth">Authentication ({authEvents.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="space-y-3 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {CATEGORIES.map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant={category === c ? "default" : "outline"}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </Button>
              ))}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEvents(diagnosticLog())}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                onClick={() => {
                  clearDiagnostics();
                  setEvents([]);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Clear session view
              </Button>
            </div>

            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events captured in this session yet.</p>
            ) : (
              <div className="space-y-2">
                {filtered.map((e) => (
                  <Card key={e.event_id}>
                    <CardContent className="p-3 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant={severityTone(e.severity)}>{e.severity}</Badge>
                        <Badge variant="outline">{e.category}</Badge>
                        <span className="font-mono">{e.operation}</span>
                        {e.error_code && <span className="font-mono text-destructive">{e.error_code}</span>}
                        <span className="text-muted-foreground">{new Date(e.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-sm break-words">{e.message}</p>
                      <p className="text-xs text-muted-foreground font-mono break-words">
                        route={e.route ?? "—"} · service={e.service ?? "—"} · corr={e.correlation_id} · build={e.build_id}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="auth" className="pt-4">
            {authEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No authentication redirects captured in this session. Every redirect to a sign-in surface records its
                canonical reason here.
              </p>
            ) : (
              <div className="space-y-2">
                {authEvents.map((e) => {
                  const m = e.metadata as Record<string, unknown>;
                  return (
                    <Card key={e.event_id}>
                      <CardContent className="p-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
                          <Badge variant={severityTone(e.severity)}>{String(m.redirect_reason ?? e.error_code)}</Badge>
                          <span className="text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</span>
                        </div>
                        <dl className="grid grid-cols-[12rem,1fr] gap-x-3 gap-y-1 text-xs font-mono">
                          {[
                            ["Environment", m.environment],
                            ["Requested route", m.requested_route],
                            ["Redirect destination", m.redirect_destination],
                            ["Authentication state", m.authentication_state],
                            ["Authorization state", m.authorization_state],
                            ["Required role", Array.isArray(m.required_role) ? (m.required_role as string[]).join(", ") : "—"],
                            ["Actual role", Array.isArray(m.actual_role) ? (m.actual_role as string[]).join(", ") : "—"],
                            ["Token present", String(m.token_present)],
                            ["Token expired", String(m.token_expired)],
                            ["Refresh result", m.refresh_result],
                            ["User (hashed)", m.user_id_hash ?? "—"],
                            ["Tenant (hashed)", m.tenant_id_hash ?? "—"],
                            ["Correlation ID", e.correlation_id],
                          ].map(([label, value]) => (
                            <div key={String(label)} className="contents">
                              <dt className="text-muted-foreground">{String(label)}</dt>
                              <dd className="break-words">{String(value ?? "—")}</dd>
                            </div>
                          ))}
                        </dl>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </StaffErrorBoundary>
  );
}
