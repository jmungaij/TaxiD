/**
 * TaxiD — STAFF OPERATIONS SECURE ACCESS
 *
 * The single authoritative Staff Access entry point (/staff/access).
 * Authentication only: identity is verified here, authorisation is resolved
 * afterwards by RequireStaffPortal (staff register link), the route registry
 * and — authoritatively — by RLS / SECURITY DEFINER RPCs server-side.
 *
 * Design: one frosted authentication panel over a cinematic mobility backdrop.
 * Glass is used selectively; `prefers-reduced-transparency` and
 * `prefers-reduced-motion` both fall back to opaque, static composition.
 */
import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import BrandLogo from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { scoreAuthEvent } from "@/lib/authRiskScore";
import { recordLoginEvent } from "@/lib/security/loginTelemetry";
import { CONTACT } from "@/config/contact";
import {
  sanitizeStaffRedirect,
  staffLandingForRoles,
  STAFF_EMAIL_DOMAIN,
} from "@/lib/staff/accessRouting";
import {
  definitionsForRoles,
  permissionsForRoles,
  workspacesForRoles,
  PERMISSION_LABEL,
  type StaffWorkspaceLink,
} from "@/lib/staff/rbacMatrix";
import PortalQuickSwitch from "@/components/platform/PortalQuickSwitch";
import cinematicBackdrop from "@/assets/staff-access-cinematic.jpg";

/** Roles are resolved server-side; the client never supplies them. */
async function fetchRoles(userId: string): Promise<string[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role as string);
}

interface ResolvedAccess {
  email: string;
  roles: string[];
  home: string;
  workspaces: StaffWorkspaceLink[];
}


export default function StaffAccessGateway() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const redirect = sanitizeStaffRedirect(params.get("redirect"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [access, setAccess] = useState<ResolvedAccess | null>(null);
  const cancelled = useRef(false);

  /** Resolve the authorised surface for a session; honour a safe redirect. */
  const resolveAccess = async (userId: string, address: string) => {
    const roles = await fetchRoles(userId);
    if (cancelled.current) return;
    if (redirect) {
      navigate(redirect, { replace: true });
      return;
    }
    setAccess({
      email: address,
      roles,
      home: staffLandingForRoles(roles),
      workspaces: workspacesForRoles(roles),
    });
  };

  // Already authenticated → resolve the authorised landing surface.
  useEffect(() => {
    cancelled.current = false;
    // Read the stored session locally: an auth-server round trip here fails on a
    // weak connection and made a signed-in specialist see the login form again.
    void supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user;
      if (cancelled.current || !u) return;
      await resolveAccess(u.id, u.email ?? "");
    });
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, redirect]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: address, password });
    setBusy(false);

    if (error) {
      // Controlled response — never disclose whether the account exists.
      await recordLoginEvent({ email: address, event_type: "login_failure", reason: error.message });
      scoreAuthEvent({ event_type: "login_failed", email: address, method: "password" });
      toast({
        title: "Access denied",
        description: "Those credentials are not valid for TaxiD Staff Operations.",
        variant: "destructive",
      });
      return;
    }

    await recordLoginEvent({ email: address, event_type: "login_success" });
    scoreAuthEvent({ event_type: "login", email: address, method: "password", user_id: data.user?.id ?? null });
    setPassword("");
    await resolveAccess(data.user!.id, address);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setAccess(null);
    setEmail("");
    setPassword("");
    toast({ title: "Signed out", description: "Your Staff Operations session has been closed." });
  }


  async function handleReset() {
    const address = email.trim().toLowerCase();
    if (!address) {
      toast({ title: "Enter your work email", description: "We send the reset link to your TaxiD address." });
      return;
    }
    setResetting(true);
    await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetting(false);
    // Identical response regardless of account existence (no enumeration).
    toast({
      title: "Reset requested",
      description: "If this address belongs to an active staff account, a secure reset link is on its way.",
    });
  }

  /**
   * First-time activation for a newly hired staff member. The account is created
   * against the allocated work email only; the authorisation resolver still
   * decides what (if anything) the person may reach afterwards.
   */
  async function handleActivate() {
    const address = email.trim().toLowerCase();
    if (!address || password.length < 8) {
      toast({
        title: "Work email and password needed",
        description: "Enter your allocated work email and choose a password of at least 8 characters.",
      });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: address,
      password,
      options: { emailRedirectTo: `${window.location.origin}/staff/access` },
    });
    setBusy(false);
    if (error) {
      toast({
        title: "Activation not completed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setPassword("");
    toast({
      title: "Confirm your email",
      description: "We sent a confirmation link to your work address. Open it, then sign in here.",
    });
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-primary">
      <Helmet>
        <title>Staff Operations Secure Access | TaxiD</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <meta
          name="description"
          content="Authorised TaxiD personnel only. Secure access to your assigned Staff Operations workspace."
        />
      </Helmet>

      {/* Cinematic backdrop — decorative, motion-gated. */}
      <img
        src={cinematicBackdrop}
        alt=""
        aria-hidden="true"
        width={1920}
        height={1200}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70 motion-safe:animate-staff-access-drift"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/90 via-primary/70 to-primary/95"
      />

      <div className="relative mx-auto flex min-h-dvh max-w-7xl flex-col px-4 py-8 sm:px-8">
        <div className="grid flex-1 items-center gap-12 lg:grid-cols-2">
          {/* Identity / orientation */}
          <div className="text-primary-foreground">
            <BrandLogo tone="light" priority className="h-16 sm:h-20" />
            <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.22em] text-ice">
              TaxiD
            </p>
            <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
              Staff Operations
              <span className="block text-brand-azure">Secure Access</span>
            </h1>
            <p className="mt-5 max-w-md text-sm text-ice sm:text-base">
              One platform. Every journey. Every destination. Sign in to reach the TaxiD
              workspaces you are authorised to operate.
            </p>
            <p className="mt-6 max-w-md text-xs text-ice/80">
              Access is granted by identity, role and permission — verified on every request by the
              platform, not by this screen.
            </p>
          </div>

          {/* Authentication / access-resolution panel — the only glass surface. */}
          <div className="mx-auto w-full max-w-md">
            {access ? (
              <div className="cine-glass rounded-2xl p-6 shadow-2xl sm:p-8">
                <div className="flex flex-col items-center text-center">
                  <ShieldCheck className="h-8 w-8 text-brand-azure" aria-hidden="true" />
                  <h2 className="mt-3 text-xl font-semibold tracking-tight text-primary-foreground">
                    Access resolved
                  </h2>
                  <p className="mt-1 break-all text-sm text-ice">{access.email}</p>
                </div>

                {access.roles.length === 0 ? (
                  <p className="mt-5 rounded-lg border border-white/15 bg-primary/40 p-3 text-xs text-ice">
                    No platform role is granted to this account yet. Your personal cockpit remains
                    available; ask an administrator to assign your operating role.
                  </p>
                ) : (
                  <>
                    <div className="mt-5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ice/80">
                        Granted roles
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {definitionsForRoles(access.roles).map((d) => (
                          <li
                            key={d.role}
                            className="rounded-full border border-white/20 bg-primary/40 px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
                          >
                            {d.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ice/80">
                        Permissions
                      </p>
                      <ul className="mt-2 space-y-1 text-xs text-ice">
                        {permissionsForRoles(access.roles).map((p) => (
                          <li key={p}>{PERMISSION_LABEL[p]}</li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                <div className="mt-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ice/80">
                    Authorised dashboards
                  </p>
                  <ul className="mt-2 space-y-2">
                    {(access.workspaces.length
                      ? access.workspaces
                      : [{ to: "/staff/workspace", label: "My Workspace", desc: "Personal cockpit" }]
                    ).map((w) => (
                      <li key={w.to}>
                        <Link
                          to={w.to}
                          className="block rounded-lg border border-white/15 bg-primary/40 p-3 transition-colors hover:border-brand-azure focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ice"
                        >
                          <span className="flex items-center justify-between text-sm font-semibold text-primary-foreground">
                            {w.label}
                            {w.to === access.home && (
                              <span className="rounded-full bg-brand-sapphire px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                                Home
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-ice">{w.desc}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>

                <PortalQuickSwitch tone="glass" />



                <Button
                  size="lg"
                  className="mt-5 w-full bg-signal text-signal-foreground hover:bg-signal/90"
                  onClick={() => navigate(access.home, { replace: true })}
                >
                  Continue to my workspace
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="mt-3 w-full text-center text-xs font-semibold text-ice underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ice"
                >
                  Sign out
                </button>
              </div>
            ) : (
            <div className="cine-glass rounded-2xl p-6 shadow-2xl sm:p-8">

              <div className="flex flex-col items-center text-center">
                <ShieldCheck className="h-8 w-8 text-ice" aria-hidden="true" />
                <h2 className="mt-3 text-xl font-semibold tracking-tight text-primary-foreground">
                  Welcome back
                </h2>
                <p className="mt-1 text-sm text-ice">
                  Sign in to access your TaxiD workspace
                </p>
              </div>

              <form onSubmit={handleSignIn} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="staff-email" className="text-xs font-semibold text-ice">
                    Work email
                  </Label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ice/70"
                      aria-hidden="true"
                    />
                    <Input
                      id="staff-email"
                      type="email"
                      required
                      autoComplete="username"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={`youremail@${STAFF_EMAIL_DOMAIN}`}
                      className="border-white/20 bg-primary/40 pl-9 text-primary-foreground placeholder:text-ice/60 focus-visible:ring-ice"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="staff-password" className="text-xs font-semibold text-ice">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ice/70"
                      aria-hidden="true"
                    />
                    <Input
                      id="staff-password"
                      type={reveal ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="border-white/20 bg-primary/40 pl-9 pr-10 text-primary-foreground placeholder:text-ice/60 focus-visible:ring-ice"
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((v) => !v)}
                      aria-label={reveal ? "Hide password" : "Show password"}
                      aria-pressed={reveal}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ice/80 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ice"
                    >
                      {reveal ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={resetting}
                    className="text-xs font-semibold text-signal underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ice"
                  >
                    {resetting ? "Sending reset link…" : "Forgot password?"}
                  </button>
                </div>

                <Button type="submit" size="lg" className="w-full bg-signal text-signal-foreground hover:bg-signal/90" disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-4 rounded-lg border border-white/15 bg-primary/30 p-3 text-center">
                <p className="text-[11px] text-ice/85">
                  Newly hired and never signed in? Enter your allocated work email and choose a password.
                </p>
                <button
                  type="button"
                  onClick={handleActivate}
                  disabled={busy}
                  className="mt-2 text-xs font-semibold text-ice underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ice"
                >
                  Activate my staff account
                </button>
              </div>


              <div className="mt-6 border-t border-white/15 pt-4">
                <p className="text-center text-[11px] text-ice/80">Need help?</p>
                <div className="mt-2 flex items-center justify-center gap-5 text-xs">
                  <a
                    href={`mailto:${CONTACT.supportEmail}?subject=Staff%20Operations%20access`}
                    className="text-ice underline-offset-4 hover:underline"
                  >
                    Support
                  </a>
                  <Link to="/legal/privacy" className="text-ice underline-offset-4 hover:underline">
                    Privacy
                  </Link>
                  <Link to="/security" className="text-ice underline-offset-4 hover:underline">
                    Security
                  </Link>
                </div>
              </div>
            </div>
            )}


            <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-ice/80">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Authorised TaxiD personnel only
            </p>
          </div>
        </div>

        <footer className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-4 text-[11px] text-ice/70 sm:flex-row">
          <span>© {new Date().getFullYear()} TaxiD. All rights reserved.</span>
          <Link to="/staff" className="underline-offset-4 hover:underline">
            Staff portal overview
          </Link>
        </footer>
      </div>
    </div>
  );
}
