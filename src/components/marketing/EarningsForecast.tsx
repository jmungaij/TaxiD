import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Lightbulb, AlertTriangle } from "lucide-react";

interface Forecast {
  city: string;
  categorySlug: string;
  effectiveSurge: number;
  topWindows: { day: string; hour: number; multiplier: number }[];
  narrative: string;
  tips: string[];
  generatedAt: string;
  cached: boolean;
}

export function EarningsForecast({ city, categorySlug }: { city: string; categorySlug: string }) {
  const [data, setData] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    supabase.functions
      .invoke("driver-earnings-forecast", { body: { city, categorySlug } })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setError(error.message); setLoading(false); return; }
        setData(data as Forecast);
        setLoading(false);
        void supabase.from("driver_analytics_events").insert({
          event_name: "forecast_recommendation_view",
          page_route: typeof window !== "undefined" ? window.location.pathname : null,
          funnel_stage: "earnings_simulator",
          metadata: { city, categorySlug, cached: (data as Forecast)?.cached } as never,
        });
      });
    return () => { alive = false; };
  }, [city, categorySlug]);

  if (loading) return <Skeleton className="h-44 w-full rounded-xl" />;

  if (error) {
    return (
      <Card>
        <CardContent className="p-4 flex items-start gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-status-warning" />
          Forecast unavailable: {error}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">AI forecast — {data.city}</CardTitle>
          </div>
          <Badge variant="secondary" className="text-[10px]">{data.cached ? "cached" : "fresh"}</Badge>
        </div>
        <CardDescription>Tailored guidance from live pricing and surge for your vehicle class.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed">{data.narrative}</p>
        {data.tips.length > 0 && (
          <ul className="space-y-1.5">
            {data.tips.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Lightbulb className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default EarningsForecast;
