/**
 * Scheduled Job Health — pg_cron run status and HTTP outcomes.
 *
 * Correlates `cron.job_run_details` (did the schedule fire?) with the HTTP
 * response of each invocation recorded through `invoke_scheduled_function`
 * (did the edge function answer 200 or 502?) and surfaces the last error.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { SeoHead } from "@/components/seo/SeoHead";

export interface JobHealthRow {
  job_name: string;
  schedule: string | null;
  active: boolean;
  function_slug: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
  runs: number;
  cron_failures: number;
  http_calls: number;
  http_ok: number;
  http_failed: number;
  last_http_status: number | null;
  last_http_at: string | null;
  last_http_error: string | null;
}

/** Watched jobs surfaced first — the two that previously failed with 502. */
export const WATCHED_JOBS = ["etims-retry", "mpesa-export-worker"];

export type JobVerdict = "healthy" | "degraded" | "failing" | "idle" | "paused";

/** Pure verdict so the health rollup stays testable. */
export function jobVerdict(row: JobHealthRow): JobVerdict {
  if (!row.active) return "paused";
  if (row.cron_failures > 0) return "failing";
  if (row.last_http_status != null && row.last_http_status >= 400) return "failing";
  if (row.http_failed > 0) return "degraded";
  if (row.runs === 0) return "idle";
  return "healthy";
}

const VERDICT_VARIANT: Record<JobVerdict, "outline" | "secondary" | "destructive"> = {
  healthy: "outline", degraded: "secondary", failing: "destructive", idle: "secondary", paused: "secondary",
};

const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-KE") : "—");

export default function ScheduledJobHealth() {
  const [rows, setRows] = useState<JobHealthRow[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<string | null>(null);

  const load = useCallback(async (window: number) => {
    setLoading(true);
    const { data, error } = await supabase.rpc("scheduled_job_health", { _hours: window } as never);
    if (error) {
      setDenied(error.message);
      setRows([]);
    } else {
      setDenied(null);
      setRows((data ?? []) as unknown as JobHealthRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(hours); }, [load, hours]);

  const watched = rows.filter((r) => WATCHED_JOBS.includes(r.function_slug ?? ""));
  const failing = rows.filter((r) => jobVerdict(r) === "failing");

  return (
    <div className="space-y-6">
      <SeoHead
        path="/dashboard/admin/scheduled-job-health"
        title="Scheduled Job Health | SAFARID"
        description="pg_cron run status, HTTP outcomes and last errors for eTIMS retry, M-Pesa export and reconciliation alert jobs."
      />

      <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-primary-glow/10 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Platform operations</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Scheduled Job Health</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Every scheduled invocation is recorded with its HTTP response, so a booting failure (502) is visible
          immediately alongside the cron run status and the last upstream error.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant={failing.length ? "destructive" : "outline"} className="gap-1">
            {failing.length
              ? <><AlertTriangle className="h-3 w-3" aria-hidden /> {failing.length} job(s) failing</>
              : <><CheckCircle2 className="h-3 w-3" aria-hidden /> All scheduled jobs healthy</>}
          </Badge>
          {[6, 24, 72].map((h) => (
            <Button key={h} size="sm" variant={hours === h ? "default" : "outline"} onClick={() => setHours(h)}>
              <Clock className="mr-2 h-4 w-4" aria-hidden /> {h}h
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => void load(hours).then(() => toast({ title: "Job health refreshed" }))}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      {denied && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Monitoring access required</CardTitle>
            <CardDescription>
              Job health needs the <code className="font-mono">ops.cron.monitor</code> permission. Server said: {denied}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Watched jobs</CardTitle>
          <CardDescription>eTIMS tax retry and the M-Pesa export worker.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {loading && <Skeleton className="h-24 w-full" />}
          {!loading && watched.length === 0 && (
            <p className="text-sm text-muted-foreground">No invocations recorded in this window yet.</p>
          )}
          {watched.map((r) => {
            const verdict = jobVerdict(r);
            return (
              <div key={r.job_name} className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{r.function_slug}</p>
                  <Badge variant={VERDICT_VARIANT[verdict]}>{verdict}</Badge>
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{r.job_name} · {r.schedule}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-muted-foreground">Runs</dt><dd className="tabular-nums">{r.runs}</dd></div>
                  <div><dt className="text-muted-foreground">Cron failures</dt><dd className="tabular-nums">{r.cron_failures}</dd></div>
                  <div><dt className="text-muted-foreground">HTTP 2xx</dt><dd className="tabular-nums">{r.http_ok}/{r.http_calls}</dd></div>
                  <div><dt className="text-muted-foreground">Last status</dt><dd className="tabular-nums">{r.last_http_status ?? "—"}</dd></div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">Last call {when(r.last_http_at)}</p>
                {r.last_http_error && (
                  <p className="mt-2 break-words text-xs text-destructive">{r.last_http_error}</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All scheduled jobs</CardTitle>
          <CardDescription>Ordered by failure count over the selected window.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-32 w-full" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Cron fails</TableHead>
                  <TableHead className="text-right">HTTP ok / calls</TableHead>
                  <TableHead>Last outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-muted-foreground">No scheduled jobs found.</TableCell></TableRow>
                )}
                {rows.map((r) => {
                  const verdict = jobVerdict(r);
                  return (
                    <TableRow key={r.job_name}>
                      <TableCell className="text-xs">
                        <span className="font-medium">{r.function_slug ?? r.job_name}</span>
                        <span className="block font-mono text-muted-foreground">{r.job_name}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.schedule}</TableCell>
                      <TableCell><Badge variant={VERDICT_VARIANT[verdict]}>{verdict}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{r.runs}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.cron_failures}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.http_ok}/{r.http_calls}</TableCell>
                      <TableCell className="text-xs">
                        {r.last_http_status != null && (
                          <Badge variant={r.last_http_status < 400 ? "outline" : "destructive"}>{r.last_http_status}</Badge>
                        )}
                        <span className="block text-muted-foreground">{when(r.last_http_at ?? r.last_run_at)}</span>
                        {(r.last_http_error ?? r.last_run_message) && (
                          <span className="block break-words text-destructive">
                            {r.last_http_error ?? r.last_run_message}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
