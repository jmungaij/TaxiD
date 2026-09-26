/**
 * AI CONTROL TOWER — /dashboard/admin/ai-control-tower
 *
 * Governance surface over the AI operations spine. Nothing is decided here:
 * recommendations, policy classification, revalidation and the non-action
 * register are all server verdicts (ai_* RPCs and v_ai_control_tower).
 * Operators may only request an action and record an approval decision;
 * execution belongs to the orchestration worker.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { AlertTriangle, Brain, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import { cn } from "@/lib/utils";
import {
  fetchAiControlTower,
  openAiActionRequest,
  decideAiAction,
  type AiControlTowerRow,
  type AiActionClass,
} from "@/lib/logistics/ai/orchestration";
import {
  fetchAiPipelineHealth,
  fetchAiNonActions,
  fetchAiAdapters,
  revalidateAiAction,
  describeAiCapability,
  describeRevalidation,
  AI_NON_ACTION_LABEL,
  type AiPipelineHealth,
  type AiNonActionRow,
  type AiAdapterRow,
  type AiNonActionCode,
} from "@/lib/logistics/ai/pipeline";

const TABS = ["recommendations", "approvals", "non-actions", "adapters", "security"] as const;

interface SecurityLedgerRow {
  finding_key: string;
  category: string | null;
  severity: string;
  exploitability: string;
  remediation_status: string;
  finding_count: number | null;
  production_blocker: boolean | null;
  risk_acceptance_note: string | null;
}

const CLASS_TONE: Record<AiActionClass, string> = {
  AUTO_SAFE: "border-success/40 text-success",
  APPROVAL_REQUIRED: "border-warning/50 text-warning",
  HUMAN_ONLY: "border-info/40 text-info",
  BLOCKED: "border-destructive/50 text-destructive",
};

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: "border-destructive/60 text-destructive",
  HIGH: "border-destructive/50 text-destructive",
  MEDIUM: "border-warning/50 text-warning",
  LOW: "border-info/40 text-info",
  INFO: "border-muted-foreground/40 text-muted-foreground",
};

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;
}

export default function AiControlTower() {
  const { toast } = useToast();
  const { tab, onTabChange } = useTabDeepLink(TABS, "recommendations");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AiControlTowerRow[]>([]);
  const [health, setHealth] = useState<AiPipelineHealth | null>(null);
  const [nonActions, setNonActions] = useState<AiNonActionRow[]>([]);
  const [adapters, setAdapters] = useState<AiAdapterRow[]>([]);
  const [ledger, setLedger] = useState<SecurityLedgerRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [revalidation, setRevalidation] = useState<Record<string, string[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [tower, h, na, ad, sec] = await Promise.all([
        fetchAiControlTower(200),
        fetchAiPipelineHealth().catch(() => null),
        fetchAiNonActions(100).catch(() => []),
        fetchAiAdapters().catch(() => []),
        (supabase as any)
          .from("v_security_ledger")
          .select("*")
          .then((r: { data: SecurityLedgerRow[] | null }) => r.data ?? [])
          .catch(() => []),
      ]);
      setRows(tower);
      setHealth(h);
      setNonActions(na);
      setAdapters(ad);
      setLedger(sec as SecurityLedgerRow[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the AI control tower.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const capabilityState = health ? describeAiCapability(health) : null;
  const capability = {
    configured: capabilityState?.state === "ACTIVE",
    label: capabilityState?.label ?? "AI CAPABILITY NOT CONFIGURED",
    detail: capabilityState
      ? capabilityState.state === "ACTIVE"
        ? "Reasoning runs against immutable, hashed context; execution stays behind policy and approval."
        : "Detectors and governance are live; no reasoning model is configured, so no model output is produced."
      : "Pipeline health is unavailable.",
  };

  const open = useMemo(() => rows.filter((r) => r.recommendation_status === "OPEN"), [rows]);
  const pending = useMemo(() => rows.filter((r) => r.action_state === "APPROVAL_PENDING"), [rows]);
  const executed = useMemo(() => rows.filter((r) => r.action_state === "EXECUTED"), [rows]);

  async function requestAction(row: AiControlTowerRow) {
    setBusy(row.recommendation_id);
    try {
      const res = await openAiActionRequest({
        recommendationId: row.recommendation_id,
        payload: (row.evidence?.dispatch_request_id
          ? { dispatch_request_id: row.evidence.dispatch_request_id }
          : { entity_id: row.entity_id }) as Record<string, unknown>,
        idempotencyKey: `ui-${row.recommendation_id}`,
      });
      toast({
        title: res.duplicate ? "Action already requested" : "Action requested",
        description: `State: ${res.state ?? "APPROVAL_PENDING"}`,
      });
      await load();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Refused",
        description: e instanceof Error ? e.message : "The governance layer refused this request.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function decide(row: AiControlTowerRow, decision: "APPROVED" | "REJECTED") {
    if (!row.action_request_id) return;
    const reason = (reasons[row.action_request_id] ?? "").trim();
    if (reason.length < 10) {
      toast({
        variant: "destructive",
        title: "Reason required",
        description: "Record why you are approving or rejecting, referencing the evidence you reviewed.",
      });
      return;
    }
    setBusy(row.action_request_id);
    try {
      const res = await decideAiAction({
        actionRequestId: row.action_request_id,
        decision,
        reason,
        evidenceReviewed: true,
      });
      toast({ title: `Decision recorded: ${res.decision}`, description: `State: ${res.state}` });
      await load();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Refused",
        description: e instanceof Error ? e.message : "The governance layer refused this decision.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function checkRevalidation(actionRequestId: string) {
    setBusy(actionRequestId);
    try {
      const res = await revalidateAiAction(actionRequestId);
      setRevalidation((prev) => ({
        ...prev,
        [actionRequestId]: res.valid ? ["Current state, policy and approval still match."] : describeRevalidation(res.reasons),
      }));
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Revalidation unavailable",
        description: e instanceof Error ? e.message : "Could not revalidate.",
      });
    } finally {
      setBusy(null);
    }
  }

  function RecommendationCard({ row, mode }: { row: AiControlTowerRow; mode: "open" | "approval" }) {
    return (
      <Card key={row.recommendation_id} className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase">{row.priority}</Badge>
            <Badge variant="outline" className={cn("text-[10px] uppercase", CLASS_TONE[row.classification])}>
              {row.classification.replace(/_/g, " ").toLowerCase()}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase">{row.recommendation_type}</Badge>
            {row.action_state && (
              <Badge variant="outline" className="text-[10px] uppercase">{row.action_state}</Badge>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {row.agent_name} · confidence {(Number(row.confidence) * 100).toFixed(0)}%
            </span>
          </div>
          <CardTitle className="text-base font-semibold leading-snug">{row.observation}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">{row.reasoning_summary}</p>
          <div className="rounded-md bg-muted/40 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence</p>
            <pre className="overflow-x-auto text-xs">{JSON.stringify(row.evidence, null, 2)}</pre>
          </div>
          {row.entity_ref && (
            <p className="text-xs text-muted-foreground">
              Entity: {row.entity_type} · {row.entity_ref}
            </p>
          )}
          {mode === "open" && (
            <Button size="sm" disabled={busy === row.recommendation_id} onClick={() => void requestAction(row)}>
              {busy === row.recommendation_id && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Request governed action
            </Button>
          )}
          {mode === "approval" && row.action_request_id && (
            <div className="space-y-2">
              <Textarea
                value={reasons[row.action_request_id] ?? ""}
                onChange={(e) =>
                  setReasons((prev) => ({ ...prev, [row.action_request_id as string]: e.target.value }))
                }
                placeholder="Record the evidence you reviewed and why this decision is safe."
                rows={2}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy === row.action_request_id} onClick={() => void decide(row, "APPROVED")}>
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === row.action_request_id}
                  onClick={() => void decide(row, "REJECTED")}
                >
                  <Ban className="mr-2 h-3.5 w-3.5" /> Reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === row.action_request_id}
                  onClick={() => void checkRevalidation(row.action_request_id as string)}
                >
                  Revalidate against live state
                </Button>
              </div>
              {revalidation[row.action_request_id]?.map((r) => (
                <p key={r} className="text-xs text-muted-foreground">
                  • {r}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Helmet>
        <title>AI Control Tower | SAFARID Logistics Governance</title>
        <meta
          name="description"
          content="Governed AI operations: recommendations, approvals, the non-action register and the security remediation ledger."
        />
      </Helmet>

      <header className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Brain className="h-6 w-6 text-primary" /> AI Control Tower
          </h1>
          <p className="text-sm text-muted-foreground">
            Detection, reasoning, recommendation, policy, approval, execution and outcome — every step is a server
            verdict. Operators request and approve; the worker executes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </header>

      <Card className={capability.configured ? "border-success/40" : "border-warning/50"}>
        <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
          {capability.configured ? (
            <ShieldCheck className="h-4 w-4 text-success" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-warning" />
          )}
          <span className="font-medium uppercase tracking-wide">{capability.label}</span>
          <span className="text-muted-foreground">{capability.detail}</span>
          {health && (
            <span className="ml-auto text-xs text-muted-foreground">
              {health.active_detectors} detectors · {health.configured_models} configured models ·{" "}
              {health.automating_adapters} automation adapters
            </span>
          )}
        </CardContent>
      </Card>

      {loadError && (
        <Card className="border-destructive/50">
          <CardContent className="py-4 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Open recommendations", value: open.length },
          { label: "Awaiting approval", value: pending.length },
          { label: "Executed", value: executed.length },
          { label: "Non-actions recorded", value: nonActions.length },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="py-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="non-actions">Non-action register</TabsTrigger>
          <TabsTrigger value="adapters">Adapters</TabsTrigger>
          <TabsTrigger value="security">Security ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="space-y-3 pt-4">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : open.length === 0 ? (
            <Empty text="No open recommendations. Detectors record findings only from authoritative events." />
          ) : (
            open.map((row) => <RecommendationCard key={row.recommendation_id} row={row} mode="open" />)
          )}
        </TabsContent>

        <TabsContent value="approvals" className="space-y-3 pt-4">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : pending.length === 0 ? (
            <Empty text="No action requests are awaiting a decision." />
          ) : (
            pending.map((row) => <RecommendationCard key={row.recommendation_id} row={row} mode="approval" />)
          )}
        </TabsContent>

        <TabsContent value="non-actions" className="space-y-3 pt-4">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : nonActions.length === 0 ? (
            <Empty text="No refusals recorded." />
          ) : (
            nonActions.map((n) => (
              <Card key={n.id}>
                <CardContent className="space-y-1 py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {AI_NON_ACTION_LABEL[n.code as AiNonActionCode] ?? n.code}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p>{n.reason}</p>
                  {n.next_step && <p className="text-xs text-muted-foreground">Next step: {n.next_step}</p>}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="adapters" className="space-y-3 pt-4">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : adapters.length === 0 ? (
            <Empty text="No execution adapters registered." />
          ) : (
            adapters.map((a) => (
              <Card key={a.adapter_code}>
                <CardContent className="space-y-1 py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.action_type}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] uppercase",
                        a.automation_allowed ? "border-success/40 text-success" : "border-info/40 text-info",
                      )}
                    >
                      {a.automation_allowed ? "automation permitted" : "human only"}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{a.target_service}</span>
                  </div>
                  {!a.automation_allowed && a.refusal_reason && (
                    <p className="text-xs text-muted-foreground">{a.refusal_reason}</p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="security" className="space-y-3 pt-4">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : ledger.length === 0 ? (
            <Empty text="The security ledger is empty or not visible to this account." />
          ) : (
            ledger.map((s) => (
              <Card key={s.finding_key}>
                <CardContent className="space-y-1 py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{s.finding_key}</span>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] uppercase", SEVERITY_TONE[s.severity] ?? SEVERITY_TONE.INFO)}
                    >
                      {s.severity}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {s.exploitability}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {s.remediation_status}
                    </Badge>
                    {s.production_blocker && (
                      <Badge variant="outline" className="border-destructive/50 text-[10px] uppercase text-destructive">
                        production blocker
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {s.finding_count ?? 0} finding(s)
                    </span>
                  </div>
                  {s.category && <p className="text-xs text-muted-foreground">Category: {s.category}</p>}
                  {s.risk_acceptance_note && (
                    <p className="text-xs text-muted-foreground">{s.risk_acceptance_note}</p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
