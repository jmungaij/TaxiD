/**
 * TaxiD PARTNERS 360 — risk centre.
 *
 * Flags are raised by the idempotent server sweep (`partner_risk_scan`) from
 * authoritative records: expired compliance documents, expired supply
 * compliance, active-but-unverified partners and breached service levels.
 * Risk never terminates a partner automatically — resolution requires
 * compliance authority and is audited.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchPartners, partnerName } from "@/lib/partners/api";
import {
  fetchRiskFlags, resolveRiskFlag, runRiskScan, type RiskFlag, type RiskState,
} from "@/lib/partners/marketplace";

const SEVERITY_CLASS: Record<RiskFlag["severity"], string> = {
  low: "border-border text-muted-foreground",
  medium: "border-warning/40 text-warning",
  high: "border-destructive/40 text-destructive",
  critical: "border-destructive text-destructive",
};

export default function PartnerRiskCentre() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"open" | "closed">("open");

  const flags = useQuery({ queryKey: ["yp-risk"], queryFn: () => fetchRiskFlags() });
  const partners = useQuery({ queryKey: ["yp-partners"], queryFn: fetchPartners });

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of partners.data ?? []) map.set(p.id, partnerName(p));
    return map;
  }, [partners.data]);

  const scan = useMutation({
    mutationFn: runRiskScan,
    onSuccess: (n) => {
      toast.success(n > 0 ? `${n} new risk flag(s) raised.` : "Sweep complete — no new risk detected.");
      void qc.invalidateQueries({ queryKey: ["yp-risk"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Risk scan failed."),
  });

  const resolve = useMutation({
    mutationFn: (v: { id: string; state: RiskState }) => resolveRiskFlag(v.id, v.state),
    onSuccess: () => { toast.success("Risk flag updated and audited."); void qc.invalidateQueries({ queryKey: ["yp-risk"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Update failed."),
  });

  const all = flags.data ?? [];
  const open = all.filter((f) => f.state === "OPEN" || f.state === "INVESTIGATING");
  const closed = all.filter((f) => f.state === "RESOLVED" || f.state === "DISMISSED");
  const shown = tab === "open" ? open : closed;

  if (flags.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-9 w-1/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="TaxiD Partners 360"
        title="Partner risk centre"
        lede="Compliance, verification and service-level risk across the partner network — each flag traceable to the record that raised it."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => scan.mutate()} disabled={scan.isPending}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Run risk sweep
        </Button>
        <p className="text-xs text-muted-foreground">
          The sweep is idempotent — repeating it never duplicates a flag.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {([
          ["Open flags", open.length],
          ["Critical", open.filter((f) => f.severity === "critical").length],
          ["High", open.filter((f) => f.severity === "high").length],
          ["Closed", closed.length],
        ] as const).map(([label, value]) => (
          <div key={label} className="glass-panel rounded-xl border border-border/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "open" | "closed")} className="space-y-4">
        <TabsList>
          <TabsTrigger value="open"><ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Open</TabsTrigger>
          <TabsTrigger value="closed"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Closed</TabsTrigger>
        </TabsList>

        <TabsContent value={tab}>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">{tab === "open" ? "Requires intervention" : "Resolved and dismissed"}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {shown.length === 0 ? (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>{tab === "open"
                    ? "No open partner risk. Run the sweep to re-check compliance, verification and service levels against current records."
                    : "No risk flags have been closed yet."}</p>
                  {tab === "open" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => scan.mutate()} disabled={scan.isPending}>Run sweep</Button>
                      <Button asChild size="sm" variant="outline"><Link to="/staff/partners/work">Open work queues</Link></Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                shown.map((f) => (
                  <div key={f.id} className="rounded-lg border border-border/60 p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{f.detail}</p>
                        <p className="text-xs text-muted-foreground">
                          <Link to={`/staff/partners/${f.partner_id}`} className="hover:underline">
                            {labels.get(f.partner_id) ?? f.partner_id}
                          </Link>
                          {" · "}{f.kind}{" · "}{new Date(f.detected_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={`text-[10px] uppercase ${SEVERITY_CLASS[f.severity]}`}>{f.severity}</Badge>
                        <Badge variant="outline" className="text-[10px] uppercase">{f.state}</Badge>
                      </div>
                    </div>
                    {tab === "open" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {f.state === "OPEN" ? (
                          <Button size="sm" variant="outline" disabled={resolve.isPending}
                            onClick={() => resolve.mutate({ id: f.id, state: "INVESTIGATING" })}>
                            Investigate
                          </Button>
                        ) : null}
                        <Button size="sm" disabled={resolve.isPending}
                          onClick={() => resolve.mutate({ id: f.id, state: "RESOLVED" })}>
                          Mark resolved
                        </Button>
                        <Button size="sm" variant="outline" disabled={resolve.isPending}
                          onClick={() => resolve.mutate({ id: f.id, state: "DISMISSED" })}>
                          Dismiss
                        </Button>
                      </div>
                    ) : f.resolution_notes ? (
                      <p className="mt-2 text-xs text-muted-foreground">{f.resolution_notes}</p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
