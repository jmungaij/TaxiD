import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import StatCard from "@/components/common/StatCard";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { useFlightHub } from "@/lib/charter/useFlightHub";
import {
  buildCompliance, buildLifecycle, buildRoutes, buildSupportQueue, complianceScore, computePulse, money,
} from "@/lib/charter/flightHub";
import { LiveFlightMap } from "@/components/charter/LiveFlightMap";
import { AircraftCard, DestinationsStrip, JourneyRibbon } from "@/components/charter/CinematicPanels";
import { statusLabel } from "@/lib/charter/transitions";
import {
  ArrowRight, PlaneTakeoff, Radar, ShieldCheck, Wallet, Users, LifeBuoy, GitBranch, Handshake, Headset,
} from "lucide-react";

const MODULES = [
  { to: "/dashboard/admin/flight-hub/console", icon: Radar, title: "Flights Console", desc: "Live flight board, status transitions and disruption control." },
  { to: "/dashboard/admin/flight-hub/partners", icon: Handshake, title: "Partner Onboarding", desc: "Operator readiness pipeline from prospect to live fleet." },
  { to: "/dashboard/admin/flight-hub/lifecycle", icon: GitBranch, title: "Lifecycle", desc: "Enquiry → quote → booking → flown conversion funnel." },
  { to: "/dashboard/admin/flight-hub/payments", icon: Wallet, title: "Payment System", desc: "Settlement posture, exposure and payment method mix." },
  { to: "/dashboard/admin/flight-hub/compliance", icon: ShieldCheck, title: "Compliance", desc: "Evidence, operator accountability and reason-code integrity." },
  { to: "/dashboard/admin/flight-hub/relations", icon: Users, title: "Customer Operations & Relations", desc: "Traveller value tiers, disruption exposure and account health." },
  { to: "/dashboard/admin/flight-hub/operations", icon: Headset, title: "Operations Center", desc: "Relations and support consolidated with SLA health and quick actions." },
  { to: "/dashboard/admin/flight-hub/support", icon: LifeBuoy, title: "Support Desk", desc: "Prioritised exception queue derived from live operations." },
  { to: "/dashboard/admin/aviation-center", icon: PlaneTakeoff, title: "Aviation Command Center", desc: "Inventory, quotes, bookings and pricing audit trail." },
];

export default function FlightHub() {
  const { data, loading, error, reload } = useFlightHub();
  const pulse = useMemo(() => computePulse(data), [data]);
  const funnel = useMemo(() => buildLifecycle(data), [data]);
  const checks = useMemo(() => buildCompliance(data), [data]);
  const queue = useMemo(() => buildSupportQueue(data), [data]);
  const score = complianceScore(checks);
  const routes = useMemo(() => buildRoutes(data), [data]);
  const featuredFleet = useMemo(
    () => data.inventory.filter((i) => i.active).slice(0, 3),
    [data.inventory],
  );

  return (
    <FlightHubPage
      eyebrow="TaxiD Air · Flight Hub"
      title="Air Mobility Command Center"
      subtitle="One governed cockpit for charter demand, fleet readiness, settlement, compliance and traveller relations."
      loading={loading}
      error={error}
      onReload={reload}
      metrics={[
        { label: "Active flights", value: String(pulse.activeFlights) },
        { label: "Fleet available", value: `${pulse.fleetAvailable}/${pulse.fleetTotal}` },
        { label: "Gross booked", value: money(pulse.grossValue, pulse.currency) },
        { label: "Compliance score", value: `${score}%` },
      ]}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Open quotes" value={pulse.openQuotes} tone="primary" description="Awaiting pricing or acceptance" />
        <StatCard title="Quote conversion" value={`${pulse.conversionPct}%`} tone="success" description="Accepted or converted" />
        <StatCard title="Settled bookings" value={`${pulse.settledPct}%`} tone={pulse.settledPct >= 80 ? "success" : "warning"} description="Payment confirmed" />
        <StatCard title="Open exceptions" value={queue.length} tone={queue.length ? "danger" : "success"} description="Support desk queue" />
      </div>

      <LiveFlightMap legs={routes} dataset={data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <HubSection title="Journey visualisation" description="Live origin → destination ribbons across the TaxiD Air network.">
          <JourneyRibbon legs={routes} />
        </HubSection>
        <HubSection title="Destinations" description="Most-flown arrival points across current demand.">
          <DestinationsStrip legs={routes} />
        </HubSection>
      </div>

      {featuredFleet.length > 0 && (
        <HubSection title="Fleet spotlight" description="Contracted aircraft currently trading on the marketplace.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featuredFleet.map((i) => <AircraftCard key={i.id} item={i} />)}
          </div>
        </HubSection>
      )}

      <HubSection title="Flight Hub modules" description="Every air mobility capability, one click away.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {MODULES.map((m) => (
            <Link
              key={m.to}
              to={m.to}
              className="group rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/50 hover:shadow-[var(--shadow-lg)] motion-reduce:transform-none"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <m.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-3 font-semibold">{m.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{m.desc}</p>
              <span className="mt-3 inline-flex items-center text-sm text-primary">
                Open
                <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </HubSection>

      <div className="grid gap-6 lg:grid-cols-2">
        <HubSection title="Demand lifecycle" description="Conversion from first enquiry to flown revenue.">
          <ul className="space-y-3">
            {funnel.map((s) => (
              <li key={s.key}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{s.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {s.count}{s.dropOff > 0 && <span className="ml-2 text-status-warning">−{s.dropOff}</span>}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-gradient-hero" style={{ width: `${Math.max(4, s.share)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </HubSection>

        <HubSection title="Live operations feed" description="Most recent flight state changes across the fleet.">
          {data.bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bookings recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.bookings.slice(0, 6).map((b) => (
                <li key={b.id} className="row-hover flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{b.asset_name}</p>
                    <p className="truncate text-xs text-muted-foreground font-mono">{b.reference}</p>
                  </div>
                  <Badge variant="outline">{statusLabel(b.flight_status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </HubSection>
      </div>
    </FlightHubPage>
  );
}
