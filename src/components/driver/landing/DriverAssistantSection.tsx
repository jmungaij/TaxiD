/**
 * DriverAssistantSection — reuses the existing `AiAssistantPanel` shell with a
 * deterministic driver-intent responder. It answers recruitment, document,
 * earnings, compliance and support questions and never exposes internal
 * approval decisions or reviewer notes.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AiAssistantPanel, type AiAssistantMessage } from "@/components/layout/AiAssistantPanel";
import { trackDriverEvent } from "@/lib/driverAnalytics";
import type { DriverApplicationStatus } from "@/hooks/useDriverApplicationStatus";

const SUGGESTIONS = [
  "Where is my application?",
  "Which documents do I need?",
  "How much can I earn?",
  "What are the compliance rules?",
  "How are ratings calculated?",
  "Book an onboarding session",
];

function answer(q: string, status: DriverApplicationStatus): { text: string; link?: { to: string; label: string } } {
  const s = q.toLowerCase();
  if (/applicat|status|where|queue|approv/.test(s)) {
    if (status.status === "SUBMITTED") return { text: "Your application is submitted and verification is in progress. Decisions are issued within 24 hours and you will be notified by email, SMS and in-app notification." };
    if (status.status === "DRAFT") return { text: `Your application is saved at step ${status.stage} of 7. Continue where you left off — nothing is lost.`, link: { to: "#application-journey", label: "Resume application" } };
    return { text: "You have not started an application yet. It takes about 12 minutes and you can save and resume at any point.", link: { to: "#application-journey", label: "Start application" } };
  }
  if (/document|licence|license|id |papers|insur|logbook/.test(s)) {
    return { text: "You will need: national ID or passport, a live selfie, driving licence (plus PSV where applicable), vehicle logbook, valid inspection and insurance certificate. Upload each one inside the application steps." };
  }
  if (/earn|pay|money|income|settle|wallet/.test(s)) {
    return { text: "Earnings depend on city, vehicle class, hours and assignment type. Airport, corporate and executive jobs pay above the ride-hailing baseline, and your wallet settles daily to M-Pesa.", link: { to: "/driver/earnings", label: "Open earnings tools" } };
  }
  if (/complian|background|check|rule|law|ntsa|tax/.test(s)) {
    return { text: "Compliance covers background screening, record verification, vehicle inspection and insurance validity. Documents must remain valid — expiring papers trigger a reminder before they lapse.", link: { to: "/driver/safety", label: "Safety and compliance" } };
  }
  if (/rating|score|star|performance/.test(s)) {
    return { text: "Ratings are the rolling average of passenger scores, weighted with acceptance, completion and punctuality. Maintaining 4.7+ keeps premium categories unlocked." };
  }
  if (/train|academy|course|certific/.test(s)) {
    return { text: "The Driver Academy covers road safety, platform operations, executive service and business skills. Certifications unlock higher-value categories.", link: { to: "/driver/training", label: "Open Driver Academy" } };
  }
  if (/support|help|contact|call|chat|emergency/.test(s)) {
    return { text: "Driver support is available 24/7 by live chat, phone and email, with a dedicated emergency line while on trip.", link: { to: "/driver/support", label: "Contact support" } };
  }
  if (/schedul|onboard|session|appoint|visit/.test(s)) {
    return { text: "Onboarding sessions run daily at our partner centres. Complete your application first, then support will confirm a slot with you.", link: { to: "#application-journey", label: "Continue application" } };
  }
  return { text: "I can help with your application status, required documents, earnings, compliance, ratings, training, support and onboarding sessions. Ask me any of those." };
}

export function DriverAssistantSection({ status }: { status: DriverApplicationStatus }) {
  const [messages, setMessages] = useState<AiAssistantMessage[]>([]);

  const submit = (prompt: string) => {
    const a = answer(prompt, status);
    trackDriverEvent("landing_assistant_query", { funnel_stage: "consideration", metadata: { prompt } });
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", content: prompt },
      {
        id: `a-${Date.now() + 1}`,
        role: "assistant",
        content: (
          <div className="space-y-2">
            <p>{a.text}</p>
            {a.link && (
              a.link.to.startsWith("#") ? (
                <a href={a.link.to} className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
                  {a.link.label} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : (
                <Link to={a.link.to} className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
                  {a.link.label} <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              )
            )}
          </div>
        ),
      },
    ]);
  };

  return (
    <section className="container mx-auto px-4 py-16 md:py-20" aria-labelledby="driver-assistant-title">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">AI driver assistant</p>
          <h2 id="driver-assistant-title" className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            Answers before, during and after your application
          </h2>
          <p className="mt-3 text-muted-foreground">
            The same assistant that supports active drivers is available while you apply — application progress,
            document requirements, earnings guidance, compliance rules, ratings, training and support routing.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Internal review decisions and reviewer notes are never disclosed by the assistant.
          </p>
        </div>
        <AiAssistantPanel
          title="TaxiD Driver Assistant"
          subtitle="Recruitment, documents, earnings and support"
          messages={messages}
          suggestions={SUGGESTIONS}
          placeholder="Ask about documents, earnings or your application…"
          onSubmit={submit}
        />
      </div>
    </section>
  );
}

export default DriverAssistantSection;
