/**
 * Human time language for the Personal Operating System.
 *
 * Raw machine values ("2241m left", "score 94") are never rendered to staff.
 * Everything an employee reads is expressed the way a colleague would say it.
 */

export type TimeTone = "neutral" | "info" | "warning" | "danger" | "success";

/** 134 -> "2h 14m", 45 -> "45m", 600 -> "10h". */
export function humanizeMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hr = h % 24;
    return hr ? `${d}d ${hr}h` : `${d}d`;
  }
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Due language: "Due today · 4:30 PM", "Overdue by 1h 12m", "Due in 2h 14m". */
export function dueLabel(
  iso: string | null | undefined,
  now: Date = new Date(),
): { text: string; tone: TimeTone } {
  if (!iso) return { text: "No committed date", tone: "warning" };
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return { text: "No committed date", tone: "warning" };
  const diffMin = Math.round((due.getTime() - now.getTime()) / 60_000);

  if (diffMin < 0) return { text: `Overdue by ${humanizeMinutes(-diffMin)}`, tone: "danger" };

  const sameDay = due.toDateString() === now.toDateString();
  if (diffMin <= 120) return { text: `Due in ${humanizeMinutes(diffMin)}`, tone: diffMin <= 30 ? "warning" : "info" };
  if (sameDay) return { text: `Due today · ${clock(due)}`, tone: "info" };

  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (due.toDateString() === tomorrow.toDateString())
    return { text: `Due tomorrow · ${clock(due)}`, tone: "neutral" };

  return {
    text: `Due ${due.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}`,
    tone: "neutral",
  };
}

/** SLA language without exposing the countdown arithmetic. */
export function slaLabel(sla: {
  status: "on_track" | "at_risk" | "breached" | "met";
  remainingMinutes: number;
}): { text: string; tone: TimeTone } {
  switch (sla.status) {
    case "breached":
      return { text: `Overdue by ${humanizeMinutes(Math.abs(sla.remainingMinutes))}`, tone: "danger" };
    case "met":
      return { text: "Delivered on time", tone: "success" };
    case "at_risk":
      return { text: `SLA in ${humanizeMinutes(sla.remainingMinutes)}`, tone: "warning" };
    default:
      return { text: `${humanizeMinutes(sla.remainingMinutes)} of SLA left`, tone: "info" };
  }
}

/** "moments ago", "12 minutes ago", "3 days ago". */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "never";
  const min = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (min < 2) return "moments ago";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Header time: "Wednesday · 3:05 PM". */
export function headerMoment(now: Date = new Date()): string {
  return `${now.toLocaleDateString([], { weekday: "long" })} · ${clock(now)}`;
}

export function greetingFor(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
