import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppButton } from "@/components/nav/AppButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, ShieldAlert, RefreshCw, KeyRound, Download, LifeBuoy, PlayCircle } from "lucide-react";
import { toCsv, downloadCsv } from "@/lib/csv";
import { buildRunbook, type DriftFact } from "@/lib/platform/roleGrantRunbook";
import { toast } from "@/hooks/use-toast";


interface HelperRow {
  function_signature: string;
  function_name: string;
  function_owner: string;
  security_definer: boolean;
  authenticated_execute: boolean;
  anon_execute: boolean;
  service_role_execute: boolean;
  missing_grantees: string[];
  owner_expected: boolean;
}

interface DriftCheck {
  id: string;
  checked_at: string;
  source: string;
  gap_count: number;
  gaps: unknown;
  repaired: boolean;
  notified_at: string | null;
  notification_channel: string | null;
  notification_error: string | null;
}

interface GuardEvent {
  id: string;
  occurred_at: string;
  event_type: string;
  command_tag: string | null;
  function_signature: string | null;
  function_owner: string | null;
  security_definer: boolean | null;
  applied_grantees: string[];
  missing_grantees: string[];
  actor: string;
  details: Record<string, unknown>;
}

interface Overview {
  helpers: HelperRow[];
  checks: DriftCheck[];
  events: GuardEvent[];
  guard_enabled: boolean;
}

const fmt = (iso: string) => new Date(iso).toLocaleString();

export default function RoleGrantGovernance() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.rpc("admin_role_grant_overview");
    if (err) setError(err.message);
    else setData(res as unknown as Overview);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const drifting = useMemo(
    () => (data?.helpers ?? []).filter((h) => h.missing_grantees.length > 0 || !h.owner_expected),
    [data],
  );

  const eventsBySignature = useMemo(() => {
    const map = new Map<string, GuardEvent[]>();
    for (const e of data?.events ?? []) {
      const key = e.function_signature ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [data]);

  const runbook = useMemo(
    () =>
      buildRunbook(
        drifting.map<DriftFact>((h) => ({
          function_signature: h.function_signature,
          missing_grantees: h.missing_grantees ?? [],
          function_owner: h.function_owner,
          owner_expected: h.owner_expected,
          security_definer: h.security_definer,
        })),
      ),
    [drifting],
  );

  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  const exportMatrix = useCallback(() => {
    if (!data) return;
    const rows = data.helpers.map((h) => ({
      function_signature: h.function_signature,
      owner: h.function_owner,
      owner_expected: h.owner_expected,
      security_definer: h.security_definer,
      authenticated_execute: h.authenticated_execute,
      anon_execute: h.anon_execute,
      service_role_execute: h.service_role_execute,
      missing_grantees: (h.missing_grantees ?? []).join(" "),
      guard_events: eventsBySignature.get(h.function_signature)?.length ?? 0,
      exported_at: new Date().toISOString(),
    }));
    downloadCsv(`role-grant-matrix-${stamp()}.csv`, toCsv(rows));
    toast({ title: "Grant matrix exported", description: `${rows.length} helper overloads written to CSV.` });
  }, [data, eventsBySignature]);

  const exportDriftHistory = useCallback(() => {
    if (!data) return;
    const rows = data.checks.map((c) => ({
      check_id: c.id,
      checked_at: c.checked_at,
      source: c.source,
      gap_count: c.gap_count,
      repaired: c.repaired,
      notified_at: c.notified_at ?? "",
      notification_channel: c.notification_channel ?? "",
      notification_error: c.notification_error ?? "",
      gaps: JSON.stringify(c.gaps ?? []),
    }));
    downloadCsv(`role-grant-drift-history-${stamp()}.csv`, toCsv(rows));
    toast({ title: "Drift history exported", description: `${rows.length} checks written to CSV.` });
  }, [data]);

  const exportGuardEvents = useCallback(() => {
    if (!data) return;
    const rows = data.events.map((e) => ({
      event_id: e.id,
      occurred_at: e.occurred_at,
      event_type: e.event_type,
      command_tag: e.command_tag ?? "",
      function_signature: e.function_signature ?? "",
      function_owner: e.function_owner ?? "",
      security_definer: e.security_definer ?? "",
      applied_grantees: (e.applied_grantees ?? []).join(" "),
      missing_grantees: (e.missing_grantees ?? []).join(" "),
      actor: e.actor,
    }));
    downloadCsv(`role-grant-audit-events-${stamp()}.csv`, toCsv(rows));
    toast({ title: "Audit events exported", description: `${rows.length} guard events written to CSV.` });
  }, [data]);

  const [running, setRunning] = useState(false);
  const runDriftCheck = useCallback(async () => {
    setRunning(true);
    const { data: res, error: err } = await supabase.functions.invoke("role-grant-monitor", {
      body: { source: "admin-console", repair: true },
    });
    setRunning(false);
    if (err) {
      toast({ title: "Drift check failed", description: err.message, variant: "destructive" });
      return;
    }
    const gaps = (res as { gap_count?: number; environment?: string } | null)?.gap_count ?? 0;
    const env = (res as { environment?: string } | null)?.environment ?? "unknown";
    toast({
      title: gaps ? `${gaps} gap(s) found and repaired` : "No drift detected",
      description: `Environment: ${env}.`,
    });
    await load();
  }, [load]);

  return (
    <div className="container mx-auto space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Platform · Access Integrity</p>
          <h1 className="text-2xl font-semibold text-foreground">Role Grant Governance</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Live EXECUTE grant state for every role-check helper (has_role / has_any_role and their
            version-pinned variants), drift history over time, and the guard events that repaired them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AppButton
            analytics="admin_role_grant_run_check"
            action="noop"
            variant="secondary"
            disabled={running}
            onClick={() => void runDriftCheck()}
            aria-label="Run the role grant drift check now"
          >
            <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            {running ? "Running drift check…" : "Run drift check"}
          </AppButton>
          <AppButton
            analytics="admin_role_grant_export_matrix"
            action="noop"
            variant="secondary"
            disabled={!data}
            onClick={exportMatrix}
            aria-label="Download the latest role helper grant matrix as CSV"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Export grant matrix CSV
          </AppButton>
          <AppButton
            analytics="admin_role_grant_export_history"
            action="noop"
            variant="secondary"
            disabled={!data}
            onClick={exportDriftHistory}
            aria-label="Download the drift check history as CSV"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Export drift history CSV
          </AppButton>
          <AppButton
            analytics="admin_role_grant_export_events"
            action="noop"
            variant="secondary"
            disabled={!data}
            onClick={exportGuardEvents}
            aria-label="Download the guard audit events as CSV"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Export audit events CSV
          </AppButton>
          <AppButton
            analytics="admin_role_grant_refresh"
            action="noop"
            variant="secondary"
            onClick={() => void load()}
            aria-label="Refresh role grant governance data"
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh grant status
          </AppButton>
        </div>
      </header>


      {error && (
        <Card role="alert" className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Guard trigger</CardDescription>
                <CardTitle className="flex items-center gap-2 text-lg">
                  {data.guard_enabled ? (
                    <>
                      <ShieldCheck className="h-5 w-5 text-primary" aria-hidden /> Active
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden /> Disabled
                    </>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Re-applies grants on CREATE, ALTER, rename and security changes.
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Helpers tracked</CardDescription>
                <CardTitle className="text-lg">{data.helpers.length}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Every overload of the role-check helpers in the public schema.
              </CardContent>
            </Card>
            <Card className={drifting.length ? "border-destructive/40" : undefined}>
              <CardHeader className="pb-2">
                <CardDescription>Current drift</CardDescription>
                <CardTitle className="text-lg">{drifting.length}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {drifting.length === 0
                  ? "All helpers hold the expected grants and ownership."
                  : "Helpers missing grants or with unexpected ownership."}
              </CardContent>
            </Card>
          </div>

          <Card
            className={runbook.length ? "border-destructive/40" : undefined}
            role={runbook.length ? "alert" : undefined}
            aria-live="polite"
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LifeBuoy className="h-4 w-4" aria-hidden /> Runbook &amp; escalation
              </CardTitle>
              <CardDescription>
                Each live drift is linked to its exact cause (missing grantee, owner mismatch or
                security context), the remediation steps and the escalation owner.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {runbook.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No open drift. Baseline: <code className="font-mono text-xs">authenticated</code>,{" "}
                  <code className="font-mono text-xs">anon</code> and{" "}
                  <code className="font-mono text-xs">service_role</code> hold EXECUTE; owner{" "}
                  <code className="font-mono text-xs">postgres</code>; SECURITY DEFINER with{" "}
                  <code className="font-mono text-xs">search_path = public</code>. The CI gate
                  (Role Grant Integrity) fails any PR that reintroduces a 42501.
                </p>
              ) : (
                runbook.map((entry) => (
                  <section
                    key={entry.signature}
                    className="rounded-lg border border-border bg-muted/30 p-4"
                    aria-label={`Runbook for ${entry.signature}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={entry.severity === "critical" ? "destructive" : "secondary"}>
                        {entry.severity.toUpperCase()}
                      </Badge>
                      <span className="font-mono text-xs">{entry.signature}</span>
                    </div>
                    <p className="mt-2 text-sm text-foreground">{entry.diagnosis}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{entry.impact}</p>
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                      {entry.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                    <pre className="mt-3 overflow-x-auto rounded-md bg-background p-3 text-xs">
                      <code>{entry.sql.join("\n")}</code>
                    </pre>
                    <p className="mt-3 text-xs text-muted-foreground">
                      <strong className="text-foreground">Escalate to:</strong> {entry.escalation.owner} ·{" "}
                      {entry.escalation.channel} · {entry.escalation.sla}
                    </p>
                  </section>
                ))
              )}
            </CardContent>
          </Card>



          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" aria-hidden /> Helper grant matrix
              </CardTitle>
              <CardDescription>EXECUTE privileges per grantee, owner and security context.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Function signature</TableHead>
                    <TableHead>authenticated</TableHead>
                    <TableHead>anon</TableHead>
                    <TableHead>service_role</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Security definer</TableHead>
                    <TableHead>Guard events</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.helpers.map((h) => (
                    <TableRow key={h.function_signature}>
                      <TableCell className="font-mono text-xs">{h.function_signature}</TableCell>
                      {[h.authenticated_execute, h.anon_execute, h.service_role_execute].map((ok, i) => (
                        <TableCell key={i}>
                          <Badge variant={ok ? "secondary" : "destructive"}>{ok ? "granted" : "missing"}</Badge>
                        </TableCell>
                      ))}
                      <TableCell className="text-xs">
                        {h.function_owner}
                        {!h.owner_expected && (
                          <Badge variant="destructive" className="ml-2">unexpected</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{h.security_definer ? "yes" : "no"}</TableCell>
                      <TableCell className="text-xs">
                        {eventsBySignature.get(h.function_signature)?.length ?? 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Drift checks over time</CardTitle>
              <CardDescription>
                Scheduled and manual integrity checks, auto-repair outcome and alert delivery.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Checked</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Gaps</TableHead>
                    <TableHead>Repaired</TableHead>
                    <TableHead>Alert</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.checks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        No drift checks recorded yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.checks.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs">{fmt(c.checked_at)}</TableCell>
                        <TableCell className="text-xs">{c.source}</TableCell>
                        <TableCell>
                          <Badge variant={c.gap_count ? "destructive" : "secondary"}>{c.gap_count}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{c.repaired ? "yes" : "—"}</TableCell>
                        <TableCell className="text-xs">
                          {c.notified_at
                            ? `${c.notification_channel ?? "sent"}${c.notification_error ? " (errors)" : ""}`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Triggering audit events</CardTitle>
              <CardDescription>
                Append-only guard trail: which DDL command touched a helper, and what was repaired.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Command</TableHead>
                    <TableHead>Function</TableHead>
                    <TableHead>Missing before</TableHead>
                    <TableHead>Actor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.events.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-sm text-muted-foreground">
                        No guard events recorded — no helper has drifted since the guard was installed.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.events.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs">{fmt(e.occurred_at)}</TableCell>
                        <TableCell>
                          <Badge variant={e.event_type === "GRANT_APPLIED" ? "secondary" : "destructive"}>
                            {e.event_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{e.command_tag ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{e.function_signature ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {e.missing_grantees?.length ? e.missing_grantees.join(", ") : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{e.actor}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
