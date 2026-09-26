/**
 * Finance · Refunds & Disputes Operations Center.
 *
 * Production Module Completion — composed exclusively from certified
 * primitives (EnterpriseHeroBand, StatCard, AsyncState, SectionErrorBoundary,
 * AiAssistantPanel) and existing infrastructure:
 *   - payment_disputes / chargebacks  (existing tables)
 *   - refund_requests / refund_request_events (maker-checker backbone)
 *   - refund-execute edge function → reuses mpesa-reverse for money movement
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Wallet,
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  Play,
  Plus,
  History,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import StatCard from "@/components/common/StatCard";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { AiAssistantPanel } from "@/components/layout/AiAssistantPanel";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";

type RefundRow = {
  id: string;
  dispute_id: string | null;
  transaction_id: string;
  provider: string;
  amount_cents: number;
  currency: string;
  reason: string;
  status: string;
  requested_by: string;
  approved_by: string | null;
  approval_note: string | null;
  rejected_reason: string | null;
  execution_ref: string | null;
  failure_reason: string | null;
  executed_at: string | null;
  created_at: string;
};

type DisputeRow = {
  id: string;
  transaction_id: string | null;
  reason: string;
  status: string;
  amount_cents: number | null;
  currency: string | null;
  description: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  refund_request_id: string;
  actor_user_id: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
};

const money = (cents: number | null | undefined, ccy = "KES") =>
  `${ccy} ${((cents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const statusTone: Record<string, string> = {
  PENDING_APPROVAL: "bg-status-warning/15 text-status-warning border-status-warning/30",
  APPROVED: "bg-primary/10 text-primary border-primary/30",
  EXECUTING: "bg-primary/10 text-primary border-primary/30",
  EXECUTED: "bg-status-success/15 text-status-success border-status-success/30",
  REJECTED: "bg-muted text-muted-foreground border-border",
  CANCELLED: "bg-muted text-muted-foreground border-border",
  FAILED: "bg-destructive/10 text-destructive border-destructive/30",
};

export default function RefundsCenter() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    transaction_id: "",
    dispute_id: "",
    amount: "",
    currency: "KES",
    reason: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, d, e] = await Promise.all([
        supabase
          .from("refund_requests")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("payment_disputes")
          .select("id,transaction_id,reason,status,amount_cents,currency,description,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("refund_request_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (r.error) throw new Error(r.error.message);
      setRefunds((r.data ?? []) as RefundRow[]);
      setDisputes((d.data ?? []) as unknown as DisputeRow[]);
      setEvents((e.data ?? []) as EventRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load refund operations data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Realtime: refund queue stays live for the whole finance desk.
  useEffect(() => {
    const ch = supabase
      .channel("refund-operations")
      .on("postgres_changes", { event: "*", schema: "public", table: "refund_requests" }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load]);

  const kpis = useMemo(() => {
    const pending = refunds.filter((r) => r.status === "PENDING_APPROVAL");
    const approved = refunds.filter((r) => r.status === "APPROVED");
    const failed = refunds.filter((r) => r.status === "FAILED");
    const executedValue = refunds
      .filter((r) => r.status === "EXECUTED")
      .reduce((s, r) => s + r.amount_cents, 0);
    const openDisputes = disputes.filter((d) => !["RESOLVED", "REJECTED"].includes(d.status)).length;
    return { pending, approved, failed, executedValue, openDisputes };
  }, [refunds, disputes]);

  const logEvent = async (
    refundId: string,
    action: string,
    from: string,
    to: string,
    note?: string,
  ) => {
    await supabase.from("refund_request_events").insert({
      refund_request_id: refundId,
      actor_user_id: user?.id ?? null,
      action,
      from_status: from,
      to_status: to,
      note: note ?? null,
    });
  };

  const createRefund = async () => {
    const cents = Math.round(Number(form.amount) * 100);
    if (!form.transaction_id || !cents || cents <= 0 || form.reason.trim().length < 10) {
      toast({
        title: "Incomplete refund request",
        description: "Transaction ID, a positive amount and a reason of at least 10 characters are required.",
        variant: "destructive",
      });
      return;
    }
    setBusyId("create");
    const { data, error: insErr } = await supabase
      .from("refund_requests")
      .insert({
        transaction_id: form.transaction_id.trim(),
        dispute_id: form.dispute_id.trim() || null,
        amount_cents: cents,
        currency: form.currency || "KES",
        reason: form.reason.trim(),
        requested_by: user?.id as string,
        idempotency_key: `refund-${crypto.randomUUID()}`,
      })
      .select("id")
      .maybeSingle();
    setBusyId(null);
    if (insErr) {
      toast({ title: "Could not raise refund", description: insErr.message, variant: "destructive" });
      return;
    }
    if (data?.id) await logEvent(data.id, "created", "—", "PENDING_APPROVAL", form.reason.trim());
    toast({ title: "Refund raised", description: "Awaiting a second approver (maker-checker)." });
    setCreateOpen(false);
    setForm({ transaction_id: "", dispute_id: "", amount: "", currency: "KES", reason: "" });
    void load();
  };

  const decide = async (row: RefundRow, approve: boolean) => {
    if (row.requested_by === user?.id) {
      toast({
        title: "Maker-checker blocked",
        description: "You raised this refund — a different finance approver must review it.",
        variant: "destructive",
      });
      return;
    }
    setBusyId(row.id);
    const { data: updated, error: upErr } = await supabase
      .from("refund_requests")
      .update(
        approve
          ? { status: "APPROVED", approved_by: user?.id as string, approval_note: "Approved in Refunds Center" }
          : { status: "REJECTED", approved_by: user?.id as string, rejected_reason: "Rejected in Refunds Center" },
      )
      .eq("id", row.id)
      .eq("status", "PENDING_APPROVAL")
      .select("id");
    setBusyId(null);
    if (upErr) {
      toast({ title: "Decision failed", description: upErr.message, variant: "destructive" });
      return;
    }
    if (!updated || updated.length === 0) {
      // Optimistic lock lost: another approver already decided. Never write an
      // audit event for a transition that did not happen.
      toast({
        title: "Already decided",
        description: "This refund was decided by another approver — reloading the queue.",
        variant: "destructive",
      });
      void load();
      return;
    }

    await logEvent(row.id, approve ? "approved" : "rejected", "PENDING_APPROVAL", approve ? "APPROVED" : "REJECTED");
    toast({ title: approve ? "Refund approved" : "Refund rejected" });
    void load();
  };

  const execute = async (row: RefundRow) => {
    setBusyId(row.id);
    const { data, error: fnErr } = await supabase.functions.invoke("refund-execute", {
      body: { refund_request_id: row.id },
    });
    setBusyId(null);
    if (fnErr) {
      toast({ title: "Execution failed", description: fnErr.message, variant: "destructive" });
    } else {
      toast({
        title: "Refund executed",
        description: `Reference ${(data as { execution_ref?: string } | null)?.execution_ref ?? row.id}`,
      });
    }
    void load();
  };

  const isEmpty = !loading && !error && refunds.length === 0 && disputes.length === 0;

  return (
    <div className="space-y-6">
      <EnterpriseHeroBand
        eyebrow={<span>Admin · Finance</span>}
        title={
          <span className="flex items-center gap-2">
            <Wallet className="h-6 w-6" /> Refunds &amp; Disputes
          </span>
        }
        subtitle="Maker-checker refund lifecycle — raise, approve, execute and audit customer refunds against live payment disputes and chargebacks."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="backdrop-blur bg-background/10 border-primary-foreground/30 text-primary-foreground">
              <span className="mr-2 inline-flex h-2 w-2 rounded-full bg-status-success animate-pulse" aria-hidden />
              {kpis.pending.length} awaiting approval
            </Badge>
            <Button size="sm" variant="secondary" onClick={() => void load()} aria-label="Refresh refunds workspace">
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        }
      />

      <AsyncState
        loading={loading}
        error={error}
        isEmpty={isEmpty}
        emptyTitle="No refunds or disputes yet"
        emptyMessage="When a customer raises a dispute or an operator initiates a refund, it appears here for maker-checker approval."
        onRetry={() => void load()}
      >
        <SectionErrorBoundary sectionName="Refund Scorecard">
          <section aria-label="Refund scorecard">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Refund Scorecard
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                title="Awaiting approval"
                value={kpis.pending.length}
                icon={<Clock className="h-5 w-5 text-status-warning" />}
                description="Requires a second approver"
              />
              <StatCard
                title="Approved · ready to execute"
                value={kpis.approved.length}
                icon={<CheckCircle2 className="h-5 w-5 text-primary" />}
                description="Cleared maker-checker"
              />
              <StatCard
                title="Refunded value"
                value={money(kpis.executedValue)}
                icon={<Wallet className="h-5 w-5 text-status-success" />}
                description="Executed refunds"
              />
              <StatCard
                title="Open disputes"
                value={kpis.openDisputes}
                icon={
                  kpis.failed.length
                    ? <ShieldAlert className="h-5 w-5 text-destructive" />
                    : <ShieldCheck className="h-5 w-5 text-status-success" />
                }
                description={`${kpis.failed.length} failed execution(s)`}
              />
            </div>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Refund Operations">
          <section aria-label="Refund operations" className="mt-6">
            <Tabs defaultValue="queue">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <TabsList>
                  <TabsTrigger value="queue">Refund queue</TabsTrigger>
                  <TabsTrigger value="disputes">Disputes</TabsTrigger>
                  <TabsTrigger value="audit">Audit timeline</TabsTrigger>
                </TabsList>
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1" /> Raise refund
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Raise a refund request</DialogTitle>
                      <DialogDescription>
                        The refund enters the maker-checker queue. A different finance approver must approve it before it can execute.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor="refund-txn">Transaction ID</Label>
                        <Input
                          id="refund-txn"
                          value={form.transaction_id}
                          onChange={(e) => setForm((f) => ({ ...f, transaction_id: e.target.value }))}
                          placeholder="uuid of the M-Pesa transaction"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="refund-dispute">Linked dispute (optional)</Label>
                        <Input
                          id="refund-dispute"
                          value={form.dispute_id}
                          onChange={(e) => setForm((f) => ({ ...f, dispute_id: e.target.value }))}
                          placeholder="dispute uuid"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="refund-amount">Amount</Label>
                          <Input
                            id="refund-amount"
                            inputMode="decimal"
                            value={form.amount}
                            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                            placeholder="1500.00"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="refund-currency">Currency</Label>
                          <Input
                            id="refund-currency"
                            value={form.currency}
                            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="refund-reason">Reason (min 10 characters)</Label>
                        <Textarea
                          id="refund-reason"
                          value={form.reason}
                          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                          placeholder="Duplicate charge confirmed against receipt QK12345678"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                      <Button onClick={() => void createRefund()} disabled={busyId === "create"}>
                        Submit for approval
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <TabsContent value="queue">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Refund queue</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AsyncState
                      loading={false}
                      error={null}
                      isEmpty={refunds.length === 0}
                      emptyTitle="No refund requests"
                      emptyMessage="Raise a refund to start the maker-checker workflow."
                    >
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Raised</TableHead>
                            <TableHead>Transaction</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {refunds.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {new Date(r.created_at).toLocaleString()}
                              </TableCell>
                              <TableCell className="font-mono text-xs">{r.transaction_id.slice(0, 8)}…</TableCell>
                              <TableCell className="whitespace-nowrap">{money(r.amount_cents, r.currency)}</TableCell>
                              <TableCell className="max-w-[18rem] truncate" title={r.reason}>{r.reason}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={statusTone[r.status] ?? ""}>{r.status}</Badge>
                                {r.failure_reason && (
                                  <p className="text-xs text-destructive mt-1 max-w-[14rem] truncate" title={r.failure_reason}>
                                    {r.failure_reason}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="text-right space-x-1 whitespace-nowrap">
                                {r.status === "PENDING_APPROVAL" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={busyId === r.id || r.requested_by === user?.id}
                                      onClick={() => void decide(r, true)}
                                      aria-label={`Approve refund ${r.id}`}
                                    >
                                      <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={busyId === r.id || r.requested_by === user?.id}
                                      onClick={() => void decide(r, false)}
                                      aria-label={`Reject refund ${r.id}`}
                                    >
                                      <XCircle className="h-4 w-4 mr-1" /> Reject
                                    </Button>
                                  </>
                                )}
                                {(r.status === "APPROVED" || r.status === "FAILED") && (
                                  <Button
                                    size="sm"
                                    disabled={busyId === r.id}
                                    onClick={() => void execute(r)}
                                    aria-label={`Execute refund ${r.id}`}
                                  >
                                    <Play className="h-4 w-4 mr-1" /> Execute
                                  </Button>
                                )}
                                {r.status === "EXECUTED" && (
                                  <span className="text-xs text-muted-foreground font-mono">{r.execution_ref ?? "—"}</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AsyncState>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="disputes">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Customer disputes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AsyncState
                      loading={false}
                      error={null}
                      isEmpty={disputes.length === 0}
                      emptyTitle="No disputes recorded"
                      emptyMessage="Disputes raised by riders, drivers or corporate accounts will appear here."
                    >
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Raised</TableHead>
                            <TableHead>Transaction</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {disputes.map((d) => (
                            <TableRow key={d.id}>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {new Date(d.created_at).toLocaleString()}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {d.transaction_id ? `${d.transaction_id.slice(0, 8)}…` : "—"}
                              </TableCell>
                              <TableCell>{d.reason}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {money(d.amount_cents, d.currency ?? "KES")}
                              </TableCell>
                              <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  aria-label={`Raise refund for dispute ${d.id}`}
                                  onClick={() => {
                                    setForm({
                                      transaction_id: d.transaction_id ?? "",
                                      dispute_id: d.id,
                                      amount: ((d.amount_cents ?? 0) / 100).toString(),
                                      currency: d.currency ?? "KES",
                                      reason: d.description ?? `Dispute ${d.reason} resolution refund`,
                                    });
                                    setCreateOpen(true);
                                  }}
                                >
                                  Raise refund
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AsyncState>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="audit">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <History className="h-4 w-4" /> Refund audit timeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AsyncState
                      loading={false}
                      error={null}
                      isEmpty={events.length === 0}
                      emptyTitle="No refund activity yet"
                      emptyMessage="Every raise, approval, rejection and execution is recorded here immutably."
                    >
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>When</TableHead>
                            <TableHead>Refund</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead>Transition</TableHead>
                            <TableHead>Note</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {events.map((ev) => (
                            <TableRow key={ev.id}>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {new Date(ev.created_at).toLocaleString()}
                              </TableCell>
                              <TableCell className="font-mono text-xs">{ev.refund_request_id.slice(0, 8)}…</TableCell>
                              <TableCell>{ev.action}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {ev.from_status ?? "—"} → {ev.to_status ?? "—"}
                              </TableCell>
                              <TableCell className="max-w-[20rem] truncate" title={ev.note ?? ""}>{ev.note ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </AsyncState>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Refund AI Copilot">
          <section aria-label="Refund AI copilot" className="mt-6">
            <AiAssistantPanel
              title="Refund Copilot"
              subtitle="Preview — guidance is derived from the live refund queue, no model invocation yet."
              suggestions={[
                "Which refunds are blocked on approval?",
                "Show failed executions from this week",
                "Summarise dispute reasons by volume",
              ]}
              messages={[
                {
                  id: "digest",
                  role: "assistant",
                  content: `${kpis.pending.length} refund(s) await a second approver, ${kpis.approved.length} are cleared for execution, and ${kpis.failed.length} execution(s) failed. ${kpis.openDisputes} dispute(s) remain open.`,
                },
              ]}
              onSubmit={() =>
                toast({
                  title: "Copilot is in preview",
                  description: "Refund Copilot currently summarises the live queue only.",
                })
              }
            />
          </section>
        </SectionErrorBoundary>
      </AsyncState>
    </div>
  );
}
