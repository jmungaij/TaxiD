import { useEffect, useState } from "react";
import { RiderShell } from "@/components/rider/RiderShell";
import { ErrorState } from "@/components/rider/ErrorState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Gift, Award } from "lucide-react";

interface Rewards {
  points_balance: number;
  tier: string;
  lifetime_points: number;
}

const TIERS = [
  { name: "Bronze", min: 0 },
  { name: "Silver", min: 1000 },
  { name: "Gold", min: 5000 },
  { name: "Platinum", min: 15000 },
];

export default function RiderRewardsPage() {
  const { user } = useAuth();
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function refresh() {
    if (!user) return;
    setLoadError(false);
    const res = await supabase.from("rider_rewards").select("*").eq("user_id", user.id).maybeSingle();
    if (res.error) {
      setLoadError(true);
      return;
    }
    let data = res.data;
    if (!data) {
      const ins = await supabase.from("rider_rewards").insert({ user_id: user.id }).select("*").single();
      if (ins.error) {
        setLoadError(true);
        return;
      }
      data = ins.data;
    }
    setRewards(data as Rewards);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const lifetime = rewards?.lifetime_points ?? 0;
  const currentTier = [...TIERS].reverse().find((t) => lifetime >= t.min) ?? TIERS[0];
  const nextTier = TIERS.find((t) => t.min > lifetime);

  return (
    <RiderShell>
      <h1 className="text-2xl font-bold mb-4">SAFARID Rewards</h1>
      {loadError && (
        <div className="mb-4">
          <ErrorState
            message="We couldn't load your rewards. Please try again."
            onRetry={refresh}
            testId="rider-rewards-error"
          />
        </div>
      )}
      <Card className="p-6 mb-4 bg-gradient-to-br from-primary/10 to-primary/5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-muted-foreground mb-1">Available points</div>
            <div className="text-4xl font-bold text-primary">{rewards?.points_balance ?? 0}</div>
          </div>
          <Award className="h-8 w-8 text-primary" />
        </div>
        <div className="mt-4 text-sm">
          <div className="font-semibold">{currentTier.name} member</div>
          {nextTier && (
            <div className="text-xs text-muted-foreground">
              {nextTier.min - lifetime} pts to {nextTier.name}
            </div>
          )}
        </div>
      </Card>

      <h2 className="font-semibold mb-2 flex items-center gap-2">
        <Gift className="h-4 w-4" /> Ways to earn
      </h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {[
          { title: "Complete a trip", pts: "+10 pts" },
          { title: "Rate your driver", pts: "+5 pts" },
          { title: "Refer a friend", pts: "+500 pts" },
          { title: "Schedule airport ride", pts: "+50 pts" },
        ].map((e) => (
          <Card key={e.title} className="p-4">
            <div className="text-sm font-medium">{e.title}</div>
            <div className="text-primary font-bold mt-1">{e.pts}</div>
          </Card>
        ))}
      </div>
    </RiderShell>
  );
}
