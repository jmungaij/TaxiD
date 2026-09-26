import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { CinematicHeading, JourneyRibbon } from "@/components/charter/CinematicPanels";
import { useFlightHub } from "@/lib/charter/useFlightHub";
import { buildCustomers, buildRoutes, buildSupportQueue, money, pct } from "@/lib/charter/flightHub";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { LifeBuoy, Users, Radar, PhoneCall, Mail, ArrowUpRight } from "lucide-react";
import {
  DEFAULT_SLA_CONFIG, escalateQueue, loadSlaConfig, sanitiseSlaConfig, saveSlaConfig, type SlaConfig,
} from "@/lib/charter/slaEscalation";

const PRIORITY = {
  p1: { label: "P1 · Critical", cls: "bg-status-danger/12 text-status-danger" },
  p2: { label: "P2 · High", cls: "bg-status-warning/12 text-status-warning" },
  p3: { label: "P3 · Normal", cls: "bg-primary/10 text-primary" },
} as const;


export default function OperationsCenter() {
  const { data, loading, error, reload } = useFlightHub();
  const [priority, setPriority] = useState<"all" | keyof typeof PRIORITY>("all");
  const [sla, setSla] = useState<SlaConfig>(() => loadSlaConfig());

  const updateSla = (patch: Partial<SlaConfig>) => {
    const next = sanitiseSlaConfig({ ...sla, ...patch });
    setSla(next);
    saveSlaConfig(next);
  };

  const queue = useMemo(() => buildSupportQueue(data), [data]);
  const customers = useMemo(() => buildCustomers(data), [data]);
  const routes = useMemo(() => buildRoutes(data), [data]);

  // Auto-escalation: items past the configured threshold are bumped a level.
  const enriched = useMemo(() => escalateQueue(queue, sla), [queue, sla]);
  const visible = priority === "all" ? enriched : enriched.filter((t) => t.priority === priority);
  const breaches = enriched.filter((t) => t.breached).length;
  const escalated = enriched.filter((t) => t.escalated).length;
  const slaCompliance = pct(enriched.length - breaches, enriched.length || 1);
  const atRisk = customers.filter((c) => c.disruptions > 0);

  return (
    <FlightHubPage
      eyebrow="Flight Hub · Operations"
      title="Operations Center"
      subtitle="One console for customer relations and service recovery — priority queues, SLA health and the accounts behind every exception."
      loading={loading}
      error={error}
      onReload={reload}
      metrics={[
        { label: "Open exceptions", value: String(enriched.length) },
        { label: "SLA compliance", value: `${slaCompliance}%` },
        { label: "SLA breaches", value: String(breaches) },
        { label: "Auto-escalated", value: String(escalated) },
        { label: "Accounts at risk", value: String(atRisk.length) },
      ]}
      actions={
        <div className="flex gap-2">
          <Button asChild size="sm" variant="secondary" className="gap-2 border-0 bg-primary-foreground/12 text-primary-foreground hover:bg-primary-foreground/20">
            <Link to="/dashboard/admin/flight-hub/support"><LifeBuoy className="h-4 w-4" aria-hidden="true" />Support desk</Link>
          </Button>
          <Button asChild size="sm" variant="secondary" className="gap-2 border-0 bg-primary-foreground/12 text-primary-foreground hover:bg-primary-foreground/20">
            <Link to="/dashboard/admin/flight-hub/relations"><Users className="h-4 w-4" aria-hidden="true" />Relations</Link>
          </Button>
        </div>
      }
    >
      <HubSection
        title="Priority queue"
        description="Live exceptions with SLA burn-down. Quick actions open the account or the flight record."
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {(["p1", "p2", "p3"] as const).map((p) => (
              <label key={`sla-${p}`} className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="uppercase">{p}</span>
                <Input
                  type="number" min={0.25} step={0.25} value={sla[p]}
                  aria-label={`${p.toUpperCase()} SLA target in hours`}
                  onChange={(e) => updateSla({ [p]: Number(e.target.value) } as Partial<SlaConfig>)}
                  className="h-8 w-16 text-xs"
                />
                <span>h</span>
              </label>
            ))}
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Escalate at</span>
              <Input
                type="number" min={10} max={100} step={5} value={sla.escalateAtPct}
                aria-label="Escalation threshold percentage"
                onChange={(e) => updateSla({ escalateAtPct: Number(e.target.value) })}
                className="h-8 w-16 text-xs"
              />
              <span>%</span>
            </label>
            <Button size="sm" variant="ghost" onClick={() => { setSla(DEFAULT_SLA_CONFIG); saveSlaConfig(DEFAULT_SLA_CONFIG); }}>Reset</Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {(["all", "p1", "p2", "p3"] as const).map((p) => (
              <Button key={p} size="sm" variant={priority === p ? "default" : "outline"} onClick={() => setPriority(p)} className="uppercase">
                {p}
              </Button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Priority</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead className="w-40">SLA</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((t) => (
                <TableRow key={t.item.id} className="row-hover">
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", PRIORITY[t.priority].cls)}>
                        {PRIORITY[t.priority].label}
                      </span>
                      {t.escalated && (
                        <Badge variant="outline" className="gap-1 border-status-warning/40 text-status-warning" title={`Auto-escalated from ${t.basePriority.toUpperCase()} at ${t.consumedPct}% of target`}>
                          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />escalated
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{t.item.reference}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-sm">{t.item.subject}</TableCell>
                  <TableCell className="text-sm capitalize text-muted-foreground">{t.item.origin}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={t.health} className="h-2" />
                      <span className={cn("w-16 text-right text-xs tabular-nums", t.breached ? "text-status-danger" : "text-muted-foreground")}>
                        {t.breached ? "breached" : `${Math.max(0, Math.round(t.targetHours - t.ageHours))}h left`}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button asChild size="sm" variant="outline" className="gap-1.5">
                        <Link to={`/charter/booking-status?reference=${encodeURIComponent(t.item.reference)}`}>
                          <Radar className="h-3.5 w-3.5" aria-hidden="true" />Flight
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost" className="gap-1.5">
                        <Link to="/dashboard/admin/flight-hub/relations"><PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />Outreach</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Queue clear — no open exceptions.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </HubSection>

      <div className="grid gap-6 lg:grid-cols-2">
        <HubSection title="Accounts requiring outreach" description="Highest-value clients touched by a disruption.">
          <ul className="space-y-3">
            {atRisk.slice(0, 6).map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.email || "No email on file"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant={c.tier === "platinum" ? "default" : "secondary"} className="capitalize">{c.tier}</Badge>
                  <span className="text-xs tabular-nums text-muted-foreground">{money(c.value, c.currency)}</span>
                  {c.email && (
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                      <a href={`mailto:${encodeURIComponent(c.email)}`}><Mail className="h-3.5 w-3.5" aria-hidden="true" />Email</a>
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {atRisk.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">No disrupted accounts.</li>}
          </ul>
        </HubSection>

        <HubSection title="Journey pressure" description="Where exceptions concentrate across the live network.">
          <CinematicHeading eyebrow="Network" title="Busiest journeys">
            Routes are ranked by airborne flights, then total volume.
          </CinematicHeading>
          <JourneyRibbon legs={routes} limit={4} />
        </HubSection>
      </div>
    </FlightHubPage>
  );
}
