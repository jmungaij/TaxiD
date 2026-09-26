import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { SeoHead } from "@/components/seo/SeoHead";

type Row = Record<string, unknown>;

function useAdminTable(table: string, opts?: { orderBy?: string; limit?: number }) {
  return useQuery({
    queryKey: ["ml-platform", table, opts],
    queryFn: async () => {
      let q = supabase.from(table as never).select("*").limit(opts?.limit ?? 100);
      if (opts?.orderBy) q = q.order(opts.orderBy, { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 30_000,
  });
}

function StatusBadge({ value }: { value: unknown }) {
  const s = String(value ?? "").toLowerCase();
  const variant: "default" | "secondary" | "destructive" | "outline" =
    s === "production" || s === "approved" || s === "completed" || s === "active" || s === "running"
      ? "default"
      : s === "failed" || s === "rolled_back" || s === "drift_detected"
      ? "destructive"
      : s === "registered" || s === "draft" || s === "queued"
      ? "secondary"
      : "outline";
  return <Badge variant={variant}>{String(value ?? "—")}</Badge>;
}

export default function MLPlatform() {
  const models = useAdminTable("ml_model_registry", { orderBy: "updated_at" });
  const deployments = useAdminTable("ml_model_deployments", { orderBy: "rollout_started_at" });
  const predictions = useAdminTable("ml_predictions", { orderBy: "created_at", limit: 200 });
  const drift = useAdminTable("ml_drift_metrics", { orderBy: "window_end", limit: 200 });
  const experiments = useAdminTable("ml_experiments", { orderBy: "updated_at" });
  const training = useAdminTable("ml_training_runs", { orderBy: "created_at", limit: 100 });

  const driftCount = drift.data?.filter((r) => r.is_drift_detected).length ?? 0;
  const activeDeploys = deployments.data?.filter((r) => r.is_active).length ?? 0;
  const runningExps = experiments.data?.filter((r) => String(r.status) === "running").length ?? 0;
  const recentPredLatency =
    predictions.data && predictions.data.length
      ? Math.round(
          predictions.data
            .slice(0, 50)
            .map((r) => Number(r.latency_ms ?? 0))
            .reduce((a, b) => a + b, 0) / Math.min(50, predictions.data.length),
        )
      : 0;

  return (
    <div className="space-y-6 p-6">
      <SeoHead title="AI/ML Platform · Admin" description="Models, predictions, drift, experiments and training runs." path="/dashboard/admin/ml-platform" />
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI/ML Platform</h1>
          <p className="text-sm text-muted-foreground">Read-only viewer over the ml_* tables.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Active deployments" value={activeDeploys} />
        <StatCard label="Models registered" value={models.data?.length ?? 0} />
        <StatCard label="Drift signals (latest 200)" value={driftCount} tone={driftCount ? "danger" : "ok"} />
        <StatCard label="Running experiments" value={runningExps} />
        <StatCard label="Recent predictions (200)" value={predictions.data?.length ?? 0} />
        <StatCard label="Avg prediction latency" value={`${recentPredLatency} ms`} />
      </div>

      <Tabs defaultValue="models">
        <TabsList>
          <TabsTrigger value="models">Model Registry</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          <TabsTrigger value="predictions">Predictions</TabsTrigger>
          <TabsTrigger value="drift">Drift</TabsTrigger>
          <TabsTrigger value="experiments">Experiments</TabsTrigger>
          <TabsTrigger value="training">Training Runs</TabsTrigger>
        </TabsList>

        <TabsContent value="models">
          <DataCard title="Model Registry" rows={models.data}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead><TableHead>Version</TableHead><TableHead>Use case</TableHead>
                  <TableHead>Framework</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.data?.map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell className="font-medium">{String(r.model_name)}</TableCell>
                    <TableCell>{String(r.version)}</TableCell>
                    <TableCell>{String(r.use_case)}</TableCell>
                    <TableCell>{String(r.framework ?? "—")}</TableCell>
                    <TableCell><StatusBadge value={r.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(r.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="deployments">
          <DataCard title="Model Deployments" rows={deployments.data}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Use case</TableHead><TableHead>Env</TableHead><TableHead>Traffic %</TableHead>
                  <TableHead>Canary</TableHead><TableHead>Active</TableHead><TableHead>Rolled out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.data?.map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell className="font-medium">{String(r.use_case)}</TableCell>
                    <TableCell>{String(r.environment)}</TableCell>
                    <TableCell>{String(r.traffic_pct)}%</TableCell>
                    <TableCell>{r.is_canary ? "yes" : "no"}</TableCell>
                    <TableCell><StatusBadge value={r.is_active ? "active" : "inactive"} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(r.rollout_started_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="predictions">
          <DataCard title="Recent Predictions" rows={predictions.data}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Use case</TableHead><TableHead>Entity</TableHead><TableHead>Confidence</TableHead>
                  <TableHead>Latency</TableHead><TableHead>Env</TableHead><TableHead>At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {predictions.data?.slice(0, 100).map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell>{String(r.use_case)}</TableCell>
                    <TableCell className="text-xs">{String(r.entity_type ?? "—")}:{String(r.entity_id ?? "—")}</TableCell>
                    <TableCell>{r.confidence != null ? Number(r.confidence).toFixed(3) : "—"}</TableCell>
                    <TableCell>{r.latency_ms != null ? `${r.latency_ms} ms` : "—"}</TableCell>
                    <TableCell>{String(r.served_environment ?? "—")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(r.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="drift">
          <DataCard title="Drift Metrics" rows={drift.data}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Feature</TableHead><TableHead>Metric</TableHead><TableHead>Value</TableHead>
                  <TableHead>Threshold</TableHead><TableHead>Drift?</TableHead><TableHead>Window</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drift.data?.map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell className="font-medium">{String(r.feature_name ?? "—")}</TableCell>
                    <TableCell>{String(r.metric_type)}</TableCell>
                    <TableCell>{Number(r.metric_value).toFixed(4)}</TableCell>
                    <TableCell>{r.threshold != null ? Number(r.threshold).toFixed(4) : "—"}</TableCell>
                    <TableCell>
                      {r.is_drift_detected ? <Badge variant="destructive">drift</Badge> : <Badge variant="outline">ok</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(r.window_end)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="experiments">
          <DataCard title="Experiments" rows={experiments.data}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead><TableHead>Use case</TableHead><TableHead>Primary metric</TableHead>
                  <TableHead>Status</TableHead><TableHead>Winner</TableHead><TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {experiments.data?.map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell className="font-medium">{String(r.name)}</TableCell>
                    <TableCell>{String(r.use_case ?? "—")}</TableCell>
                    <TableCell>{String(r.primary_metric)}</TableCell>
                    <TableCell><StatusBadge value={r.status} /></TableCell>
                    <TableCell>{String(r.winner ?? "—")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(r.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="training">
          <DataCard title="Training Runs" rows={training.data}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead><TableHead>Run</TableHead><TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead><TableHead>Dataset</TableHead><TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {training.data?.map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell className="font-medium">{String(r.model_name)}</TableCell>
                    <TableCell>{String(r.run_name ?? "—")}</TableCell>
                    <TableCell><StatusBadge value={r.status} /></TableCell>
                    <TableCell>{r.duration_seconds != null ? `${r.duration_seconds}s` : "—"}</TableCell>
                    <TableCell className="text-xs">{String(r.dataset_ref ?? "—")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(r.started_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: "ok" | "danger" }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className={`mt-2 text-2xl font-bold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function DataCard({ title, rows, children }: { title: string; rows?: Row[]; children: React.ReactNode }) {
  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <span className="text-xs text-muted-foreground">{rows?.length ?? 0} rows</span>
      </CardHeader>
      <CardContent>
        {rows?.length === 0 ? <div className="text-sm text-muted-foreground">No data.</div> : children}
      </CardContent>
    </Card>
  );
}

function fmt(v: unknown) {
  if (!v) return "—";
  try { return new Date(String(v)).toLocaleString(); } catch { return String(v); }
}
