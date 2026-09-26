/**
 * Phase D5.1 — Continuous Qualification Panel
 *
 * Live view of the 14-step payment lifecycle certification runs, per-step
 * traces, failure classification, financial-integrity scoring, evidence
 * pack downloads, and the D5.1 exit-gate streak counter.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, PlayCircle, ShieldCheck, Download, AlertTriangle, CheckCircle2, Activity } from "lucide-react";
import { ReadinessV2Card } from "@/components/dashboard/ReadinessV2Card";
import { AppButton } from "@/components/nav/AppButton";

interface CQRun {
  id: string;
  chain_key: string;
  status: string;
  triggered_at: string;
  completed_at: string | null;
  passed_steps: number | null;
  failed_steps: number | null;
  failure_class: string | null;
  financial_integrity_score: number | null;
  reliability_score: number | null;
  correlation_id: string | null;
  evidence_pack_id: string | null;
}
interface StepTrace {
  id: string; step_index: number; step_name: string; status: string;
  latency_ms: number | null; error_message: string | null;
  evidence_ref: Record<string, unknown> | null;
}
interface Streak { consecutive_passes: number | null; last_pass_at: string | null }
interface Eligibility {
  eligible: boolean;
  blockers: Array<{ code: string; detail?: unknown; count?: number; pass_rate?: number; required?: string }>;
  stability_windows: Record<string, { passing?: boolean; success_rate?: number; total_runs?: number }>;
  critical_incidents_72h: number;
  chaos_pass_rate: number;
}
interface GateV2 {
  eligibility: {
    eligible: boolean;
    pci_score: number;
    pci_streak_days: number;
    config_certification_ok: boolean;
    replay_certification_ok: boolean;
    critical_incidents_72h: number;
    blockers: string[];
  } | null;
  pci_streak: { current_days: number; best_days: number; last_score: number; last_computed_at: string } | null;
  latest_config_certification: { passed: boolean; ran_at: string; failure_reason: string | null; drift_from_baseline: Record<string, unknown> } | null;
  latest_replay_certification: { status: string; critical: boolean; diverged: number; sample_size: number; started_at: string; finished_at: string | null } | null;
  latest_confidence_report: { confidence_pct: number; can_process_production_money: boolean; generated_at: string; reasons: Array<{ label: string; value: string; positive: boolean }> } | null;
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    PASSED: "bg-status-success/15 text-status-success border-status-success/30",
    FAILED: "bg-status-danger/15 text-status-danger border-status-danger/30",
    ERROR:  "bg-status-danger/15 text-status-danger border-status-danger/30",
    RUNNING:"bg-ai/15 text-ai border-ai/30",
    PENDING:"bg-muted text-muted-foreground",
    SKIPPED:"bg-muted text-muted-foreground",
  };
  return <Badge variant="outline" className={map[s] ?? ""}>{s}</Badge>;
}

export default function ContinuousQualificationPanel() {
  const [runs, setRuns] = useState<CQRun[]>([]);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [selected, setSelected] = useState<CQRun | null>(null);
  const [steps, setSteps] = useState<StepTrace[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [gateV2, setGateV2] = useState<GateV2 | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, s, e, g] = await Promise.all([
      supabase.from("payment_continuous_qualification_runs" as any)
        .select("id,chain_key,status,triggered_at,completed_at,passed_steps,failed_steps,failure_class,financial_integrity_score,reliability_score,correlation_id,evidence_pack_id")
        .order("triggered_at", { ascending: false })
        .limit(20),
      supabase.from("payment_qualification_streak" as any).select("*").maybeSingle(),
      supabase.rpc("payment_promotion_eligibility" as any),
      supabase.functions.invoke("payment-promotion-gate-v2", { body: {} }),
    ]);
    setRuns((r.data as unknown as CQRun[]) ?? []);
    setStreak((s.data as unknown as Streak) ?? null);
    setEligibility((e.data as unknown as Eligibility) ?? null);
    setGateV2(((g as { data?: GateV2 })?.data) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("cq-runs")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_continuous_qualification_runs" },
        () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  const openDetail = async (run: CQRun) => {
    setSelected(run);
    const { data } = await supabase.from("payment_qualification_step_traces" as any)
      .select("id,step_index,step_name,status,latency_ms,error_message,evidence_ref")
      .eq("cq_run_id", run.id)
      .order("step_index");
    setSteps((data as unknown as StepTrace[]) ?? []);
  };

  const trigger = async () => {
    setTriggering(true);
    try {
      const { error } = await supabase.functions.invoke("payment-continuous-qualification", {
        body: { triggered_by: "manual_admin" },
      });
      if (error) throw error;
      toast({ title: "Qualification cycle started" });
      setTimeout(() => void load(), 1500);
    } catch (e) {
      toast({ title: "Failed to trigger", description: (e as Error).message, variant: "destructive" });
    } finally { setTriggering(false); }
  };

  const downloadPack = async (run: CQRun) => {
    if (!run.evidence_pack_id) { toast({ title: "No evidence pack yet" }); return; }
    const { data, error } = await supabase.from("payment_qualification_evidence_packs" as any)
      .select("*").eq("id", run.evidence_pack_id).maybeSingle();
    if (error || !data) { toast({ title: "Download failed", description: error?.message, variant: "destructive" }); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `qualification-evidence-${run.id}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const consecutive = streak?.consecutive_passes ?? 0;
  const gateGreen = consecutive >= 5;

  return (
    <div className="space-y-4">
      <ReadinessV2Card />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle>Continuous Qualification — 14-step Lifecycle</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={trigger} disabled={triggering}>
              <PlayCircle className="h-4 w-4 mr-1" /> Run now
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Exit-gate strip */}
          <div className={`p-3 rounded-md border flex items-center justify-between ${gateGreen ? "bg-status-success/5 border-status-success/30" : "bg-status-warning/5 border-status-warning/30"}`}>
            <div className="flex items-center gap-2">
              {gateGreen ? <CheckCircle2 className="h-5 w-5 text-status-success" /> : <AlertTriangle className="h-5 w-5 text-status-warning" />}
              <div>
                <div className="font-medium">D5.1 Exit Gate — {consecutive}/5 consecutive successful cycles</div>
                <div className="text-xs text-muted-foreground">
                  Last pass: {streak?.last_pass_at ? new Date(streak.last_pass_at).toLocaleString() : "—"}
                </div>
              </div>
            </div>
            <Badge className={gateGreen ? "bg-status-success" : "bg-status-warning"}>
              {gateGreen ? "GREEN" : "STABILIZING"}
            </Badge>
          </div>

          {/* D5.2 Promotion Eligibility strip */}
          {eligibility && (
            <div className={`p-3 rounded-md border ${eligibility.eligible ? "bg-status-success/5 border-status-success/30" : "bg-status-danger/5 border-status-danger/30"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className={`h-5 w-5 ${eligibility.eligible ? "text-status-success" : "text-status-danger"}`} />
                  <div className="font-medium">
                    D5.2 Production Promotion — {eligibility.eligible ? "ELIGIBLE" : `${eligibility.blockers?.length ?? 0} blocker(s)`}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Chaos {Math.round(eligibility.chaos_pass_rate ?? 0)}% · Critical 72h: {eligibility.critical_incidents_72h}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {Object.entries(eligibility.stability_windows ?? {}).map(([k, v]) => (
                  <div key={k} className={`rounded border px-2 py-1 ${v?.passing ? "border-status-success/40" : "border-status-warning/40"}`}>
                    <div className="text-muted-foreground uppercase">{k}</div>
                    <div className="font-medium">{v?.total_runs ?? 0} runs · {(v?.success_rate ?? 0).toFixed(2)}%</div>
                  </div>
                ))}
              </div>
              {!eligibility.eligible && eligibility.blockers?.length > 0 && (
                <ul className="mt-2 text-xs text-status-danger space-y-0.5">
                  {eligibility.blockers.slice(0, 5).map((b, i) => (
                    <li key={i}>• {b.code}{b.required ? ` — ${b.required}` : ""}{b.count ? ` (${b.count})` : ""}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* D5.3 Production Confidence Index */}
          {gateV2 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className={`p-3 rounded-md border ${(gateV2.pci_streak?.last_score ?? 0) >= 95 ? "bg-status-success/5 border-status-success/30" : "bg-status-warning/5 border-status-warning/30"}`}>
                <div className="text-xs uppercase text-muted-foreground">PCI (Production Confidence Index)</div>
                <div className="text-2xl font-semibold">{gateV2.pci_streak?.last_score?.toFixed(1) ?? "—"}<span className="text-sm text-muted-foreground">/100</span></div>
                <div className="text-xs mt-1">Streak: <span className="font-medium">{gateV2.pci_streak?.current_days ?? 0}d</span> · Best: {gateV2.pci_streak?.best_days ?? 0}d · Gate needs 14d ≥95</div>
              </div>
              <div className={`p-3 rounded-md border ${gateV2.latest_config_certification?.passed ? "bg-status-success/5 border-status-success/30" : "bg-status-danger/5 border-status-danger/30"}`}>
                <div className="text-xs uppercase text-muted-foreground">Config Qualification</div>
                <div className="text-lg font-medium">{gateV2.latest_config_certification?.passed ? "PASSING" : "DRIFT / FAIL"}</div>
                <div className="text-xs text-muted-foreground">{gateV2.latest_config_certification?.ran_at ? new Date(gateV2.latest_config_certification.ran_at).toLocaleString() : "—"}</div>
                {gateV2.latest_config_certification?.failure_reason && (
                  <div className="text-xs text-status-danger mt-1 truncate">{gateV2.latest_config_certification.failure_reason}</div>
                )}
              </div>
              <div className={`p-3 rounded-md border ${gateV2.latest_replay_certification?.critical ? "bg-status-danger/5 border-status-danger/30" : "bg-status-success/5 border-status-success/30"}`}>
                <div className="text-xs uppercase text-muted-foreground">Weekly Replay Certification</div>
                <div className="text-lg font-medium">
                  {gateV2.latest_replay_certification
                    ? `${gateV2.latest_replay_certification.sample_size - gateV2.latest_replay_certification.diverged}/${gateV2.latest_replay_certification.sample_size} matched`
                    : "not yet run"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {gateV2.latest_replay_certification?.finished_at ? new Date(gateV2.latest_replay_certification.finished_at).toLocaleString() : "—"}
                </div>
              </div>
            </div>
          )}

          {/* D5.3 Confidence Narrative */}
          {gateV2?.latest_confidence_report && (
            <details className={`p-3 rounded-md border ${gateV2.latest_confidence_report.can_process_production_money ? "bg-status-success/5 border-status-success/30" : "bg-status-warning/5 border-status-warning/30"}`}>
              <summary className="cursor-pointer flex items-center justify-between">
                <div className="font-medium">
                  Confidence Narrative — {gateV2.latest_confidence_report.confidence_pct.toFixed(1)}% ·{" "}
                  {gateV2.latest_confidence_report.can_process_production_money ? "SAFE to process production money" : "NOT ready for production money"}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(gateV2.latest_confidence_report.generated_at).toLocaleString()}
                </span>
              </summary>
              <ul className="mt-2 text-xs space-y-1">
                {gateV2.latest_confidence_report.reasons.map((r, i) => (
                  <li key={i} className="flex items-center gap-2">
                    {r.positive
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-status-success" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-status-warning" />}
                    <span className="text-muted-foreground">{r.label}:</span>
                    <span className="font-medium">{r.value}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b text-muted-foreground">
                  <th className="py-2 px-2">Triggered</th>
                  <th className="px-2">Status</th>
                  <th className="px-2">Steps</th>
                  <th className="px-2">Fin. Integrity</th>
                  <th className="px-2">Failure Class</th>
                  <th className="px-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 px-2 whitespace-nowrap">{new Date(r.triggered_at).toLocaleString()}</td>
                    <td className="px-2">{statusBadge(r.status)}</td>
                    <td className="px-2">{r.passed_steps ?? 0}/{(r.passed_steps ?? 0) + (r.failed_steps ?? 0)}</td>
                    <td className="px-2">
                      {r.financial_integrity_score != null
                        ? <Badge variant="outline" className={r.financial_integrity_score >= 100 ? "border-status-success/40 text-status-success" : "border-status-warning/40 text-status-warning"}>
                            {r.financial_integrity_score}
                          </Badge>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2">{r.failure_class ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => void openDetail(r)}>Details</Button>
                      <AppButton analytics="admin_qualification_evidence_pack_download" action="submit" size="sm" variant="ghost" aria-label="Download qualification evidence pack" title="Download qualification evidence pack" onClick={() => void downloadPack(r)} disabled={!r.evidence_pack_id}>
                        <Download className="h-4 w-4" />
                      </AppButton>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && !loading && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No qualification runs yet. Click <em>Run now</em> to start.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Lifecycle trace — {selected?.correlation_id ?? selected?.id}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {steps.map(s => (
              <div key={s.id} className="flex items-start justify-between gap-3 p-2 rounded border bg-card">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-6">{s.step_index + 1}.</span>
                    <span className="font-medium">{s.step_name}</span>
                    {statusBadge(s.status)}
                  </div>
                  {s.error_message && (
                    <div className="text-xs text-status-danger mt-1 ml-8">{s.error_message}</div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {s.latency_ms != null ? `${s.latency_ms} ms` : "—"}
                </div>
              </div>
            ))}
            {steps.length === 0 && <div className="text-center text-muted-foreground py-6">No traces recorded.</div>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
