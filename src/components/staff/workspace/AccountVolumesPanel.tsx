/**
 * WHAT ACTUALLY RAN TODAY, CUSTOMER BY CUSTOMER.
 *
 * The specialist enters the airport transfers, staff transport trips and parcel
 * deliveries each customer used today, and the value they can stand behind. The
 * gap to the monthly target is recomputed from the records the moment a figure
 * is saved — nothing here is a guess, and a customer with nothing recorded is
 * shown as not recorded rather than as a zero.
 */
import * as React from "react";
import { Loader2, PlaneTakeoff, Package, RefreshCw, Save, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  loadVolumeBoard,
  recordAccountVolumes,
  volumeRefusal,
  type VolumeAccount,
  type VolumeBoard,
} from "@/lib/sales/accountVolumes";

const KES = (n: number | null | undefined): string =>
  n == null ? "not stated" : `KSh ${Math.round(n).toLocaleString("en-KE")}`;

function AccountRow({ account, onSaved }: { account: VolumeAccount; onSaved: () => void }) {
  const { toast } = useToast();
  const t = account.today;
  const [air, setAir] = React.useState(String(t?.airport_transfers ?? ""));
  const [trips, setTrips] = React.useState(String(t?.staff_transport_trips ?? ""));
  const [parcels, setParcels] = React.useState(String(t?.parcel_deliveries ?? ""));
  const [value, setValue] = React.useState(t?.declared_value_kes == null ? "" : String(t.declared_value_kes));
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await recordAccountVolumes({
        accountId: account.account_id,
        airportTransfers: Number(air || 0),
        staffTransportTrips: Number(trips || 0),
        parcelDeliveries: Number(parcels || 0),
        declaredValueKes: value.trim() === "" ? null : Number(value),
      });
      toast({ title: "Recorded", description: `${account.name} — today's service figures saved.` });
      onSaved();
    } catch (e) {
      toast({
        title: "Not recorded",
        description: volumeRefusal(e instanceof Error ? e.message : String(e)),
        variant: "destructive",
      });
    }
    setSaving(false);
  };

  const m = account.month;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{account.name}</span>
        <Badge variant="outline" className="text-[10px] capitalize">
          {account.lifecycle_stage.replace(/_/g, " ")}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {m
            ? `This month: ${m.airport_transfers} transfer(s), ${m.staff_transport_trips} staff trip(s), ${m.parcel_deliveries} parcel(s) · ${KES(m.declared_value_kes)} over ${m.days_recorded} recorded day(s)`
            : "Nothing recorded this month yet"}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        <div>
          <Label className="text-[11px] text-muted-foreground">Airport transfers</Label>
          <Input aria-label={`Airport transfers for ${account.name}`} inputMode="numeric" value={air} onChange={(e) => setAir(e.target.value.replace(/\D/g, ""))} placeholder="0" />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Staff transport trips</Label>
          <Input aria-label={`Staff transport trips for ${account.name}`} inputMode="numeric" value={trips} onChange={(e) => setTrips(e.target.value.replace(/\D/g, ""))} placeholder="0" />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Parcels</Label>
          <Input aria-label={`Parcels for ${account.name}`} inputMode="numeric" value={parcels} onChange={(e) => setParcels(e.target.value.replace(/\D/g, ""))} placeholder="0" />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Value today (KSh)</Label>
          <Input
            aria-label={`Value today in KSh for ${account.name}`}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="leave blank if not known"
          />
        </div>
        <div className="flex items-end">
          <Button size="sm" className="w-full" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="mr-1 h-3.5 w-3.5" aria-hidden />}
            {saving ? "" : t ? "Update" : "Record"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AccountVolumesPanel() {
  const [board, setBoard] = React.useState<VolumeBoard | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await loadVolumeBoard());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The service figures could not be read.");
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading && !board) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading what ran today…
      </div>
    );
  }
  if (error) return <p className="py-4 text-sm text-destructive">{error}</p>;
  if (!board) return null;

  const m = board.month;

  return (
    <div className="space-y-3">
      <Card className="border-primary/20">
        <CardContent className="space-y-2 pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Service delivered this month
            </p>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Refresh
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <PlaneTakeoff className="h-4 w-4 text-primary" aria-hidden /> {m.airport_transfers} airport transfer(s)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4 text-primary" aria-hidden /> {m.staff_transport_trips} staff transport trip(s)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Package className="h-4 w-4 text-primary" aria-hidden /> {m.parcel_deliveries} parcel(s)
            </span>
          </div>
          <p className="text-sm">
            {KES(m.declared_value_kes)} of service recorded over {m.days_recorded} day(s).{" "}
            {board.gap_after_operations_kes == null
              ? "No monthly target is recorded against you, so no gap can be stated."
              : board.gap_after_operations_kes <= 0
                ? "Recognised revenue and recorded service together cover the month's target."
                : `${KES(board.gap_after_operations_kes)} still to find once today's service is counted (${KES(board.gap_revenue_only_kes)} on recognised revenue alone).`}
          </p>
          <p className="text-xs text-muted-foreground">
            {m.projected_month_value_kes == null
              ? "A month projection needs at least one recorded day."
              : `At the rate of the days recorded so far, this book runs at ${KES(m.projected_month_value_kes)} for the full month.`}
          </p>
        </CardContent>
      </Card>

      {board.accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No customer account is held against you yet, so there is nothing to record against.
        </p>
      ) : (
        <div className="space-y-2">
          {board.accounts.map((a) => (
            <AccountRow key={a.account_id} account={a} onSaved={() => void load()} />
          ))}
        </div>
      )}
    </div>
  );
}

export default AccountVolumesPanel;
