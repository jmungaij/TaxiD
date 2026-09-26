/**
 * Organisation panel — tenant-scoped view of one corporate account.
 *
 * Everything here is read through row-level security using the signed-in
 * person's own organisation id: pending applications (staff invitations and
 * ride requests awaiting a decision), the organisation's verification state,
 * approved bookings, and the organisation's own sign-in policy.
 *
 * Sign-in policy changes are *proposals*: `corp_signin_policy_propose` writes a
 * new DRAFT version that only takes effect once platform staff approve it.
 * Organisation single sign-on is not offered — no identity provider is
 * connected, so the option is deliberately absent rather than shown as broken.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Building2, CheckCircle2, Clock, Loader2, ShieldCheck, Info, Mail, Car,
} from "lucide-react";

interface OrgRow {
  id: string;
  legal_name: string;
  trading_name: string | null;
  kra_pin: string | null;
  registration_number: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_address: string | null;
  status: string;
  credit_limit_cents: number | null;
  payment_terms_days: number | null;
  created_at: string;
}

interface PolicyRow {
  id: string;
  version: number;
  state: string;
  email_domains: string[] | null;
  password_enabled: boolean;
  passwordless_enabled: boolean;
  google_enabled: boolean;
  sso_enabled: boolean;
  mfa_required: boolean;
  session_idle_minutes: number;
  session_absolute_hours: number;
  approved_at: string | null;
  note: string | null;
  created_at: string;
}

interface InviteRow {
  id: string; email: string | null; full_name: string | null;
  role: string; invited_at: string | null;
}
interface ApprovalRow {
  id: string; pickup_address: string | null; dropoff_address: string | null;
  estimated_fare_cents: number | null; scheduled_for: string | null;
  status: string; decided_at: string | null; created_at: string;
}

const money = (cents: number | null | undefined) =>
  `KSh ${((cents ?? 0) / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export default function CorporateOrganisation({ corporateId }: { corporateId: string | null }) {
  const { isAnyAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<OrgRow | null>(null);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [pendingRides, setPendingRides] = useState<ApprovalRow[]>([]);
  const [approvedRides, setApprovedRides] = useState<ApprovalRow[]>([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [saving, setSaving] = useState(false);

  // Billing contact form
  const [billingEmail, setBillingEmail] = useState("");
  const [billingPhone, setBillingPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");

  // Sign-in policy proposal form
  const [domains, setDomains] = useState("");
  const [password, setPassword] = useState(true);
  const [emailLink, setEmailLink] = useState(false);
  const [google, setGoogle] = useState(false);
  const [mfa, setMfa] = useState(false);
  const [idle, setIdle] = useState(30);
  const [absolute, setAbsolute] = useState(8);

  const load = useCallback(async () => {
    if (!corporateId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [orgRes, polRes, invRes, pendRes, apprRes, apprCount] = await Promise.all([
        supabase.from("corporate_accounts")
          .select("id, legal_name, trading_name, kra_pin, registration_number, billing_email, billing_phone, billing_address, status, credit_limit_cents, payment_terms_days, created_at")
          .eq("id", corporateId).maybeSingle(),
        untypedDb.from("identity_auth_policies")
          .select("id, version, state, email_domains, password_enabled, passwordless_enabled, google_enabled, sso_enabled, mfa_required, session_idle_minutes, session_absolute_hours, approved_at, note, created_at")
          .eq("corporate_id", corporateId).order("version", { ascending: false }),
        supabase.from("corporate_employees")
          .select("id, email, full_name, role, invited_at")
          .eq("corporate_id", corporateId).eq("status", "invited")
          .order("invited_at", { ascending: false }).limit(25),
        supabase.from("corporate_ride_approvals")
          .select("id, pickup_address, dropoff_address, estimated_fare_cents, scheduled_for, status, decided_at, created_at")
          .eq("corporate_id", corporateId).eq("status", "pending")
          .order("created_at", { ascending: false }).limit(25),
        supabase.from("corporate_ride_approvals")
          .select("id, pickup_address, dropoff_address, estimated_fare_cents, scheduled_for, status, decided_at, created_at")
          .eq("corporate_id", corporateId).eq("status", "approved")
          .order("decided_at", { ascending: false }).limit(25),
        supabase.from("corporate_ride_approvals")
          .select("*", { count: "exact", head: true })
          .eq("corporate_id", corporateId).eq("status", "approved"),
      ]);

      const o = (orgRes.data ?? null) as OrgRow | null;
      setOrg(o);
      if (o) {
        setBillingEmail(o.billing_email ?? "");
        setBillingPhone(o.billing_phone ?? "");
        setBillingAddress(o.billing_address ?? "");
      }
      const pols = (polRes.data ?? []) as unknown as PolicyRow[];
      setPolicies(pols);
      const current = pols.find((p) => p.state === "ACTIVE") ?? pols[0];
      if (current) {
        setDomains((current.email_domains ?? []).join(", "));
        setPassword(current.password_enabled);
        setEmailLink(current.passwordless_enabled);
        setGoogle(current.google_enabled);
        setMfa(current.mfa_required);
        setIdle(current.session_idle_minutes);
        setAbsolute(current.session_absolute_hours);
      }
      setInvites((invRes.data ?? []) as unknown as InviteRow[]);
      setPendingRides((pendRes.data ?? []) as unknown as ApprovalRow[]);
      setApprovedRides((apprRes.data ?? []) as unknown as ApprovalRow[]);
      setApprovedCount(apprCount.count ?? 0);
    } catch (e) {
      toast.error((e as Error).message || "Could not load your organisation");
    } finally {
      setLoading(false);
    }
  }, [corporateId]);

  useEffect(() => { void load(); }, [load]);

  const saveBilling = async () => {
    if (!corporateId) return;
    setSaving(true);
    try {
      const { data, error } = await untypedDb.rpc("corp_org_settings_update", {
        _corporate_id: corporateId,
        _billing_email: billingEmail,
        _billing_phone: billingPhone,
        _billing_address: billingAddress,
      });
      if (error) throw error;
      const res = data as { ok?: boolean; reason?: string } | null;
      if (!res?.ok) throw new Error(res?.reason ?? "Update refused");
      toast.success("Billing contact updated");
      await load();
    } catch (e) {
      toast.error((e as Error).message || "Could not update billing contact");
    } finally { setSaving(false); }
  };

  const proposePolicy = async () => {
    if (!corporateId) return;
    setSaving(true);
    try {
      const { data, error } = await untypedDb.rpc("corp_signin_policy_propose", {
        _corporate_id: corporateId,
        _email_domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
        _password: password,
        _passwordless: emailLink,
        _google: google,
        _mfa_required: mfa,
        _idle_minutes: idle,
        _absolute_hours: absolute,
        _note: null,
      });
      if (error) throw error;
      const res = data as { ok?: boolean; reason?: string; version?: number } | null;
      if (!res?.ok) throw new Error(res?.reason ?? "Proposal refused");
      toast.success(`Version ${res.version} saved — awaiting platform approval`);
      await load();
    } catch (e) {
      toast.error((e as Error).message || "Could not save the proposal");
    } finally { setSaving(false); }
  };

  if (!corporateId) {
    return (
      <Alert>
        <Info className="h-4 w-4" aria-hidden />
        <AlertTitle>No organisation linked yet</AlertTitle>
        <AlertDescription>
          Your account is not linked to an approved organisation. An organisation is created only
          once a SAFARID manager approves the business application.
        </AlertDescription>
      </Alert>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your organisation…
      </div>
    );
  }

  const activePolicy = policies.find((p) => p.state === "ACTIVE") ?? null;
  const pendingPolicy = policies.find((p) => p.state === "DRAFT") ?? null;
  const pendingTotal = invites.length + pendingRides.length;

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pending applications</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{pendingTotal}</div>
            <p className="text-xs text-muted-foreground">
              {invites.length} staff invitation{invites.length === 1 ? "" : "s"} · {pendingRides.length} ride request{pendingRides.length === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Organisation status</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" aria-hidden />
              <Badge className={org?.status === "ACTIVE" ? "bg-status-success text-ice" : "bg-status-warning text-ice"}>
                {org?.status === "ACTIVE" ? "Verified & active" : org?.status ?? "Unknown"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Verified on approval of your business application.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Approved bookings</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{approvedCount}</div>
            <p className="text-xs text-muted-foreground">Approved by your own approvers.</p>
          </CardContent>
        </Card>
      </div>

      {isAnyAdmin && (
        <Alert>
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <AlertTitle>SAFARID manager view</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Approve business applications, check submitted documents and change account settings in
              the corporate admin portal.
            </span>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/admin/corporate-portal">Open corporate admin portal</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Organisation record */}
      <Card>
        <CardHeader><CardTitle className="text-base">Organisation record</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Registered name</dt><dd className="font-medium text-right">{org?.legal_name}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Trading name</dt><dd className="text-right">{org?.trading_name || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">KRA PIN</dt><dd className="text-right">{org?.kra_pin || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Registration number</dt><dd className="text-right">{org?.registration_number || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Credit limit</dt><dd className="text-right">{money(org?.credit_limit_cents)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Payment terms</dt><dd className="text-right">{org?.payment_terms_days ?? 0} days</dd></div>
          </dl>
          <div className="space-y-3">
            <div>
              <Label htmlFor="billing-email" className="text-xs">Billing email</Label>
              <Input id="billing-email" type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="billing-phone" className="text-xs">Billing phone</Label>
              <Input id="billing-phone" value={billingPhone} onChange={(e) => setBillingPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="billing-address" className="text-xs">Billing address</Label>
              <Input id="billing-address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
            </div>
            <Button size="sm" onClick={saveBilling} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Save billing contact
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sign-in policy */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Sign-in policy</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            These settings decide what your people see on the sign-in screen. A change is saved as a
            new dated version and takes effect only once SAFARID approves it — the version in force now
            keeps working until then.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden /> In force now
              </div>
              {activePolicy ? (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <li>Version {activePolicy.version} · approved {activePolicy.approved_at ? new Date(activePolicy.approved_at).toLocaleDateString() : "—"}</li>
                  <li>Email domains: {(activePolicy.email_domains ?? []).join(", ") || "—"}</li>
                  <li>
                    Methods: {[activePolicy.password_enabled && "password", activePolicy.passwordless_enabled && "email sign-in link", activePolicy.google_enabled && "Google"].filter(Boolean).join(", ") || "none"}
                  </li>
                  <li>Second factor {activePolicy.mfa_required ? "required" : "optional"} · {activePolicy.session_idle_minutes} min idle / {activePolicy.session_absolute_hours} h</li>
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  No approved version yet — the platform default applies to your people.
                </p>
              )}
            </div>
            <div className="rounded-lg border p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Clock className="h-4 w-4 text-status-warning" aria-hidden /> Awaiting approval
              </div>
              {pendingPolicy ? (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <li>Version {pendingPolicy.version} · proposed {new Date(pendingPolicy.created_at).toLocaleDateString()}</li>
                  <li>Email domains: {(pendingPolicy.email_domains ?? []).join(", ") || "—"}</li>
                  <li>
                    Methods: {[pendingPolicy.password_enabled && "password", pendingPolicy.passwordless_enabled && "email sign-in link", pendingPolicy.google_enabled && "Google"].filter(Boolean).join(", ") || "none"}
                  </li>
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Nothing waiting.</p>
              )}
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="policy-domains" className="text-xs">Your email domains (comma separated)</Label>
              <Input id="policy-domains" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.co.ke, acme.com" />
            </div>
            <label className="flex items-center justify-between rounded-md border bg-background p-3 text-sm">
              <span>Password sign-in</span>
              <Switch checked={password} onCheckedChange={setPassword} aria-label="Allow password sign-in" />
            </label>
            <label className="flex items-center justify-between rounded-md border bg-background p-3 text-sm">
              <span>Email sign-in link</span>
              <Switch checked={emailLink} onCheckedChange={setEmailLink} aria-label="Allow email sign-in link" />
            </label>
            <label className="flex items-center justify-between rounded-md border bg-background p-3 text-sm">
              <span>Google sign-in</span>
              <Switch checked={google} onCheckedChange={setGoogle} aria-label="Allow Google sign-in" />
            </label>
            <label className="flex items-center justify-between rounded-md border bg-background p-3 text-sm">
              <span>Require a second factor</span>
              <Switch checked={mfa} onCheckedChange={setMfa} aria-label="Require a second factor" />
            </label>
            <div>
              <Label htmlFor="policy-idle" className="text-xs">Idle timeout (minutes, 5–480)</Label>
              <Input id="policy-idle" type="number" min={5} max={480} value={idle}
                     onChange={(e) => setIdle(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="policy-absolute" className="text-xs">Maximum session length (hours, 1–24)</Label>
              <Input id="policy-absolute" type="number" min={1} max={24} value={absolute}
                     onChange={(e) => setAbsolute(Number(e.target.value))} />
            </div>
            <div className="md:col-span-2 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Organisation single sign-on is not offered — no identity provider is connected to your account.
              </p>
              <Button size="sm" onClick={proposePolicy} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                Submit for approval
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending applications */}
      <Card>
        <CardHeader><CardTitle className="text-base">Pending applications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <section aria-labelledby="pending-staff">
            <h3 id="pending-staff" className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Mail className="h-4 w-4 text-primary" aria-hidden /> Staff invitations awaiting activation
            </h3>
            {invites.length === 0 ? (
              <p className="text-xs text-muted-foreground">None.</p>
            ) : (
              <ul className="divide-y rounded-md border text-sm">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 p-3">
                    <span className="min-w-0 truncate">{i.full_name || i.email || "Invited employee"}</span>
                    <span className="text-xs text-muted-foreground">
                      {i.role.split("_").join(" ")} · invited {i.invited_at ? new Date(i.invited_at).toLocaleDateString() : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="pending-rides">
            <h3 id="pending-rides" className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Car className="h-4 w-4 text-primary" aria-hidden /> Ride requests awaiting a decision
            </h3>
            {pendingRides.length === 0 ? (
              <p className="text-xs text-muted-foreground">None.</p>
            ) : (
              <ul className="divide-y rounded-md border text-sm">
                {pendingRides.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 p-3">
                    <span className="min-w-0 truncate">{r.pickup_address || "—"} → {r.dropoff_address || "—"}</span>
                    <span className="text-xs text-muted-foreground">{money(r.estimated_fare_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </CardContent>
      </Card>

      {/* Approved bookings */}
      <Card>
        <CardHeader><CardTitle className="text-base">Approved bookings</CardTitle></CardHeader>
        <CardContent>
          {approvedRides.length === 0 ? (
            <p className="text-xs text-muted-foreground">No approved bookings yet.</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {approvedRides.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 p-3">
                  <span className="min-w-0 truncate">{r.pickup_address || "—"} → {r.dropoff_address || "—"}</span>
                  <span className="text-xs text-muted-foreground">
                    {money(r.estimated_fare_cents)} · approved {r.decided_at ? new Date(r.decided_at).toLocaleDateString() : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
