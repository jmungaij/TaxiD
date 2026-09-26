/**
 * Cost baseline entry — the real figures that make margin and market
 * comparison work. Nothing here is seeded or guessed: every number is typed in
 * by finance/pricing and stored against the same service / scope / vehicle
 * class keys the rate card uses. Write authority is enforced in the database.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
  type CostBaseline,
  PRICING_BASIS_OPTIONS,
  costTotal,
  deleteCostBaseline,
  fetchCostBaselines,
  saveCostBaseline,
} from "@/lib/pricing/competitive";

const COST_FIELDS = [
  { key: "driver_cost", label: "Driver" },
  { key: "fuel_cost", label: "Fuel" },
  { key: "tolls_parking", label: "Tolls & parking" },
  { key: "supplier_cost", label: "Supplier / partner" },
  { key: "operational_cost", label: "Operations" },
  { key: "platform_cost", label: "Platform" },
] as const;

type Draft = Partial<CostBaseline> & Record<string, unknown>;

const money = (n: number, currency = "KES") =>
  `${currency} ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

export function CostBaselineEditor({
  services,
  scopes,
  categories,
  serviceLabel,
  categoryLabel,
}: {
  services: string[];
  scopes: string[];
  categories: string[];
  serviceLabel: (code: string) => string;
  categoryLabel: (code: string) => string;
}) {
  const [rows, setRows] = useState<CostBaseline[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({
    service_code: services[0] ?? "",
    scope_label: scopes[0] ?? "",
    category_code: categories[0] ?? "",
    pricing_basis: "per_trip",
    currency: "KES",
    effective_from: new Date().toISOString().slice(0, 10),
    source: "",
  });

  const load = useCallback(async () => {
    try {
      setRows(await fetchCostBaselines());
      setDenied(null);
    } catch (e) {
      setDenied(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const draftTotal = useMemo(() => costTotal(draft), [draft]);

  const setField = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value === "" ? null : value }));

  const save = async () => {
    if (!draft.service_code || !draft.scope_label || !draft.category_code) {
      toast.error("Pick the service, scope and vehicle class this cost belongs to");
      return;
    }
    if (draftTotal <= 0) {
      toast.error("Enter at least one real cost figure");
      return;
    }
    setSaving(true);
    try {
      await saveCostBaseline({
        ...draft,
        driver_cost: draft.driver_cost == null ? null : Number(draft.driver_cost),
        fuel_cost: draft.fuel_cost == null ? null : Number(draft.fuel_cost),
        tolls_parking: draft.tolls_parking == null ? null : Number(draft.tolls_parking),
        supplier_cost: draft.supplier_cost == null ? null : Number(draft.supplier_cost),
        operational_cost: draft.operational_cost == null ? null : Number(draft.operational_cost),
        platform_cost: draft.platform_cost == null ? null : Number(draft.platform_cost),
      });
      toast.success("Cost baseline recorded", {
        description: `${serviceLabel(String(draft.service_code))} · ${draft.scope_label} · ${categoryLabel(
          String(draft.category_code),
        )} — ${money(draftTotal, String(draft.currency ?? "KES"))}`,
      });
      setDraft((d) => ({
        ...d,
        id: undefined,
        driver_cost: null,
        fuel_cost: null,
        tolls_parking: null,
        supplier_cost: null,
        operational_cost: null,
        platform_cost: null,
      }));
      await load();
    } catch (e) {
      toast.error("Cost baseline not saved", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: CostBaseline) => {
    try {
      await deleteCostBaseline(row.id);
      await load();
      toast.success("Cost baseline removed");
    } catch (e) {
      toast.error("Not removed", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading cost baselines…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {denied && (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader>
            <CardTitle className="text-base">Cost figures are restricted</CardTitle>
            <CardDescription>
              Cost and margin are visible to finance and pricing only. {denied}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record a cost baseline</CardTitle>
          <CardDescription>
            Enter what a single unit of this service actually costs. Margin on the quotation builder
            and the market comparison read these figures — no cost is assumed anywhere.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Service</Label>
              <Select
                value={String(draft.service_code ?? "")}
                onValueChange={(v) => setField("service_code", v)}
              >
                <SelectTrigger><SelectValue placeholder="Service" /></SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s} value={s}>{serviceLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scope / destination</Label>
              <Select
                value={String(draft.scope_label ?? "")}
                onValueChange={(v) => setField("scope_label", v)}
              >
                <SelectTrigger><SelectValue placeholder="Scope" /></SelectTrigger>
                <SelectContent>
                  {scopes.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vehicle class</Label>
              <Select
                value={String(draft.category_code ?? "")}
                onValueChange={(v) => setField("category_code", v)}
              >
                <SelectTrigger><SelectValue placeholder="Class" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Basis</Label>
              <Select
                value={String(draft.pricing_basis ?? "per_trip")}
                onValueChange={(v) => setField("pricing_basis", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRICING_BASIS_OPTIONS.map((b) => (
                    <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-6">
            {COST_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>{f.label}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={(draft[f.key] as string | number | null) ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Effective from</Label>
              <Input
                type="date"
                value={String(draft.effective_from ?? "")}
                onChange={(e) => setField("effective_from", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Effective to (optional)</Label>
              <Input
                type="date"
                value={String(draft.effective_to ?? "")}
                onChange={(e) => setField("effective_to", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Where the figure came from</Label>
              <Input
                placeholder="e.g. supplier quote, fuel log"
                value={String(draft.source ?? "")}
                onChange={(e) => setField("source", e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">Unit cost {money(draftTotal, String(draft.currency ?? "KES"))}</Badge>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
              Save cost baseline
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recorded baselines</CardTitle>
          <CardDescription>
            {rows.length === 0
              ? "No cost figures recorded yet — margin will stay blank until you add them."
              : `${rows.length} baseline(s) in use by the pricing engine.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{serviceLabel(r.service_code)}</TableCell>
                    <TableCell>{r.scope_label}</TableCell>
                    <TableCell>{categoryLabel(r.category_code)}</TableCell>
                    <TableCell>
                      {PRICING_BASIS_OPTIONS.find((b) => b.value === r.pricing_basis)?.label ??
                        r.pricing_basis}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(costTotal(r), r.currency)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.effective_from ?? "—"}
                      {r.effective_to ? ` → ${r.effective_to}` : ""}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.source ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
