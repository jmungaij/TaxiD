/**
 * Slice D5 — Continuous Qualification governance + Forecast accuracy panel.
 *
 * Mounted inside the Forensics tab. Provides:
 *  • recent nightly qualification runs with a one-click Rerun action
 *    (writes to payment_continuous_qualification_reruns; picked up by worker)
 *  • forecast accuracy / drift table (MAPE, drift flags)
 *
 * Server-side RBAC is enforced by the RPC + RLS — this UI is display-only.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, GaugeCircle } from "lucide-react";

interface QualRun { id: string; chain_key: string; status: string; passed: number | null; failed: number | null; started_at: string; }
interface AccuracyRow { id: string; metric: string; predicted_value: number; actual_value: number; percent_error: number | null; drift_flag: boolean; window_end: string; }

export default function QualificationGovernancePanel() {
  const [runs, setRuns] = useState<QualRun[]>([]);
  const [accuracy, setAccuracy] = useState<AccuracyRow[]>([]);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Workstream 3: consume the versioned RPC (get_qualification_governance_overview)
  // instead of base tables. The RPC returns { schema_version, runs, accuracy }.
  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc(
      "get_qualification_governance_overview" as any,
      { _limit: 10 },
    );
    if (error) {
      toast({ title: "Failed to load governance data", description: error.message, variant: "destructive" });
      setRuns([]); setAccuracy([]); setLoading(false);
      return;
    }
    const payload = (data ?? {}) as { runs?: QualRun[]; accuracy?: AccuracyRow[] };
    setRuns(payload.runs ?? []);
    setAccuracy(payload.accuracy ?? []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const rerun = async () => {
    if (!selected) return;
    if (reason.trim().length < 4) { toast({ title: "Reason required (≥ 4 chars)" }); return; }
    const { error } = await supabase.rpc("payment_continuous_qualification_rerun" as any, {
      _original_run_id: selected, _reason: reason,
    });
    if (error) { toast({ title: "Rerun failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Rerun queued" });
    setReason(""); setSelected(null);
    void load();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            <h4 className="font-medium text-sm">Continuous Qualification — Manual Rerun</h4>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>Refresh</Button>
        </div>
        <div className="space-y-1 max-h-56 overflow-y-auto text-xs">
          {runs.map(r => (
            <label key={r.id} className={`flex items-center justify-between border rounded px-2 py-1 cursor-pointer ${selected === r.id ? "bg-muted" : ""}`}>
              <span className="flex items-center gap-2">
                <input type="radio" name="qual-run" checked={selected === r.id} onChange={() => setSelected(r.id)} />
                <span className="font-mono">{r.chain_key}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant={r.status === "PASSED" ? "default" : r.status === "FAILED" ? "destructive" : "secondary"}>
                  {r.status}
                </Badge>
                <span className="text-muted-foreground">{new Date(r.started_at).toLocaleString()}</span>
              </span>
            </label>
          ))}
          {!runs.length && <div className="text-muted-foreground">No runs recorded yet.</div>}
        </div>
        <div className="mt-3 flex gap-2">
          <Input placeholder="Reason (auditable)" value={reason} onChange={e => setReason(e.target.value)} />
          <Button size="sm" disabled={!selected || reason.trim().length < 4} onClick={rerun}>Queue rerun</Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <GaugeCircle className="h-4 w-4" />
          <h4 className="font-medium text-sm">Forecast Accuracy & Drift</h4>
        </div>
        <div className="space-y-1 max-h-72 overflow-y-auto text-xs">
          {accuracy.map(a => (
            <div key={a.id} className="flex items-center justify-between border rounded px-2 py-1">
              <span className="font-mono">{a.metric}</span>
              <span className="text-muted-foreground">pred {Number(a.predicted_value).toFixed(2)} / act {Number(a.actual_value).toFixed(2)}</span>
              <Badge variant={a.drift_flag ? "destructive" : "secondary"}>
                {a.percent_error == null ? "—" : `${Number(a.percent_error).toFixed(1)}%`}
              </Badge>
            </div>
          ))}
          {!accuracy.length && <div className="text-muted-foreground">No accuracy samples yet.</div>}
        </div>
      </Card>
    </div>
  );
}
