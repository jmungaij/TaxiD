import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { AlertTriangle, Download, Lock, ShieldCheck, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import {
  complianceAccess,
  complianceDecisionLabel,
  decideCompliance,
  loadComplianceCenter,
  maskRecord,
  referenceComplianceCenter,
  type ComplianceCenterData,
  type ComplianceDecision,
  type ComplianceRecord,
  type ComplianceState,
} from "@/lib/delivery/governanceCenter";
import { auditTrailCsv, listAudit, subscribeAudit, type AuditEntry } from "@/lib/delivery/auditTrail";

const STATE_STYLE: Record<ComplianceState, string> = {
  valid: "border-status-success/50 text-status-success",
  expiring: "border-status-warning/50 text-status-warning",
  expired: "border-destructive/50 text-destructive",
  pending: "border-status-warning/50 text-status-warning",
  breach: "border-destructive/50 text-destructive",
};

const SEVERITY_STYLE = {
  low: "border-border",
  medium: "border-status-warning/40 bg-status-warning/5",
  high: "border-status-warning/60 bg-status-warning/10",
  critical: "border-destructive/50 bg-destructive/5",
} as const;

const DECISIONS: ComplianceDecision[] = ["verify", "request_renewal", "suspend", "escalate"];

const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const timeFmt = (iso: string) => new Date(iso).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Governance compliance centre: KYC, vehicle/insurance validity, contract expiry
 * and route-safety compliance with role-based access, an incident register and
 * the hash-chained audit trail of every decision taken here.
 */
export function ComplianceCenter({ module }: { module: DeliveryModule }) {
  const { user, roles } = useAuth();
  const access = useMemo(() => complianceAccess(roles), [roles]);
  const [data, setData] = useState<ComplianceCenterData>(() => referenceComplianceCenter(module));
  const [pending, setPending] = useState<{ record: ComplianceRecord; decision: ComplianceDecision } | null>(null);
  const [reason, setReason] = useState("");
  const [trail, setTrail] = useState<AuditEntry[]>(() => listAudit({ domain: "compliance", module }));
  const [filter, setFilter] = useState<"all" | "attention">("attention");

  const actor = user?.email ?? "unauthenticated operator";

  useEffect(() => {
    setData(referenceComplianceCenter(module));
    let cancelled = false;
    void loadComplianceCenter(module).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [module]);

  useEffect(() => {
    setTrail(listAudit({ domain: "compliance", module }));
    return subscribeAudit(() => setTrail(listAudit({ domain: "compliance", module })));
  }, [module]);

  const records = data.records
    .filter((r) => (filter === "all" ? true : r.state !== "valid"))
    .map((r) => maskRecord(r, access.canView));

  const confirm = () => {
    if (!pending) return;
    if (reason.trim().length < 4) {
      toast({ title: "Reason required", description: "Compliance decisions must be justified for the audit record.", variant: "destructive" });
      return;
    }
    const entry = decideCompliance(module, pending.record, pending.decision, actor, reason.trim());
    toast({
      title: complianceDecisionLabel(pending.decision),
      description: `${pending.record.requirement} · audit ${entry.hash.slice(0, 8)}`,
    });
    setPending(null);
    setReason("");
  };

  const exportTrail = () => {
    const csv = auditTrailCsv(trail);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-audit-${module}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card className="border-border/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-md bg-primary/10">
              <ShieldCheck className="h-4 w-4 text-primary" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Governance & compliance centre</h3>
              <p className="text-[11px] text-muted-foreground">
                KYC, vehicle & insurance validity, contract expiry and route-safety compliance — role-gated with full audit
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn("text-[10px]", data.source === "live" ? "border-status-success/50 text-status-success" : "border-border text-muted-foreground")}
            >
              {data.source === "live" ? "Live document records" : "Reference register"}
            </Badge>
            <Badge variant="secondary" className="text-[10px] capitalize">
              <Lock className="mr-1 h-3 w-3" />
              {access.label}
            </Badge>
          </div>
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">{access.scope}</p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {data.summary.map((s) => (
            <div key={s.domain} className="rounded-lg border p-3">
              <div className="text-[11px] font-semibold">{s.label}</div>
              <div className="mt-1 text-base font-bold tabular-nums">{s.coveragePct}%</div>
              <Progress value={s.coveragePct} className="mt-1.5 h-1" />
              <div className="mt-1 text-[10px] text-muted-foreground">
                {s.valid} valid · {s.attention} need attention
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Tabs defaultValue="register" className="space-y-3">
        <TabsList className="grid h-auto grid-cols-3">
          <TabsTrigger value="register" className="text-[11px]">Compliance register</TabsTrigger>
          <TabsTrigger value="incidents" className="text-[11px]">Incidents ({data.incidents.length})</TabsTrigger>
          <TabsTrigger value="audit" className="text-[11px]">Audit log ({trail.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {(["attention", "all"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "secondary" : "ghost"}
                className="h-7 px-2 text-[11px]"
                onClick={() => setFilter(f)}
              >
                {f === "attention" ? "Needs attention" : "All requirements"}
              </Button>
            ))}
            <span className="text-[11px] text-muted-foreground">{records.length} records</span>
          </div>

          <Card className="overflow-x-auto border-border/70">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2 font-semibold">Requirement</th>
                  <th className="p-2 font-semibold">Entity</th>
                  <th className="p-2 font-semibold">Reference</th>
                  <th className="p-2 font-semibold">Valid to</th>
                  <th className="p-2 font-semibold">State</th>
                  <th className="p-2 font-semibold">Last checked</th>
                  <th className="p-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-2">
                      <div className="font-medium capitalize">{r.requirement}</div>
                      <div className="text-muted-foreground">{r.evidence}</div>
                    </td>
                    <td className="p-2">
                      <div>{r.entity}</div>
                      <div className="capitalize text-muted-foreground">{r.entityType}</div>
                    </td>
                    <td className="p-2 font-mono">{r.reference}</td>
                    <td className="p-2 tabular-nums">
                      {dateFmt(r.validTo)}
                      {r.daysToExpiry !== null && (
                        <div className={cn("text-[10px]", r.daysToExpiry < 0 ? "text-destructive" : r.daysToExpiry <= 30 ? "text-status-warning" : "text-muted-foreground")}>
                          {r.daysToExpiry < 0 ? `${Math.abs(r.daysToExpiry)} d overdue` : `${r.daysToExpiry} d left`}
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      <Badge variant="outline" className={cn("text-[10px] capitalize", STATE_STYLE[r.state])}>
                        {r.state}
                      </Badge>
                    </td>
                    <td className="p-2 tabular-nums text-muted-foreground">{timeFmt(r.lastCheckedAt)}</td>
                    <td className="p-2">
                      {access.canDecide ? (
                        <div className="flex flex-wrap gap-1">
                          {DECISIONS.map((d) => (
                            <Button
                              key={d}
                              size="sm"
                              variant="outline"
                              className="h-6 px-1.5 text-[10px]"
                              onClick={() => {
                                setReason("");
                                setPending({ record: r, decision: d });
                              }}
                            >
                              {complianceDecisionLabel(d)}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Requires compliance role</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="border-border/70 p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <AlertTriangle className="h-3.5 w-3.5 text-status-warning" /> Route & safety telemetry
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
              {data.routeSignals.map((s) => (
                <div key={s.id} className="rounded-lg border p-2.5">
                  <div className="truncate text-[11px] text-muted-foreground">{s.label}</div>
                  <div
                    className={cn(
                      "text-sm font-semibold",
                      s.state === "breach" && "text-destructive",
                      s.state === "watch" && "text-status-warning",
                      s.state === "ok" && "text-status-success",
                    )}
                  >
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="incidents" className="space-y-2">
          {data.incidents.map((i) => (
            <div key={i.id} className={cn("rounded-lg border p-3", SEVERITY_STYLE[i.severity])}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    <Siren className="mr-1 inline h-3.5 w-3.5" />
                    {i.title}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{i.detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] capitalize">{i.severity}</Badge>
                  <Badge variant="secondary" className="text-[10px] capitalize">{i.state}</Badge>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 text-[11px] text-muted-foreground">
                <span className="capitalize">Domain: {i.domain.replace(/_/g, " ")}</span>
                <span>Entity: {access.canView ? i.entity : "•••• restricted"}</span>
                <span>Owner: {i.owner}</span>
                <span className="tabular-nums">{timeFmt(i.at)}</span>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="audit" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Every compliance decision is appended with the operator identity, justification, timestamp and chained hash.
            </p>
            <Button data-analytics="compliancecenter.export_csv" size="sm" variant="outline" className="h-7 text-[11px]" onClick={exportTrail} disabled={!access.canExport || trail.length === 0}>
              <Download className="mr-1 h-3 w-3" /> Export CSV
            </Button>
          </div>
          {trail.length === 0 && <p className="text-[11px] text-muted-foreground">No compliance decisions recorded yet.</p>}
          {trail.map((e) => (
            <div key={e.id} className="rounded-lg border p-3 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{e.action}</span>
                <span className="tabular-nums text-muted-foreground">{timeFmt(e.at)}</span>
              </div>
              <p className="text-muted-foreground">{e.subject}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                <span>by {e.actor}</span>
                <span className="font-mono">#{e.hash.slice(0, 8)}</span>
                {e.reason && <span>· {e.reason}</span>}
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          {pending && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-base">{complianceDecisionLabel(pending.decision)}</AlertDialogTitle>
                <AlertDialogDescription>
                  {pending.record.requirement} for {pending.record.entity} ({pending.record.reference}). Current state:{" "}
                  {pending.record.state}
                  {pending.record.validTo ? `, valid to ${dateFmt(pending.record.validTo)}` : ""}.
                  {pending.decision === "suspend" && " Suspension immediately removes the entity from dispatch eligibility."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div>
                <Label htmlFor="compliance-reason" className="text-[11px]">Justification (required)</Label>
                <Textarea
                  id="compliance-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 min-h-[60px] text-xs"
                  placeholder="Basis for the decision, evidence reviewed, follow-up owner"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Recorded as <span className="font-medium text-foreground">{actor}</span> · role {access.label}
                </p>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
                <AlertDialogAction className="text-xs" onClick={confirm}>Confirm decision</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
