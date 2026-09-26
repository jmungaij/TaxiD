import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared Flight Hub page frame — cinematic hero band + consistent
 * loading/error affordances. Reuses the existing `hero-band` token so the
 * workspace inherits the frozen enterprise design system.
 */
export function FlightHubPage({
  eyebrow, title, subtitle, metrics, actions, loading, error, onReload, children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  metrics?: Array<{ label: string; value: string }>;
  actions?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onReload?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <header className="hero-band">
        {/* Cinematic aurora + horizon wash (decorative, token-driven). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_-10%,hsl(var(--ai-accent)/0.45),transparent_55%),radial-gradient(circle_at_88%_120%,hsl(var(--primary)/0.55),transparent_60%)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(to_top,hsl(var(--primary)/0.35),transparent)]"
        />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary-foreground/70">
              {eyebrow}
            </p>
            <h1 className="mt-2 text-2xl md:text-4xl font-bold tracking-tight [text-wrap:balance]">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-primary-foreground/80">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            {onReload && (
              <Button
                variant="secondary" size="sm" onClick={onReload} disabled={loading}
                className="gap-2 bg-primary-foreground/12 text-primary-foreground hover:bg-primary-foreground/20 border-0"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden="true" />
                Refresh
              </Button>
            )}
          </div>
        </div>

        {metrics && metrics.length > 0 && (
          <dl className="relative z-10 mt-6 grid gap-px overflow-hidden rounded-lg bg-primary-foreground/15 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((m) => (
              <div key={m.label} className="bg-primary/70 px-4 py-3 backdrop-blur-sm">
                <dt className="text-[11px] uppercase tracking-wider text-primary-foreground/70">{m.label}</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      {error && (
        <div className="rounded-xl border border-status-danger/40 bg-status-danger/8 p-4 text-sm text-status-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : children}
    </div>
  );
}

/** Compact labelled section header used inside Flight Hub cards. */
export function HubSection({ title, description, children, actions }: {
  title: string; description?: string; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="enterprise-surface p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">{title}</h2>
          {description && <p className="section-subtitle mt-0.5">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
