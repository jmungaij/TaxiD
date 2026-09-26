/**
 * MobilityConcierge — the Employee Mobility AI assistant surface.
 *
 * Presentation only: it composes the existing `AiAssistantPanel` shell and the
 * deterministic `mobilityConcierge` intent engine (which reuses the governed
 * pricing engine and portal route resolver). Every commercial answer offers a
 * real deep-link into the authenticated booking planner.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AiAssistantPanel, type AiAssistantMessage } from "@/components/layout/AiAssistantPanel";
import { Button } from "@/components/ui/button";
import {
  answerConcierge, CONCIERGE_SUGGESTIONS,
  type ConciergeContext, type ConciergeVehicle,
} from "@/lib/marketing/mobilityConcierge";
import { trackEmCta, trackEmStep } from "@/lib/marketing/employeeMobilityFunnel";
import { ConciergeApprovalAction } from "@/components/marketing/ConciergeApprovalAction";

export interface MobilityConciergeProps {
  vehicles: ConciergeVehicle[];
  authenticated: boolean;
  passengers?: number;
  frequency?: string;
  pickup?: string;
  destination?: string;
  date?: string;
  /** When present (and authenticated) the concierge can submit approvals. */
  corporateId?: string;
  requesterLabel?: string;
  className?: string;
}

let seq = 0;
const nextId = () => `m${++seq}`;

export function MobilityConcierge({
  vehicles, authenticated, passengers, frequency, pickup, destination, date,
  corporateId, requesterLabel, className,
}: MobilityConciergeProps) {
  const [messages, setMessages] = React.useState<AiAssistantMessage[]>([]);

  const ctx: ConciergeContext = React.useMemo(
    () => ({ vehicles, authenticated, passengers, frequency, pickup, destination, date }),
    [vehicles, authenticated, passengers, frequency, pickup, destination, date],
  );

  const handle = React.useCallback((prompt: string) => {
    const reply = answerConcierge(prompt, ctx);
    trackEmStep("concierge_prompt", {
      intent: reply.intent,
      vehicle: reply.vehicleKey ?? null,
      passengers: reply.slots.passengers ?? null,
    });

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: prompt },
      {
        id: nextId(),
        role: "assistant",
        content: (
          <div className="space-y-2">
            {reply.lines.map((line, i) => (
              <p key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>{line}</p>
            ))}
            {reply.intent === "submit_approval" && authenticated && corporateId && (
              <ConciergeApprovalAction
                prompt={prompt}
                reply={reply}
                corporateId={corporateId}
                requesterLabel={requesterLabel}
              />
            )}
            {reply.action && (
              reply.action.href.startsWith("#") ? (
                <Button asChild size="sm" variant="secondary" className="mt-1">
                  <a
                    href={reply.action.href}
                    onClick={() => trackEmCta("employee_mobility.concierge.handover", {
                      target: reply.action!.href, step: "concierge_action",
                      metadata: { intent: reply.intent },
                    })}
                  >
                    {reply.action.label} <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                  </a>
                </Button>
              ) : (
                <Button asChild size="sm" className="mt-1">
                  <Link
                    to={reply.action.href}
                    onClick={() => trackEmCta(`employee_mobility.concierge.${reply.intent}`, {
                      target: reply.action!.href, step: "concierge_action",
                      metadata: { intent: reply.intent, vehicle: reply.vehicleKey ?? null, authenticated },
                    })}
                  >
                    {reply.action.label} <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              )
            )}
          </div>
        ),
      },
    ]);
  }, [ctx, authenticated, corporateId, requesterLabel]);

  return (
    <AiAssistantPanel
      title="Mobility concierge"
      subtitle="Book, price and compare corporate transport in plain language"
      placeholder="e.g. cost for 25 staff daily from Westlands"
      messages={messages}
      suggestions={messages.length === 0 ? CONCIERGE_SUGGESTIONS.slice(0, 4) : CONCIERGE_SUGGESTIONS.slice(4)}
      onSubmit={handle}
      className={className}
    />
  );
}

export default MobilityConcierge;
