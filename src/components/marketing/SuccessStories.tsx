import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Star, Quote } from "lucide-react";

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
}

export function SuccessStories() {
  const [stories, setStories] = useState<Story[]>([]);
  useEffect(() => {
    supabase
      .rpc("driver_success_stories_published", { _limit: 6 })
      .then(({ data }) => { if (data) setStories(data as Story[]); });
  }, []);

  if (!stories.length) return null;

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
      {stories.map((s) => (
        <article key={s.id} className="p-6 rounded-2xl bg-card border border-border hover:shadow-xl transition-shadow flex flex-col">
          <Quote className="h-8 w-8 text-primary/30 mb-3" />
          <h3 className="font-bold text-lg mb-2">{s.headline}</h3>
          <p className="text-sm text-muted-foreground mb-5 flex-1">{s.body}</p>
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <div>
              <div className="font-semibold">{s.display_name ?? "TaxiD driver"}</div>
              <div className="text-xs text-muted-foreground">{s.city}{s.vehicle_type ? ` · ${s.vehicle_type}` : ""}</div>
            </div>
            {s.rating != null && (
              <div className="text-right">
                <div className="inline-flex items-center gap-1 text-sm font-semibold">
                  <Star className="h-4 w-4 fill-status-warning text-status-warning" /> {Number(s.rating).toFixed(2)}
                </div>
                {s.earnings_band && (
                  <div className="text-xs text-primary font-semibold mt-0.5">{s.earnings_band}/mo</div>
                )}
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
