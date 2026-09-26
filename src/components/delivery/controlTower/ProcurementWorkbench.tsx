import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Building2, ChevronDown, Check, FileSpreadsheet, Receipt, ShieldCheck, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import {
  decidePurchaseOrder,
  loadProcurementWorkspace,
  poStatusAfter,
  referenceWorkspace,
  type ProcurementWorkspace,
  type PurchaseOrder,
} from "@/lib/delivery/procurement";
import { listAudit, subscribeAudit, type AuditEntry } from "@/lib/delivery/auditTrail";

const kes = (n: number) =>
  n >= 1_000_000 ? `KSh ${(Math.round(n / 100_000) / 10).toFixed(1)}M` : `KSh ${Math.round(n).toLocaleString("en-KE")}`;
const dateFmt = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });

const PO_STYLE: Record<PurchaseOrder["status"], string> = {
  draft: "border-border text-muted-foreground",
  pending_approval: "border-status-warning/50 text-status-warning",
  approved: "border-status-success/50 text-status-success",
  rejected: "border-destructive/50 text-destructive",
  committed: "border-primary/50 text-primary",
  closed: "border-border text-muted-foreground",
};

const CONTROL_STYLE = {
  ok: "border-status-success/40 bg-status-success/5",
  warn: "border-status-warning/40 bg-status-warning/5",
  block: "border-destructive/40 bg-destructive/5",
} as const;

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-bold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

/**
 * Enterprise procurement workbench: cost centres, department billing, purchase
 * orders with approval chains, budget controls and monthly invoicing linked to
 * the logistics charges the control tower prices.
 */
export function ProcurementWorkbench({ module }: { module: DeliveryModule }) {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<ProcurementWorkspace>(() => referenceWorkspace(module));
  const [overrides, setOverrides] = useState<Record<string, PurchaseOrder["status"]>>({});
  const [pending, setPending] = useState<{ po: PurchaseOrder; decision: "approve" | "reject" } | null>(null);
  const [reason, setReason] = useState("");
  const [trail, setTrail] = useState<AuditEntry[]>(() => listAudit({ domain: "procurement", module }));
  const [open, setOpen] = useState<string | null>(null);

  const actor = user?.email ?? "unauthenticated operator";

  useEffect(() => {
    setWorkspace(referenceWorkspace(module));
    setOverrides({});
    let cancelled = false;
    void loadProcurementWorkspace(module).then((w) => {
      if (!cancelled) setWorkspace(w);
    });
    return () => {
      cancelled = true;
    };
  }, [module]);

  useEffect(() => {
    setTrail(listAudit({ domain: "procurement", module }));
    return subscribeAudit(() => setTrail(listAudit({ domain: "procurement", module })));
  }, [module]);

  const purchaseOrders = useMemo(
    () => workspace.purchaseOrders.map((p) => ({ ...p, status: overrides[p.id] ?? p.status })),
    [workspace.purchaseOrders, overrides],
  );

  const confirm = () => {
    if (!pending) return;
    if (pending.decision === "reject" && reason.trim().length < 4) {
      toast({ title: "Reason required", description: "Rejections must carry a justification.", variant: "destructive" });
      return;
    }
    const entry = decidePurchaseOrder(module, pending.po, pending.decision, actor, reason.trim() || undefined);
    setOverrides((prev) => ({ ...prev, [pending.po.id]: poStatusAfter(pending.po, pending.decision) }));
    toast({
      title: pending.decision === "approve" ? "Purchase order approved" : "Purchase order rejected",
      description: `${pending.po.number} · audit ${entry.hash.slice(0, 8)}`,
    });
    setPending(null);
    setReason("");
  };

  const t = workspace.totals;

  return (
    <div className="space-y-4">
      <Card className="border-border/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-md bg-primary/10">
              <Wallet className="h-4 w-4 text-primary" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Procurement workbench</h3>
              <p className="text-[11px] text-muted-foreground">
                Cost centres, department billing, purchase orders, approvals, budget controls and monthly invoicing
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              workspace.source === "live" ? "border-status-success/50 text-status-success" : "border-border text-muted-foreground",
            )}
          >
            {workspace.source === "live" ? "Live finance records" : "Reference model"}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Period budget" value={kes(t.budgetKes)} />
          <Metric label="Committed" value={kes(t.committedKes)} hint="Approved POs reserving funds" />
          <Metric label="Spent" value={kes(t.spentKes)} />
          <Metric label="Available" value={kes(t.availableKes)} hint={`${t.utilisationPct}% utilised`} />
          <Metric label="Open POs" value={String(t.openPos)} hint={`${t.pendingApprovals} awaiting approval`} />
          <Metric label="Outstanding" value={kes(t.outstandingKes)} hint="Invoices unpaid" />
        </div>
      </Card>

      <Tabs defaultValue="pos" className="space-y-3">
        <TabsList className="grid h-auto grid-cols-2 lg:grid-cols-5">
          <TabsTrigger value="pos" className="text-[11px]">Purchase orders</TabsTrigger>
          <TabsTrigger value="centres" className="text-[11px]">Cost centres</TabsTrigger>
          <TabsTrigger value="departments" className="text-[11px]">Department billing</TabsTrigger>
          <TabsTrigger value="controls" className="text-[11px]">Budget controls</TabsTrigger>
          <TabsTrigger value="invoices" className="text-[11px]">Invoicing</TabsTrigger>
        </TabsList>

        <TabsContent value="pos" className="space-y-2">
          {purchaseOrders.map((po) => (
            <Collapsible key={po.id} open={open === po.id} onOpenChange={(v) => setOpen(v ? po.id : null)}>
              <CollapsibleTrigger className="w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {po.number} · {po.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {po.costCentreCode} · {po.department} · raised {dateFmt(po.raisedAt)} by {po.requestedBy}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-semibold tabular-nums">{kes(po.valueKes)}</span>
                    <Badge variant="outline" className={cn("text-[10px] capitalize", PO_STYLE[po.status])}>
                      {po.status.replace(/_/g, " ")}
                    </Badge>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open === po.id && "rotate-180")} />
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 px-3 pb-3 pt-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Order lines</div>
                    <div className="mt-1.5 space-y-1">
                      {po.lines.map((l) => (
                        <div key={l.description} className="flex items-center justify-between gap-2 rounded-md border p-2 text-[11px]">
                          <span>
                            {l.description} <span className="text-muted-foreground">· {l.service}</span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {l.quantity} {l.unit} × {kes(l.unitPriceKes)} = {kes(l.quantity * l.unitPriceKes)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Approval chain</div>
                    <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                      {po.approvals.map((a) => (
                        <div key={a.level} className="rounded-md border p-2 text-[11px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">
                              L{a.level} · {a.role}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] capitalize",
                                a.state === "approved" && "border-status-success/50 text-status-success",
                                a.state === "pending" && "border-status-warning/50 text-status-warning",
                                a.state === "rejected" && "border-destructive/50 text-destructive",
                              )}
                            >
                              {a.state}
                            </Badge>
                          </div>
                          <div className="text-muted-foreground">
                            {a.approver}
                            {a.decidedAt ? ` · ${dateFmt(a.decidedAt)}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={po.status === "approved" || po.status === "closed"}
                      onClick={() => {
                        setReason("");
                        setPending({ po, decision: "approve" });
                      }}
                    >
                      <Check className="mr-1 h-3 w-3" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      disabled={po.status === "rejected" || po.status === "closed"}
                      onClick={() => {
                        setReason("");
                        setPending({ po, decision: "reject" });
                      }}
                    >
                      <X className="mr-1 h-3 w-3" /> Reject
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      Needed by {dateFmt(po.neededBy)} · consumed {kes(po.consumedKes)}
                    </span>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </TabsContent>

        <TabsContent value="centres" className="space-y-2">
          {workspace.costCentres.map((c) => {
            const usedPct = Math.min(100, Math.round(((c.spentKes + c.committedKes) / Math.max(1, c.budgetKes)) * 100));
            return (
              <div key={c.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {c.code} · {c.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Owner {c.owner} · {c.department}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] capitalize",
                      c.status === "frozen" ? "border-destructive/50 text-destructive" : "border-status-success/50 text-status-success",
                    )}
                  >
                    {c.status}
                  </Badge>
                </div>
                <Progress value={usedPct} className="mt-2 h-1" />
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>Budget {kes(c.budgetKes)}</span>
                  <span>Spent {kes(c.spentKes)}</span>
                  <span>Committed {kes(c.committedKes)}</span>
                  <span className="font-medium text-foreground">{usedPct}% consumed</span>
                </div>
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="departments">
          <Card className="overflow-x-auto border-border/70">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2 font-semibold">Department</th>
                  <th className="p-2 text-right font-semibold">Deliveries</th>
                  <th className="p-2 text-right font-semibold">Logistics charges</th>
                  <th className="p-2 text-right font-semibold">Surcharges</th>
                  <th className="p-2 text-right font-semibold">Credits</th>
                  <th className="p-2 text-right font-semibold">Net billable</th>
                  <th className="p-2 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {workspace.departments.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className="p-2 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 className="h-3 w-3 text-muted-foreground" />
                        {d.name}
                      </span>
                    </td>
                    <td className="p-2 text-right tabular-nums">{d.deliveries.toLocaleString("en-KE")}</td>
                    <td className="p-2 text-right tabular-nums">{kes(d.logisticsChargesKes)}</td>
                    <td className="p-2 text-right tabular-nums">{kes(d.surchargesKes)}</td>
                    <td className="p-2 text-right tabular-nums text-status-success">−{kes(d.creditsKes)}</td>
                    <td className="p-2 text-right font-semibold tabular-nums">{kes(d.netKes)}</td>
                    <td className="p-2 text-right tabular-nums">{d.sharePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="controls" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {workspace.budgetControls.map((c) => (
            <div key={c.id} className={cn("rounded-lg border p-3", CONTROL_STYLE[c.state])}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold">{c.label}</span>
                <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                  {c.state === "block" ? "blocking" : c.state}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] font-medium">{c.rule}</p>
              <p className="text-[11px] text-muted-foreground">{c.detail}</p>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="invoices" className="space-y-2">
          {workspace.invoices.map((inv) => (
            <div key={inv.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    <Receipt className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />
                    {inv.number}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {inv.period} · {inv.costCentres} cost centres · {inv.deliveries.toLocaleString("en-KE")} deliveries · due {dateFmt(inv.dueAt)}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] capitalize",
                    inv.status === "paid" && "border-status-success/50 text-status-success",
                    inv.status === "overdue" && "border-destructive/50 text-destructive",
                    (inv.status === "issued" || inv.status === "part_paid") && "border-status-warning/50 text-status-warning",
                  )}
                >
                  {inv.status.replace(/_/g, " ")}
                </Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Subtotal", kes(inv.subtotalKes)],
                  ["VAT 16%", kes(inv.vatKes)],
                  ["Total", kes(inv.totalKes)],
                  ["Paid", kes(inv.paidKes)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md border p-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
                    <div className="text-xs font-semibold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FileSpreadsheet className="h-3 w-3" />
            Every invoice line reconciles to a delivery record, a PO line and a cost centre — exportable to ERP as CSV, or submitted to KRA eTIMS where the account is registered.
          </p>
        </TabsContent>
      </Tabs>

      {trail.length > 0 && (
        <Card className="border-border/70 p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <ShieldCheck className="h-3.5 w-3.5 text-status-success" /> Procurement decision audit ({trail.length})
          </div>
          <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {trail.map((e) => (
              <div key={e.id} className="rounded-md border p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{e.action}</span>
                  <span className="tabular-nums text-muted-foreground">{new Date(e.at).toLocaleString("en-KE")}</span>
                </div>
                <p className="text-muted-foreground">{e.subject}</p>
                <div className="text-muted-foreground">
                  by {e.actor} · <span className="font-mono">#{e.hash.slice(0, 8)}</span>
                  {e.reason ? ` · ${e.reason}` : ""}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          {pending && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-base">
                  {pending.decision === "approve" ? "Approve" : "Reject"} {pending.po.number}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {pending.po.title} · {kes(pending.po.valueKes)} against {pending.po.costCentreCode} ({pending.po.department}).
                  {pending.decision === "approve"
                    ? " Approving reserves the funds against the cost-centre budget until consumed or expired."
                    : " Rejecting releases any reservation and notifies the requester."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div>
                <Label htmlFor="po-reason" className="text-[11px]">
                  Justification {pending.decision === "reject" ? "(required)" : "(optional)"}
                </Label>
                <Textarea
                  id="po-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 min-h-[60px] text-xs"
                  placeholder="Recorded on the procurement audit trail"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Recorded as <span className="font-medium text-foreground">{actor}</span> · maker–checker enforced
                </p>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
                <AlertDialogAction className="text-xs" onClick={confirm}>
                  Confirm {pending.decision}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
