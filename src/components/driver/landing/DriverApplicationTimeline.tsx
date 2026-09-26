/**
 * DriverApplicationTimeline — premium vertical timeline that frames the seven
 * existing onboarding stages. Reads progress from the existing draft record via
 * `useDriverApplicationStatus`; the wizard itself remains the single source of
 * truth for data capture.
 */
import { CheckCircle2, Circle, Clock, Loader2 } from "lucide-react";
import type { DriverApplicationStatus } from "@/hooks/useDriverApplicationStatus";

const STEPS = [
  { t: "Identity", review: "Instant", docs: "National ID or passport, live selfie" },
  { t: "Driving Licence", review: "Under 2 hours", docs: "Driving licence, PSV licence" },
  { t: "Vehicle", review: "Under 24 hours", docs: "Logbook, inspection, insurance" },
  { t: "Compliance", review: "Up to 48 hours", docs: "Background and record consent" },
  { t: "Training", review: "Self-paced", docs: "Safety and platform modules" },
  { t: "Review", review: "Within 24 hours", docs: "Nothing — our team verifies" },
  { t: "Activation", review: "Immediate", docs: "Dashboard and wallet go live" },
];

export function DriverApplicationTimeline({ status }: { status: DriverApplicationStatus }) {
  const current = status.status === "SUBMITTED" ? 7 : Math.min(7, Math.max(1, status.stage));

  return (
    <ol className="relative space-y-3" aria-label="Application journey">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const done = n < current || status.status === "SUBMITTED";
        const active = n === current && status.status !== "SUBMITTED";
        return (
          <li
            key={s.t}
            className={`rounded-2xl border p-4 transition-colors ${
              active ? "border-primary bg-primary/5" : done ? "border-primary/30 bg-card" : "border-border bg-card"
            }`}
          >
            <div className="flex items-start gap-3">
              {done ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              ) : active ? (
                <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Step {n} · {s.t}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    done ? "bg-primary/10 text-primary" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}>
                    {done ? "Completed" : active ? "In progress" : "Pending"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Required: {s.docs}</p>
                <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden="true" /> Estimated review: {s.review}
                </p>
              </div>
            </div>
          </li>
        );
      })}
      <li className="pt-1 text-xs text-muted-foreground">
        Your progress autosaves — you can close this page and resume any time from the same device or account.
      </li>
    </ol>
  );
}

export default DriverApplicationTimeline;
