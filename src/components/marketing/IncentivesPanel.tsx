import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Gift, Target, Calendar } from "lucide-react";

interface Incentive {
  id: string;
  name: string;
  description: string | null;
  category_slug: string | null;
  city: string | null;
  trigger_type: string;
  threshold: number;
  reward_kes: number;
  window_start: string | null;
  window_end: string | null;
}

const TRIGGER_LABEL: Record<string, string> = {
  trips_completed: "trips this week",
  weekend_trips: "weekend trips",
  rating_above: "rating maintained",
  hours_online: "hours online",
};

function fmtKES(n: number) {
  return `KES ${Math.round(n).toLocaleString()}`;
}

export function IncentivesPanel({ city, categorySlug }: { city: string; categorySlug?: string }) {
  const [items, setItems] = useState<Incentive[] | null>(null);

  useEffect(() => {
    let alive = true;
    const nowIso = new Date().toISOString();
    let q = supabase
      .from("incentive_programs")
      .select("id,name,description,category_slug,city,trigger_type,threshold,reward_kes,window_start,window_end")
      .eq("is_active", true)
      .or(`window_end.is.null,window_end.gte.${nowIso}`)
      .or(`city.is.null,city.eq.${city}`);
    if (categorySlug) q = q.or(`category_slug.is.null,category_slug.eq.${categorySlug}`);
    q.order("reward_kes", { ascending: false }).limit(6).then(({ data }) => {
      if (!alive) return;
      setItems((data as Incentive[]) ?? []);
    });
    return () => { alive = false; };
  }, [city, categorySlug]);

  if (!items) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No active bonuses for {city} right now — check back at the start of the week.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-base">Active driver incentives</CardTitle>
            <CardDescription>Bonuses you can earn in {city} this week, on top of fares.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid sm:grid-cols-2 gap-3">
        {items.map((i) => (
          <div key={i.id} className="rounded-lg border p-3 bg-gradient-to-br from-primary/5 to-transparent">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-sm">{i.name}</div>
              <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/10 shrink-0">
                +{fmtKES(Number(i.reward_kes))}
              </Badge>
            </div>
            {i.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{i.description}</p>}
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><Target className="h-3 w-3" />{Number(i.threshold).toLocaleString()} {TRIGGER_LABEL[i.trigger_type] ?? i.trigger_type}</span>
              {i.window_end && (
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />
                  ends {new Date(i.window_end).toLocaleDateString("en-KE", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default IncentivesPanel;
