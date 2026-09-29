import { supabase } from "@/integrations/supabase/client";
import type { AppAudience } from "@/lib/appLinks";

export function trackAppDownload(audience: AppAudience, placement: string) {
  if (audience !== "rider" && audience !== "driver") return;
  const safePlacement = placement.trim().slice(0, 80);
  if (!safePlacement) return;
  void supabase.from("app_download_clicks").insert({
    audience,
    platform: "android",
    placement: safePlacement,
  }).then(({ error }) => {
    if (error && import.meta.env.DEV) console.warn("App download click was not recorded");
  });
}