import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Trophy, Crown, Medal } from "lucide-react";
import { tierColor } from "@/lib/design/brandColor";

interface Row {
  rank: number;
  initials: string;
  city: string;
  trips: number;
  rating: number;
  weekly_gross_kes: number;
  tier: string;
}



export function DriverLeaderboard({ city }: { city?: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (supabase.rpc as any)("driver_leaderboard_public", { _city: city ?? null, _limit: 10 })
      .then(({ data, error }: any) => {
        if (!alive) return;
        if (error) { setErr(true); setRows([]); return; }
        setRows((data as Row[]) ?? []);
      });
    return () => { alive = false; };
  }, [city]);

  if (!rows) return <Skeleton className="h-80 w-full rounded-xl" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-base">Top drivers this week{city ? ` · ${city}` : ""}</CardTitle>
            <CardDescription>Anonymised weekly leaderboard powered by live trip data.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {err || rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Leaderboard is warming up. As soon as drivers complete trips in {city ?? "your city"} this week, you'll see them ranked here.
          </div>
        ) : (
          <ol className="space-y-2">
            {rows.map((r) => (
              <li key={`${r.rank}-${r.initials}`} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="w-8 text-center font-bold tabular-nums text-muted-foreground">
                  {r.rank === 1 ? <Crown className="h-5 w-5 mx-auto text-status-warning" /> :
                   r.rank <= 3 ? <Medal className="h-4 w-4 mx-auto text-status-warning" /> : `#${r.rank}`}
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full font-semibold text-ice text-sm"
                     style={{ backgroundColor: tierColor(r.tier) }}>
                  {r.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Driver {r.initials} · {r.city}</div>
                  <div className="text-xs text-muted-foreground">{r.trips} trips · {Number(r.rating).toFixed(2)}★</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold tabular-nums">KES {Number(r.weekly_gross_kes).toLocaleString()}</div>
                  <Badge variant="outline" className="text-[10px] mt-0.5" style={{ borderColor: tierColor(r.tier) }}>
                    {r.tier}
                  </Badge>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default DriverLeaderboard;
