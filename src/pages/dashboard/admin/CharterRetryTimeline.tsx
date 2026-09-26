/**
 * Booking retry timeline drill-down.
 *
 * Takes a booking idempotency key and reconstructs the full recovery story:
 * client-side pricing retry telemetry (`analytics_events`), the backend
 * idempotency record (`charter_idempotency_keys`), and the `quote_create`
 * staleness rejections (`alerts_events`) that triggered the retries — all on
 * one correlation-ID-stamped timeline.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, History, Link2 } from "lucide-react";

type Source = "client" | "backend" | "alert";

interface TimelineEntry {
  id: string;
  at: string;
  source: Source;
  label: string;
  detail: string;
  correlationId: string;
  severity?: string;
}

interface IdemRecord {
  idempotency_key: string;
  status: string | null;
  action: string | null;
  created_at: string;
  updated_at?: string | null;
  response?: Record<string, unknown> | null;
}

const sourceVariant = (s: Source) =>
  s === "alert" ? "destructive" : s === "backend" ? "secondary" : "outline";

export default function CharterRetryTimeline() {
  const [params, setParams] = useSearchParams();
  const [key, setKey] = useState(params.get("key") ?? "");
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [idem, setIdem] = useState<IdemRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const db = untypedDb;

  const load = async (idempotencyKey: string) => {
    const trimmed = idempotencyKey.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const [client, record] = await Promise.all([
        db.from("analytics_events")
          .select("id,event_name,user_id,properties,created_at")
          .like("event_name", "charter.pricing_recovery.%")
          .contains("properties", { idempotency_key: trimmed })
          .order("created_at", { ascending: true })
          .limit(200),
        db.from("charter_idempotency_keys")
          .select("*")
          .eq("idempotency_key", trimmed)
          .maybeSingle(),
      ]);

      if (client.error) throw new Error(client.error.message);

      const clientRows = (client.data ?? []) as Array<{
        id: string; event_name: string; created_at: string;
        properties: Record<string, unknown> | null;
      }>;
      const idemRow = (record?.data ?? null) as IdemRecord | null;
      setIdem(idemRow);

      // Slugs seen on the client events drive the backend alert correlation.
      const slugs = Array.from(
        new Set(clientRows.map((r) => String((r.properties ?? {}).slug ?? "")).filter(Boolean)),
      );

      let alertRows: Array<{ id: string; severity: string; message: string; context: any; created_at: string }> = [];
      if (slugs.length) {
        const first = clientRows[0]?.created_at ?? new Date(Date.now() - 864e5).toISOString();
        const windowStart = new Date(new Date(first).getTime() - 30 * 60_000).toISOString();
        const { data: alerts } = await db
          .from("alerts_events")
          .select("id,severity,message,context,created_at")
          .eq("metric_key", "charter.pricing_version_stale")
          .gte("created_at", windowStart)
          .order("created_at", { ascending: true })
          .limit(200);
        alertRows = ((alerts ?? []) as typeof alertRows).filter((a) =>
          slugs.includes(String((a.context ?? {}).slug ?? "")),
        );
      }

      const timeline: TimelineEntry[] = [];

      for (const r of clientRows) {
        const p = r.properties ?? {};
        timeline.push({
          id: `client-${r.id}`,
          at: String(p.occurred_at ?? r.created_at),
          source: "client",
          label: r.event_name.replace("charter.pricing_recovery.", "client "),
          detail:
            `slug=${p.slug ?? "?"} quoted=v${p.quoted_version ?? "?"} active=v${p.active_version ?? "?"}` +
            (p.reference ? ` ref=${p.reference}` : "") +
            (p.error ? ` error=${p.error}` : ""),
          correlationId: String(p.idempotency_key ?? trimmed),
        });
      }

      if (idemRow) {
        timeline.push({
          id: `idem-${idemRow.idempotency_key}`,
          at: idemRow.created_at,
          source: "backend",
          label: `backend ${idemRow.action ?? "submission"} recorded`,
          detail: `status=${idemRow.status ?? "unknown"}`,
          correlationId: idemRow.idempotency_key,
        });
        if (idemRow.updated_at && idemRow.updated_at !== idemRow.created_at) {
          timeline.push({
            id: `idem-upd-${idemRow.idempotency_key}`,
            at: idemRow.updated_at,
            source: "backend",
            label: "backend record settled",
            detail: `status=${idemRow.status ?? "unknown"}`,
            correlationId: idemRow.idempotency_key,
          });
        }
      }

      for (const a of alertRows) {
        timeline.push({
          id: `alert-${a.id}`,
          at: a.created_at,
          source: "alert",
          label: "quote_create rejected (pricing_version_stale)",
          detail: a.message,
          correlationId: String((a.context ?? {}).slug ?? "—"),
          severity: a.severity,
        });
      }

      timeline.sort((x, y) => x.at.localeCompare(y.at));
      setEntries(timeline);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    const initial = params.get("key");
    if (initial) void load(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => {
    const started = entries.filter((e) => e.label.includes("retry_started")).length;
    const succeeded = entries.filter((e) => e.label.includes("retry_succeeded")).length;
    const failed = entries.filter((e) => e.label.includes("retry_failed")).length;
    return { started, succeeded, failed, rejections: entries.filter((e) => e.source === "alert").length };
  }, [entries]);

  const submit = () => {
    const next = new URLSearchParams(params);
    if (key.trim()) next.set("key", key.trim()); else next.delete("key");
    setParams(next, { replace: true });
    void load(key);
  };

  return (
    <AdminOnly>
      <div className="p-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <History className="h-5 w-5 text-primary" /> Booking retry timeline
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter a booking idempotency key to see client retry telemetry, the backend idempotency
            record and the <code>quote_create</code> rejections it correlates with.
          </p>
        </header>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lookup</CardTitle>
            <CardDescription>Idempotency key from the booking submission.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 flex-1 min-w-[18rem]">
              <Label htmlFor="crt-key">Idempotency key</Label>
              <Input
                id="crt-key"
                placeholder="charter-booking-…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
            </div>
            <Button onClick={submit} disabled={loading || !key.trim()}>
              <Search className="mr-2 h-4 w-4" /> {loading ? "Loading..." : "Trace"}
            </Button>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {searched && !loading && (
          <div className="grid gap-4 md:grid-cols-4">
            {[
              ["Retries started", summary.started],
              ["Recovered", summary.succeeded],
              ["Failed", summary.failed],
              ["Backend rejections", summary.rejections],
            ].map(([label, value]) => (
              <Card key={String(label)}>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{label}</CardTitle></CardHeader>
                <CardContent className="text-2xl font-semibold">{value}</CardContent>
              </Card>
            ))}
          </div>
        )}

        {idem && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="h-4 w-4" /> Backend idempotency record
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="font-mono text-xs">{idem.idempotency_key}</div>
              <div className="text-muted-foreground">
                status={idem.status ?? "unknown"} · action={idem.action ?? "—"} ·
                created {new Date(idem.created_at).toLocaleString()}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Correlation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(e.at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={sourceVariant(e.source)}>{e.severity ?? e.source}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{e.label}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[26rem]">{e.detail}</TableCell>
                      <TableCell className="font-mono text-xs">{e.correlationId}</TableCell>
                    </TableRow>
                  ))}
                  {!entries.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        {searched ? "No events recorded for this idempotency key." : "Enter an idempotency key to begin."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}
