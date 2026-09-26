/**
 * DriverLiveApplicationStatus — replaces the old "you're in the queue"
 * micro-copy with an enterprise status panel. Read-only: it renders the state
 * already stored on the existing onboarding draft record.
 */
import { BellRing, Mail, MessageSquare, LayoutDashboard, Wallet, UserCheck, Clock } from "lucide-react";
import { DriverApplicationTimeline } from "./DriverApplicationTimeline";
import type { DriverApplicationStatus } from "@/hooks/useDriverApplicationStatus";

const CHANNELS = [
  { icon: Mail, t: "Email update", d: "Decision sent to your registered address" },
  { icon: MessageSquare, t: "SMS alert", d: "Status change texted to your M-Pesa number" },
  { icon: BellRing, t: "In-app notification", d: "Delivered to your driver notifications" },
  { icon: LayoutDashboard, t: "Dashboard activation", d: "Unlocked the moment you are approved" },
  { icon: Wallet, t: "Wallet activation", d: "Settlement wallet created automatically" },
];

export function DriverLiveApplicationStatus({ status }: { status: DriverApplicationStatus }) {
  const submitted = status.status === "SUBMITTED";
  if (!submitted) return null;

  return (
    <section className="bg-secondary/30 py-16 md:py-20" aria-labelledby="live-status-title">
      <div className="container mx-auto px-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Live application status</p>
        <h2 id="live-status-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
          Application Successfully Submitted
        </h2>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Current status</dt>
                <dd className="mt-1 text-lg font-semibold">Verification in Progress</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Estimated approval</dt>
                <dd className="mt-1 inline-flex items-center gap-1.5 text-lg font-semibold">
                  <Clock className="h-4 w-4 text-primary" aria-hidden="true" /> Within 24 Hours
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Assigned reviewer</dt>
                <dd className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium">
                  <UserCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Driver Compliance Team
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Submitted</dt>
                <dd className="mt-1 text-sm font-medium">
                  {status.submittedAt ? new Date(status.submittedAt).toLocaleString() : "Just now"}
                </dd>
              </div>
            </dl>

            <h3 className="mt-6 text-sm font-semibold">How you will be notified</h3>
            <ul className="mt-3 space-y-2">
              {CHANNELS.map((c) => (
                <li key={c.t} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                  <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <div className="text-sm font-medium">{c.t}</div>
                    <div className="text-xs text-muted-foreground">{c.d}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold">Verification timeline</h3>
            <DriverApplicationTimeline status={status} />
          </div>
        </div>
      </div>
    </section>
  );
}

export default DriverLiveApplicationStatus;
