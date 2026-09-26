import React from "react";
import { cn } from "@/lib/utils";

/**
 * EnterpriseHeroBand — Phase 2 (presentation-only)
 * -------------------------------------------------------------
 * Reusable header band for every workspace overview. Contains
 * ZERO business logic. Callers provide title, subtitle, optional
 * eyebrow (breadcrumbs), and action slot.
 */
export interface EnterpriseHeroBandProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  tone?: "brand" | "ai" | "surface";
}

const toneClass: Record<NonNullable<EnterpriseHeroBandProps["tone"]>, string> = {
  brand: "bg-gradient-hero-band text-primary-foreground",
  ai: "bg-gradient-ai text-ai-foreground",
  surface: "bg-card text-card-foreground border border-border",
};

export function EnterpriseHeroBand({
  title,
  subtitle,
  eyebrow,
  actions,
  children,
  className,
  tone = "brand",
}: EnterpriseHeroBandProps) {
  const inverted = tone !== "surface";
  const headingId = React.useId();
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl shadow-enterprise-lg",
        "px-5 py-6 sm:px-8 sm:py-8",
        toneClass[tone],
        className,
      )}
      aria-label={typeof title === "string" ? title : undefined}
      aria-labelledby={typeof title === "string" ? undefined : headingId}
    >
      {inverted && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40 [background:radial-gradient(80%_60%_at_100%_0%,hsl(var(--primary-glow)/.35),transparent_60%),radial-gradient(60%_40%_at_0%_100%,hsl(var(--ai-glow)/.25),transparent_60%)]"
        />
      )}
      <div className="relative flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          {eyebrow && (
            <div className={cn("text-xs uppercase tracking-wider", inverted ? "text-primary-foreground/70" : "text-muted-foreground")}>
              {eyebrow}
            </div>
          )}
          <h1 id={headingId} className="text-2xl sm:text-3xl font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle && (
            <p className={cn("text-sm sm:text-base max-w-2xl", inverted ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children && <div className="relative mt-6">{children}</div>}
    </section>
  );
}

export default EnterpriseHeroBand;
