import { useEffect, useState } from "react";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Award, Check } from "lucide-react";

interface Tier {
  tier: string;
  sort_order: number;
  min_trips: number;
  min_rating: number;
  commission_discount_pct: number;
  weekly_bonus_kes: number;
  perks: string[];
  badge_color: string;
  description: string | null;
}

export function AchievementTiers() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);

  useEffect(() => {
    untypedDb
      .from("driver_achievement_tiers")
      .select("tier,sort_order,min_trips,min_rating,commission_discount_pct,weekly_bonus_kes,perks,badge_color,description")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }: any) => setTiers((data as Tier[]) ?? []));
  }, []);

  if (!tiers) return <Skeleton className="h-72 w-full rounded-xl" />;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {tiers.map((t) => (
        <Card key={t.tier} className="overflow-hidden border-2 transition-transform"
              style={{ borderColor: t.badge_color }}>
          <CardHeader className="pb-3" style={{ background: `${t.badge_color}14` }}>
            <div className="flex items-center justify-between">
              <Award className="h-5 w-5" style={{ color: t.badge_color }} />
              <Badge variant="outline" className="text-[10px]">#{t.sort_order}</Badge>
            </div>
            <CardTitle className="text-lg" style={{ color: t.badge_color }}>{t.tier}</CardTitle>
            <CardDescription className="text-xs line-clamp-2">{t.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-3 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Min trips</span><span className="font-medium tabular-nums">{t.min_trips.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Min rating</span><span className="font-medium tabular-nums">{t.min_rating.toFixed(2)}★</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Commission cut</span><span className="font-medium tabular-nums text-primary">−{(t.commission_discount_pct * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Weekly bonus</span><span className="font-medium tabular-nums">KES {Number(t.weekly_bonus_kes).toLocaleString()}</span></div>
            <ul className="pt-2 space-y-1 border-t">
              {(t.perks ?? []).slice(0, 3).map((p) => (
                <li key={p} className="flex gap-1.5 text-[11px]"><Check className="h-3 w-3 mt-0.5 shrink-0 text-primary" />{p}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default AchievementTiers;
