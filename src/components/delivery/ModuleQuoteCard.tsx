/**
 * Module quote card — intent capture for a single delivery module.
 *
 * Presentation only: it prefills from the hand-off query params written by the
 * delivery landing hero (`?intent=…&pickup=…&dropoff=…`) so the customer never
 * retypes what they already told us, then hands off to the existing contact /
 * pricing surfaces with the same params. No new booking engine, no pricing
 * calculation of its own.
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Clock, Camera } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ModuleMeta } from "./ModuleShell";
import { trackBookingStep, trackBookingHandoff } from "@/lib/marketing/bookingFunnel";

const SPEEDS = ["Express (≤ 60 min)", "Same day", "Next day", "Scheduled"];

export function ModuleQuoteCard({ module }: { module: ModuleMeta }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const initial = useMemo(
    () => ({
      pickup: params.get("pickup") ?? params.get("origin") ?? "",
      dropoff: params.get("dropoff") ?? params.get("destination") ?? "",
      detail: params.get("weight") ?? params.get("tonnage") ?? params.get("parcelType") ?? "",
      speed: params.get("speed") ?? "",
    }),
    [params],
  );

  const [form, setForm] = useState(initial);
  const prefilled = Boolean(initial.pickup || initial.dropoff);

  /**
   * Where this module's request belongs. Parcel and courier are priced and
   * booked online; fleet and logistics are freight-class work that a specialist
   * quotes, so they open the enquiry desk instead of a generic contact form.
   */
  const destination = useMemo(() => {
    const bookable: Record<string, string> = {
      package: "/delivery/book?offering=PARCEL_STANDARD",
      courier: "/delivery/book?offering=COURIER_DOCUMENT",
    };
    const enquiry: Record<string, string> = {
      fleet: "/delivery/enquiry?topic=truck",
      logistics: "/delivery/enquiry?topic=freight",
    };
    return bookable[module.id] ?? enquiry[module.id] ?? "/delivery/enquiry?topic=freight";
  }, [module.id]);

  const submit = () => {
    trackBookingStep("quote_viewed", {
      serviceCategory: `delivery_${module.id}`,
      origin: form.pickup,
      destination: form.dropoff,
    });
    trackBookingHandoff(`delivery_module_quote_${module.id}`, destination, {
      serviceCategory: `delivery_${module.id}`,
    });
    const [path, existingQuery] = destination.split("?");
    const qs = new URLSearchParams(existingQuery ?? "");
    qs.set("service", module.label);
    Object.entries(form).forEach(([k, v]) => v && qs.set(k, v));
    navigate(`${path}?${qs.toString()}`);
  };

  return (
    <Card className="border-primary/20 p-5 lg:sticky lg:top-24">
      <h2 className="text-base font-semibold">Request this delivery</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {prefilled
          ? "We carried over the details you entered — check them and send."
          : "Share the route and we return a quoted price before anything moves."}
      </p>

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {[
          { id: "pickup", label: "Pickup", placeholder: "Collect from" },
          { id: "dropoff", label: "Destination", placeholder: "Deliver to" },
          { id: "detail", label: "What are you sending?", placeholder: "e.g. 4 kg documents" },
        ].map((f) => (
          <div key={f.id}>
            <label
              htmlFor={`quote-${f.id}`}
              className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              {f.label}
            </label>
            <input
              id={`quote-${f.id}`}
              value={form[f.id as keyof typeof form]}
              placeholder={f.placeholder}
              onChange={(e) => setForm((v) => ({ ...v, [f.id]: e.target.value }))}
              className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        ))}
        <div>
          <label
            htmlFor="quote-speed"
            className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            Delivery speed
          </label>
          <select
            id="quote-speed"
            value={form.speed}
            onChange={(e) => setForm((v) => ({ ...v, speed: e.target.value }))}
            className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select</option>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Get my price <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </form>

      <ul className="mt-4 space-y-2 border-t pt-4">
        {[
          { icon: Clock, t: "Priced and agreed up front" },
          { icon: ShieldCheck, t: "Vetted, accountable operators" },
          { icon: Camera, t: "Digital proof of delivery" },
        ].map((x) => (
          <li key={x.t} className="flex items-center gap-2 text-xs text-muted-foreground">
            <x.icon className="h-3.5 w-3.5 text-primary" aria-hidden /> {x.t}
          </li>
        ))}
      </ul>
      <Link to="/pricing" className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">
        See indicative pricing
      </Link>
    </Card>
  );
}

export default ModuleQuoteCard;
