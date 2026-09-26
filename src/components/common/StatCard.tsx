import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'ai';

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  description?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  /** Optional series rendered as a lightweight inline sparkline (no extra deps). */
  sparkline?: number[];
  /** Semantic accent for the icon chip and left rail. */
  tone?: StatTone;
  className?: string;
}

const TONE: Record<StatTone, { chip: string; rail: string; stroke: string }> = {
  default: { chip: 'bg-muted text-muted-foreground', rail: 'bg-border', stroke: 'hsl(var(--muted-foreground))' },
  primary: { chip: 'bg-primary/10 text-primary', rail: 'bg-primary', stroke: 'hsl(var(--primary))' },
  success: { chip: 'bg-status-success/12 text-status-success', rail: 'bg-status-success', stroke: 'hsl(var(--status-success))' },
  warning: { chip: 'bg-status-warning/12 text-status-warning', rail: 'bg-status-warning', stroke: 'hsl(var(--status-warning))' },
  danger: { chip: 'bg-status-danger/12 text-status-danger', rail: 'bg-status-danger', stroke: 'hsl(var(--status-danger))' },
  ai: { chip: 'bg-ai/12 text-ai', rail: 'bg-ai', stroke: 'hsl(var(--ai-accent))' },
};

function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 96;
  const h = 28;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((d - min) / span) * (h - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className="overflow-visible"
      role="img"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="none"
    >
      <polyline
        points={`0,${h} ${pts.join(' ')} ${w},${h}`}
        fill={stroke}
        opacity={0.1}
        stroke="none"
      />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const StatCard = ({ title, value, icon, description, trend, sparkline, tone = 'primary', className }: StatCardProps) => {
  const t = TONE[tone] ?? TONE.primary;
  return (
    <Card className={cn("stats-card relative overflow-hidden group", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-1 opacity-70 transition-opacity duration-base group-hover:opacity-100",
          t.rail,
        )}
      />
      <CardContent className="p-0 flex flex-col">
        <div className="flex justify-between items-start gap-3 mb-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">{title}</p>
            <h3 className="text-2xl font-bold mt-1 tabular-nums tracking-tight">{value}</h3>
          </div>
          {icon && (
            <div className={cn("h-10 w-10 shrink-0 rounded-xl flex items-center justify-center", t.chip)}>
              {icon}
            </div>
          )}
        </div>

        {sparkline && sparkline.length > 1 && (
          <div className="mt-1 -mb-1">
            <Sparkline data={sparkline} stroke={t.stroke} />
          </div>
        )}

        {(description || trend) && (
          <div className="flex items-center mt-2 gap-2">
            {trend && (
              <div className={cn(
                "text-xs font-semibold px-1.5 py-0.5 rounded-md tabular-nums",
                trend.isPositive
                  ? "text-status-success bg-status-success/15"
                  : "text-status-danger bg-status-danger/15"
              )}>
                {trend.isPositive ? '▲ ' : '▼ '}{Math.abs(trend.value)}%
              </div>
            )}
            {description && (
              <p className="text-xs text-muted-foreground truncate">{description}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StatCard;
