import { type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DATA_STATE_LABEL, lastUpdatedText, type StaffMetric } from "@/lib/staff/dataState";

/** Page header — one clear question per surface, progressive disclosure below. */
export function StaffPageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</div>
        )}
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
        {lede && <p className="mt-2 text-sm text-muted-foreground">{lede}</p>}
      </div>
      {actions}
    </header>
  );
}

export function DataStateBadge({ state }: { state: StaffMetric["state"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] tracking-wide",
        state === "live" && "border-primary/40 text-primary",
        state === "modelled" && "border-info/40 text-info",
        state === "unavailable" && "border-muted-foreground/30 text-muted-foreground",
      )}
    >
      {DATA_STATE_LABEL[state]}
    </Badge>
  );
}

/** Metric tile that refuses to invent a number. */
export function MetricTile({ metric }: { metric: StaffMetric }) {
  const showValue = metric.state === "live" || metric.state === "modelled";
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground">{metric.label}</div>
          <DataStateBadge state={metric.state} />
        </div>
        <div className={cn("mt-2 font-semibold", showValue ? "text-2xl" : "text-sm text-muted-foreground")}>
          {showValue ? metric.value : DATA_STATE_LABEL[metric.state]}
        </div>
        {metric.hint && <div className="mt-1 text-xs text-muted-foreground">{metric.hint}</div>}
        {metric.source && <div className="mt-1 text-[11px] text-muted-foreground">Source: {metric.source}</div>}
        {metric.updatedAt && (
          <div className="mt-1 text-[11px] text-muted-foreground">{lastUpdatedText(metric.updatedAt)}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function StaffSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {description && <p className="mt-1 mb-4 text-sm text-muted-foreground">{description}</p>}
      <div className={description ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

/** Horizontal chain used for the revenue graph, commercial and people flows. */
export function FlowChain({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Process flow">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className="rounded-md border bg-card px-2.5 py-1 text-xs font-medium">{s}</span>
          {i < steps.length - 1 && (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}

export function ChipList({ items }: { items: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Badge key={i} variant="secondary" className="font-normal">
          {i}
        </Badge>
      ))}
    </div>
  );
}

export function InfoCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-3">
        {children}
        {footer}
      </CardContent>
    </Card>
  );
}
