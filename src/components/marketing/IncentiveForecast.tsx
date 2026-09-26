import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sparkles, Trophy, Clock, Target } from "lucide-react";
import { trackDriverEvent } from "@/lib/driverAnalytics";

type Forecast = {
  id: string;
  name: string;
  description: string | null;
  city: string | null;
  category_slug: string | null;
  trigger_type: string;
  threshold: number;
  reward_kes: number;
  current_progress: number;
  projected_progress: number;
  eligible: boolean;
  window_end: string | null;
};

interface Props {
  city?: string;
  projectedTrips?: number;
  projectedHours?: number;
}

export function IncentiveForecast({ city = "Nairobi", projectedTrips = 0, projectedHours = 0 }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Forecast[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    (async () => {
      const driverId = user?.id ?? "00000000-0000-0000-0000-000000000000";
      const { data, error } = await supabase.rpc("driver_incentive_forecast", {
        _driver_id: driverId,
        _city: city,
        _projected_trips: Math.round(projectedTrips),
        _projected_hours: projectedHours,
      });
      if (cancel) return;
      if (!error && data) {
        setRows(data as Forecast[]);
        trackDriverEvent("incentive_eligible_view", {
          funnel_stage: "earnings_intelligence",
          metadata: { city, count: data.length, eligible: (data as Forecast[]).filter((r) => r.eligible).length },
        });
      }
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [user?.id, city, projectedTrips, projectedHours]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-5 w-5 text-primary" />
          Incentive forecast — {city}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Based on your projected {Math.round(projectedTrips)} trips · {projectedHours.toFixed(1)}h this week.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <div className="text-sm text-muted-foreground">Loading active programs…</div>}
        {!loading && rows.length === 0 && (
          <div className="text-sm text-muted-foreground">No active incentive programs for {city} right now.</div>
        )}
        {rows.map((r) => {
          const pct = r.threshold > 0 ? Math.min(100, (r.projected_progress / r.threshold) * 100) : 0;
          const unit = r.trigger_type === "hours_online" ? "h" : "trips";
          return (
            <div key={r.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {r.trigger_type === "hours_online" ? <Clock className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
                    {r.name}
                  </div>
                  {r.description && <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold text-primary">KES {Number(r.reward_kes).toLocaleString()}</div>
                  {r.eligible ? (
                    <Badge className="bg-status-success/15 text-status-success dark:text-status-success hover:bg-status-success/15">
                      <Trophy className="h-3 w-3 mr-1" /> Eligible
                    </Badge>
                  ) : (
                    <Badge variant="secondary">{Math.round(pct)}%</Badge>
                  )}
                </div>
              </div>
              <Progress value={pct} className="h-1.5 mt-2" />
              <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                <span>Now: {Number(r.current_progress).toFixed(unit === "h" ? 1 : 0)} {unit}</span>
                <span>Target: {Number(r.threshold).toFixed(0)} {unit}</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
