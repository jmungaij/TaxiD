/**
 * SAFARID — Command Workspace Contract (Command Experience v1).
 *
 * Every domain command centre composes the SAME architectural layers:
 *
 *   1. Domain header (cinematic context band)
 *   2. KPI intelligence
 *   3. Contextual tabs
 *   4. Command canvas (domain-specific primary surface)
 *   5. Decision intelligence
 *   6. Action centre
 *   7. Activity stream
 *
 * Rules enforced by this contract:
 *   - No new design tokens. Compositions reuse the frozen Executive Blue
 *     primitives (`glass-panel`, `bg-gradient-hero-band`, status tokens).
 *   - No fabricated numbers. A metric that failed to load MUST set
 *     `unavailable: true` — never a confident `0`.
 *   - Every action/insight/alert MUST carry a real destination (`to`) or a real
 *     handler (`onAction`). A decorative control is a defect.
 */
import type { ReactNode } from "react";

export type CommandTone = "neutral" | "positive" | "warning" | "critical" | "info";

export type CommandRange = "7d" | "30d" | "90d" | "ytd";

export const COMMAND_RANGES: { key: CommandRange; label: string; days: number | "ytd" }[] = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "ytd", label: "YTD", days: "ytd" },
];

export interface CommandKpi {
  id: string;
  label: string;
  /** Formatted, human-readable value. Omit when `unavailable`. */
  value?: string;
  /** Sub-label answering the business question ("vs previous 30 days"). */
  caption?: string;
  /** Signed percentage change vs the previous comparable period. */
  deltaPct?: number;
  tone?: CommandTone;
  /** Canonical drill-down destination — the KPI becomes an investigation entry. */
  to?: string;
  /** True when the query failed; the surface renders "—", never a fake zero. */
  unavailable?: boolean;
}

export interface CommandInsight {
  id: string;
  /** The business observation, already resolved from real data. */
  headline: string;
  detail?: string;
  tone: CommandTone;
  /** Investigation destination. Required — insights are not decoration. */
  to: string;
  actionLabel: string;
}

export interface CommandAction {
  id: string;
  severity: "critical" | "high" | "medium" | "info";
  title: string;
  detail: string;
  /** Canonical workflow entry point for resolving this item. */
  to: string;
  actionLabel: string;
}

export interface CommandActivityEvent {
  id: string;
  at: string;
  actor?: string;
  summary: string;
  /** Opens the underlying record. */
  to?: string;
}

export interface CommandTabDef {
  key: string;
  label: string;
  render: () => ReactNode;
}

export interface CommandDataState {
  loading: boolean;
  error: string | null;
  refresh: () => void;
}
