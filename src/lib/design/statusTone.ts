/**
 * Single tokenized source of truth for "traffic-light" status styling.
 *
 * Every success / warning / danger / info border, tint and text colour on the
 * platform must be resolved through this map — never hand-written Tailwind
 * colour utilities. This guarantees:
 *   • borders survive design sweeps (one place to change),
 *   • light + dark themes stay in sync (semantic tokens only),
 *   • no malformed double-opacity classes (`/30/30`) can be introduced,
 *     because opacity suffixes live here as complete literal class names.
 *
 * The literals below are intentionally spelled out so Tailwind's JIT scanner
 * can see them.
 */

export type StatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "accent"
  | "ai";

export interface ToneClasses {
  /** Tinted 1px border, e.g. cards and callouts. */
  border: string;
  /** Stronger border for emphasised callouts / alert banners. */
  borderStrong: string;
  /** Soft background tint. */
  bg: string;
  /** Foreground text/icon colour. */
  text: string;
  /** Inset ring used by pill badges (borderless). */
  ring: string;
  /** Solid dot / indicator colour. */
  dot: string;
}

export const STATUS_TONES: Record<StatusTone, ToneClasses> = {
  success: {
    border: "border-status-success/30",
    borderStrong: "border-status-success/50",
    bg: "bg-status-success/10",
    text: "text-status-success",
    ring: "ring-status-success/25",
    dot: "bg-status-success",
  },
  warning: {
    border: "border-status-warning/30",
    borderStrong: "border-status-warning/50",
    bg: "bg-status-warning/10",
    text: "text-status-warning",
    ring: "ring-status-warning/25",
    dot: "bg-status-warning",
  },
  danger: {
    border: "border-status-danger/30",
    borderStrong: "border-status-danger/50",
    bg: "bg-status-danger/10",
    text: "text-status-danger",
    ring: "ring-status-danger/25",
    dot: "bg-status-danger",
  },
  info: {
    border: "border-status-info/30",
    borderStrong: "border-status-info/50",
    bg: "bg-status-info/10",
    text: "text-status-info",
    ring: "ring-status-info/25",
    dot: "bg-status-info",
  },
  neutral: {
    border: "border-status-neutral/30",
    borderStrong: "border-status-neutral/50",
    bg: "bg-status-neutral/10",
    text: "text-status-neutral",
    ring: "ring-status-neutral/25",
    dot: "bg-status-neutral",
  },
  accent: {
    border: "border-primary/30",
    borderStrong: "border-primary/50",
    bg: "bg-primary/10",
    text: "text-primary",
    ring: "ring-primary/25",
    dot: "bg-primary",
  },
  ai: {
    border: "border-ai/30",
    borderStrong: "border-ai/50",
    bg: "bg-ai/10",
    text: "text-ai",
    ring: "ring-ai/25",
    dot: "bg-ai",
  },
};

export const STATUS_TONE_KEYS = Object.keys(STATUS_TONES) as StatusTone[];

/** Resolve tone classes, falling back to neutral for unknown tones. */
export function toneClasses(tone: StatusTone | string | undefined): ToneClasses {
  return STATUS_TONES[(tone ?? "neutral") as StatusTone] ?? STATUS_TONES.neutral;
}

/**
 * Map a numeric health/readiness score (0–100) to a status tone using the
 * platform-wide thresholds (>=90 healthy, >=70 at-risk, else critical).
 */
export function scoreTone(score: number): StatusTone {
  if (score >= 90) return "success";
  if (score >= 70) return "warning";
  return "danger";
}

/** Convenience: border class only (most common regression surface). */
export function statusBorder(tone: StatusTone | string | undefined, strong = false): string {
  const t = toneClasses(tone);
  return strong ? t.borderStrong : t.border;
}
