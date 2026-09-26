import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, FileText, Plus, ShieldCheck, AlertTriangle, Receipt } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { RateCardWorkspace } from "@/components/staff/pricing/RateCardWorkspace";
import { NegotiationPanel, type NegotiationValue } from "@/components/staff/pricing/NegotiationPanel";
import { PricingIntelligence } from "@/components/staff/pricing/PricingIntelligence";
import { CostBaselineEditor } from "@/components/staff/pricing/CostBaselineEditor";
import { QuotationAcceptance } from "@/components/staff/pricing/QuotationAcceptance";
import { CommissionEngine } from "@/components/staff/pricing/CommissionEngine";
import { DealSimulator } from "@/components/staff/pricing/DealSimulator";

import {
  type RateCard,
  type RateLine,
  type VehicleCategory,
  type QuoteLineRequest,
  SERVICE_LABELS,
  PRICING_BASIS_LABELS,
  fetchActiveRateCard,
  fetchRateLines,
  fetchVehicleCategories,
  fetchPricingRequests,
  fetchAccountPack,
  listAccounts,
  scopesFor,
  categoriesFor,
  findRate,
  previewTotal,
  quoteReadiness,
  formatMoney,
  createQuotation,
  requestPricing,
  decidePricingRequest,
} from "@/lib/commercial/charter";

type Account = { id: string; name: string; legal_name: string | null; lifecycle_stage: string | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PricingRequest = any;

const statusTone: Record<string, string> = {
  approved: "bg-success/10 text-success border-success/30",
  pending_approval: "bg-warning/10 text-warning border-warning/30",
  source: "bg-muted text-muted-foreground border-border",
  retired: "bg-destructive/10 text-destructive border-destructive/30",
};

export default function CorporateCharterCommercial() {
  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState<RateCard | null>(null);
  const [lines, setLines] = useState<RateLine[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [requests, setRequests] = useState<PricingRequest[]>([]);

  const load = useCallback(async () => {
    {
      try {
        const rc = await fetchActiveRateCard();
        setCard(rc);
        const [rl, cats, accs, reqs] = await Promise.all([
          rc ? fetchRateLines(rc.id) : Promise.resolve([]),
          fetchVehicleCategories(),
          listAccounts(),
          fetchPricingRequests(),
        ]);
        setLines(rl);
        setCategories(cats);
        setAccounts(accs);
        setRequests(reqs);
      } catch (e) {
        toast.error("Could not load the corporate charter rate card", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryLabel = (code: string) =>
    categories.find((c) => c.code === code)?.label ?? code;

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading commercial pricing…
      </div>
    );
  }

  if (!card) {
    return (
      <Card className="m-6">
        <CardHeader>
          <CardTitle>No corporate charter rate card</CardTitle>
          <CardDescription>
            No active rate card is registered for the corporate charter product domain.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Pricing &amp; Revenue</h1>
          <Badge variant="outline" className={statusTone[card.status] ?? ""}>
            {card.name} · {card.version} · {card.status.replace("_", " ")}
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every price shown here is read from the published rate card. Quotations are recomputed
          server-side against {card.version}; anything the card does not cover becomes a pricing
          request instead of an invented number.
        </p>
        {card.status !== "approved" && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
            <span>
              This rate card version is <strong>pending commercial approval</strong>. Quotes can be
              prepared for internal review but must not be sent externally until it is approved.
              {card.source_note ? ` Source: ${card.source_note}` : ""}
            </span>
          </div>
        )}
      </header>

      <Tabs defaultValue="rates">
        <TabsList className="flex-wrap">
          <TabsTrigger value="rates">Rate card</TabsTrigger>
          <TabsTrigger value="workspace">Pricing workspace</TabsTrigger>
          <TabsTrigger value="quote">Quotation builder</TabsTrigger>
          <TabsTrigger value="intelligence">Pricing intelligence</TabsTrigger>
          <TabsTrigger value="costs">Cost baselines</TabsTrigger>
          <TabsTrigger value="commission">Commission engine</TabsTrigger>
          <TabsTrigger value="simulator">Deal simulator</TabsTrigger>
          <TabsTrigger value="accounts">Contracts &amp; schedules</TabsTrigger>
          <TabsTrigger value="pricing">Pricing requests</TabsTrigger>
        </TabsList>


        <TabsContent value="rates" className="mt-4">
          <RateCardView card={card} lines={lines} categoryLabel={categoryLabel} categories={categories} />
        </TabsContent>

        <TabsContent value="workspace" className="mt-4">
          <RateCardWorkspace
            code={card.code}
            categoryLabel={categoryLabel}
            serviceLabel={(s) => SERVICE_LABELS[s] ?? s}
            categories={categories.map((c) => c.code)}
            services={[...new Set(lines.map((l) => l.service_code))]}
            onPublished={load}
          />
        </TabsContent>

        <TabsContent value="quote" className="mt-4">
          <QuoteBuilder
            card={card}
            lines={lines}
            accounts={accounts}
            categoryLabel={categoryLabel}
            onPricingRequested={async () => setRequests(await fetchPricingRequests())}
          />
          <div className="mt-4">
            <QuotationAcceptance
              accountName={(id) => accounts.find((a) => a.id === id)?.name ?? "Unknown customer"}
            />
          </div>
        </TabsContent>

        <TabsContent value="intelligence" className="mt-4">
          <PricingIntelligence
            serviceLabel={(s) => SERVICE_LABELS[s] ?? s}
            categoryLabel={categoryLabel}
          />
        </TabsContent>

        <TabsContent value="costs" className="mt-4">
          <CostBaselineEditor
            services={[...new Set(lines.map((l) => l.service_code))]}
            scopes={[...new Set(lines.map((l) => l.scope_label))]}
            categories={categories.map((c) => c.code)}
            serviceLabel={(s) => SERVICE_LABELS[s] ?? s}
            categoryLabel={categoryLabel}
          />
        </TabsContent>

        <TabsContent value="commission" className="mt-4">
          <CommissionEngine
            services={[...new Set(lines.map((l) => l.service_code))]}
            scopes={[...new Set(lines.map((l) => l.scope_label))]}
            categories={categories.map((c) => c.code)}
            serviceLabel={(s) => SERVICE_LABELS[s] ?? s}
            categoryLabel={categoryLabel}
          />
        </TabsContent>

        <TabsContent value="simulator" className="mt-4">
          <DealSimulator
            services={[...new Set(lines.map((l) => l.service_code))]}
            scopes={[...new Set(lines.map((l) => l.scope_label))]}
            categories={categories.map((c) => c.code)}
            serviceLabel={(s) => SERVICE_LABELS[s] ?? s}
            categoryLabel={categoryLabel}
          />
        </TabsContent>


        <TabsContent value="accounts" className="mt-4">
          <AccountPackView accounts={accounts} />
        </TabsContent>

        <TabsContent value="pricing" className="mt-4">
          <PricingRequestsView
            requests={requests}
            categoryLabel={categoryLabel}
            onChanged={async () => setRequests(await fetchPricingRequests())}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------------------- Rate card ---------------------------- */

function RateCardView({
  card,
  lines,
  categories,
  categoryLabel,
}: {
  card: RateCard;
  lines: RateLine[];
  categories: VehicleCategory[];
  categoryLabel: (code: string) => string;
}) {
  const services = useMemo(() => {
    const order = ["day_trip", "executive", "pwd", "offroad", "airport_transfer", "monthly_long_term"];
    return order.filter((s) => lines.some((l) => l.service_code === s));
  }, [lines]);

  return (
    <div className="space-y-6">
      {services.map((service) => {
        const serviceLines = lines.filter((l) => l.service_code === service);
        const cats = [...new Set(serviceLines.map((l) => l.category_code))];
        const scopes = scopesFor(lines, service);
        return (
          <Card key={service}>
            <CardHeader>
              <CardTitle className="text-base">{SERVICE_LABELS[service] ?? service}</CardTitle>
              <CardDescription>{serviceLines[0]?.conditions ?? ""}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Destination / scope</TableHead>
                    {cats.map((c) => (
                      <TableHead key={c} className="text-right">{categoryLabel(c)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scopes.map((scope) => (
                    <TableRow key={scope}>
                      <TableCell className="font-medium">{scope}</TableCell>
                      {cats.map((c) => {
                        const rate = findRate(lines, service, scope, c);
                        return (
                          <TableCell key={c} className="text-right tabular-nums">
                            {rate ? (
                              <span>
                                {formatMoney(rate.amount, rate.currency)}
                                <span className="ml-1 text-xs text-muted-foreground">
                                  {PRICING_BASIS_LABELS[rate.pricing_basis] ?? rate.pricing_basis}
                                </span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vehicle categories</CardTitle>
          <CardDescription>Example models as published on the rate card.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <div key={c.code} className="rounded-lg border border-border/60 bg-card/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{c.label}</p>
                {c.accessibility && <Badge variant="outline">Accessible</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.example_models.join(", ")}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provenance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>Version: {card.version} · status {card.status.replace("_", " ")}</p>
          <p>Effective from: {card.effective_from ?? "not stated on the source"}</p>
          <p>Source: {card.source_reference ?? "—"}</p>
          {card.change_reason && <p>Change reason: {card.change_reason}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------- Quote builder -------------------------- */

function QuoteBuilder({
  card,
  lines,
  accounts,
  categoryLabel,
  onPricingRequested,
}: {
  card: RateCard;
  lines: RateLine[];
  accounts: Account[];
  categoryLabel: (code: string) => string;
  onPricingRequested: () => Promise<void>;
}) {
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? "");
  const [service, setService] = useState<string>("airport_transfer");
  const [scope, setScope] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("1");
  const [basket, setBasket] = useState<QuoteLineRequest[]>([]);
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [requirement, setRequirement] = useState("");

  const scopes = useMemo(() => scopesFor(lines, service), [lines, service]);
  const cats = useMemo(
    () => categoriesFor(lines, service, scope || scopes[0] || ""),
    [lines, service, scope, scopes],
  );

  useEffect(() => {
    setScope(scopes[0] ?? "");
  }, [service, scopes]);
  useEffect(() => {
    setCategory(cats[0] ?? "");
  }, [scope, cats]);

  const preview = useMemo(() => previewTotal(lines, basket), [lines, basket]);
  const readiness = quoteReadiness(card, preview.unpriced.length);

  const [negotiation, setNegotiation] = useState<NegotiationValue>({
    proposed_amount: null,
    commercial_reason: "",
  });

  /** Selling total: negotiated price where one was proposed, otherwise the recommended rate. */
  const sellingTotal = useMemo(
    () =>
      basket.reduce((sum, b) => {
        const rate = findRate(lines, b.service_code, b.scope_label, b.category_code);
        const unit = b.proposed_amount ?? rate?.amount ?? 0;
        return sum + unit * b.quantity;
      }, 0),
    [basket, lines],
  );

  const addLine = () => {
    if (!scope || !category) return;
    const qty = Math.max(1, Number(quantity) || 1);
    setBasket((b) => [
      ...b,
      {
        service_code: service,
        scope_label: scope,
        category_code: category,
        quantity: qty,
        proposed_amount: negotiation.proposed_amount,
        commercial_reason: negotiation.commercial_reason || null,
      },
    ]);
    setNegotiation({ proposed_amount: null, commercial_reason: "" });
  };

  const submit = async () => {
    if (!accountId || basket.length === 0) {
      toast.error("Pick a customer account and add at least one line");
      return;
    }
    setSaving(true);
    try {
      const result = await createQuotation({
        accountId,
        lines: basket,
        validUntil: validUntil || null,
        notes: notes || null,
      });
      toast.success(`Quotation ${result.quote_number} created`, {
        description: `${formatMoney(result.total_amount, result.currency)} · priced against ${result.rate_card_version}${
          result.unpriced?.length ? ` · ${result.unpriced.length} item(s) need commercial pricing` : ""
        }`,
      });
      setBasket([]);
      setNotes("");
    } catch (e) {
      toast.error("Quotation not created", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const raiseRequest = async () => {
    if (!requirement.trim()) {
      toast.error("Describe what pricing is needed");
      return;
    }
    try {
      await requestPricing({
        serviceCode: service,
        requirement,
        accountId: accountId || null,
        scopeLabel: scope || null,
        categoryCode: category || null,
      });
      setRequirement("");
      await onPricingRequested();
      toast.success("Pricing request raised for commercial approval");
    } catch (e) {
      toast.error("Pricing request failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Build a quotation</CardTitle>
          <CardDescription>
            Only combinations published on {card.version} can be added. Totals are recomputed by the
            database when the quotation is created.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Customer account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Valid until</Label>
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>

          <Separator />

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Service</Label>
              <Select value={service} onValueChange={setService}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(SERVICE_LABELS)
                    .filter((s) => lines.some((l) => l.service_code === s))
                    .map((s) => (
                      <SelectItem key={s} value={s}>{SERVICE_LABELS[s]}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {scopes.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vehicle category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {cats.map((c) => (<SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </div>

          {scope && category && (
            <NegotiationPanel
              serviceCode={service}
              scopeLabel={scope}
              categoryCode={category}
              quantity={Math.max(1, Number(quantity) || 1)}
              accountId={accountId || null}
              value={negotiation}
              onChange={setNegotiation}
            />
          )}

          <Button type="button" variant="secondary" onClick={addLine} disabled={!scope || !category}>
            <Plus className="mr-1.5 h-4 w-4" /> Add line
          </Button>

          {basket.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Recommended</TableHead>
                  <TableHead className="text-right">Selling price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {basket.map((b, i) => {
                  const rate = findRate(lines, b.service_code, b.scope_label, b.category_code);
                  const unit = b.proposed_amount ?? rate?.amount ?? null;
                  const pct =
                    rate && b.proposed_amount != null && rate.amount > 0
                      ? Math.round(((b.proposed_amount - rate.amount) / rate.amount) * 1000) / 10
                      : 0;
                  return (
                    <TableRow key={`${b.service_code}-${b.scope_label}-${b.category_code}-${i}`}>
                      <TableCell>{SERVICE_LABELS[b.service_code] ?? b.service_code}</TableCell>
                      <TableCell>{b.scope_label}</TableCell>
                      <TableCell>{categoryLabel(b.category_code)}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rate ? formatMoney(rate.amount, rate.currency) : "no published rate"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {unit != null ? formatMoney(unit, rate?.currency ?? card.currency) : "—"}
                        {pct !== 0 && (
                          <Badge variant="outline" className="ml-1.5 text-[10px]">
                            {pct > 0 ? "+" : ""}
                            {pct}%
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {unit != null ? formatMoney(unit * b.quantity, rate?.currency ?? card.currency) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setBasket((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <div className="space-y-1.5">
            <Label>Notes for the customer pack</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quote summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Recommended total</span>
              <span className="text-sm tabular-nums">{formatMoney(preview.total, card.currency)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Selling total</span>
              <span className="text-xl font-semibold tabular-nums">
                {formatMoney(sellingTotal, card.currency)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Benchmarked against {card.name} {card.version}. The recommended rate is a benchmark; the
              selling total is what the customer is quoted. The database is the authority on the final
              figures.
            </p>
            {readiness.canSend ? (
              <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-2 text-success">
                <ShieldCheck className="h-4 w-4" /> Approved pricing — quote may be shared externally.
              </div>
            ) : (
              <ul className="space-y-1 rounded-md border border-warning/30 bg-warning/10 p-2">
                {readiness.blockers.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" />
                    <span className="text-xs">{b}</span>
                  </li>
                ))}
              </ul>
            )}
            <Button className="w-full" onClick={submit} disabled={saving || basket.length === 0}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Receipt className="mr-1.5 h-4 w-4" />}
              Create quotation
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Need pricing we do not publish?</CardTitle>
            <CardDescription>
              Raise a request instead of quoting an unapproved figure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              rows={3}
              placeholder="e.g. Nairobi → Kisumu one-way transfer for 14 pax, 3 consecutive days"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
            />
            <Button variant="outline" className="w-full" onClick={raiseRequest}>
              Request commercial pricing
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------- Contracts & schedules ---------------------- */

function AccountPackView({ accounts }: { accounts: Account[] }) {
  const decagon = accounts.find((a) => a.name.toLowerCase().includes("decagon"));
  const [accountId, setAccountId] = useState<string>(decagon?.id ?? accounts[0]?.id ?? "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pack, setPack] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    fetchAccountPack(accountId)
      .then(setPack)
      .catch((e) => toast.error("Could not load the commercial pack", { description: String(e) }))
      .finally(() => setLoading(false));
  }, [accountId]);

  return (
    <div className="space-y-4">
      <div className="max-w-sm space-y-1.5">
        <Label>Customer account</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (<SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading commercial pack…
        </p>
      )}

      {pack && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mobility service contracts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {pack.contracts.length === 0 && (
                <p className="text-sm text-muted-foreground">No contract instance generated yet.</p>
              )}
              {pack.contracts.map((c: Record<string, unknown>) => (
                <div key={String(c.id)} className="space-y-2 rounded-lg border border-border/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">{String(c.template)} {String(c.template_version)}</p>
                    <Badge variant="outline">{String(c.status)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {String(c.customer_legal_name)} · effective {String(c.effective_date ?? "—")}
                  </p>
                  <p className="text-xs text-muted-foreground">{String(c.contract_term ?? "")}</p>
                  <div className="flex flex-wrap gap-1">
                    {(c.selected_services as string[]).map((s) => (
                      <Badge key={s} variant="secondary">{s.replace(/_/g, " ")}</Badge>
                    ))}
                  </div>
                  {(c.schedules as Record<string, unknown>[]).map((s) => (
                    <div key={String(s.id)} className="rounded-md bg-muted/40 p-2 text-xs">
                      <p className="font-medium">{String(s.title)}</p>
                      <p className="text-muted-foreground">
                        Locations: {(s.locations as string[]).join(", ")}
                      </p>
                      <p className="text-muted-foreground">{String(s.commercial_terms ?? "")}</p>
                      <p className="text-muted-foreground">{String(s.special_conditions ?? "")}</p>
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quotations</CardTitle>
            </CardHeader>
            <CardContent>
              {pack.quotations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No quotations raised yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quote</TableHead>
                      <TableHead>Rate card</TableHead>
                      <TableHead>Approval</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pack.quotations.map((q: Record<string, unknown>) => (
                      <TableRow key={String(q.id)}>
                        <TableCell className="font-medium">{String(q.quote_number)}</TableCell>
                        <TableCell>{String(q.rate_card_version)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{String(q.approval_status).replace("_", " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(Number(q.total_amount), String(q.currency))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ------------------------ Pricing requests ------------------------- */

function PricingRequestsView({
  requests,
  categoryLabel,
  onChanged,
}: {
  requests: PricingRequest[];
  categoryLabel: (code: string) => string;
  onChanged: () => Promise<void>;
}) {
  const [note, setNote] = useState<Record<string, string>>({});

  const decide = async (id: string, status: "approved" | "declined") => {
    const reason = note[id]?.trim();
    if (!reason) {
      toast.error("A decision note is required");
      return;
    }
    try {
      await decidePricingRequest(id, status, reason);
      await onChanged();
      toast.success(`Pricing request ${status}`);
    } catch (e) {
      toast.error("Decision not recorded", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pricing requests</CardTitle>
        <CardDescription>
          Requests for charges the published rate card does not cover. Platform admins decide with a
          mandatory note.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.length === 0 && (
          <p className="text-sm text-muted-foreground">No pricing requests raised.</p>
        )}
        {requests.map((r) => (
          <div key={r.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{SERVICE_LABELS[r.service_code] ?? r.service_code}</Badge>
              {r.scope_label && <Badge variant="secondary">{r.scope_label}</Badge>}
              {r.category_code && <Badge variant="secondary">{categoryLabel(r.category_code)}</Badge>}
              <Badge variant={r.status === "pending" ? "default" : "outline"}>{r.status}</Badge>
            </div>
            <p className="text-sm">{r.requirement}</p>
            {r.decision_note && (
              <p className="text-xs text-muted-foreground">Decision: {r.decision_note}</p>
            )}
            {r.status === "pending" && (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-md"
                  placeholder="Decision note (required)"
                  value={note[r.id] ?? ""}
                  onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))}
                />
                <Button size="sm" onClick={() => decide(r.id, "approved")}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => decide(r.id, "declined")}>
                  Decline
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
