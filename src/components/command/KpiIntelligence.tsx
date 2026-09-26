/**
 * KPI intelligence strip. Each tile is an investigation entry point: hover
 * reveals the drill-down target, click navigates to the canonical workspace.
 * A failed metric renders "—" plus an explicit unavailable note.
 */
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Minus, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommandKpi, CommandTone } from "./types";

const TONE_TEXT: Record<CommandTone, string> = {
  neutral: "text-foreground",
  positive: "text-status-success",
  warning: "text-status-warning",
  critical: "text-destructive",
  info: "text-primary",
};

function Delta({ pct }: { pct?: number }) {
  if (pct === undefined || Number.isNaN(pct)) return null;
  const up = pct > 0;
  const flat = Math.abs(pct) < 0.05;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        flat ? "text-muted-foreground" : up ? "text-status-success" : "text-destructive",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {flat ? "flat" : `${up ? "+" : ""}${pct.toFixed(1)}%`}
    </span>
  );
}

function Tile({ kpi }: { kpi: CommandKpi }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {kpi.label}
        </span>
        {kpi.to && (
          <ChevronRight
            className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "text-3xl font-bold leading-none tracking-tight tabular-nums",
            kpi.unavailable ? "text-muted-foreground" : TONE_TEXT[kpi.tone ?? "neutral"],
          )}
        >
          {kpi.unavailable ? "—" : kpi.value}
        </span>
        {!kpi.unavailable && <Delta pct={kpi.deltaPct} />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {kpi.unavailable ? "Unavailable — not authoritative" : kpi.caption}
      </p>
    </>
  );

  const shell = "group glass-panel rounded-xl border p-4 text-left transition-shadow";
  return kpi.to ? (
    <Link to={kpi.to} className={cn(shell, "hover:shadow-elegant focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

export function KpiIntelligence({ kpis }: { kpis: CommandKpi[] }) {
  return (
    <section aria-label="Key performance intelligence" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((k) => (
        <Tile key={k.id} kpi={k} />
      ))}
    </section>
  );
}
