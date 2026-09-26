/**
 * Commercial priority brief — daily, weekly, monthly and annual, with a
 * downloadable PDF.
 *
 * The comparison line for each period is period-over-period against the same
 * calendar window: yesterday vs today, last week vs this week, and so on. Where
 * the prior window has no activity the delta reads "new" or "n/a" rather than a
 * misleading percentage.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, CalendarRange, Download, FileText, RefreshCw, Siren,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatCents } from "@/lib/staff/phase85/closureEngine";
import {
  PERIOD_META, deltaPct, downloadBriefPdf, formatDelta, loadPriorityBrief,
  type BriefPeriod, type PriorityBrief,
} from "@/lib/staff/phase85/priorityBrief";
import { AppButton } from "@/components/nav/AppButton";

const PERIODS: BriefPeriod[] = ["day", "week", "month", "year"];

function Delta({ current, previous }: { current: number; previous: number }) {
  const d = deltaPct(current, previous);
  const Icon = d === null ? ArrowRight : d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : ArrowRight;
  const tone = d === null ? "text-muted-foreground" : d > 0 ? "text-success" : d < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={`flex items-center gap-1 text-xs ${tone}`}>
      <Icon className="h-3.5 w-3.5" /> {formatDelta(current, previous)}
    </span>
  );
}

export default function PriorityBriefPanel({ onTrace }: { onTrace?: (ref: string) => void }) {
  const [period, setPeriod] = useState<BriefPeriod>("day");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [brief, setBrief] = useState<PriorityBrief | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await loadPriorityBrief(period);
    setBrief(res);
    setLoading(false);
    if (!res.ok) toast.error(res.error === "not_authorised" ? "You do not have access to the commercial brief." : (res.error ?? "Brief unavailable."));
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const doDownload = async () => {
    if (!brief?.ok) return;
    setExporting(true);
    try {
      const filename = await downloadBriefPdf(brief);
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      toast.error(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const meta = PERIOD_META[period];
  const c = brief?.current;
  const p = brief?.previous;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> {meta.label}
            </CardTitle>
            <CardDescription>
              {meta.comparison} on authoritative commercial records
              {brief?.asOf ? ` · as of ${new Date(brief.asOf).toLocaleString()}` : ""}.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AppButton analytics="staff_priority_brief_pdf_download" action="submit" size="sm" onClick={() => void doDownload()} disabled={exporting || !brief?.ok}>
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "Preparing…" : "Download priority brief (PDF)"}
            </AppButton>
            <Button size="icon" variant="outline" onClick={() => void load()} aria-label="Refresh brief">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={period} onValueChange={(v) => setPeriod(v as BriefPeriod)}>
            <TabsList className="flex-wrap">
              {PERIODS.map((k) => (
                <TabsTrigger key={k} value={k}>{PERIOD_META[k].cadence}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {loading || !c || !p ? <Skeleton className="h-32 w-full" /> : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Recognised revenue", cur: c.revenueCents, prev: p.revenueCents, money: true },
                { label: "Contribution", cur: c.contributionCents, prev: p.contributionCents, money: true },
                { label: "Collections", cur: c.collectionsCents, prev: p.collectionsCents, money: true },
                { label: "Fulfilments", cur: c.fulfilments, prev: p.fulfilments, money: false },
              ].map((m) => (
                <Card key={m.label}>
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-2 text-xs">
                      <CalendarRange className="h-3.5 w-3.5" /> {m.label}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 pt-0">
                    <div className="text-xl font-semibold tabular-nums">
                      {m.money ? formatCents(m.cur) : m.cur}
                    </div>
                    <div className="flex items-center gap-2">
                      <Delta current={m.cur} previous={m.prev} />
                      <span className="text-xs text-muted-foreground">
                        from {m.money ? formatCents(m.prev) : m.prev}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {brief?.ok ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top opportunities</CardTitle>
              <CardDescription>Open pipeline ranked by expected value.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {brief.opportunities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open opportunities recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead><TableHead>Opportunity</TableHead><TableHead>Stage</TableHead>
                      <TableHead className="text-right">Expected value</TableHead>
                      <TableHead className="text-right">Probability</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {brief.opportunities.map((o) => (
                      <TableRow key={o.opportunity_ref}>
                        <TableCell className="font-medium">{o.opportunity_ref}</TableCell>
                        <TableCell className="max-w-[20rem] truncate">{o.title ?? o.customer_label ?? "—"}</TableCell>
                        <TableCell className="text-xs capitalize">{(o.stage ?? "").replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCents(o.expected_value_cents ?? 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {o.probability_pct !== null ? `${o.probability_pct}%` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Priority actions</CardTitle>
              <CardDescription>Open commercial actions ranked by expected contribution.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {brief.actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open actions recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead><TableHead>Action</TableHead>
                      <TableHead className="text-right">Contribution</TableHead>
                      <TableHead className="text-right">Confidence</TableHead><TableHead>Approval</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {brief.actions.map((a) => (
                      <TableRow key={a.action_ref}>
                        <TableCell className="font-medium">{a.action_ref}</TableCell>
                        <TableCell className="max-w-[22rem] truncate">{a.title ?? a.recommendation ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCents(a.expected_contribution_cents ?? 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.confidence_pct !== null ? `${a.confidence_pct}%` : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{a.approval_required ? "Required" : "Not required"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Constraints, reconciliation and incidents</CardTitle>
              <CardDescription>
                What is blocking revenue right now, grouped exposure by break kind, and the critical incidents.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="overflow-x-auto">
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Constraints</div>
                {brief.constraints.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open constraints.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Exception</TableHead><TableHead>Transaction</TableHead><TableHead>Kind</TableHead>
                        <TableHead className="text-right">At risk</TableHead><TableHead>SLA</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {brief.constraints.map((k) => (
                        <TableRow key={k.exception_ref}>
                          <TableCell className="font-medium">{k.exception_ref}</TableCell>
                          <TableCell className="text-xs">
                            {k.transaction_ref && onTrace ? (
                              <button className="underline-offset-2 hover:underline"
                                onClick={() => onTrace(k.transaction_ref as string)}>
                                {k.transaction_ref} <ArrowUpRight className="inline h-3 w-3" />
                              </button>
                            ) : (k.transaction_ref ?? "—")}
                          </TableCell>
                          <TableCell className="text-xs">{k.kind} · {k.severity}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCents(k.value_at_risk_cents ?? 0)}</TableCell>
                          <TableCell className="text-xs">
                            {k.breached
                              ? <Badge variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive">breached</Badge>
                              : k.sla_due_at ? new Date(k.sla_due_at).toLocaleString() : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="overflow-x-auto">
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Reconciliation exceptions</div>
                {brief.reconciliation.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open reconciliation breaks.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Break kind</TableHead><TableHead>Severity</TableHead>
                        <TableHead className="text-right">Cases</TableHead><TableHead className="text-right">Exposure</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {brief.reconciliation.map((r) => (
                        <TableRow key={`${r.kind}-${r.severity}`}>
                          <TableCell className="text-xs">{r.kind}</TableCell>
                          <TableCell className="text-xs">{r.severity}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.cases}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCents(r.exposure_cents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="overflow-x-auto">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                  <Siren className="h-3.5 w-3.5" /> Critical incidents
                </div>
                {brief.incidents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No critical or high-severity incidents open.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Exception</TableHead><TableHead>Transaction</TableHead><TableHead>Kind</TableHead>
                        <TableHead className="text-right">At risk</TableHead><TableHead>Escalation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {brief.incidents.map((i) => (
                        <TableRow key={i.exception_ref}>
                          <TableCell className="font-medium">{i.exception_ref}</TableCell>
                          <TableCell className="text-xs">
                            {i.transaction_ref && onTrace ? (
                              <button className="underline-offset-2 hover:underline"
                                onClick={() => onTrace(i.transaction_ref as string)}>
                                {i.transaction_ref} <ArrowUpRight className="inline h-3 w-3" />
                              </button>
                            ) : (i.transaction_ref ?? "—")}
                          </TableCell>
                          <TableCell className="text-xs">{i.kind} · {i.severity}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCents(i.value_at_risk_cents ?? 0)}</TableCell>
                          <TableCell className="text-xs">L{i.escalation_level ?? 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
