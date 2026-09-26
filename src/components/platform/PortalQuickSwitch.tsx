/**
 * Portal quick-switch — instant jump between the operating contexts an
 * identity is authorised to enter (Staff Operations, Super Admin Control
 * Centre), plus deep links to the most-used landing pages inside each.
 *
 * Authority is server-resolved: contexts come from `resolve_operating_contexts`
 * and every jump is re-authorised and audited by `switch_operating_context`.
 * This component only presents what the server already granted. The remembered
 * portal is a UX hint (localStorage + cookie) and never widens authority.
 */
import * as React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowUpRight, Loader2, ShieldCheck, Star } from "lucide-react";

import { toast } from "@/hooks/use-toast";
import { requestContextSwitch } from "@/lib/platform/operatingContextApi";
import {
  OPERATING_CONTEXTS,
  activeOperatingContext,
  type OperatingContextKey,
} from "@/lib/platform/operatingContexts";
import {
  PORTAL_DEEP_LINKS,
  auditPortalTransition,
  readRememberedPortal,
  rememberPortal,
} from "@/lib/platform/portalPreference";
import { useOperatingContext } from "@/hooks/useOperatingContext";

/** Presentation surface — glass panel (dark chrome) or plain card. */
export function PortalQuickSwitch({ tone = "glass" }: { tone?: "glass" | "card" }) {
  const { identity, loading } = useOperatingContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = React.useState<string | null>(null);
  const [remembered, setRemembered] = React.useState<OperatingContextKey | null>(null);

  React.useEffect(() => setRemembered(readRememberedPortal()), []);

  if (loading || !identity?.authenticated) return null;

  const contexts = OPERATING_CONTEXTS.filter((c) => identity.contexts.includes(c.key));
  if (contexts.length < 2) return null;

  const currentContext = activeOperatingContext(location.pathname);

  const jump = async (
    next: OperatingContextKey,
    to: string,
    kind: "portal_switch" | "deep_link",
  ) => {
    setPending(to);
    const res = await requestContextSwitch({ next, previous: currentContext });
    setPending(null);
    if (!res.ok) {
      toast({
        title: "Portal switch denied",
        description: "The server did not authorise this operating context.",
        variant: "destructive",
      });
      return;
    }
    rememberPortal(next);
    setRemembered(next);
    void auditPortalTransition({
      kind,
      newRoute: to,
      previousRoute: location.pathname,
      newContext: next,
      previousContext: currentContext,
    });
    navigate(to);
  };

  const dark = tone === "glass";
  const roles = identity.roles.length ? identity.roles : ["—"];

  return (
    <div className="mt-5">
      {/* Active identity: resolved role, held roles and the authorised portals. */}
      <div
        className={
          dark
            ? "rounded-lg border border-white/15 bg-primary/30 p-3"
            : "rounded-lg border border-border bg-muted/40 p-3"
        }
      >
        <p
          className={
            dark
              ? "text-[11px] font-semibold uppercase tracking-[0.18em] text-ice/80"
              : "text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          }
        >
          Active role &amp; authorised portal
        </p>
        <p
          className={
            dark
              ? "mt-1 text-sm font-semibold text-primary-foreground"
              : "mt-1 text-sm font-semibold text-foreground"
          }
        >
          {identity.resolved_role ?? "Authenticated user"}
          {currentContext && (
            <span className={dark ? "text-ice" : "text-muted-foreground"}>
              {" · "}
              {OPERATING_CONTEXTS.find((c) => c.key === currentContext)?.label}
            </span>
          )}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <span
              key={r}
              className={
                dark
                  ? "rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ice"
                  : "rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              }
            >
              {r}
            </span>
          ))}
        </div>
        {identity.identity && (
          <p className={dark ? "mt-2 text-[11px] text-ice" : "mt-2 text-[11px] text-muted-foreground"}>
            {identity.identity}
          </p>
        )}
      </div>

      <p
        className={
          dark
            ? "mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ice/80"
            : "mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
        }
      >
        Switch portal
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {contexts.map((c) => (
          <div
            key={c.key}
            className={
              dark
                ? "rounded-lg border border-white/15 bg-primary/40 p-3"
                : "rounded-lg border border-border bg-card p-3"
            }
          >
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void jump(c.key, c.to, "portal_switch")}
              className="flex w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ice disabled:opacity-60"
            >
              {pending === c.to ? (
                <Loader2 className="mt-0.5 h-4 w-4 animate-spin" aria-hidden />
              ) : c.key === "super_admin" ? (
                <ShieldCheck
                  className={dark ? "mt-0.5 h-4 w-4 text-brand-azure" : "mt-0.5 h-4 w-4 text-primary"}
                  aria-hidden
                />
              ) : (
                <ArrowUpRight
                  className={dark ? "mt-0.5 h-4 w-4 text-brand-azure" : "mt-0.5 h-4 w-4 text-primary"}
                  aria-hidden
                />
              )}
              <span className="flex-1">
                <span
                  className={
                    dark
                      ? "flex items-center gap-1.5 text-sm font-semibold text-primary-foreground"
                      : "flex items-center gap-1.5 text-sm font-semibold text-foreground"
                  }
                >
                  {c.label}
                  {remembered === c.key && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-sapphire px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
                      <Star className="h-2.5 w-2.5" aria-hidden />
                      Last used
                    </span>
                  )}
                </span>
                <span className={dark ? "block text-[11px] text-ice" : "block text-[11px] text-muted-foreground"}>
                  {c.description}
                </span>
              </span>
            </button>

            {/* Deep links to the most common landing pages in this portal. */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(PORTAL_DEEP_LINKS[c.key] ?? []).map((link) => (
                <button
                  key={link.to}
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void jump(c.key, link.to, "deep_link")}
                  className={
                    dark
                      ? "rounded-full border border-white/20 px-2.5 py-1 text-[11px] font-medium text-ice transition-colors hover:border-brand-azure hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ice disabled:opacity-60"
                      : "rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  }
                >
                  {pending === link.to ? "Opening…" : link.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className={dark ? "mt-2 text-[10px] text-ice/70" : "mt-2 text-[10px] text-muted-foreground"}>
        Your last portal is remembered on this device and used for your next sign-in. Every switch is
        audited.
      </p>
    </div>
  );
}

export default PortalQuickSwitch;
