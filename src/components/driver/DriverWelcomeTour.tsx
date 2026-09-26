/**
 * WELCOME RIDE — a guided tour of the driver portal.
 * A walkthrough only: it opens the real screens and remembers which stops the
 * driver has seen on this device. No trips, earnings or money are involved.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Check, Compass, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const STOPS = [
  {
    id: "rides",
    title: "Where your rides appear",
    body: "Rides waiting for a driver and the trips assigned to you, with pickup, time and status.",
    to: "/driver/portal",
    cta: "Open my rides",
  },
  {
    id: "documents",
    title: "Your documents",
    body: "Licence, insurance and inspection. Our team checks these before you can take paid work.",
    to: "/driver/apply",
    cta: "Open documents",
  },
  {
    id: "earnings",
    title: "What a trip pays",
    body: "Yalla keeps 15% of the trip value; the remaining 85% is yours and shows in your wallet.",
    to: "/driver/earnings",
    cta: "See earnings",
  },
  {
    id: "payouts",
    title: "Getting paid out",
    body: "Money is released after the trip is fulfilled. Withdrawals go to your default M-Pesa number, with a 5% withdrawal fee.",
    to: "/driver/portal",
    cta: "Open wallet & payouts",
  },
  {
    id: "support",
    title: "Help when you need it",
    body: "Safety, support channels and the driver academy — all in one place.",
    to: "/driver/support",
    cta: "Open support",
  },
] as const;

const KEY = "yalla_driver_welcome_tour_v1";

export default function DriverWelcomeTour() {
  const [seen, setSeen] = React.useState<string[]>([]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setSeen(JSON.parse(raw) as string[]);
    } catch { /* noop */ }
  }, []);

  const mark = (id: string) => {
    setSeen((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };

  const done = STOPS.filter((s) => seen.includes(s.id)).length;
  const pct = Math.round((done / STOPS.length) * 100);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-primary" aria-hidden="true" />
            <CardTitle className="text-base">Your welcome ride</CardTitle>
          </div>
          <Badge variant={done === STOPS.length ? "default" : "outline"}>
            {done} of {STOPS.length} stops
          </Badge>
        </div>
        <CardDescription>
          Five short stops through the driver portal so you know where everything is before your first trip.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={pct} aria-label="Welcome ride progress" />
        <ol className="space-y-3">
          {STOPS.map((s, i) => {
            const isSeen = seen.includes(s.id);
            return (
              <li key={s.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {i + 1}. {s.title}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                  </div>
                  {isSeen && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" /> Seen
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild onClick={() => mark(s.id)}>
                    <Link to={s.to}>
                      {s.cta} <ExternalLink className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </Button>
                  {!isSeen && (
                    <Button size="sm" variant="ghost" onClick={() => mark(s.id)}>
                      Mark as seen
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {done === STOPS.length && (
          <p className="text-sm font-medium text-primary">
            Welcome ride complete — you know your way around. Your first paid trip appears under My rides once your
            documents are approved.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
