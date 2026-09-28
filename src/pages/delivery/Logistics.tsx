import { Card } from "@/components/ui/card";
import { DeliveryModulePage } from "@/components/delivery/DeliveryModulePage";
import { DELIVERY_MODULES } from "@/components/delivery/ModuleShell";
import { Route, Warehouse, Snowflake, Container } from "lucide-react";
import logisticsScene from "@/assets/delivery/taxid-logistics-scene.jpg";

const FEATURES = [
  { icon: Route, t: "Multi-stop routing", d: "Optimise 5–50 stops per run automatically." },
  { icon: Warehouse, t: "Warehousing", d: "Cross-dock and short-term storage with audit." },
  { icon: Snowflake, t: "Cold chain", d: "Refrigerated vans with temperature logs." },
  { icon: Container, t: "Container haul", d: "Port → DC moves with custodial tracking." },
];

export default function LogisticsPage() {
  return (
    <DeliveryModulePage
      module={DELIVERY_MODULES.logistics}
      overview={
        <div><img src={logisticsScene} width={1600} height={1008} loading="lazy" alt="Freight trucks and consignments at a distribution hub" className="mb-6 aspect-[16/7] w-full object-cover" /><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <Card key={f.t} className="p-4">
              <f.icon className="h-6 w-6 text-primary mb-2" />
              <div className="font-semibold text-sm">{f.t}</div>
              <p className="text-xs text-muted-foreground mt-1">{f.d}</p>
            </Card>
          ))}
        </div></div>
      }
    />
  );
}
