/// <reference types="google.maps" />
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Loader2, MapPin, X } from "lucide-react";
import type { BookingPoint } from "./bookingTypes";

/** The Places Autocomplete fields this input reads. */
interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting?: { main_text?: string; secondary_text?: string };
}

/** The Geocoder fields this input reads. */
interface GeocodeResult {
  formatted_address?: string;
  geometry: { location: { lat: () => number; lng: () => number } };
}

interface Prediction {
  placeId: string;
  primary: string;
  secondary: string;
}

interface Props {
  id?: string;
  label: string;
  badge: string;
  placeholder?: string;
  value: BookingPoint | null;
  active?: boolean;
  onFocusField?: () => void;
  onResolve: (point: BookingPoint | null) => void;
  /**
   * Called with the raw typed text when no suggestion has been picked. Lets a
   * form accept a typed address (no coordinates) so the flow is never blocked
   * when Places suggestions are unavailable.
   */
  onFreeText?: (text: string) => void;
  /** Bias predictions around this location (defaults to Nairobi). */
  bias?: { lat: number; lng: number };
  testId?: string;
}

const NAIROBI = { lat: -1.286389, lng: 36.817223 };

/**
 * Accessible, typeable address field with Google Places autocomplete.
 * Users can freely type, pick a suggestion with mouse or keyboard
 * (↑/↓/Enter/Esc), or clear the field — matching international
 * ride-hailing booking standards.
 */
export function AddressSearchInput({
  id,
  label,
  badge,
  placeholder,
  value,
  active,
  onFocusField,
  onResolve,
  onFreeText,
  bias = NAIROBI,
  testId,
}: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-listbox`;

  const [text, setText] = useState(value?.address ?? "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Prediction[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const svcRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const tokenRef = useRef<any>(null);
  const dirtyRef = useRef(false);
  const blurTimer = useRef<number | null>(null);

  const query = useDebouncedValue(text, 250);

  // Keep the field in sync when the point changes elsewhere (map pin drop).
  useEffect(() => {
    if (!dirtyRef.current) setText(value?.address ?? "");
  }, [value?.address]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled) return;
        svcRef.current = new g.maps.places.AutocompleteService();
        geocoderRef.current = new g.maps.Geocoder();
        tokenRef.current = new g.maps.places.AutocompleteSessionToken();
      })
      .catch(() => !cancelled && setUnavailable(true));
    return () => {
      cancelled = true;
      if (blurTimer.current) window.clearTimeout(blurTimer.current);
    };
  }, []);

  const biasKey = useMemo(() => `${bias.lat},${bias.lng}`, [bias.lat, bias.lng]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const q = query.trim();
    if (q.length < 3 || !svcRef.current) {
      setItems([]);
      return;
    }
    setBusy(true);
    svcRef.current.getPlacePredictions(
      {
        input: q,
        sessionToken: tokenRef.current,
        location: new window.google.maps.LatLng(bias.lat, bias.lng),
        radius: 60000,
        componentRestrictions: { country: "ke" },
      },
      (res: PlacePrediction[] | null, status: string) => {
        setBusy(false);
        if (status !== "OK" || !res) {
          setItems([]);
          return;
        }
        setItems(
          res.slice(0, 6).map((p) => ({
            placeId: p.place_id,
            primary: p.structured_formatting?.main_text ?? p.description,
            secondary: p.structured_formatting?.secondary_text ?? "",
          })),
        );
        setOpen(true);
        setHighlight(-1);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, biasKey]);

  function select(p: Prediction) {
    if (!geocoderRef.current) return;
    setBusy(true);
    geocoderRef.current.geocode({ placeId: p.placeId }, (results: GeocodeResult[] | null, status: string) => {
      setBusy(false);
      setOpen(false);
      setItems([]);
      if (status !== "OK" || !results?.[0]) return;
      const loc = results[0].geometry.location;
      const address = results[0].formatted_address ?? `${p.primary} ${p.secondary}`.trim();
      dirtyRef.current = false;
      setText(address);
      onResolve({ address, lat: loc.lat(), lng: loc.lng() });
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      if (highlight >= 0) {
        e.preventDefault();
        select(items[highlight]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function clear() {
    dirtyRef.current = false;
    setText("");
    setItems([]);
    setOpen(false);
    onResolve(null);
    onFreeText?.("");
  }

  return (
    <div className="relative">
      <Label htmlFor={inputId} className="text-xs flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-4 w-4 rounded-full inline-flex items-center justify-center text-[10px] font-bold ${
            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {badge}
        </span>
        {label}
      </Label>
      <div className="relative">
        <Input
          id={inputId}
          data-testid={testId}
          className="pr-16"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
          autoComplete="off"
          value={text}
          placeholder={placeholder ?? "Search an address, place or landmark"}
          onFocus={() => {
            onFocusField?.();
            if (items.length) setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 150);
          }}
          onChange={(e) => {
            dirtyRef.current = true;
            setText(e.target.value);
            if (!e.target.value) onResolve(null);
            onFreeText?.(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
          {text && (
            <button
              type="button"
              aria-label={`Clear ${label}`}
              onClick={clear}
              className="text-muted-foreground hover:text-foreground rounded-sm p-0.5"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {unavailable && (
        <p className="text-[11px] text-muted-foreground mt-1">
          Search suggestions unavailable — tap the map to set this point.
        </p>
      )}

      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute z-30 mt-1 w-full rounded-lg border bg-popover shadow-lg overflow-hidden"
        >
          {items.map((p, i) => (
            <li
              key={p.placeId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(p)}
              className={`px-3 py-2 cursor-pointer flex items-start gap-2 text-sm ${
                i === highlight ? "bg-primary text-primary-foreground" : ""
              }`}
            >
              <MapPin className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.primary}</span>
                {p.secondary && (
                  <span className="block truncate text-xs text-muted-foreground">{p.secondary}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
