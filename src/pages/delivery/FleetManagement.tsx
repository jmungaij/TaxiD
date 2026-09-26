import { Card } from "@/components/ui/card";
import { DeliveryModulePage } from "@/components/delivery/DeliveryModulePage";
import { DELIVERY_MODULES } from "@/components/delivery/ModuleShell";
import { Wrench, BarChart3, Users, FileWarning } from "lucide-react";

const FEATURES = [
  { icon: Users, t: "Driver assignment", d: "Roster, shifts and substitutions per vehicle." },
  { icon: Wrench, t: "Maintenance log", d: "Service intervals with cost reporting." },
  { icon: BarChart3, t: "Utilisation analytics", d: "Idle time, revenue / vehicle, cost per km." },
  { icon: FileWarning, t: "Compliance alerts", d: "Insurance, NTSA & licence expiry." },
];

export default function FleetManagementPage() {
  return (
    <DeliveryModulePage
      module={DELIVERY_MODULES.fleet}
      overview={
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <Card key={f.t} className="p-4">
              <f.icon className="h-6 w-6 text-primary mb-2" />
              <div className="font-semibold text-sm">{f.t}</div>
              <p className="text-xs text-muted-foreground mt-1">{f.d}</p>
            </Card>
          ))}
        </div>
      }
    />
  );
}
