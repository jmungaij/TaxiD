import * as React from "react";
import { cn } from "@/lib/utils";
import { surfaceClass, type SurfaceLevel, type BrandContextName } from "@/lib/design/designSystem";

/**
 * Surface — semantic elevation primitive (Phase 11).
 * Importance is communicated by elevation alone. Presentation only.
 */
export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  level?: SurfaceLevel;
  wash?: boolean;
  arrival?: boolean;
}

export function Surface({
  level = 2,
  wash = false,
  arrival = false,
  className,
  ...rest
}: SurfaceProps) {
  return (
    <div
      data-surface={level}
      className={cn(surfaceClass[level], wash && "context-wash", arrival && "motion-arrival", className)}
      {...rest}
    />
  );
}

/**
 * BrandContext — declares the semantic colour context for a subtree.
 * Corporate reads sapphire, operations titanium, executive gold, etc.
 */
export function BrandContext({
  context,
  className,
  children,
}: {
  context: BrandContextName;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-brand-context={context} className={className}>
      {children}
    </div>
  );
}

export default Surface;
