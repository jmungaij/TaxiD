import { Card } from "@/components/ui/card";
import { DeliveryModulePage } from "@/components/delivery/DeliveryModulePage";
import { DELIVERY_MODULES } from "@/components/delivery/ModuleShell";
import { Zap, Clock, MapPin, Bell } from "lucide-react";

const FEATURES = [
  { icon: Zap, t: "Same-day delivery", d: "Order before noon, delivered today." },
  { icon: Clock, t: "Scheduled windows", d: "Pick a window up to 14 days ahead." },
  { icon: MapPin, t: "Live tracking", d: "Driver location updates every few seconds." },
  { icon: Bell, t: "Delivery notifications", d: "SMS + push when your parcel moves." },
];

export default function PackageDeliveryPage() {
  return (
    <DeliveryModulePage
      module={DELIVERY_MODULES.package}
      overview={
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f) => (
              <Card key={f.t} className="p-4">
                <f.icon className="h-6 w-6 text-primary mb-2" />
                <div className="font-semibold text-sm">{f.t}</div>
                <p className="text-xs text-muted-foreground mt-1">{f.d}</p>
              </Card>
            ))}
          </div>
        </>
      }
    />
  );
}
