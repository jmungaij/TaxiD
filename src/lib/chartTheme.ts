/**
 * Enterprise Chart Theme (Phase 2)
 * -------------------------------------------------------------
 * Presentation-only. Reads certified HSL design tokens from CSS
 * variables so charts follow light/dark mode automatically.
 * Reuse: pass these values as props to existing Recharts wrappers.
 * DO NOT hardcode hex colors in chart components.
 */

const hsl = (v: string) => `hsl(var(${v}))`;
const hsla = (v: string, a: number) => `hsl(var(${v}) / ${a})`;

export const chartTheme = {
  series: [
    hsl("--chart-1"),
    hsl("--chart-2"),
    hsl("--chart-3"),
    hsl("--chart-4"),
    hsl("--chart-5"),
    hsl("--chart-6"),
  ],
  grid: hsl("--chart-grid"),
  axis: hsl("--muted-foreground"),
  tooltipBg: hsl("--popover"),
  tooltipFg: hsl("--popover-foreground"),
  tooltipBorder: hsl("--border"),
  status: {
    success: hsl("--status-success"),
    warning: hsl("--status-warning"),
    danger: hsl("--status-danger"),
    info: hsl("--status-info"),
    neutral: hsl("--status-neutral"),
  },
  ai: hsl("--ai-accent"),
  fill: (i: number, alpha = 0.15) => hsla(`--chart-${(i % 6) + 1}`, alpha),
  seriesAt: (i: number) => hsl(`--chart-${(i % 6) + 1}`),
} as const;

export type ChartTheme = typeof chartTheme;

/** Default Recharts <CartesianGrid /> props. */
export const gridProps = {
  stroke: chartTheme.grid,
  strokeDasharray: "3 3",
  vertical: false,
} as const;

/** Default Recharts axis props. */
export const axisProps = {
  stroke: chartTheme.axis,
  tick: { fill: chartTheme.axis, fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;

/** Default Recharts tooltip contentStyle. */
export const tooltipStyle: React.CSSProperties = {
  background: chartTheme.tooltipBg,
  color: chartTheme.tooltipFg,
  border: `1px solid ${chartTheme.tooltipBorder}`,
  borderRadius: 12,
  boxShadow: "var(--shadow-lg)",
  fontSize: 12,
};
