/**
 * ADMIN COMMAND CENTRE — Command Experience v1.
 *
 * The Administration domain's command environment. Composes the shared
 * CommandWorkspace layers over real platform data (accounts, settled payments,
 * compliance alerts, dead-letter events, navigation integrity runs). Nothing on
 * this page is decorative: every KPI, insight and action resolves to a canonical
 * administrative destination, and any failed query renders "—" rather than 0.
 */
import { Link } from "react-router-dom";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  ActionCenter,
  ActivityStream,
  CommandCanvas,
  CommandWorkspace,
  DecisionIntelligence,
  type CommandRange,
  type CommandTabDef,
} from "@/components/command";
import { useAdminCommandIntelligence } from "@/hooks/useAdminCommandIntelligence";
import { Button } from "@/components/ui/button";
import AdminSurfacesTab from "./command/AdminSurfacesTab";

const KES = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });

function SettledSparkline({ series }: { series: { day: string; value: number }[] }) {
  if (series.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No settled payments recorded in this period.
      </p>
    );
  }
  const max = Math.max(...series.map((p) => p.value));
  return (
    <div className="space-y-3">
      <div className="flex h-40 items-end gap-1" role="img" aria-label="Daily settled payment value">
        {series.map((p) => (
          <div key={p.day} className="group relative flex-1">
            <div
              className="rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
              style={{ height: `${max > 0 ? Math.max(2, (p.value / max) * 156) : 2}px` }}
            />
            <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
              {p.day} · KES {KES.format(p.value)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Peak day KES {KES.format(max)} · {series.length} days with settlement activity.
      </p>
    </div>
  );
}

function IntegrityPanel({
  run,
  score,
}: {
  run: ReturnType<typeof useAdminCommandIntelligence>["snapshot"]["integrity"];
  score: number | null;
}) {
  if (!run) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No navigation integrity run has been recorded yet.
      </p>
    );
  }
  const rows = [
    { label: "Dead routes", value: run.dead_routes, bad: run.dead_routes > 0 },
    { label: "Registry mismatch", value: run.registry_mismatch, bad: run.registry_mismatch > 0 },
    { label: "Unbound controls", value: run.unbound_buttons, bad: run.unbound_buttons > 0 },
    { label: "Orphan routes", value: run.orphan_routes, bad: false },
    { label: "Missing analytics", value: run.missing_analytics, bad: false },
    {
      label: "Permission violations",
      value: run.permission_violations ?? 0,
      bad: (run.permission_violations ?? 0) > 0,
    },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold">{score ?? "—"}%</span>
        <span className="text-sm text-muted-foreground">
          gate {run.passed ? "passing" : "failing"} · {new Date(run.ran_at).toLocaleString()}
        </span>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
            <dt className="text-sm text-muted-foreground">{r.label}</dt>
            <dd className={r.bad ? "font-semibold text-destructive" : "font-semibold"}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <Button asChild variant="outline" size="sm">
        <Link to="/dashboard/admin/integrity-report">Open integrity report</Link>
      </Button>
    </div>
  );
}

export default function AdminCommandCenter() {
  const [range, setRange] = useState<CommandRange>("30d");
  const { kpis, insights, actions, activity, series, snapshot, integrityScore, loading, error, refresh } =
    useAdminCommandIntelligence(range);

  const tabs: CommandTabDef[] = [
    {
      key: "overview",
      label: "Overview",
      render: () => (
        <>
          <CommandCanvas
            title="Settlement flow"
            subtitle="Daily successful M-Pesa value across the selected period"
          >
            <SettledSparkline series={series} />
          </CommandCanvas>
          <div className="grid gap-4 lg:grid-cols-2">
            <DecisionIntelligence insights={insights} />
            <ActionCenter actions={actions} />
          </div>
        </>
      ),
    },
    {
      key: "intelligence",
      label: "Intelligence",
      render: () => (
        <>
          <DecisionIntelligence
            title="Platform observations"
            insights={insights}
            emptyMessage="No account, payment or compliance signal crossed a decision threshold in this window."
          />
          <CommandCanvas title="Platform integrity" subtitle="Latest navigation integrity gate evidence">
            <IntegrityPanel run={snapshot.integrity} score={integrityScore} />
          </CommandCanvas>
        </>
      ),
    },
    {
      key: "operations",
      label: "Operations",
      render: () => (
        <>
          <ActionCenter actions={actions} title="Operational triage" />
          <ActivityStream events={activity} title="Administrative audit stream" />
        </>
      ),
    },
    { key: "surfaces", label: "Surfaces", render: () => <AdminSurfacesTab /> },
  ];

  return (
    <CommandWorkspace
      domain="Administration"
      title="Admin Command Centre"
      sublabel="Platform integrity, settlement health, compliance risk and every administrative surface in one command environment."
      icon={<ShieldCheck className="h-7 w-7" aria-hidden />}
      kpis={kpis}
      tabs={tabs}
      loading={loading}
      error={error}
      onRefresh={refresh}
      range={range}
      onRangeChange={setRange}
    />
  );
}
