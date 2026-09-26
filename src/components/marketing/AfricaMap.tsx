import { useState } from "react";

type Market = { id: string; name: string; cx: number; cy: number; status: "live" | "soon" };

const MARKETS: Market[] = [
  { id: "ke", name: "Kenya · Nairobi, Mombasa, Kisumu", cx: 360, cy: 270, status: "live" },
  { id: "ug", name: "Uganda · Kampala", cx: 330, cy: 260, status: "live" },
  { id: "tz", name: "Tanzania · Dar es Salaam, Arusha", cx: 365, cy: 305, status: "live" },
  { id: "rw", name: "Rwanda · Kigali", cx: 325, cy: 280, status: "soon" },
  { id: "et", name: "Ethiopia · Addis Ababa", cx: 380, cy: 215, status: "soon" },
  { id: "ng", name: "Nigeria · Lagos, Abuja", cx: 195, cy: 230, status: "soon" },
  { id: "gh", name: "Ghana · Accra", cx: 165, cy: 235, status: "soon" },
  { id: "za", name: "South Africa · Johannesburg, Cape Town", cx: 320, cy: 430, status: "soon" },
  { id: "eg", name: "Egypt · Cairo", cx: 340, cy: 130, status: "soon" },
];

export function AfricaMap() {
  const [hover, setHover] = useState<Market | null>(null);

  return (
    <div className="relative">
      <svg viewBox="0 0 560 540" className="w-full h-auto" role="img" aria-label="Yalla Mobility Africa coverage map">
        <defs>
          <radialGradient id="afGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(var(--primary) / 0.25)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <linearGradient id="afFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary) / 0.15)" />
            <stop offset="100%" stopColor="hsl(var(--primary) / 0.05)" />
          </linearGradient>
        </defs>
        <rect width="560" height="540" fill="url(#afGlow)" />
        {/* Simplified Africa silhouette */}
        <path
          d="M210,80 L295,70 L360,90 L390,140 L385,200 L405,250 L410,310 L380,360 L355,420 L320,480 L280,505 L235,495 L210,455 L180,400 L150,340 L135,275 L150,210 L170,150 Z"
          fill="url(#afFill)"
          stroke="hsl(var(--primary) / 0.5)"
          strokeWidth="1.5"
        />
        {MARKETS.map((m) => (
          <g
            key={m.id}
            onMouseEnter={() => setHover(m)}
            onMouseLeave={() => setHover(null)}
            className="cursor-pointer"
          >
            {m.status === "live" && (
              <circle cx={m.cx} cy={m.cy} r="14" fill="hsl(var(--accent) / 0.3)">
                <animate attributeName="r" values="10;20;10" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            <circle
              cx={m.cx}
              cy={m.cy}
              r={m.status === "live" ? 7 : 5}
              fill={m.status === "live" ? "hsl(var(--accent))" : "hsl(var(--primary))"}
              stroke="white"
              strokeWidth="2"
            />
          </g>
        ))}
        {hover && (
          <g transform={`translate(${Math.min(hover.cx + 16, 380)}, ${hover.cy - 18})`}>
            <rect width={Math.max(hover.name.length * 6.5, 80)} height="28" rx="6" fill="hsl(var(--foreground))" />
            <text x="8" y="18" fill="hsl(var(--background))" fontSize="11" fontWeight="500">
              {hover.name}
            </text>
          </g>
        )}
      </svg>
      <div className="mt-4 flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-primary" /> Live markets
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-primary" /> Coming soon
        </div>
      </div>
    </div>
  );
}
