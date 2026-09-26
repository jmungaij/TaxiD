/**
 * Staff Security Audit — /staff/audit
 *
 * Presents the authenticated-access and privilege trail: login successes,
 * login failures, role changes and permission changes, with timestamps and the
 * acting email. Read-only; the server (RLS) decides what is visible.
 */
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck, ShieldAlert, KeyRound, UserCog, FileLock2, ArrowLeftRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AUDIT_EVENT_LABEL,
  fetchStaffAuditEvents,
  type AuditEventKind,
  type StaffAuditEvent,
} from "@/lib/staff/securityAudit";

const KINDS: AuditEventKind[] = [
  "login_success",
  "login_failure",
  "role_change",
  "permission_change",
  "policy_change",
  "portal_transition",
];

const tone: Record<AuditEventKind, string> = {
  login_success: "bg-success/15 text-success border-success/30",
  login_failure: "bg-destructive/10 text-destructive border-destructive/30",
  role_change: "bg-info/15 text-info border-info/30",
  permission_change: "bg-warning/15 text-warning-foreground border-warning/30",
  policy_change: "bg-info/15 text-info border-info/30",
  portal_transition: "bg-muted text-muted-foreground border-border",
};

const KindIcon = ({ kind }: { kind: AuditEventKind }) =>
  kind === "login_success" ? <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
    : kind === "login_failure" ? <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden />
    : kind === "role_change" ? <UserCog className="h-4 w-4 text-info" aria-hidden />
    : kind === "policy_change" ? <FileLock2 className="h-4 w-4 text-info" aria-hidden />
    : kind === "portal_transition" ? <ArrowLeftRight className="h-4 w-4 text-muted-foreground" aria-hidden />
    : <KeyRound className="h-4 w-4 text-warning-foreground" aria-hidden />;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "medium" });

export default function StaffSecurityAudit() {
  const [events, setEvents] = useState<StaffAuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<AuditEventKind | "all">("all");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setEvents(await fetchStaffAuditEvents(150));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit trail unavailable");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => {
    const c = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<AuditEventKind, number>;
    for (const e of events ?? []) c[e.kind] += 1;
    return c;
  }, [events]);

  const rows = useMemo(
    () => (events ?? []).filter((e) => active === "all" || e.kind === active),
    [events, active],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff Security Audit</h1>
          <p className="text-sm text-muted-foreground">
            Authentication outcomes and privilege changes, newest first. Written server-side — this
            surface is read-only.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          Refresh audit trail
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {KINDS.map((k) => (
          <Card key={k}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <KindIcon kind={k} />
                {AUDIT_EVENT_LABEL[k]}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{events ? counts[k] : "—"}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event log</CardTitle>
          <CardDescription>
            {error
              ? "The audit trail could not be read with your current authorisation."
              : "Login success, login failure, role change, permission change, security-policy change and portal transition events."}
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" variant={active === "all" ? "default" : "outline"} onClick={() => setActive("all")}>
              All events
            </Button>
            {KINDS.map((k) => (
              <Button
                key={k}
                size="sm"
                variant={active === k ? "default" : "outline"}
                onClick={() => setActive(k)}
              >
                {AUDIT_EVENT_LABEL[k]}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {!events ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded for this filter yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Actor email</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmt(e.at)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={tone[e.kind]}>{AUDIT_EVENT_LABEL[e.kind]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{e.actorEmail ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.subject ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.detail ?? "—"}</TableCell>
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
