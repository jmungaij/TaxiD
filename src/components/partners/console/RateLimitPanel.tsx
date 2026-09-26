/**
 * Rate-limit simulator — models the documented token bucket per tier so a
 * partner can test throttling behaviour before go-live.
 *
 * This is explicitly a model of the published contract, not a live probe of the
 * gateway. The panel states that on screen so no engineer mistakes it for a
 * measured result.
 */

import { useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Gauge } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CAPABILITY_DOMAINS, COMMERCIAL_TIERS } from "@/lib/partners/apiPlatform";
import { RETRY_REFERENCE, policyForTier, simulate } from "@/lib/partners/rateLimitSim";

const nf = new Intl.NumberFormat("en-KE");

export function RateLimitPanel() {
  const [tier, setTier] = useState(COMMERCIAL_TIERS[0].key);
  const [domain, setDomain] = useState(CAPABILITY_DOMAINS[0].key);
  const [negotiated, setNegotiated] = useState(20_000);
  const [arrival, setArrival] = useState(40);
  const [duration, setDuration] = useState(60);
  const [burstAt, setBurstAt] = useState(10);
  const [burstSize, setBurstSize] = useState(500);

  const policy = useMemo(() => policyForTier(tier, negotiated), [tier, negotiated]);
  const result = useMemo(
    () =>
      simulate({
        policy,
        arrivalPerSec: arrival,
        durationSeconds: duration,
        burst: burstSize > 0 ? { atSecond: burstAt, requests: burstSize } : undefined,
      }),
    [policy, arrival, duration, burstAt, burstSize],
  );

  const domainMeta = CAPABILITY_DOMAINS.find((d) => d.key === domain);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" aria-hidden /> Throttling model
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            This simulator models the published token bucket — burst allowance plus sustained refill —
            for a tier. It is a deterministic model of the rate-limit contract, not a live probe of the
            gateway, so use it to design retry behaviour rather than to certify capacity.
          </p>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sim-tier">Commercial tier</Label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger id="sim-tier"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMERCIAL_TIERS.map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.name} — {t.rateLimit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sim-domain">Capability domain</Label>
              <Select value={domain} onValueChange={setDomain}>
                <SelectTrigger id="sim-domain"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CAPABILITY_DOMAINS.map((d) => (
                    <SelectItem key={d.key} value={d.key}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {domainMeta && <p className="text-xs text-muted-foreground">{domainMeta.summary}</p>}
            </div>

            {policy.negotiated && (
              <div className="space-y-2">
                <Label htmlFor="sim-negotiated">Contracted ceiling (req/min)</Label>
                <Input
                  id="sim-negotiated"
                  type="number"
                  min={60}
                  step={60}
                  value={negotiated}
                  onChange={(e) => setNegotiated(Math.max(60, Number(e.target.value) || 60))}
                />
                <p className="text-xs text-muted-foreground">
                  This tier has dedicated capacity, so enter the ceiling from your contract.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="sim-arrival">Steady load — {nf.format(arrival)} req/sec</Label>
              <Slider
                id="sim-arrival"
                min={0}
                max={Math.max(50, Math.ceil(policy.refillPerSec * 3))}
                step={1}
                value={[arrival]}
                onValueChange={([v]) => setArrival(v)}
                aria-label="Steady offered load in requests per second"
              />
              <p className="text-xs text-muted-foreground">
                Sustained allowance is {policy.refillPerSec.toFixed(1)} req/sec.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sim-duration">Window — {duration}s</Label>
              <Slider
                id="sim-duration"
                min={10}
                max={300}
                step={10}
                value={[duration]}
                onValueChange={([v]) => setDuration(v)}
                aria-label="Simulation window in seconds"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sim-burst">Spike — {nf.format(burstSize)} extra requests at t={burstAt}s</Label>
              <Slider
                id="sim-burst"
                min={0}
                max={5000}
                step={50}
                value={[burstSize]}
                onValueChange={([v]) => setBurstSize(v)}
                aria-label="Spike size in requests"
              />
              <Slider
                min={1}
                max={duration}
                step={1}
                value={[Math.min(burstAt, duration)]}
                onValueChange={([v]) => setBurstAt(v)}
                aria-label="Second at which the spike occurs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Offered", value: nf.format(result.totals.offered), hint: `${duration}s window` },
          { label: "Allowed", value: nf.format(result.totals.allowed), hint: "2xx eligible" },
          { label: "Throttled (429)", value: nf.format(result.totals.throttled), hint: `${(result.totals.throttleRate * 100).toFixed(2)}% of offered` },
          { label: "Burst capacity", value: nf.format(policy.burstCapacity), hint: `${policy.tierName} bucket` },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-border bg-card p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{m.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{m.value}</div>
            <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {result.verdict.level === "clear" ? (
              <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden />
            ) : (
              <AlertTriangle className="h-4 w-4 text-status-warning" aria-hidden />
            )}
            {result.verdict.headline}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{result.verdict.guidance}</p>
          <div className="flex flex-wrap gap-2" role="list" aria-label="Illustrative response headers">
            {Object.entries(result.headers).map(([k, v]) => (
              <Badge key={k} variant="secondary" role="listitem" className="font-mono text-[11px]">
                {k}: {v}
              </Badge>
            ))}
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.seconds} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="second" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="allowed" stackId="a" name="Allowed" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
                <Bar dataKey="throttled" stackId="a" name="Throttled" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" aria-hidden /> Second-by-second
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>t</TableHead>
                  <TableHead className="text-right">Offered</TableHead>
                  <TableHead className="text-right">Allowed</TableHead>
                  <TableHead className="text-right">429</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Retry-After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.seconds.map((s) => (
                  <TableRow key={s.second}>
                    <TableCell className="tabular-nums">{s.second}s</TableCell>
                    <TableCell className="text-right tabular-nums">{nf.format(s.offered)}</TableCell>
                    <TableCell className="text-right tabular-nums">{nf.format(s.allowed)}</TableCell>
                    <TableCell className="text-right tabular-nums">{nf.format(s.throttled)}</TableCell>
                    <TableCell className="text-right tabular-nums">{nf.format(s.tokensRemaining)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.retryAfterSeconds === null ? "—" : `${s.retryAfterSeconds}s`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Reference 429 handling</CardTitle></CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
              <code>{RETRY_REFERENCE}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
