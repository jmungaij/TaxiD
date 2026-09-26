/**
 * Navigation Integrity Report — shows the latest run from
 * `navigation_integrity_runs`, highlights failed checks, and links to the
 * affected routes / button components in AdminCommandCenter for one-click
 * remediation. Also exposes an on-demand "Run now" action that invokes the
 * `navigation-integrity-run` edge function and refreshes without redeploy.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Play, Crosshair } from "lucide-react";
import { toast } from "sonner";

interface Run {
  id: string;
  ran_at: string;
  trigger: string;
  dead_routes: number;
  orphan_routes: number;
  registry_mismatch: number;
  unbound_buttons: number;
  missing_analytics: number;
  permission_violations: number;
  passed: boolean;
  report: any;
}

/** Build a deep link into AdminCommandCenter focused on a specific path. */
function focusLink(path: string) {
  return `/dashboard/admin/command-center?focus=${encodeURIComponent(path)}`;
}

/** Build a deep link into AdminCommandCenter focused on a specific file/line. */
function fileFocusLink(file: string, line: number) {
  return `/dashboard/admin/command-center?file=${encodeURIComponent(file)}&line=${line}`;
}

export default function IntegrityReport() {
  const [run, setRun] = React.useState<Run | null>(null);
  const [history, setHistory] = React.useState<Run[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [running, setRunning] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("navigation_integrity_runs")
      .select("*")
      .order("ran_at", { ascending: false })
      .limit(20);
    setHistory((data as any) ?? []);
    setRun(((data as any) ?? [])[0] ?? null);
    setLoading(false);
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("navigation-integrity-run", {
      body: {},
    });
    setRunning(false);
    if (error) {
      toast.error(`Run failed: ${error.message}`);
      return;
    }
    toast.success("Integrity check refreshed");
    await load();
    return data;
  };

  const metrics = run
    ? [
        { key: "dead_routes", label: "Dead routes", value: run.dead_routes, bad: run.dead_routes > 0 },
        { key: "orphan_routes", label: "Orphan routes", value: run.orphan_routes, bad: run.orphan_routes > 25 },
        { key: "registry_mismatch", label: "Registry mismatch", value: run.registry_mismatch, bad: run.registry_mismatch > 0 },
        { key: "unbound_buttons", label: "Unbound buttons", value: run.unbound_buttons, bad: run.unbound_buttons > 10 },
        { key: "missing_analytics", label: "Missing analytics", value: run.missing_analytics, bad: run.missing_analytics > 10 },
        { key: "permission_violations", label: "Permission violations", value: run.permission_violations, bad: run.permission_violations > 0 },
      ]
    : [];

  const details = run?.report?.details ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Navigation Integrity Report</h1>
          <p className="text-muted-foreground">
            Latest output of the prebuild governance check. Runs stored in{" "}
            <code>navigation_integrity_runs</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={runNow} disabled={running}>
            <Play className="h-4 w-4 mr-2" /> {running ? "Running…" : "Run now"}
          </Button>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-2" /> Reload
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/admin/integrity-gates">Configure gates</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/admin/integrity-audit">Threshold audit</Link>
          </Button>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : !run ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          No integrity runs recorded yet. Click <strong>Run now</strong> or execute <code>bun run nav:check</code>.
        </CardContent></Card>
      ) : (
        <>
          <Card className={run.passed ? "border-status-success/40" : "border-destructive/40"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {run.passed
                  ? <><CheckCircle2 className="h-5 w-5 text-status-success" /> Passing</>
                  : <><AlertTriangle className="h-5 w-5 text-destructive" /> Failing</>}
                <Badge variant="secondary" className="ml-2">{run.trigger}</Badge>
                <span className="ml-auto text-sm font-normal text-muted-foreground">
                  {new Date(run.ran_at).toLocaleString()}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {metrics.map(m => (
                  <div
                    key={m.key}
                    className={`rounded-lg border p-3 ${m.bad ? "border-destructive/40 bg-destructive/5" : "border-border"}`}
                  >
                    <div className="text-xs text-muted-foreground">{m.label}</div>
                    <div className={`text-2xl font-bold ${m.bad ? "text-destructive" : ""}`}>{m.value}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="dead">
            <TabsList>
              <TabsTrigger value="dead">Dead routes ({details.deadRoutes?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="orphan">Orphans ({details.orphanRoutes?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="mismatch">Mismatch ({details.registryMismatch?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="unbound">Unbound buttons ({details.unboundButtons?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="analytics">No analytics ({details.missingAnalytics?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="dead">
              <PathList items={details.deadRoutes ?? []} />
            </TabsContent>
            <TabsContent value="orphan">
              <PathList items={details.orphanRoutes ?? []} />
            </TabsContent>
            <TabsContent value="mismatch">
              <Card><CardContent className="pt-6">
                {(details.registryMismatch ?? []).length === 0
                  ? <Empty />
                  : <ul className="space-y-1 text-sm">
                      {(details.registryMismatch as any[]).map((m, i) => (
                        <li key={i} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted">
                          <span><Badge variant="outline" className="mr-2">{m.side}</Badge><code>{m.path}</code></span>
                          <div className="flex gap-1">
                            <Button asChild size="sm" variant="ghost">
                              <Link to={focusLink(m.path)}>
                                <Crosshair className="h-3 w-3 mr-1" /> focus
                              </Link>
                            </Button>
                            {m.side === "app-only" && (
                              <Button asChild size="sm" variant="ghost">
                                <Link to={m.path}>open <ExternalLink className="h-3 w-3 ml-1" /></Link>
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>}
              </CardContent></Card>
            </TabsContent>
            <TabsContent value="unbound">
              <HitList items={details.unboundButtons ?? []} />
            </TabsContent>
            <TabsContent value="analytics">
              <HitList items={details.missingAnalytics ?? []} />
            </TabsContent>
            <TabsContent value="history">
              <Card><CardContent className="pt-6">
                <ul className="divide-y">
                  {history.map(h => (
                    <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                      <span>{new Date(h.ran_at).toLocaleString()}</span>
                      <span className="text-muted-foreground">{h.trigger}</span>
                      <span>D:{h.dead_routes} · O:{h.orphan_routes} · M:{h.registry_mismatch}</span>
                      <Badge variant={h.passed ? "secondary" : "destructive"}>{h.passed ? "pass" : "fail"}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent></Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground py-4 text-center">Nothing flagged 🎉</p>;
}

function PathList({ items }: { items: string[] }) {
  if (items.length === 0) return <Card><CardContent className="pt-6"><Empty /></CardContent></Card>;
  return (
    <Card><CardContent className="pt-6">
      <ul className="space-y-1 text-sm">
        {items.map(p => (
          <li key={p} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted">
            <code>{p}</code>
            <div className="flex gap-1">
              <Button asChild size="sm" variant="ghost">
                <Link to={focusLink(p)}>
                  <Crosshair className="h-3 w-3 mr-1" /> focus
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link to={p}>open <ExternalLink className="h-3 w-3 ml-1" /></Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </CardContent></Card>
  );
}

function HitList({ items }: { items: Array<{ file: string; line: number; kind: string; target?: string }> }) {
  if (items.length === 0) return <Card><CardContent className="pt-6"><Empty /></CardContent></Card>;
  return (
    <Card><CardContent className="pt-6">
      <ul className="space-y-1 text-sm">
        {items.map((h, i) => (
          <li key={i} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted">
            <span>
              <Badge variant="outline" className="mr-2 font-mono text-xs">{h.kind}</Badge>
              <code>{h.file}:{h.line}</code>
              {h.target ? <span className="ml-2 text-muted-foreground">→ {h.target}</span> : null}
            </span>
            <div className="flex gap-1">
              {h.target ? (
                <Button asChild size="sm" variant="ghost">
                  <Link to={focusLink(h.target)}>
                    <Crosshair className="h-3 w-3 mr-1" /> focus target
                  </Link>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="ghost">
                <Link to={fileFocusLink(h.file, h.line)}>
                  <ExternalLink className="h-3 w-3 mr-1" /> locate button
                </Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </CardContent></Card>
  );
}
