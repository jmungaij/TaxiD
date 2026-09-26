import { forwardRef, MouseEvent } from "react";
import { Link, LinkProps } from "react-router-dom";
import { logUiEvent } from "@/lib/navLog";
import { routeFor } from "@/lib/routes";

interface AppLinkProps extends Omit<LinkProps, "to"> {
  to: string;
  /** Stable id for ui_events; defaults to derived label/href. */
  trackId?: string;
  trackLabel?: string;
}

/**
 * Drop-in replacement for <Link> that:
 *  - logs every click to ui_events,
 *  - warns in dev when the target path isn't in the route registry.
 */
export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(
  { to, trackId, trackLabel, onClick, children, ...rest },
  ref,
) {
  const route = routeFor(to);

  if (import.meta.env.DEV && !route) {
     
    console.warn(`[AppLink] target "${to}" is not registered in src/lib/routes.ts`);
  }

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    void logUiEvent({
      elementId: trackId ?? `link:${to}`,
      elementLabel: trackLabel ?? (typeof children === "string" ? children : undefined),
      action: "navigate",
      success: !!route,
      errorMessage: route ? null : "DEAD_LINK",
      payload: { to },
    });
    onClick?.(e);
  };

  return (
    <Link ref={ref} to={to} onClick={handleClick} {...rest}>
      {children}
    </Link>
  );
});
