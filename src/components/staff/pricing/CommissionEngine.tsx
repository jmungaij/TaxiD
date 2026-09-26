/**
 * Commission engine console — the configured, versioned commission register.
 *
 * Nothing here is hardcoded: the default rate, the basis, the excluded
 * components and every rule are stored rows. Publishing retires the previous
 * version from the new effective date, so historic transactions keep the rate
 * they were priced with.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
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
  COMMISSION_BASIS_OPTIONS,
  type CommissionRule,
  type CommissionSchedule,
  deleteCommissionRule,
  describeRule,
  fetchCommissionRules,
  fetchCommissionSchedules,
  openCommissionDraft,
  publishCommissionSchedule,
  saveCommissionRule,
} from "@/lib/pricing/commission";

interface Props {
  services?: string[];
  scopes?: string[];
  categories?: string[];
  serviceLabel?: (code: string) => string;
  categoryLabel?: (code: string) => string;
}

const statusTone: Record<string, string> = {
  approved: "border-success/40 text-success",
  draft: "border-warning/40 text-warning",
  retired: "text-muted-foreground",
  pending_approval: "border-warning/40 text-warning",
};

const NONE = "__any__";

export function CommissionEngine({
  services = [],
  scopes = [],
  categories = [],
  serviceLabel = (s) => s,
  categoryLabel = (c) => c,
}: Props) {
  const [schedules, setSchedules] = useState<CommissionSchedule[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [draft, setDraft] = useState<Record<string, string>>({ label: "", rate_percent: "", priority: "50" });

  const selected = useMemo(
    () => schedules.find((s) => s.id === selectedId) ?? null,
    [schedules, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchCommissionSchedules();
      setSchedules(list);
      const next =
        list.find((s) => s.id === selectedId) ??
        list.find((s) => s.status === "draft") ??
        list.find((s) => s.status === "approved") ??
        list[0];
      if (next) {
        setSelectedId(next.id);
        setRules(await fetchCommissionRules(next.id));
      } else {
        setRules([]);
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = async (id: string) => {
    setSelectedId(id);
    try {
      setRules(await fetchCommissionRules(id));
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onOpenDraft = () =>
    guard(async () => {
      if (!selected) return;
      const result = await openCommissionDraft({
        code: selected.code,
        change_summary: reason || undefined,
      });
      toast.success(result.created ? "Draft version opened" : "An open draft already exists");
      await load();
      await pick(result.schedule_id);
    });

  const onAddRule = () =>
    guard(async () => {
      if (!selected) return;
      if (!draft.rate_percent) {
        toast.error("Enter the commission rate for this rule");
        return;
      }
      const payload: Record<string, unknown> = {
        schedule_id: selected.id,
        label: draft.label || "Commission rule",
        priority: Number(draft.priority || 100),
        rate_percent: Number(draft.rate_percent),
        basis: draft.basis || null,
        reason: draft.reason || null,
      };
      for (const key of [
        "service_code", "scope_label", "category_code", "city", "region", "country",
        "customer_segment", "transaction_type", "partner_tier",
      ]) {
        const value = draft[key];
        if (value && value !== NONE) payload[key] = value;
      }
      if (draft.min_volume) payload.min_volume = Number(draft.min_volume);
      if (draft.max_volume) payload.max_volume = Number(draft.max_volume);
      await saveCommissionRule(payload);
      toast.success("Rule added to the draft");
      setDraft({ label: "", rate_percent: "", priority: "50" });
      setRules(await fetchCommissionRules(selected.id));
    });

  const onDeleteRule = (rule: CommissionRule) =>
    guard(async () => {
      await deleteCommissionRule(rule.id, "Removed in draft");
      toast.success("Rule removed");
      setRules(await fetchCommissionRules(rule.schedule_id));
    });

  const onPublish = () =>
    guard(async () => {
      if (!selected) return;
      if (!reason.trim()) {
        toast.error("A commission change must record why it is being made");
        return;
      }
      const result = await publishCommissionSchedule({
        schedule_id: selected.id,
        effective_from: effectiveFrom,
        reason: reason.trim(),
      });
      toast.success(`Version ${result.version} live from ${result.effective_from}`);
      setReason("");
      await load();
    });

  const setField = (key: string, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading commission configuration…
        </CardContent>
      </Card>
    );
  }

  if (!selected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No commission schedule visible</CardTitle>
          <CardDescription>
            You do not have access to the commission register, or none has been configured yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isDraft = selected.status === "draft";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Commission schedule</CardTitle>
              <CardDescription>
                The platform rate is configuration, not code. Rules below override the default for a
                narrower slice of transactions; the most specific matching rule wins.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedId} onValueChange={pick}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · v{s.version} · {s.status.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={onOpenDraft}
                disabled={busy}
                data-analytics="commission-open-draft"
              >
                Open new draft version
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className={statusTone[selected.status] ?? ""}>
              {selected.status.replace("_", " ")}
            </Badge>
            <Badge variant="outline">Default {selected.default_rate_percent}%</Badge>
            <Badge variant="outline">{COMMISSION_BASIS_LABELS[selected.default_basis] ?? selected.default_basis}</Badge>
            <span className="text-muted-foreground">
              Excludes: {(selected.excluded_components ?? []).join(", ") || "nothing"}
            </span>
            <span className="text-muted-foreground">
              Effective {selected.effective_from ?? "—"}
              {selected.effective_to ? ` to ${selected.effective_to}` : ""}
            </span>
          </div>
          {selected.change_summary && (
            <p className="text-sm text-muted-foreground">{selected.change_summary}</p>
          )}

          {isDraft && (
            <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr,180px,auto]">
              <div className="space-y-1">
                <Label htmlFor="commission-reason">Reason for this change</Label>
                <Input
                  id="commission-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why the commission is changing"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="commission-effective">Effective from</Label>
                <Input
                  id="commission-effective"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={onPublish} disabled={busy} data-analytics="commission-publish">
                  <Upload className="mr-2 h-4 w-4" /> Publish version
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rules ({rules.length})</CardTitle>
          <CardDescription>
            Lower priority number is evaluated first. A rule with no dimensions applies to every
            transaction on this schedule.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead className="text-right">Priority</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Basis</TableHead>
                <TableHead>Effective</TableHead>
                {isDraft && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isDraft ? 7 : 6} className="text-sm text-muted-foreground">
                    No rules — every transaction uses the schedule default of{" "}
                    {selected.default_rate_percent}%.
                  </TableCell>
                </TableRow>
              )}
              {rules.map((rule) => (
                <TableRow key={rule.id} className={rule.active ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{rule.label}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{describeRule(rule)}</TableCell>
                  <TableCell className="text-right">{rule.priority}</TableCell>
                  <TableCell className="text-right font-medium">{rule.rate_percent}%</TableCell>
                  <TableCell className="text-sm">
                    {rule.basis ? COMMISSION_BASIS_LABELS[rule.basis] ?? rule.basis : "Schedule default"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {rule.effective_from ?? "—"}
                    {rule.effective_to ? ` – ${rule.effective_to}` : ""}
                  </TableCell>
                  {isDraft && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDeleteRule(rule)}
                        disabled={busy}
                        aria-label={`Remove rule ${rule.label}`}
                        data-analytics="commission-rule-delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {isDraft ? (
            <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="rule-label">Rule name</Label>
                <Input
                  id="rule-label"
                  value={draft.label ?? ""}
                  onChange={(e) => setField("label", e.target.value)}
                  placeholder="e.g. Nairobi airport transfers"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-rate">Rate %</Label>
                <Input
                  id="rule-rate"
                  type="number"
                  step="0.25"
                  value={draft.rate_percent ?? ""}
                  onChange={(e) => setField("rate_percent", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-priority">Priority</Label>
                <Input
                  id="rule-priority"
                  type="number"
                  value={draft.priority ?? "50"}
                  onChange={(e) => setField("priority", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-basis">Basis</Label>
                <Select
                  value={draft.basis ?? NONE}
                  onValueChange={(v) => setField("basis", v === NONE ? "" : v)}
                >
                  <SelectTrigger id="rule-basis">
                    <SelectValue placeholder="Schedule default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Schedule default</SelectItem>
                    {COMMISSION_BASIS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="rule-service">Service</Label>
                <Select
                  value={draft.service_code ?? NONE}
                  onValueChange={(v) => setField("service_code", v === NONE ? "" : v)}
                >
                  <SelectTrigger id="rule-service">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Any service</SelectItem>
                    {services.map((s) => (
                      <SelectItem key={s} value={s}>
                        {serviceLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-scope">Route / scope</Label>
                <Select
                  value={draft.scope_label ?? NONE}
                  onValueChange={(v) => setField("scope_label", v === NONE ? "" : v)}
                >
                  <SelectTrigger id="rule-scope">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Any route</SelectItem>
                    {scopes.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-category">Vehicle class</Label>
                <Select
                  value={draft.category_code ?? NONE}
                  onValueChange={(v) => setField("category_code", v === NONE ? "" : v)}
                >
                  <SelectTrigger id="rule-category">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Any vehicle class</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {categoryLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-transaction">Transaction type</Label>
                <Input
                  id="rule-transaction"
                  value={draft.transaction_type ?? ""}
                  onChange={(e) => setField("transaction_type", e.target.value)}
                  placeholder="e.g. corporate_charter"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="rule-min-volume">Minimum volume</Label>
                <Input
                  id="rule-min-volume"
                  type="number"
                  value={draft.min_volume ?? ""}
                  onChange={(e) => setField("min_volume", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-max-volume">Maximum volume</Label>
                <Input
                  id="rule-max-volume"
                  type="number"
                  value={draft.max_volume ?? ""}
                  onChange={(e) => setField("max_volume", e.target.value)}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="rule-reason">Reason</Label>
                <Input
                  id="rule-reason"
                  value={draft.reason ?? ""}
                  onChange={(e) => setField("reason", e.target.value)}
                  placeholder="Why this slice carries a different rate"
                />
              </div>

              <div className="md:col-span-4">
                <Button onClick={onAddRule} disabled={busy} data-analytics="commission-rule-add">
                  <Plus className="mr-2 h-4 w-4" /> Add rule to draft
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This version is published and cannot be edited. Open a new draft version to change the
              rate, the basis or any rule — historic transactions keep the rate they were priced with.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
