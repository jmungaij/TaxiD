import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronDown, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { useOperatingContext } from "@/hooks/useOperatingContext";
import { requestContextSwitch } from "@/lib/platform/operatingContextApi";
import {
  OPERATING_CONTEXTS,
  activeOperatingContext,
  type OperatingContextKey,
} from "@/lib/platform/operatingContexts";

/**
 * Operating-context indicator + switch.
 *
 * Authority is server-resolved (`resolve_operating_contexts`) and every switch
 * is re-authorised server-side (`switch_operating_context`), which also writes
 * the immutable audit record. Identities with a single context see a quiet,
 * non-interactive indicator. Nothing here can be typed or claimed by the user.
 */
export function OperatingContextSwitch() {
  const { identity, loading } = useOperatingContext();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [pending, setPending] = useState<OperatingContextKey | null>(null);

  if (loading || !identity?.authenticated) return null;

  const contexts = OPERATING_CONTEXTS.filter((c) => identity.contexts.includes(c.key));
  if (contexts.length === 0) return null;

  const active = activeOperatingContext(pathname);
  const current = contexts.find((c) => c.key === active) ?? contexts[0];
  const subtitle = [identity.organisation, identity.unit, identity.resolved_role]
    .filter(Boolean)
    .join(" · ");

  if (contexts.length === 1) {
    return (
      <div className="hidden sm:flex flex-col leading-tight">
        <span className="text-xs font-medium text-foreground">{current.label}</span>
        {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
      </div>
    );
  }

  const onSwitch = async (next: OperatingContextKey, to: string) => {
    if (next === current.key) return;
    setPending(next);
    const res = await requestContextSwitch({ next, previous: active });
    setPending(null);
    if (!res.ok) {
      toast({
        title: "Context switch denied",
        description: "The server did not authorise this operating context.",
        variant: "destructive",
      });
      return;
    }
    navigate(to);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-auto py-1.5">
          {identity.contexts.includes("super_admin") && (
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
          <span className="flex flex-col items-start leading-tight">
            <span className="truncate max-w-[210px] text-xs font-medium">{current.label}</span>
            {subtitle && (
              <span className="truncate max-w-[210px] text-[11px] font-normal text-muted-foreground">
                {subtitle}
              </span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Operating context
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {contexts.map((c) => (
          <DropdownMenuItem
            key={c.key}
            onSelect={(e) => {
              e.preventDefault();
              void onSwitch(c.key, c.to);
            }}
            className="flex items-start gap-2"
          >
            {pending === c.key ? (
              <Loader2 className="mt-0.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Check
                className={c.key === current.key ? "mt-0.5 h-4 w-4 text-primary" : "mt-0.5 h-4 w-4 opacity-0"}
                aria-hidden
              />
            )}
            <span>
              <span className="block text-sm font-medium">{c.label}</span>
              <span className="block text-xs text-muted-foreground">{c.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default OperatingContextSwitch;
