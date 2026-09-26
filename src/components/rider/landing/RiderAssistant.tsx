import { useMemo, useState } from "react";
import { AiAssistantPanel, type AiAssistantMessage } from "@/components/layout/AiAssistantPanel";
import { Bot, Compass, Calculator, Route as RouteIcon } from "lucide-react";

/**
 * RiderAssistant — presentation wrapper over the existing AiAssistantPanel.
 * Deterministic, public-safe guidance only. No privileged data is referenced.
 */
const KB: { match: RegExp; answer: string }[] = [
  { match: /airport|jkia|flight/i, answer: "Airport transfers use flat fares with flight tracking and optional meet & greet. Book them under Airport in the booking panel, or open the Airport workspace to add your flight number and terminal." },
  { match: /fare|price|cost|cheap|estimate/i, answer: "Fares are shown upfront before you confirm. Use the Pricing guide to estimate by distance and vehicle tier — every receipt itemises base fare, distance, time, surge and VAT." },
  { match: /bus|coach|charter|group|van/i, answer: "For groups, charter a van, bus or coach from the charter marketplace. Tell me your route and party size and I'll point you to the right vehicle class." },
  { match: /rent|rental|self.?drive|lease/i, answer: "Rentals cover self-drive cars and SUVs, luxury vehicles, trucks and equipment. Daily, weekly and monthly durations are available with insurance options." },
  { match: /parcel|courier|deliver|package|freight/i, answer: "Send documents or parcels with same-day courier, or move business volumes with freight and dedicated truck dispatch. Every job is GPS-tracked with proof of delivery." },
  { match: /corporate|company|business|invoice|etims|approval/i, answer: "Business accounts add policy limits, manager approvals, cost centres, department budgets and eTIMS-compliant invoicing — while personal trips stay on your personal wallet." },
  { match: /safe|safety|sos|track|share/i, answer: "Every trip includes live tracking, a shareable trip link, one-tap SOS to our 24/7 safety centre, and verified drivers and vehicles." },
  { match: /pay|m-?pesa|card|wallet/i, answer: "You can pay by M-Pesa, card or wallet balance, or bill an approved corporate account. Payments are tokenised and receipts are issued automatically." },
  { match: /cancel|change|modify|reschedul/i, answer: "Scheduled bookings can be changed or cancelled from your trips list before the driver is dispatched; charter changes are handled by the charter concierge." },
];

const FALLBACK =
  "I can help you choose a service, estimate a fare, compare vehicle types, plan a journey or locate a booking. Try asking about airport transfers, group charter, rentals, delivery or corporate accounts.";

const SUGGESTIONS = [
  "Which service fits an airport pickup at 5am?",
  "What does a 32-seat coach cost for a day?",
  "How do corporate approvals work?",
  "Estimate a 12 km city ride",
];

export function RiderAssistant() {
  const [messages, setMessages] = useState<AiAssistantMessage[]>([]);
  const highlights = useMemo(
    () => [
      { icon: Compass, t: "Recommends transport", d: "Matches your trip to the right service and vehicle class." },
      { icon: Calculator, t: "Estimates fares", d: "Transparent ranges before you commit to a booking." },
      { icon: RouteIcon, t: "Plans journeys", d: "Multi-leg trips, airport timing and group logistics." },
    ],
    [],
  );

  const ask = (prompt: string) => {
    const hit = KB.find((k) => k.match.test(prompt));
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-u`, role: "user", content: prompt },
      { id: `${Date.now()}-a`, role: "assistant", content: hit ? hit.answer : FALLBACK },
    ]);
  };

  return (
    <section className="border-y border-border bg-secondary/30 py-20">
      <div className="container mx-auto grid gap-10 px-4 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-start">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
            <Bot className="h-4 w-4" aria-hidden /> AI mobility assistant
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Ask, compare, then book</h2>
          <p className="mt-3 max-w-xl text-muted-foreground">
            The assistant helps you pick the right service, understand pricing and plan journeys — then
            hands you straight to the booking flow.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {highlights.map((h) => (
              <li key={h.t} className="rounded-2xl border border-border bg-card p-5">
                <h.icon className="mb-3 h-5 w-5 text-primary" aria-hidden />
                <h3 className="text-sm font-semibold">{h.t}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{h.d}</p>
              </li>
            ))}
          </ul>
        </div>
        <AiAssistantPanel
          title="Yalla Travel Assistant"
          subtitle="Journey planning, fares and service guidance"
          messages={messages}
          suggestions={SUGGESTIONS}
          placeholder="e.g. I need a coach to Nakuru on Friday"
          onSubmit={ask}
        />
      </div>
    </section>
  );
}

export default RiderAssistant;
