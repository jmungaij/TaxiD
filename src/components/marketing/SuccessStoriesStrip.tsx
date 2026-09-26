import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Quote, Star } from "lucide-react";

/**
 * Published driver stories. Read through `driver_success_stories_published`,
 * which returns a first-name display name and an earnings BAND — and the band
 * only when the driver's consent is recorded. Full names and exact earnings
 * figures are never sent to the browser.
 */
interface Story {
  id: string;
  display_name: string | null;
  city: string;
  vehicle_type: string | null;
  headline: string;
  body: string;
  rating: number | null;
  years_on_platform: number | null;
  earnings_band: string | null;
  avatar_url: string | null;
}

export function SuccessStoriesStrip() {
  const [stories, setStories] = useState<Story[] | null>(null);

  useEffect(() => {
    supabase
      .rpc("driver_success_stories_published", { _limit: 6 })
      .then(({ data }) => setStories((data as Story[]) ?? []));
  }, []);

  if (!stories) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (stories.length === 0) return null;

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {stories.map((s) => {
        const name = s.display_name ?? "Yalla driver";
        return (
          <Card key={s.id} className="overflow-hidden">
            <CardContent className="p-5 space-y-3">
              <Quote className="h-6 w-6 text-primary/60" />
              <h3 className="font-semibold text-base leading-snug">{s.headline}</h3>
              <p className="text-sm text-muted-foreground line-clamp-4">{s.body}</p>
              <div className="flex items-center gap-3 pt-3 border-t">
                <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                  {s.avatar_url ? <img src={s.avatar_url} alt={name} className="h-10 w-10 rounded-full object-cover" /> : name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {s.city}{s.vehicle_type ? ` · ${s.vehicle_type}` : ""}
                    {s.rating ? <> · {Number(s.rating).toFixed(2)}<Star className="inline h-3 w-3 fill-current text-status-warning mb-0.5" /></> : null}
                  </div>
                </div>
                {s.earnings_band && (
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Monthly</div>
                    <div className="text-sm font-bold">{s.earnings_band}</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default SuccessStoriesStrip;
