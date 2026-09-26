/**
 * CommandWorkspace — the single reusable enterprise command shell instantiated
 * by every Yalla domain (Admin, Riders, Drivers, Charter & Business, Delivery &
 * Logistics, Leasing & Rentals, Payments & Finance, Settings).
 *
 * Layers: cinematic domain header → KPI intelligence → contextual tabs →
 * per-tab composition (canvas / intelligence / action centre / stream).
 *
 * Deep-link contract: `?tab=` selects the contextual tab, so any KPI, insight or
 * alert elsewhere in the platform can land the operator on the exact surface.
 */
import * as React from "react";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import { KpiIntelligence } from "./KpiIntelligence";
import { COMMAND_RANGES, type CommandKpi, type CommandRange, type CommandTabDef } from "./types";

export function CommandWorkspace({
  domain,
  title,
  sublabel,
  icon,
  kpis,
  tabs,
  loading,
  error,
  onRefresh,
  range,
  onRangeChange,
  headerAside,
}: {
  domain: string;
  title: string;
  sublabel: string;
  icon?: React.ReactNode;
  kpis: CommandKpi[];
  tabs: CommandTabDef[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  range?: CommandRange;
  onRangeChange?: (r: CommandRange) => void;
  headerAside?: React.ReactNode;
}) {
  const keys = React.useMemo(() => tabs.map((t) => t.key), [tabs]);
  const { tab, goTo } = useTabDeepLink(keys, keys[0]);
  const active = tabs.find((t) => t.key === tab) ?? tabs[0];

  return (
    <div className="space-y-5">
      {/* Layer 1 — cinematic domain context band */}
      <header className="hero-band px-6 py-6">
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">{domain}</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
              {icon}
              {title}
            </h1>
            <p className="mt-1 max-w-2xl text-sm opacity-85">{sublabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {headerAside}
            {range && onRangeChange && (
              <div
                role="group"
                aria-label="Reporting period"
                className="flex overflow-hidden rounded-lg border border-primary-foreground/25"
              >
                {COMMAND_RANGES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    aria-pressed={range === r.key}
                    onClick={() => onRangeChange(r.key)}
                    className={cn(
                      "px-2.5 py-1.5 text-xs font-semibold transition-colors",
                      range === r.key
                        ? "bg-primary-foreground/95 text-primary"
                        : "text-primary-foreground/80 hover:bg-primary-foreground/10",
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
            {onRefresh && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onRefresh}
                disabled={loading}
                aria-label="Refresh command data"
              >
                {loading ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" aria-hidden />
                )}
                Refresh
              </Button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Some intelligence could not be loaded — affected figures show “—” and are not authoritative. {error}
          </span>
        </div>
      )}

      {/* Layer 2 — KPI intelligence */}
      <KpiIntelligence kpis={kpis} />

      {/* Layer 3 — contextual tabs */}
      <nav
        aria-label="Command workspace sections"
        className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active.key}
            onClick={() => goTo(t.key)}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              t.key === active.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Layers 4-9 — per-domain composition */}
      <div role="tabpanel" aria-label={active.label} className="space-y-4">
        {active.render()}
      </div>
    </div>
  );
}
