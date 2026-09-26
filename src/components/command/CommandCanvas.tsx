/**
 * Command canvas — the large central operational surface of a domain. It is
 * intentionally a *slot*: the Admin domain fills it with platform intelligence,
 * Drivers with supply/demand, Delivery with the live network, and so on, so the
 * eight domains never collapse into eight identical dashboards.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CommandCanvas({
  title,
  subtitle,
  toolbar,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cn("glass-panel rounded-xl border", className)}>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {toolbar}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
