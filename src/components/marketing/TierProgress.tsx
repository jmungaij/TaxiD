import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Award } from "lucide-react";
import { trackDriverEvent } from "@/lib/driverAnalytics";
import { brandColor } from "@/lib/design/brandColor";

type Progress = {
  current_tier: string;
  points: number;
  trips_30d: number;
  rating_30d: number;
  acceptance_30d: number;
  cancellation_30d: number;
};

type Tier = {
  tier: string;
  sort_order: number;
  min_trips: number | null;
  min_rating: number | null;
  badge_color: string | null;
  weekly_bonus_kes: number | null;
  commission_discount_pct: number | null;
};

export function TierProgress() {
  const { user } = useAuth();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: tierData } = await supabase
        .from("driver_achievement_tiers")
        .select("tier,sort_order,min_trips,min_rating,badge_color,weekly_bonus_kes,commission_discount_pct")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      setTiers((tierData as Tier[]) ?? []);

      if (user?.id) {
        const { data: progData } = await supabase
          .from("driver_achievement_progress")
          .select("current_tier,points,trips_30d,rating_30d,acceptance_30d,cancellation_30d")
          .eq("driver_id", user.id)
          .maybeSingle();
        if (progData) {
          setProgress(progData as Progress);
          trackDriverEvent("achievement_progress_view", {
            funnel_stage: "earnings_intelligence",
            metadata: { tier: (progData as Progress).current_tier, points: (progData as Progress).points },
          });
        }
      }
      setLoading(false);
    })();
  }, [user?.id]);

  if (loading) return null;
  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Award className="h-5 w-5 text-primary" /> Your tier progress
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Sign in as a driver to track real-time tier progress and unlock perks.
        </CardContent>
      </Card>
    );
  }

  const currentIdx = tiers.findIndex((t) => t.tier === progress?.current_tier);
  const nextTier = currentIdx >= 0 && currentIdx < tiers.length - 1 ? tiers[currentIdx + 1] : null;
  const tripsToNext = nextTier?.min_trips ? Math.max(0, nextTier.min_trips - (progress?.trips_30d ?? 0)) : 0;
  const pct = nextTier?.min_trips && progress
    ? Math.min(100, (progress.trips_30d / nextTier.min_trips) * 100)
    : 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Award className="h-5 w-5 text-primary" /> Your tier progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Current tier</div>
            <Badge
              className="text-base mt-1"
              style={{ backgroundColor: tiers[currentIdx]?.badge_color ?? brandColor("titanium") }}
               
              data-brand-surface="tier"
            >
              {progress?.current_tier ?? "Bronze"}
            </Badge>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Points</div>
            <div className="text-2xl font-bold">{progress?.points ?? 0}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Trips (30d)" value={progress?.trips_30d ?? 0} />
          <Stat label="Rating" value={(progress?.rating_30d ?? 0).toFixed(2)} />
          <Stat label="Accept %" value={`${Math.round(progress?.acceptance_30d ?? 0)}%`} />
        </div>

        {nextTier && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Next: {nextTier.tier}</span>
              <span className="font-medium">{tripsToNext} trips to go</span>
            </div>
            <Progress value={pct} className="h-2" />
            <div className="text-[11px] text-muted-foreground mt-1">
              Unlocks {nextTier.commission_discount_pct ?? 0}% commission discount
              {nextTier.weekly_bonus_kes ? ` · KES ${Number(nextTier.weekly_bonus_kes).toLocaleString()}/wk bonus` : ""}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
