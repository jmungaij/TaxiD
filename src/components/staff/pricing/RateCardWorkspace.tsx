/**
 * Pricing workspace — the recommended price book is editable, versioned and
 * auditable. An approved version is never edited in place: pricing
 * administration opens a draft, edits it, previews a bulk change, then
 * publishes it with an effective date. Historical versions are preserved so old
 * quotes keep the price that was actually applied.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2, Upload, Wand2, Download } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
  fetchRateCardVersions,
  openRateCardDraft,
  saveRateItem,
  deleteRateItem,
  bulkAdjust,
  publishRateCard,
  PRICING_BASIS_OPTIONS,
  describeTerms,
} from "@/lib/pricing/competitive";
import { fetchRateLines, type RateLine, type RateCard } from "@/lib/commercial/charter";

type Draft = Record<string, string>;

export function RateCardWorkspace({
  code,
  categoryLabel,
  serviceLabel,
  categories,
  services,
  onPublished,
}: {
  code: string;
  categoryLabel: (c: string) => string;
  serviceLabel: (s: string) => string;
  categories: string[];
  services: string[];
  onPublished?: () => void;
}) {
  const [versions, setVersions] = useState<RateCard[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [lines, setLines] = useState<RateLine[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [newItem, setNewItem] = useState({
    service_code: services[0] ?? "day_trip",
    scope_label: "",
    category_code: categories[0] ?? "",
    pricing_basis: "per_day",
    amount: "",
    included_distance_km: "",
    excess_distance_rate: "",
  });

  const [bulk, setBulk] = useState({ service_code: "", scope_label: "", category_code: "", percent: "", includedKm: "", reason: "" });
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof bulkAdjust>> | null>(null);
  const [publishDate, setPublishDate] = useState("");
  const [publishReason, setPublishReason] = useState("");

  const card = useMemo(() => versions.find((v) => v.id === selected) ?? null, [versions, selected]);
  const editable = !!card && ["draft", "source", "pending_approval"].includes(card.status);

  const reload = useCallback(async (keep?: string) => {
    const vs = (await fetchRateCardVersions(code)) as RateCard[];
    setVersions(vs);
    const pick =
      keep ??
      vs.find((v) => ["draft", "source", "pending_approval"].includes(v.status))?.id ??
      vs.find((v) => v.status === "approved")?.id ??
      vs[0]?.id ??
      "";
    setSelected(pick);
    setLines(pick ? await fetchRateLines(pick) : []);
    setDrafts({});
  }, [code]);

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch (e) {
        toast.error("Could not load rate card versions", { description: msg(e) });
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  const pickVersion = async (id: string) => {
    setSelected(id);
    setDrafts({});
    setLines(await fetchRateLines(id));
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error("Not saved", { description: msg(e) });
    } finally {
      setBusy(false);
    }
  };

  const openDraft = () =>
    run(async () => {
      const r = await openRateCardDraft(code, "Rate review");
      await reload(r.rate_card_id);
      toast.success(r.reused ? `Continuing draft ${r.version}` : `Draft ${r.version} opened`);
    });

  const saveLine = (line: RateLine) =>
    run(async () => {
      const d = drafts[line.id] ?? {};
      await saveRateItem({
        rate_card_id: line.rate_card_id,
        service_code: line.service_code,
        scope_label: line.scope_label,
        category_code: line.category_code,
        pricing_basis: line.pricing_basis,
        amount: d.amount ?? String(line.amount),
        included_distance_km: d.included_distance_km ?? (line.included_distance_km ?? ""),
        excess_distance_rate: d.excess_distance_rate ?? "",
        reason: "Inline rate edit",
      });
      setLines(await fetchRateLines(line.rate_card_id));
      setDrafts((p) => ({ ...p, [line.id]: {} }));
      toast.success("Rate updated on the draft");
    });

  const removeLine = (line: RateLine) =>
    run(async () => {
      await deleteRateItem(line.id, "Removed on draft");
      setLines(await fetchRateLines(line.rate_card_id));
      toast.success("Rate item removed");
    });

  const addLine = () =>
    run(async () => {
      if (!card) return;
      if (!newItem.amount) {
        toast.error("Enter the recommended amount");
        return;
      }
      await saveRateItem({
        rate_card_id: card.id,
        ...newItem,
        included_distance_period: newItem.included_distance_km ? "day" : "",
        reason: "New rate item",
      });
      setLines(await fetchRateLines(card.id));
      setNewItem((n) => ({ ...n, amount: "", scope_label: "" }));
      toast.success("Rate item added");
    });

  const previewBulk = (apply: boolean) =>
    run(async () => {
      if (!card) return;
      const filters: Record<string, string> = {};
      if (bulk.service_code) filters.service_code = bulk.service_code;
      if (bulk.scope_label) filters.scope_label = bulk.scope_label;
      if (bulk.category_code) filters.category_code = bulk.category_code;
      const r = await bulkAdjust({
        rateCardId: card.id,
        filters,
        percent: bulk.percent === "" ? null : Number(bulk.percent),
        includedKm: bulk.includedKm === "" ? null : Number(bulk.includedKm),
        apply,
        reason: bulk.reason,
      });
      setPreview(r);
      if (apply) {
        setLines(await fetchRateLines(card.id));
        toast.success(`${r.affected} rate item(s) updated`);
      }
    });

  const publish = () =>
    run(async () => {
      if (!card) return;
      const r = await publishRateCard(card.id, publishDate || null, publishReason);
      await reload();
      onPublished?.();
      toast.success(
        r.status === "scheduled"
          ? `Version scheduled from ${publishDate}`
          : `Version published — ${r.lines} rates now in force`,
      );
    });

  const exportCsv = () => {
    const header = "service_code,scope_label,category_code,pricing_basis,amount,currency,included_distance_km";
    const rows = lines.map((l) =>
      [l.service_code, l.scope_label, l.category_code, l.pricing_basis, l.amount, l.currency, l.included_distance_km ?? ""].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${code}-${card?.version ?? "version"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the pricing workspace…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Pricing &amp; rate cards</CardTitle>
            <CardDescription>
              Recommended rates. Editing these changes the organisation's reference pricing — it does
              not change any quote already given.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selected} onValueChange={pickVersion}>
              <SelectTrigger className="w-[230px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.version} · {v.status.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="secondary" size="sm" onClick={openDraft} disabled={busy}>
              <Plus className="mr-1 h-4 w-4" /> New version
            </Button>
            <Button variant="ghost" size="sm" onClick={exportCsv} data-analytics="rate_card_export_csv">
              <Download className="mr-1 h-4 w-4" /> Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!editable && (
            <p className="rounded-md border border-info/30 bg-info/10 p-3 text-sm">
              {card?.status === "approved" || card?.status === "scheduled"
                ? "This version is in force and cannot be edited. Open a new version to change rates."
                : "This version is retired and kept for history."}
            </p>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Destination / scope</TableHead>
                  <TableHead>Vehicle class</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead className="text-right">Recommended rate</TableHead>
                  <TableHead className="text-right">Included distance</TableHead>
                  <TableHead className="text-right">Excess / unit</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const d = drafts[l.id] ?? {};
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap">{serviceLabel(l.service_code)}</TableCell>
                      <TableCell className="font-medium">{l.scope_label || "—"}</TableCell>
                      <TableCell>{categoryLabel(l.category_code)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {describeTerms({ ...l, currency: l.currency })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          className="ml-auto h-8 w-28 text-right tabular-nums"
                          disabled={!editable}
                          value={d.amount ?? String(l.amount)}
                          onChange={(e) =>
                            setDrafts((p) => ({ ...p, [l.id]: { ...d, amount: e.target.value } }))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          className="ml-auto h-8 w-24 text-right tabular-nums"
                          disabled={!editable}
                          placeholder="none"
                          value={d.included_distance_km ?? (l.included_distance_km ?? "")}
                          onChange={(e) =>
                            setDrafts((p) => ({ ...p, [l.id]: { ...d, included_distance_km: e.target.value } }))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          className="ml-auto h-8 w-24 text-right tabular-nums"
                          disabled={!editable}
                          placeholder="—"
                          value={d.excess_distance_rate ?? ""}
                          onChange={(e) =>
                            setDrafts((p) => ({ ...p, [l.id]: { ...d, excess_distance_rate: e.target.value } }))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {editable && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => saveLine(l)} disabled={busy}>
                              <Save className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => removeLine(l)} disabled={busy}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {editable && (
            <>
              <Separator />
              <div className="grid gap-3 md:grid-cols-7">
                <Field label="Service">
                  <Select value={newItem.service_code} onValueChange={(v) => setNewItem((n) => ({ ...n, service_code: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {services.map((s) => <SelectItem key={s} value={s}>{serviceLabel(s)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Scope">
                  <Input value={newItem.scope_label} onChange={(e) => setNewItem((n) => ({ ...n, scope_label: e.target.value }))} />
                </Field>
                <Field label="Vehicle class">
                  <Select value={newItem.category_code} onValueChange={(v) => setNewItem((n) => ({ ...n, category_code: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Basis">
                  <Select value={newItem.pricing_basis} onValueChange={(v) => setNewItem((n) => ({ ...n, pricing_basis: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRICING_BASIS_OPTIONS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Rate">
                  <Input type="number" value={newItem.amount} onChange={(e) => setNewItem((n) => ({ ...n, amount: e.target.value }))} />
                </Field>
                <Field label="Included distance">
                  <Input type="number" placeholder="none" value={newItem.included_distance_km} onChange={(e) => setNewItem((n) => ({ ...n, included_distance_km: e.target.value }))} />
                </Field>
                <div className="flex items-end">
                  <Button className="w-full" onClick={addLine} disabled={busy}>
                    <Plus className="mr-1 h-4 w-4" /> Add rate
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {editable && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bulk change</CardTitle>
              <CardDescription>Preview the effect before it is applied to the draft.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Service (all if blank)">
                  <Input value={bulk.service_code} onChange={(e) => setBulk((b) => ({ ...b, service_code: e.target.value }))} placeholder="day_trip" />
                </Field>
                <Field label="Scope (all if blank)">
                  <Input value={bulk.scope_label} onChange={(e) => setBulk((b) => ({ ...b, scope_label: e.target.value }))} placeholder="Within Nairobi" />
                </Field>
                <Field label="Vehicle class (all if blank)">
                  <Input value={bulk.category_code} onChange={(e) => setBulk((b) => ({ ...b, category_code: e.target.value }))} placeholder="saloon_comfort" />
                </Field>
                <Field label="Change by %">
                  <Input type="number" value={bulk.percent} onChange={(e) => setBulk((b) => ({ ...b, percent: e.target.value }))} placeholder="5" />
                </Field>
                <Field label="Included distance">
                  <Input type="number" value={bulk.includedKm} onChange={(e) => setBulk((b) => ({ ...b, includedKm: e.target.value }))} placeholder="120" />
                </Field>
                <Field label="Reason">
                  <Input value={bulk.reason} onChange={(e) => setBulk((b) => ({ ...b, reason: e.target.value }))} />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => previewBulk(false)} disabled={busy}>
                  <Wand2 className="mr-1 h-4 w-4" /> Preview
                </Button>
                <Button onClick={() => previewBulk(true)} disabled={busy || !preview} data-analytics="rate_card_bulk_apply">
                  Apply to draft
                </Button>
              </div>
              {preview && (
                <div className="max-h-64 overflow-auto rounded-md border border-border/60">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">Proposed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((r) => (
                        <TableRow key={r.rate_line_id}>
                          <TableCell className="text-xs">
                            {r.scope_label || "—"} · {categoryLabel(r.category_code)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.current_amount).toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(r.proposed_amount).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="p-2 text-xs text-muted-foreground">{preview.affected} rate item(s) affected</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publish this version</CardTitle>
              <CardDescription>
                A future date schedules the version; it activates on that date on its own.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Effective from">
                <Input type="date" value={publishDate} onChange={(e) => setPublishDate(e.target.value)} />
              </Field>
              <Field label="Change summary">
                <Input value={publishReason} onChange={(e) => setPublishReason(e.target.value)} placeholder="e.g. 2027 fuel review" />
              </Field>
              <Button className="w-full" onClick={publish} disabled={busy}>
                <Upload className="mr-1 h-4 w-4" /> Publish
              </Button>
              <p className="text-xs text-muted-foreground">
                Quotes already issued keep the price they were given. {lines.length} rate item(s) in this
                version. <Badge variant="outline">{card?.status}</Badge>
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
