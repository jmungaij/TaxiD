/**
 * Executive assistance — concierge services that extend a charter mission
 * beyond transport (protocol, security, hospitality).
 */
import {
  BedDouble, Coffee, Languages, PlaneTakeoff, ShieldCheck, Sparkles, Users, UtensilsCrossed,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export interface ConciergeService {
  id: string;
  label: string;
  description: string;
  icon: typeof BedDouble;
}

export const CONCIERGE_SERVICES: ConciergeService[] = [
  { id: "hotel", label: "Hotel booking", description: "Vetted executive properties along the corridor.", icon: BedDouble },
  { id: "flight", label: "Flight coordination", description: "Timed to the ground leg, with delay watch.", icon: PlaneTakeoff },
  { id: "security", label: "Security escort", description: "Licensed close-protection detail.", icon: ShieldCheck },
  { id: "meet-greet", label: "VIP meet & greet", description: "Named greeter and expedited handling.", icon: Sparkles },
  { id: "lounge", label: "Airport lounge", description: "Lounge access for the delegation.", icon: Coffee },
  { id: "event", label: "Event coordination", description: "On-site mobility marshalling.", icon: Users },
  { id: "catering", label: "Catering", description: "Onboard refreshments and dietary handling.", icon: UtensilsCrossed },
  { id: "translation", label: "Translation services", description: "Interpreter travelling with the delegation.", icon: Languages },
];

export function ConciergeServicesPanel({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <Card className="border-primary/20 bg-card/70 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Executive assistance</CardTitle>
        <p className="text-xs text-muted-foreground">
          Optional concierge services coordinated by the operations desk alongside the mission.
        </p>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {CONCIERGE_SERVICES.map((s) => {
          const on = selected.includes(s.id);
          return (
            <label
              key={s.id}
              htmlFor={`concierge-${s.id}`}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                on ? "border-primary/40 bg-primary/5" : "hover:bg-muted/40"
              }`}
            >
              <Checkbox
                id={`concierge-${s.id}`}
                checked={on}
                onCheckedChange={(v) => onToggle(s.id, v === true)}
              />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <s.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  {s.label}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{s.description}</span>
              </span>
              <Label htmlFor={`concierge-${s.id}`} className="sr-only">{s.label}</Label>
            </label>
          );
        })}
      </CardContent>
    </Card>
  );
}
