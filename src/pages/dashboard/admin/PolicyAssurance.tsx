import type { LooseRow } from "@/lib/types/loose";
/**
 * Policy Assurance Framework — admin dashboard.
 * Continuously proves the platform's authorization model is secure by
 * displaying coverage scores, risk register, drift, and generated remediation SQL.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldAlert, PlayCircle, Download, Zap, ShieldOff, ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { computeDrift, toSnapshot } from "@/lib/paf/drift";
import { RemediationReviewModal } from "./RemediationReviewModal";

type Run = {
  id: string; ran_at: string; trigger: string; scores: LooseRow;
  inventory: LooseRow; risk_register: LooseRow[]; remediation: LooseRow[];
  critical_count: number; high_count: number; medium_count: number; low_count: number; passed: boolean;
};

const sevColor: Record<string, string> = {
  critical: "bg-status-danger text-ice",
  high: "bg-status-warning text-ice",
  medium: "bg-status-warning text-ink",
  low: "bg-ai text-ice",
  info: "bg-muted-foreground text-ice",
};

export default function PolicyAssurance() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [streamLog, setStreamLog] = useState<{ step: string; message: string; t: number }[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("paf_runs")
      .select("id,ran_at,trigger,scores,inventory,risk_register,remediation,critical_count,high_count,medium_count,low_count,passed")
      .order("ran_at", { ascending: false }).limit(20);
    setRuns((data as Run[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runScan = async (streaming = false) => {
    setScanning(true);
    setStreamLog([]);
    try {
      if (!streaming) {
        const { data, error } = await supabase.functions.invoke("paf-scan", { body: { trigger: "manual" } });
        if (error) throw error;
        toast.success(`Scan complete — ${data.findings_count} finding(s)`);
        await load();
        return;
      }
      // Streamed run — SSE via fetch
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paf-scan?stream=1&trigger=manual`;
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${sess.session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (!res.body) throw new Error("No stream response");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const eventMatch = p.match(/event: (\w+)/);
          const dataMatch = p.match(/data: (.+)/);
          if (!eventMatch || !dataMatch) continue;
          const evt = eventMatch[1];
          try {
            const payload = JSON.parse(dataMatch[1]);
            if (evt === "phase") {
              setStreamLog((L) => [...L, { step: payload.step, message: payload.message, t: Date.now() }]);
            } else if (evt === "done") {
              toast.success(`Scan complete — ${payload.findings_count} finding(s)`);
            } else if (evt === "error") {
              toast.error(payload.message ?? "Scan failed");
            }
          } catch { /* ignore */ }
        }
      }
      await load();
    } catch (e: LooseRow) {
      toast.error(e.message ?? "Scan failed");
    } finally { setScanning(false); }
  };

  const latest = runs[0];
  const previous = runs[1];
  const drift = useMemo(() => {
    if (!latest) return null;
    return computeDrift(previous ? toSnapshot(previous.inventory) : null, toSnapshot(latest.inventory));
  }, [latest, previous]);

  const downloadReport = () => {
    if (!latest) return;
    const blob = new Blob([JSON.stringify(latest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `paf-run-${latest.id}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <ShieldCheck className="text-primary" /> Policy Assurance Framework
            </h1>
            <p className="text-muted-foreground">Continuous authorization governance for TaxiD.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runScan(true)} disabled={scanning} variant="default">
              {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
              Run policy scan now
            </Button>
            <Button onClick={() => runScan(false)} disabled={scanning} variant="outline">
              <PlayCircle className="mr-2 h-4 w-4" /> Quick scan
            </Button>
            <Button variant="outline" onClick={() => setReviewOpen(true)} disabled={!latest?.remediation?.length}>
              <ClipboardCheck className="mr-2 h-4 w-4" /> Review remediation
            </Button>
            <Button data-analytics="policyassurance.export_json" variant="outline" onClick={downloadReport} disabled={!latest}>
              <Download className="mr-2 h-4 w-4" /> Export JSON
            </Button>
            <Button asChild variant="outline">
              <Link to="/dashboard/admin/policy-exceptions"><ShieldOff className="mr-2 h-4 w-4" /> Exceptions</Link>
            </Button>
          </div>
        </div>

        {streamLog.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Live scan progress</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-40 bg-muted-foreground text-muted-foreground rounded p-2 font-mono text-xs">
                {streamLog.map((l, i) => (
                  <div key={i}><span className="text-status-success">[{l.step}]</span> {l.message}</div>
                ))}
                {scanning && <div className="text-status-warning">▌ running…</div>}
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {loading && <Loader2 className="animate-spin" />}

        {latest && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ScoreCard label="RLS Coverage" value={latest.scores.rls_coverage_pct} />
              <ScoreCard label="Authorization Health" value={latest.scores.authorization_health} />
              <ScoreCard label="Zero Trust" value={latest.scores.zero_trust_score} />
              <ScoreCard label="Production Readiness" value={latest.scores.production_readiness} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge className={sevColor.critical}>Critical: {latest.critical_count}</Badge>
              <Badge className={sevColor.high}>High: {latest.high_count}</Badge>
              <Badge className={sevColor.medium}>Medium: {latest.medium_count}</Badge>
              <Badge className={sevColor.low}>Low: {latest.low_count}</Badge>
              <Badge variant={latest.passed ? "default" : "destructive"}>
                {latest.passed ? "PASSED" : "BLOCKED"}
              </Badge>
            </div>

            <Tabs defaultValue="risks">
              <TabsList>
                <TabsTrigger value="risks">Risk Register</TabsTrigger>
                <TabsTrigger value="remediation">Remediation SQL</TabsTrigger>
                <TabsTrigger value="drift">Drift</TabsTrigger>
                <TabsTrigger value="inventory">Inventory</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              <TabsContent value="risks">
                <Card><CardContent className="p-0">
                  <ScrollArea className="h-[500px]">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0"><tr>
                        <th className="p-2 text-left">Severity</th><th className="p-2 text-left">Category</th>
                        <th className="p-2 text-left">Resource</th><th className="p-2 text-left">Message</th>
                      </tr></thead>
                      <tbody>
                        {latest.risk_register.map((r: LooseRow, i: number) => (
                          <tr key={i} className="border-b hover:bg-muted/40">
                            <td className="p-2"><Badge className={sevColor[r.severity]}>{r.severity}</Badge></td>
                            <td className="p-2 font-mono text-xs">{r.category}</td>
                            <td className="p-2 font-mono text-xs">{r.resource}</td>
                            <td className="p-2">{r.message}</td>
                          </tr>
                        ))}
                        {latest.risk_register.length === 0 && (
                          <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">
                            <ShieldCheck className="inline mr-2" /> No findings — authorization model is clean.
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </ScrollArea>
                </CardContent></Card>
              </TabsContent>

              <TabsContent value="remediation">
                <Card><CardHeader><CardTitle>Generated Remediation SQL</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">
                    Review before applying — production changes require migration approval.
                  </p>
                  <pre className="bg-muted-foreground text-muted-foreground p-4 rounded text-xs overflow-auto max-h-[500px]">
{latest.remediation.map((r: LooseRow) => `-- [${r.severity}] ${r.resource}\n${r.sql}`).join("\n\n") || "-- No remediation needed"}
                  </pre>
                </CardContent></Card>
              </TabsContent>

              <TabsContent value="drift">
                <Card><CardHeader><CardTitle>Drift vs Previous Run</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {!previous && <p className="text-muted-foreground">Need at least two runs to compute drift.</p>}
                  {drift && (
                    <>
                      <DriftRow label="New tables" items={drift.new_tables} />
                      <DriftRow label="Removed tables" items={drift.removed_tables} />
                      <DriftRow label="New policies" items={drift.new_policies} />
                      <DriftRow label="Removed policies" items={drift.removed_policies} />
                      <DriftRow label="Changed policies" items={drift.changed_policies} />
                      <DriftRow label="New realtime" items={drift.new_realtime} />
                      <DriftRow label="New SECURITY DEFINER" items={drift.new_definer} />
                    </>
                  )}
                </CardContent></Card>
              </TabsContent>

              <TabsContent value="inventory">
                <Card><CardContent className="p-4 text-sm">
                  <p>Discovered <strong>{latest.inventory?.tables?.length ?? 0}</strong> tables · <strong>{latest.inventory?.policies?.length ?? 0}</strong> policies · <strong>{latest.inventory?.security_definer?.length ?? 0}</strong> SECURITY DEFINER functions · <strong>{latest.inventory?.realtime_publication?.length ?? 0}</strong> realtime tables.</p>
                </CardContent></Card>
              </TabsContent>

              <TabsContent value="history">
                <Card><CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead className="bg-muted"><tr>
                      <th className="p-2 text-left">When</th><th className="p-2">Trigger</th>
                      <th className="p-2">Critical</th><th className="p-2">High</th><th className="p-2">Passed</th>
                    </tr></thead>
                    <tbody>
                      {runs.map((r) => (
                        <tr key={r.id} className="border-b">
                          <td className="p-2">{new Date(r.ran_at).toLocaleString()}</td>
                          <td className="p-2 text-center">{r.trigger}</td>
                          <td className="p-2 text-center">{r.critical_count}</td>
                          <td className="p-2 text-center">{r.high_count}</td>
                          <td className="p-2 text-center">{r.passed ? "✅" : "❌"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent></Card>
              </TabsContent>
            </Tabs>
          </>
        )}

        {!loading && !latest && (
          <Card><CardContent className="p-10 text-center text-muted-foreground">
            <ShieldAlert className="mx-auto h-10 w-10 mb-3" />
            No scans yet. Click <strong>Run Scan</strong> to inventory and validate the authorization model.
          </CardContent></Card>
        )}
      </div>
      {latest && (
        <RemediationReviewModal
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          runId={latest.id}
          items={(latest.remediation ?? []) as LooseRow}
        />
      )}
    </>
  );
}

function ScoreCard({ label, value }: { label: string; value: number }) {
  const color = value >= 90 ? "text-status-success" : value >= 70 ? "text-status-warning" : "text-status-danger";
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-3xl font-bold ${color}`}>{value}%</div>
      <Progress value={value} className="mt-2 h-1" />
    </CardContent></Card>
  );
}

function DriftRow({ label, items }: { label: string; items: LooseRow[] }) {
  return (
    <div className="flex items-start gap-2 py-1 border-b">
      <span className="font-medium min-w-[180px]">{label}</span>
      <span className="text-xs text-muted-foreground flex-1">
        {items.length === 0 ? "—" : items.slice(0, 15).map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(", ")}
        {items.length > 15 && ` +${items.length - 15} more`}
      </span>
      <Badge variant={items.length > 0 ? "destructive" : "outline"}>{items.length}</Badge>
    </div>
  );
}
