/**
 * Deliverability panel — sender authentication readiness, provider delivery
 * statistics, bounce/complaint rates and reputation signals over time.
 *
 * All data is server-derived: role-gated daily statistics come from the
 * `email_deliverability_daily` RPC, provider evidence from the append-only
 * `email_delivery_events` ledger, and DNS readiness from stored SPF/DKIM/DMARC
 * probe snapshots.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AppButton } from "@/components/nav/AppButton";
import {
  fetchDeliverabilityDaily, fetchDomainAuth, fetchProviderEvents, runDomainAuthCheck,
  summariseReputation,
  type DeliverabilityDay, type DomainAuthSnapshot, type ProviderEventRow,
} from "@/lib/email/deliverability";

const POSTURE_TONE: Record<string, string> = {
  healthy: "bg-success/10 text-success",
  watch: "bg-warning/10 text-warning",
  at_risk: "bg-destructive/10 text-destructive",
};

const EVENT_TONE: Record<string, string> = {
  delivered: "bg-success/10 text-success",
  opened: "bg-info/10 text-info",
  clicked: "bg-info/10 text-info",
  deferred: "bg-warning/10 text-warning",
  bounced: "bg-destructive/10 text-destructive",
  complained: "bg-destructive/10 text-destructive",
  unsubscribed: "bg-muted text-muted-foreground",
  rejected_unverified: "bg-destructive/10 text-destructive",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });

function AuthCheck({ label, ok, detail }: { label: string; ok: boolean; detail?: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border p-3">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" aria-hidden="true" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 text-destructive" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {detail || (ok ? "Published" : "Not published")}
        </p>
      </div>
    </div>
  );
}

export default function DeliverabilityPanel() {
  const [days, setDays] = useState<DeliverabilityDay[] | null>(null);
  const [events, setEvents] = useState<ProviderEventRow[] | null>(null);
  const [auth, setAuth] = useState<DomainAuthSnapshot[] | null>(null);
  const [probing, setProbing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, e, a] = await Promise.all([
        fetchDeliverabilityDaily(30),
        fetchProviderEvents(100),
        fetchDomainAuth(5),
      ]);
      setDays(d);
      setEvents(e);
      setAuth(a);
    } catch (err) {
      console.error("Failed to load deliverability data", err);
      toast.error(err instanceof Error ? err.message : "Could not load deliverability data.");
      setDays([]);
      setEvents([]);
      setAuth([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reputation = useMemo(() => summariseReputation(days ?? []), [days]);
  const latestAuth = auth?.[0] ?? null;

  const probe = async () => {
    setProbing(true);
    try {
      await runDomainAuthCheck();
      toast.success("Sender authentication re-checked.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "DNS probe failed.");
    } finally {
      setProbing(false);
    }
  };

  if (days === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Reputation summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Emails (7 days)", value: reputation.total.toLocaleString("en-KE") },
          { label: "Delivery rate", value: `${reputation.deliveryRate}%` },
          { label: "Bounce rate", value: `${reputation.bounceRate}%` },
          { label: "Complaint rate", value: `${reputation.complaintRate}%` },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              Sending reputation
            </CardTitle>
            <CardDescription>
              Derived from the last 7 days of deduplicated sends and provider feedback.
            </CardDescription>
          </div>
          <Badge className={POSTURE_TONE[reputation.posture]} variant="secondary">
            {reputation.posture.replace("_", " ")}
          </Badge>
        </CardHeader>
        <CardContent>
          {reputation.signals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reputation risks detected in the current window.
            </p>
          ) : (
            <ul className="space-y-2">
              {reputation.signals.map((s) => (
                <li key={s} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" aria-hidden="true" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Domain authentication */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">Sender authentication</CardTitle>
            <CardDescription>
              {latestAuth
                ? `${latestAuth.domain} — readiness ${latestAuth.readiness_score}/100, checked ${when(latestAuth.checked_at)}`
                : "No SPF/DKIM/DMARC snapshot recorded yet."}
            </CardDescription>
          </div>
          <AppButton
            size="sm"
            variant="outline"
            disabled={probing}
            analytics="email_ops_action"
            action="noop"
            aria-label="Re-check sender authentication DNS records"
            onClick={probe}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${probing ? "animate-spin" : ""}`} aria-hidden="true" />
            Re-check DNS
          </AppButton>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AuthCheck label="SPF" ok={Boolean(latestAuth?.spf_present)} detail={latestAuth?.spf_record} />
            <AuthCheck label="DKIM" ok={Boolean(latestAuth?.dkim_present)} detail={latestAuth?.dkim_selector ? `selector ${latestAuth.dkim_selector}` : null} />
            <AuthCheck label="DMARC" ok={Boolean(latestAuth?.dmarc_present)} detail={latestAuth?.dmarc_policy ? `p=${latestAuth.dmarc_policy}` : null} />
            <AuthCheck label="MX" ok={Boolean(latestAuth?.mx_present)} />
          </div>
          {latestAuth && latestAuth.findings.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {latestAuth.findings.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Daily statistics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily delivery statistics</CardTitle>
          <CardDescription>Deduplicated by message — one email is one row.</CardDescription>
        </CardHeader>
        <CardContent>
          {days.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sends recorded in the last 30 days.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Bounced</TableHead>
                  <TableHead className="text-right">Complaints</TableHead>
                  <TableHead className="text-right">Failed / DLQ</TableHead>
                  <TableHead className="text-right">Delivery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell>{new Date(d.day).toLocaleDateString("en-KE", { dateStyle: "medium" })}</TableCell>
                    <TableCell className="text-right">{d.total}</TableCell>
                    <TableCell className="text-right">{d.sent}</TableCell>
                    <TableCell className="text-right">{d.bounced}</TableCell>
                    <TableCell className="text-right">{d.complained}</TableCell>
                    <TableCell className="text-right">{Number(d.failed) + Number(d.dlq)}</TableCell>
                    <TableCell className="text-right">{d.delivery_rate}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Provider evidence */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider feedback ledger</CardTitle>
          <CardDescription>
            Signature-verified bounce, complaint and delivery reports. Append-only evidence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(events ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No provider events received yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(events ?? []).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Badge className={EVENT_TONE[e.event_type] ?? "bg-muted text-muted-foreground"} variant="secondary">
                        {e.event_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate">{e.recipient_email}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">
                      {e.bounce_type ? `${e.bounce_type}: ` : ""}{e.reason ?? "—"}
                    </TableCell>
                    <TableCell>{e.signature_verified ? "Yes" : "No"}</TableCell>
                    <TableCell>{when(e.occurred_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
