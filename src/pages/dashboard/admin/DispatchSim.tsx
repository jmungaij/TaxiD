import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FlaskConical, Play, GitCompareArrows, RefreshCw } from "lucide-react";

interface ResultRow {
  id: string;
  scenario_id: string;
  rule_version: string | null;
  total_requests: number;
  assigned: number;
  no_supply: number;
  avg_score: number;
  avg_eta_seconds: number;
  details: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
}

const FACTORS = [
  "proximity", "eta", "driver_rating", "acceptance_rate",
  "completion_rate", "idle_time", "vehicle_match", "surge_alignment",
] as const;
const DEFAULT_WEIGHTS: Record<string, number> = {
  proximity: 0.25, eta: 0.2, driver_rating: 0.1, acceptance_rate: 0.15,
  completion_rate: 0.1, idle_time: 0.1, vehicle_match: 0.05, surge_alignment: 0.05,
};

function rateOf(r: ResultRow): number {
  return r.total_requests > 0 ? r.assigned / r.total_requests : 0;
}
function noSupplyRateOf(r: ResultRow): number {
  return r.total_requests > 0 ? r.no_supply / r.total_requests : 0;
}
function p95(r: ResultRow): number {
  const v = (r.details as { p95_wait_seconds?: number } | null)?.p95_wait_seconds;
  return typeof v === "number" ? v : 0;
}

export default function DispatchSim() {
  const [seed, setSeed] = useState("42");
  const [ticks, setTicks] = useState("30");
  const [demand, setDemand] = useState("8");
  const [supply, setSupply] = useState("40");
  const [surgeMode, setSurgeMode] = useState<"off" | "current" | "synthetic">("off");
  const [weights, setWeights] = useState<Record<string, number>>({ ...DEFAULT_WEIGHTS });
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const refresh = async () => {
    const { data: r } = await supabase.from("dispatch_sim_results").select("*")
      .order("started_at", { ascending: false }).limit(50);
    setResults((r ?? []) as unknown as ResultRow[]);
  };
  useEffect(() => { refresh(); }, []);

  const sumWeights = Object.values(weights).reduce((a, b) => a + b, 0);
  const weightsValid = Math.abs(sumWeights - 1) < 0.01;

  const run = async () => {
    if (!weightsValid) { toast.error(`Weights sum to ${sumWeights.toFixed(2)}, must be 1.00`); return; }
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("dispatch-simulator", {
        body: {
          scenario: {
            seed: parseInt(seed) || 42,
            ticks: parseInt(ticks) || 30,
            demand_per_tick: parseInt(demand) || 8,
            supply_pool: parseInt(supply) || 40,
            surge_mode: surgeMode,
            weights,
          },
        },
      });
      if (error) throw error;
      toast.success("Simulation complete");
      await refresh();
    } catch (e) {
      toast.error(`Simulation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else if (next.size < 3) next.add(id);
    setSelected(next);
  };
  const compared = results.filter((r) => selected.has(r.id));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FlaskConical className="h-6 w-6 text-ai" />
          Dispatch Simulator
        </h1>
        <p className="text-sm text-muted-foreground">
          Replay synthetic demand against any weight configuration and compare runs.
        </p>
      </div>

      <Tabs defaultValue="run">
        <TabsList>
          <TabsTrigger value="run"><Play className="h-4 w-4 mr-1" /> Run</TabsTrigger>
          <TabsTrigger value="compare">
            <GitCompareArrows className="h-4 w-4 mr-1" /> Compare ({selected.size})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="run" className="space-y-6">
          <Card className="p-4">
            <h2 className="font-semibold mb-3">Scenario controls</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <Field label="Seed"><Input value={seed} onChange={(e) => setSeed(e.target.value)} /></Field>
              <Field label="Ticks (min)"><Input value={ticks} onChange={(e) => setTicks(e.target.value)} /></Field>
              <Field label="Demand / tick"><Input value={demand} onChange={(e) => setDemand(e.target.value)} /></Field>
              <Field label="Supply pool"><Input value={supply} onChange={(e) => setSupply(e.target.value)} /></Field>
              <Field label="Surge mode">
                <select value={surgeMode}
                        onChange={(e) => setSurgeMode(e.target.value as typeof surgeMode)}
                        className="border rounded px-2 py-1 text-sm h-9 w-full">
                  <option value="off">off</option>
                  <option value="current">current</option>
                  <option value="synthetic">synthetic</option>
                </select>
              </Field>
            </div>

            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">Rule weights</h3>
                <Badge variant={weightsValid ? "outline" : "destructive"}>
                  Σ = {sumWeights.toFixed(2)}
                </Badge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {FACTORS.map((f) => (
                  <Field key={f} label={f}>
                    <Input type="number" step="0.05" min="0" max="1"
                           value={weights[f]}
                           onChange={(e) => setWeights({ ...weights, [f]: parseFloat(e.target.value) || 0 })} />
                  </Field>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}>
                  Reset defaults
                </Button>
                <Button size="sm" onClick={run} disabled={running || !weightsValid}>
                  <Play className="h-4 w-4 mr-1" />
                  {running ? "Running…" : "Run simulation"}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Recent runs</h2>
              <Button size="sm" variant="ghost" onClick={refresh}>
                <RefreshCw className="h-4 w-4 mr-1" /> Refresh
              </Button>
            </div>
            {results.length === 0 ? (
              <div className="text-sm text-muted-foreground italic py-6 text-center">
                No runs yet. Run a scenario above.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="py-2 w-8"></th>
                      <th>When</th>
                      <th>Reqs</th>
                      <th>Assign %</th>
                      <th>No supply %</th>
                      <th>Avg score</th>
                      <th>Avg ETA</th>
                      <th>p95 wait</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.id} className="border-b hover:bg-muted/40">
                        <td>
                          <Checkbox checked={selected.has(r.id)}
                                    onCheckedChange={() => toggleSelect(r.id)}
                                    aria-label={`Select run ${r.id.slice(0, 8)}`} />
                        </td>
                        <td className="py-1">{new Date(r.started_at).toLocaleString()}</td>
                        <td>{r.total_requests}</td>
                        <td>{(rateOf(r) * 100).toFixed(1)}%</td>
                        <td>{(noSupplyRateOf(r) * 100).toFixed(1)}%</td>
                        <td>{Number(r.avg_score).toFixed(3)}</td>
                        <td>{r.avg_eta_seconds}s</td>
                        <td>{p95(r)}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="compare">
          <Card className="p-4">
            <h2 className="font-semibold mb-3">Side-by-side</h2>
            {compared.length < 2 ? (
              <div className="text-sm text-muted-foreground italic py-6 text-center">
                Select 2–3 runs from the Run tab to compare.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="py-2">Metric</th>
                      {compared.map((r) => (
                        <th key={r.id}>
                          <div className="font-mono text-[10px]">{r.id.slice(0, 8)}</div>
                          <div className="text-muted-foreground font-normal">
                            {new Date(r.started_at).toLocaleTimeString()}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <CompareRow label="Total requests" runs={compared} get={(r) => r.total_requests} />
                    <CompareRow label="Assignment rate" runs={compared} fmt={(v) => `${(Number(v) * 100).toFixed(1)}%`} get={(r) => rateOf(r)} />
                    <CompareRow label="No-supply rate" runs={compared} fmt={(v) => `${(Number(v) * 100).toFixed(1)}%`} get={(r) => noSupplyRateOf(r)} />
                    <CompareRow label="Avg score" runs={compared} get={(r) => Number(r.avg_score).toFixed(3)} />
                    <CompareRow label="Avg ETA (s)" runs={compared} get={(r) => r.avg_eta_seconds} />
                    <CompareRow label="p95 wait (s)" runs={compared} get={(r) => p95(r)} />
                  </tbody>
                </table>

                <h3 className="font-semibold mt-6 mb-2 text-sm">Weight diff</h3>
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b"><tr className="text-left">
                      <th className="py-2">Factor</th>
                      {compared.map((r) => <th key={r.id} className="font-mono text-[10px]">{r.id.slice(0, 8)}</th>)}
                    </tr></thead>
                    <tbody>
                      {FACTORS.map((f) => (
                        <tr key={f} className="border-b">
                          <td className="py-1">{f}</td>
                          {compared.map((r) => {
                            const w = ((r.details?.weights as Record<string, number>) ?? DEFAULT_WEIGHTS)[f];
                            const def = DEFAULT_WEIGHTS[f];
                            const diff = w - def;
                            return (
                              <td key={r.id}>
                                {w?.toFixed(2)}
                                {Math.abs(diff) > 0.001 && (
                                  <span className={`ml-1 text-[10px] ${diff > 0 ? "text-status-success" : "text-status-danger"}`}>
                                    {diff > 0 ? "+" : ""}{diff.toFixed(2)}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function CompareRow<T extends ResultRow>({
  label, runs, get, fmt,
}: {
  label: string; runs: T[]; get: (r: T) => number | string;
  fmt?: (v: number | string) => string;
}) {
  return (
    <tr className="border-b">
      <td className="py-1 font-medium">{label}</td>
      {runs.map((r) => {
        const v = get(r);
        return <td key={r.id}>{fmt ? fmt(v) : v}</td>;
      })}
    </tr>
  );
}
