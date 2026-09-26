/**
 * Security Centre — the account holder's own view of where they are signed in,
 * which devices they have used and what has happened on their account.
 *
 * Everything is read through server-side routines scoped to the caller's own
 * identity and organisation. No other account's data can be requested from
 * here, and no risk score, tamper flag or raw IP address is exposed.
 */
import { useCallback, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { toast } from "sonner";
import { Building2, KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { loadMyRiskAssessments, type OwnRiskAssessment } from "@/lib/identity/risk";
import {
  loadMyAuthEvents,
  loadMyDevices,
  loadMySessions,
  loadTenantContext,
  signOutOtherSessions,
  type IdentityAuthEvent,
  type IdentityDevice,
  type IdentitySession,
  type TenantContext,
} from "@/lib/identity/plane";
import {
  loadMfaState,
  removeFactor,
  startEnrolment,
  verifyCode,
  type EnrolmentStart,
  type MfaState,
} from "@/lib/identity/mfa";

function when(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

function shortAgent(agent: string | null): string {
  if (!agent) return "Unknown device";
  const a = agent.toLowerCase();
  const platform = a.includes("android") ? "Android" : a.includes("iphone") || a.includes("ipad") ? "iOS" : a.includes("mac") ? "Mac" : a.includes("windows") ? "Windows" : a.includes("linux") ? "Linux" : "Device";
  const browser = a.includes("edg/") ? "Edge" : a.includes("chrome") ? "Chrome" : a.includes("firefox") ? "Firefox" : a.includes("safari") ? "Safari" : "Browser";
  return `${browser} on ${platform}`;
}

export default function SecurityCentre() {
  const [context, setContext] = useState<TenantContext | null>(null);
  const [sessions, setSessions] = useState<IdentitySession[] | null>(null);
  const [devices, setDevices] = useState<IdentityDevice[] | null>(null);
  const [events, setEvents] = useState<IdentityAuthEvent[] | null>(null);
  const [working, setWorking] = useState(false);
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [enrolment, setEnrolment] = useState<EnrolmentStart | null>(null);
  const [code, setCode] = useState("");
  const [risk, setRisk] = useState<OwnRiskAssessment[] | null>(null);

  const load = useCallback(async () => {
    const ctx = await loadTenantContext();
    setContext(ctx);
    const [s, d, e, m, r] = await Promise.all([
      loadMySessions().catch(() => []),
      loadMyDevices().catch(() => []),
      loadMyAuthEvents(25).catch(() => []),
      loadMfaState().catch(() => null),
      loadMyRiskAssessments(10).catch(() => []),
    ]);
    setSessions(s);
    setDevices(d);
    setEvents(e);
    setMfa(m);
    setRisk(r);
  }, []);


  const beginEnrolment = async () => {
    setWorking(true);
    try {
      setEnrolment(await startEnrolment());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the setup.");
    } finally {
      setWorking(false);
    }
  };

  const confirmEnrolment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrolment) return;
    setWorking(true);
    try {
      await verifyCode(enrolment.factorId, code, "enrol");
      toast.success("Second factor switched on for this account.");
      setEnrolment(null);
      setCode("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That code was not accepted.");
    } finally {
      setWorking(false);
    }
  };

  const dropFactor = async (factorId: string) => {
    setWorking(true);
    try {
      await removeFactor(factorId);
      toast.success("Second factor removed.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove it.");
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const signOutOthers = async () => {
    setWorking(true);
    try {
      await signOutOtherSessions();
      toast.success("Signed out everywhere else. This device stays signed in.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign out the other sessions.");
    } finally {
      setWorking(false);
    }
  };

  const loading = sessions === null;

  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <Helmet>
        <title>Security Centre | SAFARID</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <header className="mb-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Security Centre
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your account security</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Where you are signed in, the devices you have used, and recent activity on your account.
          Only you and SAFARID security staff can see this.
        </p>
      </header>

      {context && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>{context.email ?? "Signed-in account"}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Company</div>
              <div className="mt-1 flex items-center gap-2 font-medium">
                <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {context.organisation_name ?? "Personal account"}
              </div>
              {context.membership_role && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {context.membership_role.split("_").join(" ")}
                  {context.membership_status ? ` · ${context.membership_status}` : ""}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Access on this platform</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {context.roles.length === 0 ? (
                  <span className="text-muted-foreground">None granted</span>
                ) : (
                  context.roles.map((r) => (
                    <Badge key={r} variant="outline" className="text-xs">
                      {r.split("_").join(" ")}
                    </Badge>
                  ))
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Access is decided on our servers and cannot be changed from this page.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Second factor. Enrolment, codes and the session's assurance level are
          all decided by the auth server — this page only shows and asks. */}
      <Card className="mb-6">
        <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle className="text-base">Second factor</CardTitle>
            <CardDescription>
              A 6-digit code from an authenticator app, asked for when you sign in.
            </CardDescription>
          </div>
          {mfa?.enrolled && <Badge variant="outline" className="text-xs">On</Badge>}
        </CardHeader>
        <CardContent className="space-y-4">
          {mfa === null ? (
            <Skeleton className="h-12 w-full" />
          ) : mfa.enrolled ? (
            <div className="space-y-3">
              {mfa.factors
                .filter((f) => f.status === "verified")
                .map((f) => (
                  <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="text-sm">
                      <div className="flex items-center gap-2 font-medium">
                        <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        {f.friendlyName ?? "Authenticator app"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Added {when(f.createdAt)}</div>
                    </div>
                    <Button variant="outline" size="sm" disabled={working} onClick={() => dropFactor(f.id)}>
                      Remove
                    </Button>
                  </div>
                ))}
              <p className="text-xs text-muted-foreground">
                {mfa.sessionVerified
                  ? "This session has been verified with your second factor."
                  : "You will be asked for a code the next time you sign in."}
              </p>
            </div>
          ) : enrolment ? (
            <form onSubmit={confirmEnrolment} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Scan this with your authenticator app, then enter the code it shows.
              </p>
              {enrolment.qrSvg && (
                <img
                  src={enrolment.qrSvg}
                  alt="Setup code for your authenticator app"
                  className="h-44 w-44 rounded-lg border border-border bg-background p-2"
                />
              )}
              {enrolment.secret && (
                <p className="text-xs text-muted-foreground">
                  Can't scan? Enter this key manually:{" "}
                  <code className="rounded bg-secondary px-1.5 py-0.5">{enrolment.secret}</code>
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="mfa-code">Code from the app</Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="max-w-[12rem] tracking-[0.3em] text-center"
                  placeholder="000000"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={working}>Turn on second factor</Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={working}
                  onClick={() => { setEnrolment(null); setCode(""); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Not switched on. With it on, someone who learns your password still cannot sign in.
              </p>
              <Button onClick={beginEnrolment} disabled={working}>
                <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
                Set up second factor
              </Button>
            </div>
          )}
        </CardContent>
      </Card>



      <Card className="mb-6">
        <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle className="text-base">Where you are signed in</CardTitle>
            <CardDescription>Active sessions on this account.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={signOutOthers}
            disabled={working || (sessions?.length ?? 0) < 2}
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            Sign out everywhere else
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          ) : sessions!.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active sessions recorded.</p>
          ) : (
            sessions!.map((s) => (
              <div
                key={s.session_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {shortAgent(s.user_agent)}
                    {s.is_current && (
                      <Badge className="text-[10px]">This device</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Signed in {when(s.created_at)} · last active {when(s.refreshed_at)}
                    {s.approximate_location ? ` · near ${s.approximate_location}` : ""}
                  </div>
                </div>
                {s.not_after && (
                  <div className="text-xs text-muted-foreground">Expires {when(s.not_after)}</div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Devices you have used</CardTitle>
          <CardDescription>
            Recognised devices only. We do not show scoring or network addresses here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {devices === null ? (
            <Skeleton className="h-12 w-full" />
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No devices recorded for this account yet.</p>
          ) : (
            devices.map((d, i) => (
              <div key={`${d.fingerprint_hash ?? i}`} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <MonitorSmartphone className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 text-sm">
                  <div className="font-medium">
                    {[d.platform, d.os].filter(Boolean).join(" · ") || shortAgent(d.user_agent)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    First seen {when(d.first_seen)} · last seen {when(d.last_seen)}
                    {d.timezone ? ` · ${d.timezone}` : ""}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent account activity</CardTitle>
          <CardDescription>Sign-ins and sign-in attempts recorded on your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {events === null ? (
            <Skeleton className="h-24 w-full" />
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No activity recorded yet. New sign-ins will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {events.map((e, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="font-medium">
                    {(e.event_type ?? "activity").split("_").join(" ")}
                    {e.method ? ` · ${e.method.split("_").join(" ")}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {when(e.occurred_at)}
                    {e.approximate_location ? ` · near ${e.approximate_location}` : ""}
                    {e.outcome ? ` · ${e.outcome.toLowerCase()}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            Activity is written by SAFARID after each attempt. If you see something you do not
            recognise, sign out everywhere else and change your password.
          </p>
        </CardContent>
      </Card>

      {/* Risk checks: scored on our servers from this account's own history.
          Shown so the person can see why a code was asked for. */}
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sign-in risk checks</CardTitle>
          <CardDescription>
            Each sign-in is checked against your own history. An unusual one asks for a code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {risk === null ? (
            <Skeleton className="h-20 w-full" />
          ) : risk.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No checks recorded yet. They appear the next time you sign in.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {risk.map((r) => (
                <li key={r.id} className="py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {r.decision === "STEP_UP_REQUIRED" ? "Code requested" : "Nothing unusual"}
                    </span>
                    <span className="text-xs text-muted-foreground">{when(r.occurred_at)}</span>
                  </div>
                  {r.reasons.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">{r.reasons.join(" · ")}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

    </main>
  );
}
