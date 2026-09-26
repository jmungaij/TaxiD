/**
 * Asset pricing band governance (Pricing 360 — Engine B).
 *
 * Administrators create a draft version, edit the governed band for each
 * vehicle, map it to a commercial vehicle category and service code, then move
 * the version through review → approval → publication. Nothing here computes a
 * price: amounts are stored, and every quote is calculated server-side by
 * `asset_pricing_calculate` from the published version.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { auditedPricingAction } from "@/lib/pricing360/audit";
import { AppButton } from "@/components/nav/AppButton";
import {
  createAssetPricingDraft, fetchAssetBands, fetchAssetPricingVersions, fetchVehicleCategories,
  saveAssetBand, setAssetPricingStatus,
  type AssetBandRow, type AssetPricingVersionRow,
} from "@/lib/pricing360/assetBands";

const money = (n: number) => new Intl.NumberFormat("en-KE").format(Math.round(n));

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  under_review: "bg-warning/10 text-warning",
  approved: "bg-info/10 text-info",
  published: "bg-success/10 text-success",
  superseded: "bg-muted text-muted-foreground",
  archived: "bg-muted text-muted-foreground",
};

/** Service codes a road band may be mapped to. */
const SERVICE_CODES = [
  "charter_day", "charter_transfer", "charter_hourly", "rental_day", "leasing_month", "logistics_trip",
];

type Draftable = Pick<
  AssetBandRow,
  | "base_kes" | "min_kes" | "max_kes" | "per_km_kes" | "extra_hour_kes" | "included_km_per_day"
  | "corporate_discount_pct" | "platform_fee_pct" | "vat_pct" | "category_code" | "service_code" | "active"
>;

export function AssetBandGovernance() {
  const [versions, setVersions] = useState<AssetPricingVersionRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bands, setBands] = useState<AssetBandRow[] | null>(null);
  const [categories, setCategories] = useState<Array<{ code: string; label: string }>>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Draftable>>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("");

  const selected = useMemo(
    () => (versions ?? []).find((v) => v.id === selectedId) ?? null,
    [versions, selectedId],
  );
  const editable = selected?.status === "draft";

  const loadVersions = useCallback(async (preferId?: string) => {
    const rows = await fetchAssetPricingVersions();
    setVersions(rows);
    const next = preferId ?? rows.find((r) => r.status === "draft")?.id ?? rows[0]?.id ?? null;
    setSelectedId(next);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadVersions();
        setCategories(await fetchVehicleCategories());
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not load asset pricing versions");
        setVersions([]);
      }
    })();
  }, [loadVersions]);

  useEffect(() => {
    if (!selectedId) { setBands([]); return; }
    setBands(null);
    setEdits({});
    void fetchAssetBands(selectedId)
      .then(setBands)
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : "Could not load bands");
        setBands([]);
      });
  }, [selectedId]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = bands ?? [];
    if (!q) return list;
    return list.filter((b) =>
      [b.label, b.vehicle_key, b.asset_class, b.fleet_group, b.category_code ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [bands, filter]);

  const patch = (id: string, key: keyof Draftable, value: string | boolean) => {
    setEdits((cur) => ({ ...cur, [id]: { ...cur[id], [key]: value as never } }));
  };
  const valueOf = <K extends keyof Draftable>(b: AssetBandRow, key: K): Draftable[K] => {
    const e = edits[b.id]?.[key];
    return (e === undefined ? (b[key] as Draftable[K]) : (e as Draftable[K]));
  };

  const newDraft = async () => {
    setBusy(true);
    try {
      const id = await auditedPricingAction(
        {
          action: "save",
          entity: "asset_pricing_versions",
          reason: note || "Draft opened from Pricing 360",
          after: { status: "draft", note: note || "Draft opened from Pricing 360" },
        },
        () => createAssetPricingDraft(note || "Draft opened from Pricing 360"),
      );
      await loadVersions(id);
      setNote("");
      toast.success("Draft version opened — it clones the published bands");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open a draft");
    } finally {
      setBusy(false);
    }
  };

  const saveBand = async (b: AssetBandRow) => {
    if (!selectedId) return;
    const e = edits[b.id];
    if (!e || Object.keys(e).length === 0) return;
    setBusy(true);
    try {
      const numeric = (v: unknown, fallback: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
      };
      const payload = {
        version_id: selectedId,
        vehicle_key: b.vehicle_key,
        asset_class: b.asset_class,
        label: b.label,
        fleet_group: b.fleet_group,
        seats: b.seats,
        basis: b.basis,
        base_kes: numeric(valueOf(b, "base_kes"), b.base_kes),
        min_kes: numeric(valueOf(b, "min_kes"), b.min_kes),
        max_kes: numeric(valueOf(b, "max_kes"), b.max_kes),
        per_km_kes: numeric(valueOf(b, "per_km_kes"), b.per_km_kes),
        extra_hour_kes: numeric(valueOf(b, "extra_hour_kes"), b.extra_hour_kes),
        included_km_per_day: numeric(valueOf(b, "included_km_per_day"), b.included_km_per_day),
        corporate_discount_pct: numeric(valueOf(b, "corporate_discount_pct"), b.corporate_discount_pct),
        platform_fee_pct: numeric(valueOf(b, "platform_fee_pct"), b.platform_fee_pct),
        vat_pct: numeric(valueOf(b, "vat_pct"), b.vat_pct),
        category_code: (valueOf(b, "category_code") as string | null) || null,
        service_code: String(valueOf(b, "service_code") || b.service_code),
        active: Boolean(valueOf(b, "active")),
        reason: reason || `Band update for ${b.label}`,
      };
      const saved = await auditedPricingAction(
        {
          action: "save",
          entity: "asset_pricing_bands",
          entityId: b.id,
          reason: payload.reason,
          before: b as unknown as Record<string, unknown>,
          after: payload as unknown as Record<string, unknown>,
          context: { version_id: selectedId },
        },
        () => saveAssetBand(payload),
      );
      setBands((cur) => (cur ?? []).map((r) => (r.id === saved.id || r.vehicle_key === saved.vehicle_key ? saved : r)));
      setEdits((cur) => {
        const next = { ...cur };
        delete next[b.id];
        return next;
      });
      toast.success(`${b.label} band saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Band rejected by pricing governance");
    } finally {
      setBusy(false);
    }
  };

  const move = async (status: "under_review" | "approved" | "published" | "archived") => {
    if (!selectedId) return;
    if (!reason.trim()) {
      toast.error("A governance reason is required for every status change");
      return;
    }
    setBusy(true);
    try {
      await auditedPricingAction(
        {
          action: status === "approved" ? "approve" : status === "archived" ? "reject" : status === "published" ? "publish" : "save",
          entity: "asset_pricing_versions",
          entityId: selectedId,
          reason: reason.trim(),
          before: { status: versions?.find((v) => v.id === selectedId)?.status ?? null },
          after: { status },
        },
        () => setAssetPricingStatus(selectedId, status, reason.trim()),
      );
      await loadVersions(selectedId);
      setReason("");
      toast.success(`Version moved to ${status.replace("_", " ")}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status change refused");
    } finally {
      setBusy(false);
    }
  };

  const dirtyCount = Object.keys(edits).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Asset pricing band versions</CardTitle>
          <CardDescription>
            Governed bands per vehicle, versioned in the database. Only a published version can price
            a live booking; drafts are editable, approved versions are frozen until published.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {versions === null ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 space-y-1">
                <Label>Version</Label>
                <Select value={selectedId ?? ""} onValueChange={setSelectedId}>
                  <SelectTrigger><SelectValue placeholder="Select a version" /></SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.version} · {v.status.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-64 flex-1 space-y-1">
                <Label htmlFor="asset-band-note">New draft note</Label>
                <Input
                  id="asset-band-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Q4 fuel and driver cost revision"
                />
              </div>
              <AppButton
                analytics="pricing360_asset_bands_new_draft"
                action="submit"
                disabled={busy}
                onClick={() => void newDraft()}
              >
                Open new band draft
              </AppButton>
            </div>
          )}

          {selected && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <Badge className={STATUS_TONE[selected.status] ?? ""}>{selected.status.replace("_", " ")}</Badge>
              <span className="text-sm text-muted-foreground">
                {selected.code} · effective {new Date(selected.effective_from).toLocaleDateString()} ·{" "}
                {selected.note || "no note"}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Input
                  className="w-64"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Governance reason (required)"
                  aria-label="Governance reason"
                />
                <AppButton
                  analytics="pricing360_asset_bands_submit_review"
                  action="submit"
                  variant="outline"
                  disabled={busy || selected.status !== "draft"}
                  onClick={() => void move("under_review")}
                >
                  Submit for review
                </AppButton>
                <AppButton
                  analytics="pricing360_asset_bands_approve"
                  action="submit"
                  variant="outline"
                  disabled={busy || selected.status !== "under_review"}
                  onClick={() => void move("approved")}
                >
                  Approve bands
                </AppButton>
                <AppButton
                  analytics="pricing360_asset_bands_publish"
                  action="submit"
                  disabled={busy || selected.status !== "approved"}
                  onClick={() => void move("published")}
                >
                  Publish bands live
                </AppButton>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bands, category &amp; service mapping</CardTitle>
          <CardDescription>
            Each vehicle band maps to a commercial vehicle category and a service code, so the
            booking surfaces and the rate card resolve to the same governed price.
            {editable
              ? " This version is a draft — edits save straight to the database with an audit reason."
              : " This version is read-only. Open a draft to change any figure."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="max-w-xs"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by vehicle, class or category"
              aria-label="Filter bands"
            />
            {dirtyCount > 0 && (
              <span className="text-sm text-warning">{dirtyCount} band(s) with unsaved changes</span>
            )}
          </div>

          {bands === null ? (
            <Skeleton className="h-64 w-full" />
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bands in this version.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Min</TableHead>
                    <TableHead className="text-right">Max</TableHead>
                    <TableHead className="text-right">Per km</TableHead>
                    <TableHead className="text-right">Fee %</TableHead>
                    <TableHead className="text-right">VAT %</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Service code</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium">{b.label}</div>
                        <div className="font-mono text-xs text-muted-foreground">{b.vehicle_key}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {b.asset_class} · {b.seats} seats
                      </TableCell>
                      {(["base_kes", "min_kes", "max_kes", "per_km_kes", "platform_fee_pct", "vat_pct"] as const).map((key) => (
                        <TableCell key={key} className="text-right">
                          {editable ? (
                            <Input
                              className="w-24 text-right"
                              inputMode="decimal"
                              value={String(valueOf(b, key))}
                              aria-label={`${b.label} ${key}`}
                              onChange={(e) => patch(b.id, key, e.target.value)}
                            />
                          ) : (
                            money(Number(b[key]))
                          )}
                        </TableCell>
                      ))}
                      <TableCell>
                        {editable ? (
                          <Select
                            value={(valueOf(b, "category_code") as string) ?? "none"}
                            onValueChange={(v) => patch(b.id, "category_code", v === "none" ? "" : v)}
                          >
                            <SelectTrigger className="w-40"><SelectValue placeholder="Unmapped" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Unmapped</SelectItem>
                              {categories.map((c) => (
                                <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm">{b.category_code ?? "Unmapped"}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <Select
                            value={String(valueOf(b, "service_code"))}
                            onValueChange={(v) => patch(b.id, "service_code", v)}
                          >
                            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Array.from(new Set([b.service_code, ...SERVICE_CODES])).filter(Boolean).map((c) => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="font-mono text-xs">{b.service_code}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editable && (
                          <AppButton
                            analytics="pricing360_asset_band_save"
                            action="submit"
                            size="sm"
                            variant="outline"
                            disabled={busy || !edits[b.id]}
                            onClick={() => void saveBand(b)}
                          >
                            Save band
                          </AppButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AssetBandGovernance;
