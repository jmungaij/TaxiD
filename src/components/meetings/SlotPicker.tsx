import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookingCall, errText, nextDays, timeLabel } from "@/lib/meetings/booking";

/** Date strip + free times for a meeting type and host ("any" = first available). */
export default function SlotPicker({ typeId, host, value, onChange }: { typeId: string; host: string; value: string | null; onChange: (s: string | null) => void }) {
  const days = React.useMemo(() => nextDays(21), []);
  const [day, setDay] = React.useState(days[0]);
  const [slots, setSlots] = React.useState<string[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [confidence, setConfidence] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setSlots(null); setErr(null); onChange(null);
    bookingCall<{ slots: string[]; confidence?: string }>({ action: "slots", type: typeId, host, date: day })
      .then((d) => { if (live) { setSlots(d.slots ?? []); setConfidence(d.confidence ?? null); } })
      .catch((e) => { if (live) { setSlots([]); setErr(errText(e, "Could not load times.")); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, typeId, host]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => (
          <Button key={d} type="button" size="sm" variant={d === day ? "default" : "outline"} className="shrink-0" onClick={() => setDay(d)}>
            {new Date(`${d}T09:00:00Z`).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}
          </Button>
        ))}
      </div>
      {slots === null ? <Loader2 className="h-5 w-5 animate-spin" /> : slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{err ?? "No open times on this day. Try another day."}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {slots.map((s) => (
            <Button key={s} type="button" size="sm" variant={s === value ? "default" : "outline"} onClick={() => onChange(s)}>{timeLabel(s)}</Button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Times are Nairobi time (EAT).{confidence === "working_hours_only" ? " These times follow working hours; your host will confirm if anything clashes." : confidence === "calendar_verified" ? " Checked against the live calendar." : ""}</p>
    </div>
  );
}
