/**
 * Pricing 360 Audit Log.
 *
 * The forensic record of every consequential pricing action: who did it, when,
 * on what entity, with what field-level diff, and whether the platform allowed
 * or refused it. Filterable by action type, actor, date range and RBAC outcome.
 *
 * Read authority is the database: `pricing_audit_events` is admin-read only and
 * append-only (mutations blocked by trigger), so this page can never show an
 * altered history. Exports route through the audited export path.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Download, Filter, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AppButton } from "@/components/nav/AppButton";
import { auditedExport } from "@/lib/exportAudit";
import { downloadCsv } from "@/lib/csv";
import {
  auditRowsToCsv, queryPricingAudit, rowBlockedReason, rowDiff, rowEvent, rowOutcome,
  rowRelatedTarget, WITHHELD_EVENTS,
  type PricingAuditAction, type PricingAuditRow, type RbacOutcome,
} from "@/lib/pricing360/audit";

const ACTIONS: PricingAuditAction[] = [
  "approve", "reject", "publish", "save", "export",
  "dispatch", "reconcile", "simulate", "redirect", "view",
];
const OUTCOMES: RbacOutcome[] = ["allowed", "denied", "error"];

const OUTCOME_TONE: Record<RbacOutcome, string> = {
  allowed: "bg-success/10 text-success",
  denied: "bg-destructive/10 text-destructive",
  error: "bg-warning/10 text-warning",
};

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function PricingAuditLog() {
  const [rows, setRows] = useState<PricingAuditRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actions, setActions] = useState<PricingAuditAction[]>([]);
  const [outcomes, setOutcomes] = useState<RbacOutcome[]>([]);
  const [actor, setActor] = useState("");
  const [entity, setEntity] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [blockedReason, setBlockedReason] = useState("");
  const [from, setFrom] = useState(isoDay(-30));
  const [to, setTo] = useState(isoDay(0));
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await queryPricingAudit({
        actions, outcomes, actor, entity, events, blockedReason, from, to, limit: 500,
      });
      setRows(data);
      setError(null);
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [actions, outcomes, actor, entity, from, to]);

  useEffect(() => { void load(); }, [load]);

  const toggle = <T,>(list: T[], set: (v: T[]) => void, value: T) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const reset = () => {
    setActions([]); setOutcomes([]); setActor(""); setEntity("");
    setEvents([]); setBlockedReason("");
    setFrom(isoDay(-30)); setTo(isoDay(0));
  };

  const counts = useMemo(() => {
    const base = { allowed: 0, denied: 0, error: 0 } as Record<RbacOutcome, number>;
    for (const r of rows ?? []) base[rowOutcome(r)] += 1;
    return base;
  }, [rows]);

  const exportCsv = async () => {
    if (!rows?.length) return;
    await auditedExport(
      {
        dataset: "pricing360.audit_log",
        exportType: "csv",
        rowCount: rows.length,
        filters: { actions, outcomes, actor, entity, events, blockedReason, from, to },
      },
      () => {
        const csv = auditRowsToCsv(rows);
        downloadCsv(`pricing360-audit-${from}-to-${to}.csv`, csv);
        return csv;
      },
    );
    toast.success(`${rows.length} audit rows exported`);
  };

  const activeFilters =
    actions.length + outcomes.length + events.length +
    (actor ? 1 : 0) + (entity ? 1 : 0) + (blockedReason ? 1 : 0);

  return (
    <div className="space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Commercial &amp; Pricing
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Pricing 360 Audit Log</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Append-only forensic record of every pricing decision — rate cards, commercial rules,
            asset bands, simulations, exports and access refusals. Nothing on this page can be
            edited or deleted, by anyone.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to="/dashboard/admin/pricing-360" className="text-sm font-medium text-primary hover:underline">
              ← Back to Pricing 360 Control Centre
            </Link>
          </div>
        </header>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Filter className="h-4 w-4" aria-hidden /> Filters
              </CardTitle>
              <CardDescription>
                {activeFilters
                  ? `${activeFilters} filter${activeFilters === 1 ? "" : "s"} applied`
                  : "No action, actor or outcome filter applied — showing the full window"}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>
                <X className="mr-2 h-4 w-4" aria-hidden /> Clear filters
              </Button>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="audit-actor">Actor email</Label>
                <Input
                  id="audit-actor"
                  placeholder="e.g. admin@taxid.us"
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="audit-entity">Entity</Label>
                <Input
                  id="audit-entity"
                  placeholder="e.g. asset_pricing_bands"
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="audit-from">From date</Label>
                <Input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="audit-to">To date</Label>
                <Input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Action type</legend>
              <div className="flex flex-wrap gap-2">
                {ACTIONS.map((a) => (
                  <Button
                    key={a}
                    type="button"
                    size="sm"
                    variant={actions.includes(a) ? "default" : "outline"}
                    aria-pressed={actions.includes(a)}
                    onClick={() => toggle(actions, setActions, a)}
                  >
                    {a}
                  </Button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">RBAC outcome</legend>
              <div className="flex flex-wrap gap-2">
                {OUTCOMES.map((o) => (
                  <Button
                    key={o}
                    type="button"
                    size="sm"
                    variant={outcomes.includes(o) ? "default" : "outline"}
                    aria-pressed={outcomes.includes(o)}
                    onClick={() => toggle(outcomes, setOutcomes, o)}
                  >
                    {o}
                  </Button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Withheld-quote event type</legend>
              <p className="text-xs text-muted-foreground">
                Recorded whenever the pricing authority refused to price a booking, so the
                indicative estimate shown to the customer is traceable to its cause.
              </p>
              <div className="flex flex-wrap gap-2">
                {WITHHELD_EVENTS.map((ev) => (
                  <Button
                    key={ev}
                    type="button"
                    size="sm"
                    variant={events.includes(ev) ? "default" : "outline"}
                    aria-pressed={events.includes(ev)}
                    onClick={() => toggle(events, setEvents, ev)}
                  >
                    {ev}
                  </Button>
                ))}
              </div>
              <div className="space-y-1.5 pt-2 md:max-w-sm">
                <Label htmlFor="audit-blocked-reason">Blocked reason contains</Label>
                <Input
                  id="audit-blocked-reason"
                  placeholder="e.g. no published version"
                  value={blockedReason}
                  onChange={(e) => setBlockedReason(e.target.value)}
                />
              </div>
            </fieldset>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-4">
          {(["allowed", "denied", "error"] as RbacOutcome[]).map((o) => (
            <Card key={o}>
              <CardHeader className="pb-2">
                <CardDescription className="capitalize">{o} actions</CardDescription>
                <CardTitle className="text-2xl">
                  {rows === null ? "Model unavailable" : counts[o]}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Rows in window</CardDescription>
              <CardTitle className="text-2xl">
                {rows === null ? "Model unavailable" : rows.length === 0 ? "No activity" : rows.length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4" aria-hidden /> Audit entries
              </CardTitle>
              <CardDescription>
                Newest first, capped at 500 rows per query. Select a row to read its field-level diff.
              </CardDescription>
            </div>
            <AppButton
              analytics="pricing360_audit_export_csv"
              action="submit"
              variant="outline"
              size="sm"
              disabled={!rows?.length}
              onClick={() => void exportCsv()}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden /> Export audit CSV
            </AppButton>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : error ? (
              <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" aria-hidden />
                <div>
                  <p className="font-medium">Audit trail unavailable</p>
                  <p className="text-muted-foreground">
                    {error} — the audit table is admin-read only. No rows are shown rather than a
                    partial or fabricated history.
                  </p>
                </div>
              </div>
            ) : !rows?.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No pricing actions match these filters in the selected window.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When (UTC)</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Related</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const outcome = rowOutcome(r);
                    const diff = rowDiff(r);
                    const related = rowRelatedTarget(r);
                    const open = expanded === r.id;
                    return (
                      <>
                        <TableRow
                          key={r.id}
                          className="cursor-pointer"
                          onClick={() => setExpanded(open ? null : r.id)}
                        >
                          <TableCell className="whitespace-nowrap text-xs">
                            {new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19)}
                          </TableCell>
                          <TableCell className="text-xs">{r.actor_email ?? "system"}</TableCell>
                          <TableCell><Badge variant="outline">{r.action}</Badge></TableCell>
                          <TableCell className="text-xs">{r.entity}</TableCell>
                          <TableCell>
                            <Badge className={OUTCOME_TONE[outcome]}>{outcome}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {rowEvent(r) ? <Badge variant="outline">{rowEvent(r)}</Badge> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-xs">
                            {related.to ? (
                              <Link
                                to={related.to}
                                className="text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {related.label}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">{related.label}</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[22rem] truncate text-xs">
                            {rowBlockedReason(r) ?? r.reason}
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow key={`${r.id}-diff`}>
                            <TableCell colSpan={8} className="bg-muted/40 text-xs">
                              {diff.length === 0 ? (
                                <p className="text-muted-foreground">
                                  No field-level change recorded for this action (read, simulation or redirect).
                                </p>
                              ) : (
                                <ul className="space-y-1">
                                  {diff.map((d) => (
                                    <li key={d.field} className="font-mono">
                                      <span className="font-semibold">{d.field}</span>:{" "}
                                      {JSON.stringify(d.from ?? null)} → {JSON.stringify(d.to ?? null)}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
    </div>
  );
}
