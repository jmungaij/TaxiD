/**
 * Operator bulk editor for charter inventory — availability windows,
 * empty-leg offers, rates and listing status across a selection of assets.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { charterApi } from "@/lib/charter/api";

const KEEP = "__keep__";

interface Props {
  selectedIds: string[];
  statuses: string[];
  onSaved: () => void;
  onClear: () => void;
}

export function InventoryBulkEditor({ selectedIds, statuses, onSaved, onClear }: Props) {
  const [status, setStatus] = useState(KEEP);
  const [listing, setListing] = useState(KEEP);
  const [baseRate, setBaseRate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offerLabel, setOfferLabel] = useState("");
  const [offerPct, setOfferPct] = useState("");
  const [saving, setSaving] = useState(false);

  const validate = (): { patch: Record<string, unknown> } | { error: string } => {
    const patch: Record<string, unknown> = {};
    if (status !== KEEP) patch.status = status;
    if (listing !== KEEP) patch.active = listing === "listed";
    if (baseRate.trim()) {
      const n = Number(baseRate);
      if (!Number.isFinite(n) || n < 0) return { error: "Base rate must be a positive number." };
      patch.base_rate = n;
    }
    if (from) patch.available_from = from;
    if (to) patch.available_to = to;
    if (from && to && from > to) return { error: "Availability window ends before it starts." };
    if (offerLabel.trim()) patch.offer_label = offerLabel.trim().slice(0, 80);
    if (offerPct.trim()) {
      const d = Number(offerPct);
      if (!Number.isFinite(d) || d < 0 || d > 90) return { error: "Empty-leg discount must be between 0 and 90%." };
      patch.offer_discount_pct = d;
    }
    if (!Object.keys(patch).length) return { error: "Set at least one field to apply." };
    return { patch };
  };

  const apply = async () => {
    const result = validate();
    if ("error" in result) {
      toast({ title: "Check the form", description: result.error, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const updated = await charterApi.adminBulkUpdate(selectedIds, result.patch);
      toast({ title: "Bulk update applied", description: `${updated} asset(s) updated.` });
      onSaved();
      onClear();
    } catch (e) {
      toast({
        title: "Bulk update failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          Bulk edit · {selectedIds.length} asset{selectedIds.length === 1 ? "" : "s"} selected
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Bulk status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={KEEP}>Keep current</SelectItem>
              {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Listing</Label>
          <Select value={listing} onValueChange={setListing}>
            <SelectTrigger aria-label="Bulk listing"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={KEEP}>Keep current</SelectItem>
              <SelectItem value="listed">Listed</SelectItem>
              <SelectItem value="delisted">Delisted</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-rate">Base rate</Label>
          <Input id="bulk-rate" inputMode="decimal" placeholder="Unchanged" value={baseRate} onChange={(e) => setBaseRate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-from">Available from</Label>
          <Input id="bulk-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-to">Available to</Label>
          <Input id="bulk-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-offer">Empty-leg label</Label>
          <Input id="bulk-offer" placeholder="e.g. Empty leg NBO–MBA" value={offerLabel} onChange={(e) => setOfferLabel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-offer-pct">Empty-leg discount %</Label>
          <Input id="bulk-offer-pct" inputMode="decimal" placeholder="0–90" value={offerPct} onChange={(e) => setOfferPct(e.target.value)} />
        </div>
        <div className="flex items-end gap-2">
          <Button data-analytics="inventorybulkeditor.apply" onClick={() => void apply()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Apply
          </Button>
          <Button variant="ghost" onClick={onClear}>Clear</Button>
        </div>
      </CardContent>
    </Card>
  );
}
