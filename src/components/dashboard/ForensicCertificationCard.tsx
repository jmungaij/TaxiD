/**
 * Phase D5.5 — Forensic Certification Card.
 *
 * Renders the forensic root-cause record for every FAILED chain_* scenario
 * (stage → edge function → RPC → DB mutation → evidence → suggested fix)
 * and enforces sequential progression via `payment_certification_next_action`.
 *
 * No new page, no new route — designed to slot inside PaymentOperationsCenter.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle, ChevronRight, Microscope, PlayCircle, Pin, RefreshCw, ShieldCheck,
} from "lucide-react";

interface Forensic {
  id: string;
  scenario_id: string;
  scenario_key: string;
  run_id: string;
  stage: string;
  edge_function: string | null;
  rpc_name: string | null;
  db_mutation: Record<string, unknown>;
  failure_class: string;
  correlation_id: string | null;
  trace_id: string | null;
  evidence: Record<string, unknown>;
  recommended_fix: string;
  classified_at: string;
}
interface NextAction {
  action: "CLASSIFY" | "REPAIR_AND_REPLAY" | "NONE";
  scenario_id?: string;
  scenario_key?: string;
  reason?: string;
  failure_class?: string;
}
interface FailedScenario {
  id: string;
  scenario_key: string;
  status: string;
  started_at: string;
  error_message: string | null;
}

const classBadge = (c: string) => {
  const map: Record<string, string> = {
    RUNTIME_ERROR:   "bg-status-danger/15 text-status-danger border-status-danger/30",
    HTTP_5XX:        "bg-status-danger/15 text-status-danger border-status-danger/30",
    RLS_DENIED:      "bg-status-warning/15 text-status-warning border-status-warning/30",
    DUPLICATE:       "bg-status-warning/15 text-status-warning border-status-warning/30",
    TRIGGER_BLOCKED: "bg-status-warning/15 text-status-warning border-status-warning/30",
    TIMEOUT:         "bg-status-warning/15 text-status-warning border-status-warning/30",
    UPSTREAM:        "bg-status-warning/15 text-status-warning border-status-warning/30",
    DATA_DRIFT:      "bg-ai/15 text-ai border-ai/30",
    UNKNOWN:         "bg-muted text-muted-foreground",
  };
  return <Badge variant="outline" className={map[c] ?? ""}>{c}</Badge>;
};

export function ForensicCertificationCard() {
  const [next, setNext] = useState<NextAction | null>(null);
  const [forensics, setForensics] = useState<Forensic[]>([]);
  const [failed, setFailed] = useState<FailedScenario[]>([]);
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<Forensic | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const [n, f, s] = await Promise.all([
      supabase.rpc("payment_certification_next_action" as never, { _suite: "chain" } as never),
      supabase.from("payment_certification_forensics" as never)
        .select("*")
        .like("scenario_key", "chain\\_%")
        .order("classified_at", { ascending: false })
        .limit(50),
      supabase.from("payment_certification_scenarios")
        .select("id,scenario_key,status,started_at,error_message")
        .eq("status", "FAILED")
        .like("scenario_key", "chain\\_%")
        .order("started_at", { ascending: false })
        .limit(50),
    ]);
    setNext((n.data as NextAction) ?? null);
    setForensics(((f.data as unknown) as Forensic[]) ?? []);
    setFailed(((s.data as unknown) as FailedScenario[]) ?? []);
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const classify = async (scenarioId: string) => {
    setBusy(true);
    const { error } = await supabase.rpc(
      "payment_certification_classify_failure" as never,
      { _scenario_id: scenarioId } as never,
    );
    if (error) toast({ title: "Classify failed", description: error.message, variant: "destructive" });
    else toast({ title: "Forensic record captured" });
    await load();
  };

  const replayOne = async (scenarioKey: string) => {
    if (next?.action !== "REPAIR_AND_REPLAY" || next.scenario_key !== scenarioKey) {
      toast({
        title: "Not the next scenario",
        description: "Sequential progression enforced. Only the current next-action scenario can be replayed.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("payment-certification-runner", {
      body: { only: [scenarioKey], mode: "sequential" },
    });
    if (error) toast({ title: "Replay failed", description: error.message, variant: "destructive" });
    else toast({ title: "Replay dispatched", description: `run: ${(data as { run_id?: string })?.run_id ?? "?"}` });
    await load();
  };

  const pinRegression = async (fx: Forensic) => {
    const fingerprint = {
      stage: fx.stage, failure_class: fx.failure_class,
      edge_function: fx.edge_function, rpc_name: fx.rpc_name,
      pinned_from_run: fx.run_id,
    };
    const { error } = await supabase.rpc(
      "payment_certification_pin_regression" as never,
      { _scenario_key: fx.scenario_key, _fingerprint: fingerprint, _run_id: fx.run_id } as never,
    );
    if (error) toast({ title: "Pin failed", description: error.message, variant: "destructive" });
    else toast({ title: "Regression pinned", description: fx.scenario_key });
    await load();
  };

  // Latest forensic per scenario_key (map)
  const latestByKey = new Map<string, Forensic>();
  for (const f of forensics) if (!latestByKey.has(f.scenario_key)) latestByKey.set(f.scenario_key, f);
  const unclassified = failed.filter((s) => !latestByKey.has(s.scenario_key));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Microscope className="h-4 w-4" />
          Forensic Certification (chain_*)
          <Badge variant="outline" className="ml-2">Sequential mode</Badge>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Next-action banner */}
        <div className="rounded-md border p-3 bg-muted/30 flex items-start gap-3">
          <ChevronRight className="h-4 w-4 mt-1 text-primary" />
          <div className="flex-1 text-sm">
            <div className="font-medium">
              Next action: <span className="font-mono">{next?.action ?? "…"}</span>
              {next?.scenario_key && <span className="ml-1 font-mono text-primary">{next.scenario_key}</span>}
            </div>
            <div className="text-muted-foreground">{next?.reason ?? ""}</div>
          </div>
          {next?.action === "CLASSIFY" && next.scenario_id && (
            <Button size="sm" onClick={() => void classify(next.scenario_id!)} disabled={busy}>
              <Microscope className="h-3.5 w-3.5 mr-1" /> Classify
            </Button>
          )}
          {next?.action === "REPAIR_AND_REPLAY" && next.scenario_key && (
            <Button size="sm" onClick={() => void replayOne(next.scenario_key!)} disabled={busy}>
              <PlayCircle className="h-3.5 w-3.5 mr-1" /> Replay (isolated)
            </Button>
          )}
          {next?.action === "NONE" && (
            <Badge className="bg-status-success/15 text-status-success border-status-success/30">
              <ShieldCheck className="h-3.5 w-3.5 mr-1 inline" /> All green
            </Badge>
          )}
        </div>

        {/* Unclassified failures */}
        {unclassified.length > 0 && (
          <div className="rounded-md border border-status-danger/30 bg-status-danger/5 p-2 text-sm">
            <div className="flex items-center gap-2 mb-2 text-status-danger">
              <AlertTriangle className="h-4 w-4" />
              {unclassified.length} unclassified failure{unclassified.length === 1 ? "" : "s"} — classify to reveal root cause.
            </div>
            <div className="grid gap-1">
              {unclassified.slice(0, 6).map((s) => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{s.scenario_key}</span>
                  <Button size="sm" variant="outline" onClick={() => void classify(s.id)} disabled={busy}>
                    Classify
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Classified rows */}
        <div className="divide-y">
          {[...latestByKey.values()].map((fx) => (
            <div key={fx.id} className="py-2 flex items-center gap-3 text-sm">
              <span className="font-mono w-40 truncate">{fx.scenario_key}</span>
              <Badge variant="outline">{fx.stage}</Badge>
              {classBadge(fx.failure_class)}
              <span className="text-xs text-muted-foreground truncate flex-1">
                {fx.edge_function ?? "—"}{fx.rpc_name ? ` · ${fx.rpc_name}` : ""}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setDrawer(fx)}>Forensic</Button>
              <Button size="sm" variant="outline" onClick={() => void pinRegression(fx)} disabled={busy}>
                <Pin className="h-3.5 w-3.5 mr-1" /> Pin
              </Button>
            </div>
          ))}
          {latestByKey.size === 0 && (
            <div className="text-sm text-muted-foreground py-4 text-center">No forensic records yet.</div>
          )}
        </div>
      </CardContent>

      {/* Forensic drawer */}
      <Sheet open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)}>
        <SheetContent className="w-[560px] sm:max-w-[560px] overflow-y-auto">
          {drawer && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">{drawer.scenario_key}</SheetTitle>
                <SheetDescription>
                  Classified {new Date(drawer.classified_at).toLocaleString()}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4 text-sm">
                <Section title="Stage → Function → RPC">
                  <Row k="Stage"          v={drawer.stage} />
                  <Row k="Edge function"  v={drawer.edge_function ?? "—"} />
                  <Row k="RPC"            v={drawer.rpc_name ?? "—"} />
                  <Row k="Failure class"  v={<span>{classBadge(drawer.failure_class)}</span>} />
                </Section>
                <Section title="DB mutation">
                  <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                    {JSON.stringify(drawer.db_mutation, null, 2)}
                  </pre>
                </Section>
                <Section title="Evidence">
                  <Row k="Correlation ID" v={<code>{drawer.correlation_id ?? "—"}</code>} />
                  <Row k="Trace ID"       v={<code>{drawer.trace_id ?? "—"}</code>} />
                  <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
                    {JSON.stringify(drawer.evidence, null, 2)}
                  </pre>
                </Section>
                <Section title="Recommended fix">
                  <p className="text-sm">{drawer.recommended_fix}</p>
                </Section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono truncate">{v}</span>
    </div>
  );
}
