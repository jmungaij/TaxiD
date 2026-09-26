/**
 * AppButton — governance wrapper around shadcn <Button>.
 *
 * Every CTA in the app should use this. It enforces:
 *   • action_type     (navigate | external | submit | dialog | scroll | noop)
 *   • target          (URL/path)
 *   • analytics_event (auto-logged to cta_events)
 *   • role checks     (hidden if user lacks role)
 *
 * Falls back to a normal Button when only onClick is provided so it remains
 * a drop-in replacement.
 */
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { trackCta, type CtaActionType } from "@/lib/cta";
import { useAuth } from "@/hooks/useAuth";
import type { AppRole } from "@/lib/routes";

export interface AppButtonProps extends Omit<ButtonProps, "asChild"> {
  /** Stable analytics name, e.g. "hero_driver_apply" */
  analytics: string;
  /** What the button does */
  action: CtaActionType;
  /** Path or URL */
  target?: string;
  /** Limit visibility to these roles. Empty/undefined = visible to all. */
  requireRoles?: AppRole[];
  /** When true, hide instead of disable if role check fails */
  hideIfUnauthorized?: boolean;
  /** Extra context attached to the CTA event */
  trackingMeta?: Record<string, unknown>;
}

export const AppButton = React.forwardRef<HTMLButtonElement, AppButtonProps>(
  function AppButton(
    {
      analytics,
      action,
      target,
      requireRoles,
      hideIfUnauthorized,
      trackingMeta,
      onClick,
      children,
      ...rest
    },
    ref,
  ) {
    const navigate = useNavigate();
    const { roles } = useAuth();

    const authorized =
      !requireRoles || requireRoles.length === 0 ||
      requireRoles.some(r => roles?.includes(r));

    if (!authorized && hideIfUnauthorized) return null;

    const handle = (e: React.MouseEvent<HTMLButtonElement>) => {
      void trackCta({
        buttonName: analytics,
        actionType: action,
        target,
        metadata: trackingMeta,
      });
      if (onClick) onClick(e);
      if (e.defaultPrevented) return;
      if (action === "navigate" && target) {
        e.preventDefault();
        if (target.startsWith("http")) window.location.href = target;
        else navigate(target);
      } else if (action === "external" && target) {
        e.preventDefault();
        window.open(target, "_blank", "noopener,noreferrer");
      } else if (action === "scroll" && target) {
        e.preventDefault();
        const id = target.startsWith("#") ? target.slice(1) : target;
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (target.startsWith("#")) {
          window.location.hash = target;
        }
      }
    };

    // External anchor for SEO when navigating to a hard URL
    if (action === "navigate" && target && !target.startsWith("http")) {
      return (
        <Button asChild {...rest} disabled={!authorized || rest.disabled}>
          <Link
            to={target}
            data-analytics={analytics}
            data-action={action}
            onClick={(e) => {
              void trackCta({ buttonName: analytics, actionType: action, target, metadata: trackingMeta });
              onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>);
            }}
          >
            {children}
          </Link>
        </Button>
      );
    }

    return (
      <Button
        ref={ref}
        {...rest}
        disabled={!authorized || rest.disabled}
        data-analytics={analytics}
        data-action={action}
        data-target={target}
        onClick={handle}
      >
        {children}
      </Button>
    );
  },
);
