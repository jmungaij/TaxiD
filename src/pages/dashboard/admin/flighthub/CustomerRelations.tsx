import { useMemo } from "react";
import { FlightHubPage, HubSection } from "@/components/charter/FlightHubPage";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StatCard from "@/components/common/StatCard";
import { useFlightHub } from "@/lib/charter/useFlightHub";
import { buildCustomers, money } from "@/lib/charter/flightHub";

const TIER_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  platinum: "default", gold: "secondary", emerging: "outline",
};

export default function CustomerRelations() {
  const { data, loading, error, reload } = useFlightHub();
  const customers = useMemo(() => buildCustomers(data), [data]);
  const currency = customers[0]?.currency ?? "KES";
  const lifetime = customers.reduce((s, c) => s + c.value, 0);
  const repeat = customers.filter((c) => c.bookings > 1).length;
  const disrupted = customers.filter((c) => c.disruptions > 0);

  return (
    <FlightHubPage
      eyebrow="Flight Hub · Customers"
      title="Customer Operations & Relations Center"
      subtitle="Traveller value tiers, repeat behaviour, disruption exposure and the accounts that need a human touch today."
      loading={loading}
      error={error}
      onReload={reload}
      metrics={[
        { label: "Accounts", value: String(customers.length) },
        { label: "Lifetime value", value: money(lifetime, currency) },
        { label: "Repeat flyers", value: String(repeat) },
        { label: "Disrupted accounts", value: String(disrupted.length) },
      ]}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Platinum" value={customers.filter((c) => c.tier === "platinum").length} tone="primary" description="≥ 2M lifetime value" />
        <StatCard title="Gold" value={customers.filter((c) => c.tier === "gold").length} tone="success" description="≥ 500K lifetime value" />
        <StatCard title="Emerging" value={customers.filter((c) => c.tier === "emerging").length} description="Growth opportunity" />
        <StatCard title="Needs outreach" value={disrupted.length} tone={disrupted.length ? "warning" : "success"} description="Experienced a cancellation" />
      </div>

      {disrupted.length > 0 && (
        <HubSection title="Priority outreach" description="Accounts affected by a cancelled flight — contact before the next booking cycle.">
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {disrupted.slice(0, 6).map((c) => (
              <li key={c.key} className="rounded-xl border border-status-warning/40 bg-status-warning/8 p-4">
                <p className="font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">{c.email || "no email on file"}</p>
                <p className="mt-2 text-xs">
                  {c.disruptions} disruption{c.disruptions === 1 ? "" : "s"} · {money(c.value, c.currency)} lifetime
                </p>
              </li>
            ))}
          </ul>
        </HubSection>
      )}

      <HubSection title="Account register" description="Ranked by lifetime charter value.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Bookings</TableHead>
                <TableHead className="text-right">Lifetime value</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.key} className="row-hover">
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.email || "—"}</TableCell>
                  <TableCell><Badge variant={TIER_VARIANT[c.tier]}>{c.tier}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{c.bookings}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.value, c.currency)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.lastActivity ? new Date(c.lastActivity).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {customers.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No customer records yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </HubSection>
    </FlightHubPage>
  );
}
