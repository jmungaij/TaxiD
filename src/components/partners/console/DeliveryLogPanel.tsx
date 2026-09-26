/**
 * Webhook delivery log — every attempt, its correlation ID, the retry chain it
 * belongs to and the exact failure category recorded by the dispatcher.
 *
 * Failure categories are read from the ledger, never guessed in the browser, and
 * each one carries the operator remedy so troubleshooting does not require the
 * integration desk for the common cases.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleSlash, Download, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toggle } from "@/components/ui/toggle";
import { downloadCsv } from "@/lib/partners/usageAnalytics";
import type { ApiEnvironment } from "@/lib/partners/devPortal";
import {
  FAILURE_GUIDANCE, defaultDeliveryFilter, fetchWebhookDeliveries, filterDeliveries,
  retryChains, summariseDeliveries, type DeliveryStatus, type WebhookDeliveryRow,
} from "@/lib/partners/webhookDeliveries";

const nf = new Intl.NumberFormat("en-KE");
const ENVIRONMENTS: ApiEnvironment[] = ["sandbox", "production"];
const STATUSES: DeliveryStatus[] = ["delivered", "pending", "failed", "dead_letter"];

const statusVariant = (s: DeliveryStatus) =>
  s === "delivered" ? "secondary" : s === "dead_letter" ? "destructive" : s === "failed" ? "destructive" : "outline";

const deliveriesCsv = (rows: WebhookDeliveryRow[]) => {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    "created_at", "environment", "event_type", "event_id", "delivery_id", "correlation_id",
    "endpoint_url", "attempt", "max_attempts", "status", "failure_category", "http_status",
    "response_ms", "signature_version", "signature_valid", "timestamp_skew_seconds",
    "next_retry_at", "delivered_at", "error_detail",
  ];
  return [
    head.join(","),
    ...rows.map((r) => head.map((k) => cell((r as unknown as Record<string, unknown>)[k])).join(",")),
  ].join("\n");
};

export function DeliveryLogPanel({ partnerId }: { partnerId: string }) {
  const enabled = Boolean(partnerId);
  const [filter, setFilter] = useState(defaultDeliveryFilter);
  const [expanded, setExpanded] = useState<string | null>(null);

  const deliveries = useQuery({
    queryKey: ["partner-api-webhook-deliveries", partnerId],
    queryFn: () => fetchWebhookDeliveries(partnerId, 300),
    enabled,
  });

  const rows = deliveries.data ?? [];
  const filtered = useMemo(() => filterDeliveries(rows, filter), [rows, filter]);
  const summary = useMemo(() => summariseDeliveries(filtered), [filtered]);
  const chains = useMemo(() => retryChains(filtered), [filtered]);

  const toggleIn = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Delivery attempts</CardTitle>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => deliveries.refetch()}
              disabled={!enabled || deliveries.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${deliveries.isFetching ? "animate-spin" : ""}`} aria-hidden />
              Refresh
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-2"
              disabled={!filtered.length}
              onClick={() => downloadCsv(deliveriesCsv(filtered), "yalla-webhook-deliveries.csv")}
            >
              <Download className="h-4 w-4" aria-hidden /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-end gap-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Environment
              </legend>
              <div className="flex gap-2">
                {ENVIRONMENTS.map((env) => (
                  <Toggle
                    key={env}
                    size="sm"
                    variant="outline"
                    pressed={filter.environments.includes(env)}
                    onPressedChange={() => setFilter((f) => ({ ...f, environments: toggleIn(f.environments, env) }))}
                    aria-label={`Include ${env} deliveries`}
                  >
                    {env}
                  </Toggle>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Status
              </legend>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <Toggle
                    key={s}
                    size="sm"
                    variant="outline"
                    pressed={filter.statuses.includes(s)}
                    onPressedChange={() => setFilter((f) => ({ ...f, statuses: toggleIn(f.statuses, s) }))}
                    aria-label={`Filter to ${s.replace("_", " ")}`}
                  >
                    {s.replace("_", " ")}
                  </Toggle>
                ))}
              </div>
            </fieldset>

            <div className="min-w-[16rem] flex-1 space-y-2">
              <Label htmlFor="delivery-search" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Correlation / delivery / event ID
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="delivery-search"
                  className="pl-9"
                  placeholder="whd_… , ord_… or an endpoint host"
                  value={filter.search}
                  onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Attempts", value: nf.format(summary.attempts), hint: `${chains.length} delivery chain(s)` },
              { label: "Delivered", value: nf.format(summary.delivered), hint: `${(summary.successRate * 100).toFixed(1)}% of terminal attempts` },
              { label: "Retried", value: nf.format(summary.retried), hint: "attempt > 1" },
              { label: "Dead-lettered", value: nf.format(summary.deadLettered), hint: "exhausted retries" },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-card p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{m.label}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{m.value}</div>
                <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {summary.topFailures.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Failure categories in this window</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {summary.topFailures.map(({ category, count }) => {
              const g = FAILURE_GUIDANCE[category];
              return (
                <div key={category} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{g.label}</span>
                    <Badge variant="secondary">{nf.format(count)} attempt(s)</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{g.cause}</p>
                  <p className="mt-1 text-sm">{g.remedy}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Retry chains</CardTitle></CardHeader>
        <CardContent>
          {!enabled ? (
            <p className="text-sm text-muted-foreground">
              Delivery history appears once your login is attached to a partner account.
            </p>
          ) : deliveries.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading delivery ledger…</p>
          ) : deliveries.error ? (
            <p className="text-sm text-destructive">
              Could not load the delivery ledger: {(deliveries.error as Error).message}
            </p>
          ) : chains.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleSlash className="h-4 w-4" aria-hidden />
              No webhook deliveries match this filter. Once your endpoint is registered, every attempt —
              including failures and retries — is recorded here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Correlation ID</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Last attempt</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {chains.map((chain) => {
                  const last = chain.attempts.at(-1)!;
                  const open = expanded === chain.deliveryId;
                  return (
                    <>
                      <TableRow key={chain.deliveryId}>
                        <TableCell className="font-medium">
                          {last.event_type}
                          <div className="font-mono text-xs text-muted-foreground">{last.event_id}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{last.correlation_id}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {chain.attempts.length}/{last.max_attempts}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(last.status)}>{last.status.replace("_", " ")}</Badge>
                          {last.failure_category && last.failure_category !== "none" && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {FAILURE_GUIDANCE[last.failure_category].label}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(last.created_at).toISOString().replace("T", " ").slice(0, 19)} UTC
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-expanded={open}
                            onClick={() => setExpanded(open ? null : chain.deliveryId)}
                          >
                            {open ? "Hide" : "Inspect"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow key={`${chain.deliveryId}-detail`}>
                          <TableCell colSpan={6} className="bg-muted/40">
                            <div className="space-y-3 py-2">
                              <div className="text-xs text-muted-foreground">
                                Endpoint <span className="font-mono">{last.endpoint_url}</span> · signature scheme{" "}
                                <span className="font-mono">{last.signature_version}</span> · delivery{" "}
                                <span className="font-mono">{chain.deliveryId}</span>
                              </div>
                              {chain.attempts.map((a) => {
                                const g = a.failure_category ? FAILURE_GUIDANCE[a.failure_category] : null;
                                return (
                                  <div key={a.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Badge variant="outline">Attempt {a.attempt}</Badge>
                                      <Badge variant={statusVariant(a.status)}>{a.status.replace("_", " ")}</Badge>
                                      {a.http_status !== null && <Badge variant="secondary">HTTP {a.http_status}</Badge>}
                                      {a.response_ms !== null && <span className="text-xs text-muted-foreground">{a.response_ms} ms</span>}
                                      {a.signature_valid === false && <Badge variant="destructive">signature invalid</Badge>}
                                      {a.timestamp_skew_seconds !== null && (
                                        <span className="text-xs text-muted-foreground">skew {a.timestamp_skew_seconds}s</span>
                                      )}
                                    </div>
                                    {g && g.label !== "No failure" && (
                                      <p className="mt-2 text-xs text-muted-foreground">
                                        <span className="font-semibold text-foreground">{g.label}.</span> {g.cause} {g.remedy}
                                      </p>
                                    )}
                                    {a.error_detail && (
                                      <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-[11px]">
                                        <code>{a.error_detail}</code>
                                      </pre>
                                    )}
                                    {a.next_retry_at && (
                                      <p className="mt-2 text-xs text-muted-foreground">
                                        Next retry {new Date(a.next_retry_at).toISOString().replace("T", " ").slice(0, 19)} UTC
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
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
