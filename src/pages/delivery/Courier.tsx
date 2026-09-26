import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeliveryModulePage } from "@/components/delivery/DeliveryModulePage";
import { DELIVERY_MODULES } from "@/components/delivery/ModuleShell";
import { Timer, Shield, MapPinned, Bike } from "lucide-react";
import { offering, publicExposure } from "@/lib/logistics/domain";

/**
 * Single authoritative courier service implementation. Document courier and
 * Express city are two SERVICE_OFFERINGS of the same COURIER family rendered by
 * this one route — presentation state via ?offering=, never a duplicated page.
 * Copy governed by src/lib/logistics/claimsGovernance.ts.
 */
const FEATURES = [
  { icon: Timer, t: "Express pickup target: 60 minutes", d: "Hot-zone couriers staged across the city. Target, not a guarantee — subject to capacity." },
  { icon: Shield, t: "Accountable handovers", d: "Chain of custody, timestamp and proof of delivery on every handover." },
  { icon: MapPinned, t: "Route compliance", d: "Geo-fenced corridors with audit trail." },
  { icon: Bike, t: "Two-wheel + e-bike fleet", d: "Lower cost, faster CBD coverage." },
];

const DEFAULT_OFFERING = "COURIER_DOCUMENT";

export default function CourierPage() {
  const [params] = useSearchParams();
  const code = params.get("offering") ?? DEFAULT_OFFERING;
  const svc = useMemo(() => offering(code) ?? offering(DEFAULT_OFFERING), [code]);

  return (
    <DeliveryModulePage
      module={DELIVERY_MODULES.courier}
      overview={
        <div className="space-y-4">
          {svc && (
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-semibold text-sm">{svc.name}</div>
                <Badge variant="outline">{svc.family} · v{svc.version}</Badge>
                <Badge variant={publicExposure(svc) === "BOOKABLE" ? "default" : "secondary"}>
                  {publicExposure(svc) === "BOOKABLE" ? "Bookable" : "Enquiry only"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{svc.description}</p>
              <dl className="grid sm:grid-cols-3 gap-3 mt-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Weight range</dt>
                  <dd className="font-medium">{svc.weightLimitKg.min}–{svc.weightLimitKg.max} kg</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Proof of delivery</dt>
                  <dd className="font-medium">{svc.pod.required.join(" + ")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Operating hours</dt>
                  <dd className="font-medium">{svc.operatingHours.open}–{svc.operatingHours.close} · {svc.operatingHours.days}</dd>
                </div>
              </dl>
              <p className="text-[11px] text-muted-foreground mt-3">{svc.sla.qualifier}</p>
            </Card>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f) => (
              <Card key={f.t} className="p-4">
                <f.icon className="h-6 w-6 text-primary mb-2" />
                <div className="font-semibold text-sm">{f.t}</div>
                <p className="text-xs text-muted-foreground mt-1">{f.d}</p>
              </Card>
            ))}
          </div>
        </div>
      }
    />
  );
}
