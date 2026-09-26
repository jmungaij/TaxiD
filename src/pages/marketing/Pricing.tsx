import { useId, useState } from "react";
import { Car, Package, KeyRound, Calculator } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";

const Calc = ({ rate, unit, label }: { rate: number; unit: string; label: string }) => {
  const [v, setV] = useState(10);
  const [vehicle, setVehicle] = useState("economy");
  const reactId = useId();
  const distanceId = `pricing-distance-${reactId}`;
  const tierId = `pricing-tier-${reactId}`;
  const mult = vehicle === "economy" ? 1 : vehicle === "executive" ? 1.6 : 2.5;
  const base = 200;
  const total = Math.round(base + v * rate * mult);
  return (
    <div className="p-6 rounded-2xl bg-card border border-border">
      <div className="space-y-3">
        <div>
          <label htmlFor={distanceId} className="text-sm font-medium">{label}</label>
          <Input id={distanceId} type="number" min={1} value={v} onChange={(e) => setV(Math.max(1, Number(e.target.value)))} aria-label={label} />
        </div>
        <div>
          <label htmlFor={tierId} className="text-sm font-medium">Vehicle tier</label>
          <select id={tierId} aria-label="Vehicle tier" className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
            <option value="economy">Economy (×1.0)</option>
            <option value="executive">Executive (×1.6)</option>
            <option value="luxury">Luxury (×2.5)</option>
          </select>
        </div>
        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">Estimated total</p>
          <p className="text-3xl font-bold text-primary">KSh {total.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">Base KSh {base} + {v} {unit} × KSh {rate} × tier multiplier</p>
        </div>
      </div>
    </div>
  );
};

const Pricing = () => (
  <MarketingPage>
    <PageHero eyebrow="Pricing" title="Simple, transparent fares." subtitle="Estimate fares before you book — no surprises, no hidden fees." />

    <section className="container mx-auto px-4 py-20">
      <Tabs defaultValue="ride" className="max-w-3xl mx-auto">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="ride"><Car className="h-4 w-4 mr-2" />Ride</TabsTrigger>
          <TabsTrigger value="delivery"><Package className="h-4 w-4 mr-2" />Delivery</TabsTrigger>
          <TabsTrigger value="rental"><KeyRound className="h-4 w-4 mr-2" />Rental</TabsTrigger>
        </TabsList>
        <TabsContent value="ride" className="mt-6"><Calc rate={55} unit="km" label="Distance (km)" /></TabsContent>
        <TabsContent value="delivery" className="mt-6"><Calc rate={40} unit="km" label="Distance (km)" /></TabsContent>
        <TabsContent value="rental" className="mt-6"><Calc rate={350} unit="hours" label="Hours" /></TabsContent>
      </Tabs>
    </section>

    <section className="bg-secondary/40 py-16">
      <div className="container mx-auto px-4 max-w-3xl text-center">
        <Calculator className="h-10 w-10 text-primary mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-4">Transparent fee breakdown</h2>
        <p className="text-muted-foreground mb-6">Every receipt itemizes base fare, distance, time, surge, VAT and driver tip — no rounding tricks.</p>
        <div className="grid sm:grid-cols-3 gap-4 text-left">
          {[
            { t: "Base fare", d: "Pickup and booking fee" },
            { t: "Per km / minute", d: "Time and distance metered" },
            { t: "Dynamic surge", d: "Capped by city regulations" },
          ].map((i) => (
            <div key={i.t} className="p-4 rounded-lg bg-card border border-border">
              <p className="font-semibold">{i.t}</p>
              <p className="text-xs text-muted-foreground">{i.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  </MarketingPage>
);

export default Pricing;
