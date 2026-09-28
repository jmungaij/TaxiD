/**
 * TaxiD Air enterprise charter search widget.
 *
 * Glassmorphism booking panel used on the Charter Business hero. It captures a
 * complete charter brief (trip type, geography, calendar, time band, party mix,
 * aircraft preference, purpose and cabin) and hands it to the results page as
 * URL state so a search is shareable and deep-linkable.
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ArrowRightLeft, Loader2, MapPin, Minus, Plane, PlaneTakeoff, Plus, Search, Users,
} from "lucide-react";
import { AIRCRAFT_PREFERENCES, CABIN_CLASSES, TIME_BANDS, TRAVEL_PURPOSES, TRIP_TYPES, criteriaToParams, emptyCriteria, paxCount, type PassengerMix, type SearchCriteria } from "@/lib/charter/searchParams";
import {
  AIRPORT_TYPE_LABEL, airportByCode, airportLabel, routeInsight, searchAirports,
  type AirportRecord,
} from "@/lib/charter/airportRegistry";

function AirportField({
  id, label, placeholder, value, onChange, compareTo,
}: {
  id: string; label: string; placeholder: string; value: string;
  onChange: (code: string) => void; compareTo?: AirportRecord | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = airportByCode(value);
  const results = useMemo(() => searchAirports(query), [query]);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            className="w-full rounded-lg border border-border bg-background/70 px-3 py-2.5 text-left transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary shrink-0" aria-hidden />
              <span className="min-w-0">
                {selected ? (
                  <>
                    <span className="block truncate text-sm font-medium">{airportLabel(selected)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {selected.country} · {AIRPORT_TYPE_LABEL[selected.type]}
                      {selected.icao ? ` · ${selected.icao}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">{placeholder}</span>
                )}
              </span>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(24rem,90vw)] p-0" align="start">
          <div className="border-b border-border p-2">
            <Input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Airport, city, IATA or ICAO"
              aria-label={`Search ${label}`}
            />
          </div>
          <ul className="max-h-72 overflow-y-auto p-1" role="listbox">
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matching airfield.</li>
            )}
            {results.map((r) => {
              const insight = compareTo && compareTo.code !== r.code ? routeInsight(compareTo, r) : null;
              return (
                <li key={r.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={r.code === value}
                    onClick={() => { onChange(r.code); setOpen(false); setQuery(""); }}
                    className="w-full rounded-md px-3 py-2 text-left hover:bg-muted"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{r.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{r.iata ?? r.icao}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {r.city} · {r.country} · {AIRPORT_TYPE_LABEL[r.type]}
                    </span>
                    {insight && (
                      <span className="mt-1 block text-xs text-primary">
                        {insight.distanceNm} nm · approx {insight.label}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const Counter = ({ label, hint, value, min = 0, max = 19, onChange }: {
  label: string; hint?: string; value: number; min?: number; max?: number; onChange: (n: number) => void;
}) => (
  <div className="flex items-center justify-between gap-4 py-1.5">
    <div>
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
    <div className="flex items-center gap-2">
      <Button type="button" size="icon" variant="outline" className="h-7 w-7"
        aria-label={`Decrease ${label}`} disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="w-6 text-center text-sm tabular-nums">{value}</span>
      <Button type="button" size="icon" variant="outline" className="h-7 w-7"
        aria-label={`Increase ${label}`} disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  </div>
);

export interface CharterSearchWidgetProps {
  initial?: Partial<SearchCriteria>;
  /** Rendered inline on the results page without the hero glass treatment. */
  variant?: "hero" | "inline";
}

export function CharterSearchWidget({ initial, variant = "hero" }: CharterSearchWidgetProps) {
  const navigate = useNavigate();
  const [c, setC] = useState<SearchCriteria>({ ...emptyCriteria(), ...initial });
  const [submitting, setSubmitting] = useState(false);
  const set = <K extends keyof SearchCriteria>(k: K, v: SearchCriteria[K]) => setC((p) => ({ ...p, [k]: v }));
  const setPax = (patch: Partial<PassengerMix>) => setC((p) => ({ ...p, passengers: { ...p.passengers, ...patch } }));

  const from = airportByCode(c.origin);
  const to = airportByCode(c.destination);
  const insight = from && to && from.code !== to.code ? routeInsight(from, to) : null;
  const ready = Boolean(c.origin && c.destination && c.departDate && c.origin !== c.destination);
  const today = new Date().toISOString().slice(0, 10);

  const submit = () => {
    if (!ready) return;
    setSubmitting(true);
    // Short takeoff animation before the results page mounts.
    window.setTimeout(() => {
      setSubmitting(false);
      navigate(`/charter/search?${criteriaToParams(c).toString()}`);
    }, 650);
  };

  const swap = () => setC((p) => ({ ...p, origin: p.destination, destination: p.origin }));

  return (
    <div
      className={
        variant === "hero"
          ? "rounded-2xl border border-ice/25 bg-background/80 p-5 shadow-elegant backdrop-blur-xl md:p-6"
          : "rounded-2xl border border-border bg-card p-5"
      }
    >
      <fieldset className="mb-4">
        <legend className="sr-only">Trip type</legend>
        <div className="inline-flex flex-wrap gap-1 rounded-full border border-border bg-muted/60 p-1">
          {TRIP_TYPES.map((t) => (
            <label
              key={t.key}
              className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                c.tripType === t.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <input
                type="radio"
                name="trip-type"
                className="sr-only"
                checked={c.tripType === t.key}
                onChange={() => set("tripType", t.key)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="relative lg:col-span-2 grid gap-4 sm:grid-cols-2">
          <AirportField
            id="charter-from" label="Flying from" placeholder="Select airport or city"
            value={c.origin} onChange={(v) => set("origin", v)} compareTo={to}
          />
          <AirportField
            id="charter-to" label="Flying to" placeholder="Select airport or city"
            value={c.destination} onChange={(v) => set("destination", v)} compareTo={from}
          />
          <Button
            type="button" size="icon" variant="outline"
            aria-label="Swap origin and destination" onClick={swap}
            className="absolute left-1/2 top-9 hidden h-8 w-8 -translate-x-1/2 rounded-full bg-background sm:flex"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="charter-depart" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Departure date
          </Label>
          <Input id="charter-depart" type="date" min={today} value={c.departDate}
            onChange={(e) => set("departDate", e.target.value)} />
          {c.tripType === "return" && (
            <Input aria-label="Return date" type="date" min={c.departDate || today} value={c.returnDate}
              onChange={(e) => set("returnDate", e.target.value)} className="mt-2" />
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Departure time</Label>
          <Select value={c.timeBand} onValueChange={(v) => set("timeBand", v as SearchCriteria["timeBand"])}>
            <SelectTrigger aria-label="Preferred departure time"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIME_BANDS.map((t) => (
                <SelectItem key={t.key} value={t.key}>{t.label} · {t.window}</SelectItem>
              ))}
              <SelectItem value="specific">Specific time…</SelectItem>
            </SelectContent>
          </Select>
          {c.timeBand === "specific" && (
            <Input aria-label="Specific departure time" type="time" value={c.specificTime}
              onChange={(e) => set("specificTime", e.target.value)} className="mt-2" />
          )}
        </div>
      </div>

      {c.tripType === "multi_city" && (
        <div className="mt-4 space-y-2 rounded-lg border border-dashed border-border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Additional legs</p>
          {c.legs.map((leg, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <AirportField
                  id={`leg-${i}`} label={`Leg ${i + 2} destination`} placeholder="Select airport or city"
                  value={leg} onChange={(v) => set("legs", c.legs.map((l, j) => (j === i ? v : l)))}
                />
              </div>
              <Button type="button" variant="ghost" size="sm" className="mt-5"
                onClick={() => set("legs", c.legs.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => set("legs", [...c.legs, ""])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add leg
          </Button>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Passengers</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="w-full justify-start font-normal">
                <Users className="mr-2 h-4 w-4 text-primary" />
                {paxCount(c.passengers)} traveller{paxCount(c.passengers) === 1 ? "" : "s"}
                {c.passengers.pets > 0 && ` · ${c.passengers.pets} pet`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72" align="start">
              <Counter label="Adults" value={c.passengers.adults} min={1} onChange={(n) => setPax({ adults: n })} />
              <Counter label="Children" hint="2–11 years" value={c.passengers.children} onChange={(n) => setPax({ children: n })} />
              <Counter label="Infants" hint="Under 2" value={c.passengers.infants} onChange={(n) => setPax({ infants: n })} />
              <Counter label="Pets" value={c.passengers.pets} max={4} onChange={(n) => setPax({ pets: n })} />
              <Counter label="Baggage" hint="Total pieces" value={c.passengers.bags} max={40} onChange={(n) => setPax({ bags: n })} />
              <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
                <Label htmlFor="assist" className="text-sm font-medium">Special assistance</Label>
                <Switch id="assist" checked={c.passengers.assistance}
                  onCheckedChange={(v) => setPax({ assistance: v })} />
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aircraft preference</Label>
          <Select value={c.preference} onValueChange={(v) => set("preference", v as SearchCriteria["preference"])}>
            <SelectTrigger aria-label="Aircraft preference"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AIRCRAFT_PREFERENCES.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Travel purpose</Label>
          <Select value={c.purpose || "unspecified"}
            onValueChange={(v) => set("purpose", v === "unspecified" ? "" : (v as SearchCriteria["purpose"]))}>
            <SelectTrigger aria-label="Travel purpose"><SelectValue placeholder="Optional" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unspecified">Not specified</SelectItem>
              {TRAVEL_PURPOSES.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cabin experience</Label>
          <Select value={c.cabin} onValueChange={(v) => set("cabin", v as SearchCriteria["cabin"])}>
            <SelectTrigger aria-label="Cabin experience"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CABIN_CLASSES.map((cl) => <SelectItem key={cl.key} value={cl.key}>{cl.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {insight ? (
            <>
              <Badge variant="secondary" className="gap-1">
                <Plane className="h-3 w-3" /> {insight.distanceNm} nm
              </Badge>
              <span>Estimated {insight.label} airborne</span>
            </>
          ) : (
            <span>Select both airfields to see distance and flight time.</span>
          )}
        </div>
        <Button size="lg" onClick={submit} disabled={!ready || submitting} className="w-full sm:w-auto">
          {submitting ? (
            <><PlaneTakeoff className="mr-2 h-4 w-4 animate-[takeoff_0.65s_ease-in-out]" /> Searching operators…</>
          ) : (
            <><Search className="mr-2 h-4 w-4" /> Search available aircraft</>
          )}
        </Button>
      </div>
      {submitting && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> TaxiD AI is checking verified operators across East Africa.
        </p>
      )}
    </div>
  );
}

export default CharterSearchWidget;
