/**
 * Commercial deal simulator — price vs commission trade-offs.
 *
 * Every scenario is computed by the server against the live commission
 * configuration and the published rate card. These are comparisons of the
 * current configuration, not forecasts or guaranteed outcomes.
 */
import { useCallback, useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
  COMMISSION_BASIS_LABELS,
  type CommissionScenario,
  simulateCommission,
} from "@/lib/pricing/commission";

interface Props {
  services?: string[];
  scopes?: string[];
  categories?: string[];
  serviceLabel?: (code: string) => string;
  categoryLabel?: (code: string) => string;
}

const money = (n: number | null | undefined, currency = "KES") =>
  n == null ? "restricted" : `${currency} ${Number(n).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export function DealSimulator({
  services = [],
  scopes = [],
  categories = [],
  serviceLabel = (s) => s,
  categoryLabel = (c) => c,
}: Props) {
  const [service, setService] = useState(services[0] ?? "");
  const [scope, setScope] = useState(scopes[0] ?? "");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [price, setPrice] = useState("16000");
  const [quantity, setQuantity] = useState("1");
  const [discounts, setDiscounts] = useState("0,5,10,15");
  const [rows, setRows] = useState<CommissionScenario[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const base = Number(price) || 0;
  const qty = Math.max(1, Number(quantity) || 1);

  const steps = useMemo(
    () =>
      discounts
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n)),
    [discounts],
  );

  const run = useCallback(async () => {
    if (base <= 0) {
      toast.error("Enter the customer price to compare");
      return;
    }
    setBusy(true);
    try {
      const result = await simulateCommission({
        service_code: service || null,
        scope_label: scope || null,
        category_code: category || null,
        transaction_type: "corporate_charter",
        volume: qty,
        net_service_price: base * qty,
        options: steps.map((d) => ({
          label: d === 0 ? "Recommended price" : `${d}% discount`,
          net_service_price: Math.round(base * qty * (1 - d / 100)),
        })),
      });
      setRows(result.options ?? []);
      setNote(result.note ?? "");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [base, qty, service, scope, category, steps]);

  const restricted = rows?.some((r) => !r.money_visible) ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deal simulator</CardTitle>
        <CardDescription>
          Compare what different selling prices do to platform commission and partner payout, using
          the live commission configuration. A comparison, not a forecast.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="sim-service">Service</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger id="sim-service">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s} value={s}>
                    {serviceLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sim-scope">Route</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger id="sim-scope">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                {scopes.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sim-category">Vehicle class</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="sim-category">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {categoryLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sim-price">Unit price (KES)</Label>
            <Input id="sim-price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sim-qty">Units</Label>
            <Input id="sim-qty" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sim-discounts">Discount steps %</Label>
            <Input
              id="sim-discounts"
              value={discounts}
              onChange={(e) => setDiscounts(e.target.value)}
              placeholder="0,5,10"
            />
          </div>
        </div>

        <Button onClick={run} disabled={busy} data-analytics="deal-simulator-run">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Compare scenarios
        </Button>

        {rows && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scenario</TableHead>
                  <TableHead className="text-right">Customer price</TableHead>
                  <TableHead className="text-right">Commission rate</TableHead>
                  <TableHead className="text-right">Platform commission</TableHead>
                  <TableHead className="text-right">Partner payout</TableHead>
                  <TableHead>Basis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right">{money(r.customer_price)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline">{r.rate_percent}%</Badge>
                    </TableCell>
                    <TableCell className="text-right">{money(r.commission_amount)}</TableCell>
                    <TableCell className="text-right">{money(r.supplier_payout)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {COMMISSION_BASIS_LABELS[r.basis] ?? r.basis}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {restricted && (
              <p className="text-sm text-muted-foreground">
                Commission and payout figures are restricted to finance and pricing roles, so they
                are hidden here.
              </p>
            )}
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
