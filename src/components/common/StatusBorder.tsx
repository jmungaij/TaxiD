import React from "react";
import { cn } from "@/lib/utils";
import { toneClasses, type StatusTone } from "@/lib/design/statusTone";

export interface StatusBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  tone: StatusTone;
  /** Use the stronger border weight (alert banners, escalations). */
  strong?: boolean;
  /** Include the soft background tint. */
  tinted?: boolean;
  /** Render as a different element (e.g. "section", "li"). */
  as?: keyof React.JSX.IntrinsicElements;
}

/**
 * Tokenized status container — the single approved way to render a
 * colour-coded ("traffic-light") border/callout across dashboards.
 *
 * All colours resolve through `STATUS_TONES`, so light and dark themes and
 * future design sweeps stay consistent.
 */
export const StatusBorder = React.forwardRef<HTMLDivElement, StatusBorderProps>(
  ({ tone, strong = false, tinted = false, as = "div", className, children, ...rest }, ref) => {
    const t = toneClasses(tone);
    const Comp = as as React.ElementType;
    return (
      <Comp
        ref={ref}
        data-status-tone={tone}
        className={cn(
          "rounded-lg border",
          strong ? t.borderStrong : t.border,
          tinted && t.bg,
          className,
        )}
        {...rest}
      >
        {children}
      </Comp>
    );
  },
);
StatusBorder.displayName = "StatusBorder";

export default StatusBorder;
