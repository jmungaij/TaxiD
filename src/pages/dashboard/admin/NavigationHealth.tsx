import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { certifyJourneys } from "@/lib/platform/journeyCertification";
import { navigationExecutiveKpis } from "@/lib/platform/navigationGovernance";

interface HealthSummary {
  window_hours: number;
  total_nav: number;
  failed_nav: number;
  top_failed_routes: { route: string; hits: number; last_error: string | null }[];
  top_failed_elements: { element_id: string; page_route: string | null; hits: number; last_error: string | null }[];
  dead_routes: { route: string; hits: number }[];
}

export default function NavigationHealth() {
  const [data, setData] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("navigation_health_summary", { _hours: 24 });
        if (!alive) return;
        if (error) throw error;
        setData(data as unknown as HealthSummary);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const journeys = certifyJourneys();
  const kpis = navigationExecutiveKpis();
  const journeyCompletion = kpis.find((k) => k.key === "journey_completion")?.value ?? 0;
  const journeyExceptions = kpis.find((k) => k.key === "journey_exceptions")?.value ?? 0;
  const failureRate = data && data.total_nav ? Math.round((data.failed_nav / data.total_nav) * 1000) / 10 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Navigation Health</h1>
        <p className="text-muted-foreground text-sm">Route governance, business journey certification and live navigation telemetry.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle>User journey completion</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{journeyCompletion}%</CardContent></Card>
        <Card><CardHeader><CardTitle>Certified business journeys</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{journeys.certifiedJourneys}/{journeys.totalJourneys}</CardContent></Card>
        <Card><CardHeader><CardTitle>Documented exceptions</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{journeyExceptions}</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Business journey certification matrix</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {journeys.journeys.map((j) => (
              <li key={j.key} className="border-b pb-3 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{j.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.persona} · owner {j.executiveOwner} · {j.steps} steps · KPI {j.kpi}
                    </p>
                    <p className="text-xs text-muted-foreground">Outcome: {j.outcome}</p>
                  </div>
                  <Badge variant={j.status === "certified" ? "outline" : "destructive"}>{j.status}</Badge>
                </div>
                {j.issues.length > 0 && (
                  <p className="mt-1 text-xs text-destructive">{j.issues.join(", ")}</p>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {loading && <Skeleton className="h-64 w-full" />}
      {error && <p className="text-destructive">{error}</p>}
      {!loading && !error && data && (
      <>
      <p className="text-sm text-muted-foreground">Last {data.window_hours}h of navigation_logs and ui_events.</p>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle>Total navigations</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{data.total_nav}</CardContent></Card>
        <Card><CardHeader><CardTitle>Failed</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{data.failed_nav}</CardContent></Card>
        <Card><CardHeader><CardTitle>Failure rate</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{failureRate}%</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top failing routes</CardTitle></CardHeader>
        <CardContent>
          {data.top_failed_routes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failures.</p>
          ) : (
            <ul className="space-y-2">
              {data.top_failed_routes.map(r => (
                <li key={r.route} className="flex items-center justify-between border-b pb-2 text-sm">
                  <span className="font-mono">{r.route}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{r.last_error}</Badge>
                    <Badge variant="destructive">{r.hits}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Dead routes (visits to unregistered paths)</CardTitle></CardHeader>
        <CardContent>
          {data.dead_routes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dead routes detected.</p>
          ) : (
            <ul className="space-y-2">
              {data.dead_routes.map(r => (
                <li key={r.route} className="flex items-center justify-between border-b pb-2 text-sm">
                  <span className="font-mono">{r.route}</span>
                  <Badge variant="destructive">{r.hits}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Top failing elements</CardTitle></CardHeader>
        <CardContent>
          {data.top_failed_elements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No element failures.</p>
          ) : (
            <ul className="space-y-2">
              {data.top_failed_elements.map(r => (
                <li key={`${r.page_route}-${r.element_id}`} className="flex items-center justify-between border-b pb-2 text-sm">
                  <span><span className="font-mono">{r.element_id}</span> <span className="text-muted-foreground">on {r.page_route ?? "-"}</span></span>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{r.last_error}</Badge>
                    <Badge variant="destructive">{r.hits}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}
