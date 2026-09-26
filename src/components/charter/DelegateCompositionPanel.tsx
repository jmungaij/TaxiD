/**
 * Delegate composition — structured passenger intelligence for corporate,
 * government and NGO delegations rather than a single passenger count.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface DelegateComposition {
  executives: number;
  vipGuests: number;
  supportStaff: number;
  security: number;
  media: number;
  protocol: number;
  luggagePieces: number;
  specialEquipment: string;
  wheelchairAccess: boolean;
  interpreterRequired: boolean;
}

export const EMPTY_DELEGATES: DelegateComposition = {
  executives: 0,
  vipGuests: 0,
  supportStaff: 0,
  security: 0,
  media: 0,
  protocol: 0,
  luggagePieces: 0,
  specialEquipment: "",
  wheelchairAccess: false,
  interpreterRequired: false,
};

/** Total travelling headcount across every delegate role. */
export function delegateTotal(d: DelegateComposition): number {
  return d.executives + d.vipGuests + d.supportStaff + d.security + d.media + d.protocol;
}

/** Document lines describing the delegation for the travel dossier. */
export function delegateLines(d: DelegateComposition): string[] {
  const lines: string[] = [];
  const push = (n: number, label: string) => { if (n > 0) lines.push(`${label}: ${n}`); };
  push(d.executives, "Executive delegates");
  push(d.vipGuests, "VIP guests");
  push(d.supportStaff, "Support staff");
  push(d.security, "Security personnel");
  push(d.media, "Media team");
  push(d.protocol, "Protocol officers");
  push(d.luggagePieces, "Luggage pieces");
  if (d.specialEquipment.trim()) lines.push(`Special equipment: ${d.specialEquipment.trim()}`);
  if (d.wheelchairAccess) lines.push("Wheelchair access required");
  if (d.interpreterRequired) lines.push("Interpreter required");
  return lines;
}

const ROLES: Array<{ key: keyof DelegateComposition; label: string }> = [
  { key: "executives", label: "Executive delegates" },
  { key: "vipGuests", label: "VIP guests" },
  { key: "supportStaff", label: "Support staff" },
  { key: "security", label: "Security personnel" },
  { key: "media", label: "Media team" },
  { key: "protocol", label: "Protocol officers" },
];

export function DelegateCompositionPanel({
  value,
  onChange,
}: {
  value: DelegateComposition;
  onChange: (next: DelegateComposition) => void;
}) {
  const total = delegateTotal(value);
  const setNum = (key: keyof DelegateComposition, raw: string) =>
    onChange({ ...value, [key]: Math.max(0, Number(raw) || 0) });

  return (
    <Card className="border-primary/20 bg-card/70 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Delegation composition</CardTitle>
        <p className="text-xs text-muted-foreground">
          Declare who travels so the vehicle class, seating and protocol handling match the mission.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r.key}>
              <Label htmlFor={`delegate-${r.key}`}>{r.label}</Label>
              <Input
                id={`delegate-${r.key}`}
                type="number"
                min={0}
                className="mt-2"
                value={value[r.key] as number}
                onChange={(e) => setNum(r.key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="delegate-luggage">Luggage pieces</Label>
            <Input
              id="delegate-luggage"
              type="number"
              min={0}
              className="mt-2"
              value={value.luggagePieces}
              onChange={(e) => setNum("luggagePieces", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="delegate-equipment">Special equipment</Label>
            <Input
              id="delegate-equipment"
              className="mt-2"
              maxLength={200}
              placeholder="Conference kit, medical cooler, broadcast gear…"
              value={value.specialEquipment}
              onChange={(e) => onChange({ ...value, specialEquipment: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="delegate-wheelchair" className="text-sm font-normal">Wheelchair access</Label>
            <Switch
              id="delegate-wheelchair"
              checked={value.wheelchairAccess}
              onCheckedChange={(v) => onChange({ ...value, wheelchairAccess: v })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="delegate-interpreter" className="text-sm font-normal">Interpreter required</Label>
            <Switch
              id="delegate-interpreter"
              checked={value.interpreterRequired}
              onCheckedChange={(v) => onChange({ ...value, interpreterRequired: v })}
            />
          </div>
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">Total passengers: </span>
          <span className="font-semibold tabular-nums">{total}</span>
        </p>
      </CardContent>
    </Card>
  );
}
