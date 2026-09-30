import { supabase } from "@/integrations/supabase/client";
import type { AppAudience } from "@/lib/appLinks";

function describeDevice() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other";
  const device_type = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "desktop";
  return { os, browser, device_type };
}

export function trackAppDownload(audience: AppAudience, placement: string) {
  if (audience !== "rider" && audience !== "driver") return;
  const safePlacement = placement.trim().slice(0, 80);
  if (!safePlacement) return;
  void supabase.from("app_download_clicks").insert({
    audience,
    platform: "android",
    placement: safePlacement,
    ...describeDevice(),
  }).then(({ error }) => {
    if (error && import.meta.env.DEV) console.warn("App download click was not recorded");
  });
}
