/**
 * TaxiD Air route geography — a small, deterministic airport/city registry used
 * by the live flight map. Pure data + projection helpers (no React, no fetch)
 * so the map widget stays testable and renders without any maps API key.
 */
export interface AirPoint {
  code: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
}

export const AIR_POINTS: AirPoint[] = [
  { code: "NBO", name: "Nairobi", country: "Kenya", lat: -1.319, lng: 36.928 },
  { code: "WIL", name: "Wilson", country: "Kenya", lat: -1.322, lng: 36.815 },
  { code: "MBA", name: "Mombasa", country: "Kenya", lat: -4.035, lng: 39.594 },
  { code: "KIS", name: "Kisumu", country: "Kenya", lat: -0.086, lng: 34.729 },
  { code: "EDL", name: "Eldoret", country: "Kenya", lat: 0.404, lng: 35.239 },
  { code: "MYD", name: "Malindi", country: "Kenya", lat: -3.229, lng: 40.102 },
  { code: "UKA", name: "Ukunda", country: "Kenya", lat: -4.293, lng: 39.571 },
  { code: "LAU", name: "Lamu", country: "Kenya", lat: -2.252, lng: 40.913 },
  { code: "MRE", name: "Maasai Mara", country: "Kenya", lat: -1.406, lng: 35.008 },
  { code: "NYK", name: "Nanyuki", country: "Kenya", lat: -0.062, lng: 37.041 },
  { code: "ASV", name: "Amboseli", country: "Kenya", lat: -2.645, lng: 37.253 },
  { code: "LOK", name: "Lodwar", country: "Kenya", lat: 3.122, lng: 35.609 },
  { code: "WJR", name: "Wajir", country: "Kenya", lat: 1.733, lng: 40.092 },
  { code: "EBB", name: "Entebbe", country: "Uganda", lat: 0.042, lng: 32.443 },
  { code: "DAR", name: "Dar es Salaam", country: "Tanzania", lat: -6.878, lng: 39.203 },
  { code: "ZNZ", name: "Zanzibar", country: "Tanzania", lat: -6.222, lng: 39.225 },
  { code: "JRO", name: "Kilimanjaro", country: "Tanzania", lat: -3.429, lng: 37.075 },
  { code: "KGL", name: "Kigali", country: "Rwanda", lat: -1.969, lng: 30.139 },
  { code: "BJM", name: "Bujumbura", country: "Burundi", lat: -3.324, lng: 29.318 },
  { code: "ADD", name: "Addis Ababa", country: "Ethiopia", lat: 8.978, lng: 38.799 },
  { code: "MGQ", name: "Mogadishu", country: "Somalia", lat: 2.014, lng: 45.305 },
  { code: "JUB", name: "Juba", country: "South Sudan", lat: 4.872, lng: 31.601 },
  { code: "DXB", name: "Dubai", country: "UAE", lat: 25.253, lng: 55.365 },
  { code: "DOH", name: "Doha", country: "Qatar", lat: 25.273, lng: 51.608 },
  { code: "JNB", name: "Johannesburg", country: "South Africa", lat: -26.133, lng: 28.242 },
  { code: "CAI", name: "Cairo", country: "Egypt", lat: 30.114, lng: 31.4 },
  { code: "LOS", name: "Lagos", country: "Nigeria", lat: 6.577, lng: 3.321 },
  { code: "LHR", name: "London", country: "United Kingdom", lat: 51.47, lng: -0.454 },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Best-effort resolution of a free-text origin/destination to a known point. */
export function resolvePoint(raw: string | undefined | null): AirPoint | null {
  if (!raw) return null;
  const q = norm(raw);
  if (!q) return null;
  const upper = raw.trim().toUpperCase();
  return (
    AIR_POINTS.find((p) => p.code === upper) ??
    AIR_POINTS.find((p) => norm(p.name) === q) ??
    AIR_POINTS.find((p) => q.includes(norm(p.name)) || norm(p.name).includes(q)) ??
    AIR_POINTS.find((p) => q.includes(norm(p.country))) ??
    null
  );
}

export interface Projection {
  x: (lng: number) => number;
  y: (lat: number) => number;
}

/** Equirectangular projection fitted to the supplied points, with padding. */
export function fitProjection(points: AirPoint[], width: number, height: number, pad = 42): Projection {
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  const minLng = Math.min(...lngs, 30) - 2;
  const maxLng = Math.max(...lngs, 42) + 2;
  const minLat = Math.min(...lats, -6) - 2;
  const maxLat = Math.max(...lats, 4) + 2;
  const spanX = Math.max(0.001, maxLng - minLng);
  const spanY = Math.max(0.001, maxLat - minLat);
  return {
    x: (lng) => pad + ((lng - minLng) / spanX) * (width - pad * 2),
    y: (lat) => height - pad - ((lat - minLat) / spanY) * (height - pad * 2),
  };
}
