import { useEffect, useState } from "react";
import BrandLogo from "@/components/brand/BrandLogo";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { lovable } from "@/integrations/lovable/index";
import { useToast } from "@/hooks/use-toast";
import { scoreAuthEvent } from "@/lib/authRiskScore";
import { SeoHead } from "@/components/seo/SeoHead";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
  Phone,
} from "lucide-react";
import heroImage from "@/assets/corporate-login-hero.jpg";
import { recordLoginEvent as recordLoginEventServerSide, type LoginEventType } from "@/lib/security/loginTelemetry";
import { hasStaffPlatformRole, staffLandingForRoles } from "@/lib/staff/accessRouting";
import { operatingContextsFor } from "@/lib/platform/operatingContexts";
import { auditPortalTransition, rememberedLandingFor } from "@/lib/platform/portalPreference";
import { loadAuthMethods, FAIL_CLOSED, type AuthMethods } from "@/lib/auth/methodAvailability";
import { useSecurityClaims } from "@/hooks/useSecurityClaims";
import { discoverIdentity, type DiscoveredPolicy } from "@/lib/identity/plane";
import { resolveMethods } from "@/lib/identity/methodResolution";
import { challengeableFactor, loadMfaState, verifyCode } from "@/lib/identity/mfa";
import { requestRecovery } from "@/lib/identity/recovery";
import { evaluateSignInRisk } from "@/lib/identity/risk";


const HIGHLIGHTS = [
  "One platform. Every journey. Every destination.",
  "Connected mobility for individuals, businesses and partners",
  "Secure access across TaxiD's mobility ecosystem",
];

/** Self-service audiences. Admin/finance/ops roles are never self-assignable. */
type SelfRole = "rider" | "driver" | "corporate_admin" | "corporate_employee" | "fleet_owner";

const AUDIENCES: { id: string; label: string; hint: string; role: SelfRole }[] = [
  { id: "rider", label: "Rider", hint: "Book rides & airport transfers", role: "rider" },
  { id: "driver", label: "Driver", hint: "Drive & earn on TaxiD", role: "driver" },
  { id: "corporate", label: "Corporate", hint: "Company travel & billing", role: "corporate_admin" },
  { id: "employee", label: "Corporate employee", hint: "Ride on your company account", role: "corporate_employee" },
  { id: "logistics", label: "Logistics & delivery partner", hint: "Deliveries, courier & fleet ops", role: "fleet_owner" },
  { id: "charter", label: "Charter business", hint: "Air, bus & coach charter operator", role: "fleet_owner" },
  { id: "leasing", label: "Leasing & rentals", hint: "Lease or rent out vehicles", role: "fleet_owner" },
];

const PENDING_ROLE_KEY = "yalla.signup_role";

/** Applies the audience role chosen at sign-up (server-validated allow-list). */
async function applyPendingSignupRole() {
  let pending: string | null = null;
  try { pending = localStorage.getItem(PENDING_ROLE_KEY); } catch { /* ignore */ }
  if (!pending) return;
  try {
    await (untypedDb)
      .rpc("self_assign_signup_role", { _role: pending });
  } catch { /* non-fatal */ }
  try { localStorage.removeItem(PENDING_ROLE_KEY); } catch { /* ignore */ }
}

/** Turns raw auth errors into guidance a human can act on. */
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Those sign-in details don't match. Check the email and password, or use “Email me a sign-in link” instead.";
  }
  if (m.includes("email not confirmed")) {
    return "This email isn't confirmed yet. Use “Email me a sign-in link” — it confirms the address and signs you in.";
  }
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "We couldn't create the account. If you already have one, sign in instead or reset your password.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts from this device. Wait a few minutes and try again.";
  }
  return message;
}


// Hash-chained forensic record of every admin login attempt.
async function recordLoginEvent(args: {
  email: string;
  event_type: LoginEventType;
  reason?: string | null;
  /** Accepted for call-site compatibility; identity, risk score and decision
   *  are now derived server-side and these values are ignored. */
  user_id?: string | null;
  risk_score?: number;
  decision?: "allow" | "deny";
}) {
  const { email, event_type, reason } = args;
  await recordLoginEventServerSide({ email, event_type, reason });
}

function sanitizeRedirect(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.startsWith("/auth")) return null;
  return raw;
}

function landingForRoles(roles: string[]): string {
  // Platform control first: super admins land in the Super Admin Control Centre.
  if (roles.includes("super_admin") || roles.includes("admin")) return "/dashboard/admin";
  // Dispatch managers run operations from the admin console (no staff-portal role).
  if (roles.includes("dispatch_manager")) return "/dashboard/admin";

  // Any other staff platform role lands in the staff portal (personal cockpit
  // or the role's authorised home from the RBAC matrix).
  if (hasStaffPlatformRole(roles)) return staffLandingForRoles(roles);
  if (roles.includes("corporate_admin") || roles.includes("corporate_employee")) return "/dashboard/corporate";
  if (roles.includes("driver")) return "/dashboard/driver";
  if (roles.includes("rider")) return "/dashboard/rider";
  return "/dashboard";
}


async function resolvePostLoginDestination(userId: string, override: string | null): Promise<string> {
  if (override) return override;
  const { data } = await supabase.from("user_roles").select("role");
  const roles = data?.map((r) => r.role as string) ?? [];
  const roleDefault = landingForRoles(roles);

  // Portal memory: if this device last used an operating context the identity is
  // STILL authorised for, land there instead of the role default. Authority is
  // re-derived from the roles above — the stored hint can never widen it.
  const remembered = rememberedLandingFor(operatingContextsFor(roles).map((c) => c.key));
  const dest = remembered?.to ?? roleDefault;

  void auditPortalTransition({
    kind: "login_redirect",
    newRoute: dest,
    previousRoute: "/auth",
    newContext: remembered?.context ?? null,
    remembered: Boolean(remembered),
  });

  void userId;
  return dest;
}


export default function AuthPage() {
  /** Sign-in is the primary journey; account creation is a separate one. */
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  /** Only statements backed by a control and passing evidence are rendered. */
  const { trustLine } = useSecurityClaims("sign-in page");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [audience, setAudience] = useState<string>("rider");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [methods, setMethods] = useState<AuthMethods>(FAIL_CLOSED);
  /** The sign-in policy that applies to the typed address, resolved server-side. */
  const [policy, setPolicy] = useState<DiscoveredPolicy | null>(null);
  /** Second factor owed by this session before it may be used. */
  const [stepUp, setStepUp] = useState<{ factorId: string; destination: string } | null>(null);
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const redirectTarget = sanitizeRedirect(searchParams.get("redirect"));

  /** Only methods BOTH the auth server and the applicable policy allow. */
  const eff = resolveMethods(methods, policy);

  // Only offer methods the auth server actually provides.
  useEffect(() => {
    let cancelled = false;
    loadAuthMethods().then((m) => { if (!cancelled) setMethods(m); });
    return () => { cancelled = true; };
  }, []);

  // Email-based discovery: ask the server which methods apply to this address's
  // organisation. The answer never states whether an account exists.
  useEffect(() => {
    const candidate = email.trim().toLowerCase();
    if (tab !== "signin" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate)) {
      setPolicy(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      discoverIdentity(candidate).then((p) => { if (!cancelled) setPolicy(p); });
    }, 550);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [email, tab]);

  /**
   * Raises the session to its required assurance level before landing anywhere.
   * Three things can call for a code: the organisation's own sign-in policy
   * (discovered server-side from the address's domain), the assurance level the
   * auth server itself owes, and the server-side risk assessment of this
   * sign-in. Every decision is made server-side; a failure here never lowers a
   * requirement, and risk alone never blocks an account.
   *
   * An organisation policy that requires a second factor is the one case that
   * DOES block: the person is held on this screen and sent to their Security
   * Centre to enrol, because their organisation has made it mandatory.
   */
  async function gateOnSecondFactor(destination: string, signedInEmail?: string | null): Promise<boolean> {
    const applicable =
      policy?.outcome === "OK"
        ? policy
        : signedInEmail
          ? await discoverIdentity(signedInEmail).catch(() => null)
          : null;
    const policyWantsCode = applicable?.outcome === "OK" && applicable.mfa_required === true;

    const [state, risk] = await Promise.all([
      loadMfaState(),
      evaluateSignInRisk().catch(() => null),
    ]);
    const riskWantsCode = risk?.decision === "STEP_UP_REQUIRED";
    const needsCode =
      state.stepUpRequired || riskWantsCode || (policyWantsCode && !state.sessionVerified);
    if (!needsCode) return true;

    const factor = challengeableFactor(state);
    if (!factor) {
      if (policyWantsCode) {
        // Mandatory for this organisation — hold the person here and send them
        // to enrol rather than letting them past a requirement they set.
        setNotice({
          tone: "error",
          text:
            `${applicable?.policy_label ?? "Your organisation"} requires a second factor before ` +
            "you can use the account. Set up your authenticator app to continue.",
        });
        navigate("/account/security", { replace: true });
        return false;
      }
      // Nothing to challenge with. Say why, and let the person continue —
      // the sign-in itself already succeeded and the assessment is recorded.
      if (riskWantsCode) {
        setNotice({
          tone: "info",
          text:
            "This sign-in looked unusual" +
            (risk?.reasons.length ? ` (${risk.reasons[0].toLowerCase()})` : "") +
            ". Add a second factor in your Security Centre for stronger protection.",
        });
      }
      return true;
    }
    setStepUp({ factorId: factor.id, destination });
    setNotice({
      tone: "info",
      text: policyWantsCode && !state.stepUpRequired && !riskWantsCode
        ? `${applicable?.policy_label ?? "Your organisation"} requires a 6-digit authenticator code to finish signing in.`
        : riskWantsCode && !state.stepUpRequired
          ? "This sign-in looked unusual, so we need your 6-digit authenticator code."
          : "Enter the 6-digit code from your authenticator app to finish signing in.",
    });
    return false;
  }


  async function submitStepUp(e: React.FormEvent) {
    e.preventDefault();
    if (!stepUp) return;
    setBusy(true);
    try {
      await verifyCode(stepUp.factorId, code, "step_up");
      setCode("");
      const dest = stepUp.destination;
      setStepUp(null);
      navigate(dest, { replace: true });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "That code was not accepted." });
    } finally {
      setBusy(false);
    }
  }


  // Deep-link support: /auth?tab=signup&as=driver ("magic" is no longer a tab)
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "signup" || t === "signin") setTab(t);
    const as = searchParams.get("as");
    if (as && AUDIENCES.some((a) => a.id === as)) {
      setAudience(as);
      if (!t) setTab("signup");
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled || !data.user) return;
      await applyPendingSignupRole();
      await supabase.rpc("ensure_rider_account");
      const dest = await resolvePostLoginDestination(data.user.id, redirectTarget);
      if (!(await gateOnSecondFactor(dest, data.user.email))) return;
      navigate(dest, { replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled || !session?.user) return;
      if (event !== "SIGNED_IN") return;

      // Detect a magic-link callback: Supabase puts the OTP grant type in the
      // URL hash (#access_token=...&type=magiclink) when the user lands from a
      // magic-link email. Fire scoreAuthEvent AFTER the session is established
      // so the risk-scorer sees the real user_id and the finalized signals.
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const isMagicCallback = /(^|[#&])type=magiclink(&|$)/.test(hash);
      if (isMagicCallback) {
        scoreAuthEvent({
          event_type: "login",
          method: "magic_link",
          user_id: session.user.id,
          email: session.user.email ?? undefined,
        });
      }

      await applyPendingSignupRole();
      await supabase.rpc("ensure_rider_account");
      const dest = await resolvePostLoginDestination(session.user.id, redirectTarget);
      if (!(await gateOnSecondFactor(dest, session.user.email))) return;
      navigate(dest, { replace: true });
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [navigate, redirectTarget]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);
    if (error) {
      await recordLoginEvent({ email, event_type: "login_failure", reason: error.message, risk_score: 50 });
      scoreAuthEvent({ event_type: "login_failed", email, method: "password" });
      setNotice({ tone: "error", text: friendlyAuthError(error.message) });
      toast({ title: "Sign in failed", description: friendlyAuthError(error.message), variant: "destructive" });
    } else {
      await recordLoginEvent({ email, event_type: "login_success", user_id: data.user?.id ?? null });
      scoreAuthEvent({ event_type: "login", email, method: "password", user_id: data.user?.id ?? null });
      toast({ title: "Welcome back!" });
      await applyPendingSignupRole();
      await supabase.rpc("ensure_rider_account");
      // Support agents sign in only through the agent portal.
      const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", data.user!.id);
      const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
      if (roles.includes("support") && !roles.some((r) => r === "admin" || r === "super_admin")) {
        await supabase.auth.signOut();
        navigate(`/agent/login${redirectTarget ? `?next=${encodeURIComponent(redirectTarget)}` : ""}`, { replace: true });
        return;
      }
      const dest = await resolvePostLoginDestination(data.user!.id, redirectTarget);
      if (!(await gateOnSecondFactor(dest, data.user?.email ?? email))) return;
      navigate(dest, { replace: true });
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const chosen = AUDIENCES.find((a) => a.id === audience) ?? AUDIENCES[0];
    try { localStorage.setItem(PENDING_ROLE_KEY, chosen.role); } catch { /* ignore */ }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: { full_name: fullName, phone, account_type: chosen.id },
        emailRedirectTo: `${window.location.origin}/auth`,
      },
    });
    setBusy(false);
    if (error) {
      scoreAuthEvent({ event_type: "login_failed", email, method: "signup" });
      setNotice({ tone: "error", text: friendlyAuthError(error.message) });
      toast({ title: "Sign up failed", description: friendlyAuthError(error.message), variant: "destructive" });
    } else {
      scoreAuthEvent({ event_type: "signup", email, method: "password" });
      if (data.session) {
        await applyPendingSignupRole();
        toast({ title: "Account created", description: `Welcome to TaxiD, ${chosen.label}.` });
      } else {
        toast({
          title: `${chosen.label} account created`,
          description: "Check your email for the confirmation link, then sign in.",
        });
        setTab("signin");
      }
    }
  }


  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth${redirectTarget ? `?redirect=${encodeURIComponent(redirectTarget)}` : ""}`,
        data: fullName ? { full_name: fullName } : undefined,
        shouldCreateUser: true,
      },
    });
    setBusy(false);
    if (error) {
      scoreAuthEvent({ event_type: "login_failed", email, method: "magic_link" });
      toast({ title: "Could not send magic link", description: error.message, variant: "destructive" });
    } else {
      scoreAuthEvent({ event_type: "login", email, method: "magic_link" });
      toast({ title: "Check your email", description: `We sent a one-tap sign-in link to ${email}. No password needed.` });
    }
  }

  async function handleGoogle() {
    const returnTo = `${window.location.origin}/auth${redirectTarget ? `?redirect=${encodeURIComponent(redirectTarget)}` : ""}`;
    scoreAuthEvent({ event_type: "login", method: "google" });
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: returnTo });
    if (result.error) {
      scoreAuthEvent({ event_type: "login_failed", method: "google" });
      setNotice({ tone: "error", text: "Google sign-in is unavailable right now. Use your email and password instead." });
      toast({ title: "Google sign in failed", description: String(result.error), variant: "destructive" });
    } else if (result.redirected) {
      return;
    }
  }

  const inputBase =
    "h-12 pl-10 bg-secondary/40 border-border/70 focus-visible:bg-background";

  /** Sends the passwordless link without revealing whether the account exists. */
  async function sendSignInLink() {
    if (!email) {
      setNotice({ tone: "error", text: "Enter your email address first." });
      return;
    }
    setNotice(null);
    await handleMagicLink({ preventDefault() {} } as unknown as React.FormEvent);
    setNotice({
      tone: "info",
      text: `If an account exists for ${email.trim().toLowerCase()}, a sign-in link is on its way. The link expires shortly — request a new one if it does.`,
    });
  }

  return (
    <>
      <SeoHead
        path="/auth"
        title="Sign in | TaxiD Africa"
        description="One secure TaxiD account for rides, business travel, rentals, leasing, delivery, fleet and charter."
      />
      <main className="min-h-screen bg-background">
        <div className="grid min-h-screen lg:grid-cols-[1fr_1fr] xl:grid-cols-[1.05fr_1fr]">
          {/* Brand / proposition panel — desktop only. Authentication leads on smaller screens. */}
          <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-primary text-primary-foreground">
            <img
              src={heroImage}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover opacity-25"
              width={1280}
              height={1600}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--primary) / 0.96) 0%, hsl(var(--primary) / 0.88) 45%, hsl(var(--primary) / 0.72) 100%)",
              }}
              aria-hidden="true"
            />

            <div className="relative z-10 p-10">
              <Link to="/" className="inline-flex items-center gap-3 group">
                <BrandLogo
                  tone="light"
                  className="h-8 max-w-[168px] transition-transform group-hover:scale-105"
                />
                <div className="leading-tight border-l border-ice/30 pl-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-ice/80">
                    Secure access
                  </div>
                </div>
              </Link>
            </div>

            <div className="relative z-10 px-10 pb-4 max-w-xl">
              <span className="inline-flex items-center gap-2 rounded-full bg-ice/15 backdrop-blur-sm border border-ice/25 px-3 py-1 text-xs font-medium">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                One secure account. Simple access.
              </span>
              <h1 className="mt-6 text-4xl xl:text-5xl font-semibold leading-[1.1] tracking-tight">
                Welcome back to TaxiD.
              </h1>
              <p className="mt-4 text-base xl:text-lg text-ice/90 max-w-lg">
                One secure account for every journey — rides, business travel, rentals, leasing,
                delivery, fleet and charter.
              </p>

              <ul className="mt-8 space-y-3">
                {HIGHLIGHTS.map((h) => (
                  <li key={h} className="flex items-start gap-3 text-sm text-ice">
                    <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-ice/80" aria-hidden="true" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Only claims held in the public security claim register appear here. */}
            <div className="relative z-10 p-10 flex items-center gap-2 text-xs text-ice/80">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              {trustLine}
            </div>
          </aside>

          {/* Authentication panel */}
          <section className="relative flex items-center justify-center px-5 py-10 sm:px-10 sm:py-14 lg:px-16">
            <div className="relative z-10 w-full max-w-md">
              {/* Compact brand bar on mobile/tablet — no decorative photography. */}
              <div className="lg:hidden mb-8 flex items-center justify-between">
                <Link to="/" className="inline-flex items-center gap-3">
                  <BrandLogo className="h-7 max-w-[148px]" />
                  <span className="leading-tight border-l border-border pl-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Secure access
                  </span>
                </Link>
              </div>

              {stepUp ? (
                /* The session exists but is not yet trusted for use: the auth
                   server decides the assurance level, not this page. */
                <>
                  <div className="space-y-2">
                    <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                      One more step
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      This account uses a second factor. Enter the 6-digit code from your
                      authenticator app to finish signing in.
                    </p>
                  </div>
                  <form onSubmit={submitStepUp} className="mt-8 space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="stepup-code">Authentication code</Label>
                      <Input
                        id="stepup-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        autoFocus
                        required
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="h-12 tracking-[0.4em] text-center text-lg"
                        placeholder="000000"
                      />
                    </div>
                    <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={busy}>
                      {busy ? (<><Loader2 className="h-4 w-4 animate-spin mr-2" />Checking…</>) : "Verify and continue"}
                    </Button>
                  </form>
                  <div aria-live="polite" role="status" className="mt-4 empty:mt-0">
                    {notice && (
                      <p className={cn(
                        "rounded-lg border p-3 text-xs",
                        notice.tone === "error"
                          ? "border-destructive/40 bg-destructive/5 text-destructive"
                          : "border-primary/25 bg-primary/5 text-muted-foreground",
                      )}>
                        {notice.text}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={async () => { await supabase.auth.signOut(); setStepUp(null); setNotice(null); }}
                    className="mt-6 text-xs font-medium text-primary hover:underline underline-offset-4"
                  >
                    Use a different account
                  </button>
                </>
              ) : tab === "signin" ? (
                <>
                  <div className="space-y-2">
                    <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                      Sign in to TaxiD
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      One secure account for your rides, mobility, business travel and more.
                    </p>
                  </div>

                  {/* What the address's organisation policy allows — server-resolved. */}
                  <div aria-live="polite" className="mt-4 empty:mt-0">
                    {eff.rateLimited ? (
                      <p className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                        Too many sign-in lookups from here. Wait a few minutes, or sign in with your
                        email and password.
                      </p>
                    ) : eff.organisationPolicy ? (
                      <p className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground">
                        {eff.policyLabel
                          ? `${eff.policyLabel} sets the sign-in methods for this address.`
                          : "Your organisation sets the sign-in methods for this address."}
                        {eff.mfaRequired ? " A second factor is required." : ""}
                        {eff.unavailable.length > 0
                          ? ` ${eff.unavailable.join(" and ")} is not connected yet, so it is not offered.`
                          : ""}
                      </p>
                    ) : null}
                  </div>


                  <form onSubmit={handleSignIn} className="mt-8 space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="signin-email">Email</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                          id="signin-email"
                          name="email"
                          type="email"
                          required
                          autoComplete="username"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={inputBase}
                          placeholder="you@company.com"
                        />
                      </div>
                    </div>

                    {eff.password && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="signin-password">Password</Label>
                          <button
                            type="button"
                            onClick={() => navigate("/reset-password")}
                            className="text-xs font-medium text-primary hover:underline underline-offset-4"
                          >
                            Forgot password?
                          </button>
                        </div>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          <Input
                            id="signin-password"
                            name="current-password"
                            type={showPassword ? "text" : "password"}
                            required
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={cn(inputBase, "pr-12")}
                            placeholder="Your password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            className="absolute right-2 top-1/2 -translate-y-1/2 h-11 w-11 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                    <Button type="submit" className="w-full h-12 text-base font-semibold shadow-elegant group" disabled={busy}>
                      {busy ? (<><Loader2 className="h-4 w-4 animate-spin mr-2" />Signing in…</>) : (<>Sign in<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>)}
                    </Button>
                  </form>

                  {/* Live region so errors and confirmations reach screen readers. */}
                  <div aria-live="polite" role="status" className="mt-4 empty:mt-0">
                    {notice && (
                      <p className={cn(
                        "rounded-lg border p-3 text-xs",
                        notice.tone === "error"
                          ? "border-destructive/40 bg-destructive/5 text-destructive"
                          : "border-primary/25 bg-primary/5 text-muted-foreground",
                      )}>
                        {notice.text}
                      </p>
                    )}
                  </div>

                  {(eff.emailLink || eff.google || eff.sso) && (
                    <div className="mt-6">
                      <div className="relative flex items-center">
                        <Separator className="flex-1" />
                        <span className="px-3 text-xs text-muted-foreground uppercase tracking-wider">or</span>
                        <Separator className="flex-1" />
                      </div>
                      <div className="mt-4 space-y-3">
                        {eff.emailLink && (
                          <Button type="button" variant="outline" className="w-full h-12 font-medium" onClick={sendSignInLink} disabled={busy}>
                            <Mail className="h-4 w-4 mr-2" aria-hidden="true" />
                            Email me a sign-in link
                          </Button>
                        )}
                        {eff.google && (
                          <Button type="button" variant="outline" className="w-full h-12 font-medium" onClick={handleGoogle}>
                            <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                            </svg>
                            Continue with Google
                          </Button>
                        )}
                        {eff.sso && (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full h-12 font-medium"
                            onClick={() =>
                              setNotice({
                                tone: "info",
                                text: "Your organisation sign-in is being set up. Use your email and password for now.",
                              })
                            }
                          >
                            <ShieldCheck className="h-4 w-4 mr-2" aria-hidden="true" />
                            Continue with {eff.ssoProvider ?? "organisation sign-in"}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    {trustLine}
                  </div>

                  <div className="mt-6 pt-6 border-t border-border/60 space-y-3 text-sm text-center">
                    {methods.signupOpen && (
                      <p className="text-muted-foreground">
                        New to TaxiD?{" "}
                        <button
                          type="button"
                          onClick={() => { setNotice(null); setTab("signup"); }}
                          className="font-semibold text-primary underline-offset-4 hover:underline"
                        >
                          Create an account
                        </button>
                      </p>
                    )}
                    <p className="text-muted-foreground">
                      Managing business travel?{" "}
                      <Link to="/corporate/login" className="font-semibold text-primary underline-offset-4 hover:underline">
                        Sign in to Corporate
                      </Link>
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                      Create your TaxiD account
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      Tell us how you'll use TaxiD — you can add more later.
                    </p>
                  </div>

                  <form onSubmit={handleSignUp} className="mt-8 space-y-5">
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium text-foreground mb-2">I'm signing up as</legend>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {AUDIENCES.map((a) => {
                          const active = audience === a.id;
                          return (
                            <button
                              key={a.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setAudience(a.id)}
                              className={cn(
                                "text-left rounded-lg border px-3 py-2.5 transition-colors",
                                active
                                  ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                                  : "border-border/70 bg-secondary/30 hover:bg-secondary/60",
                              )}
                            >
                              <div className="text-sm font-semibold text-foreground">{a.label}</div>
                              <div className="text-[11px] text-muted-foreground">{a.hint}</div>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>

                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Full name</Label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <Input id="signup-name" required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputBase} placeholder="Jane Wanjiku" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-phone">Phone</Label>
                      <div className="relative">
                        <Phone className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <Input id="signup-phone" placeholder="0712345678" required autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputBase} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <Input id="signup-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputBase} placeholder="you@company.com" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <Input id="signup-password" type={showPassword ? "text" : "password"} required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={cn(inputBase, "pr-12")} placeholder="At least 8 characters" />
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          className="absolute right-2 top-1/2 -translate-y-1/2 h-11 w-11 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <Button type="submit" className="w-full h-12 text-base font-semibold shadow-elegant group" disabled={busy}>
                      {busy ? (<><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating account…</>) : (<>Create account<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>)}
                    </Button>
                  </form>

                  <div className="mt-6 pt-6 border-t border-border/60 text-sm text-muted-foreground text-center">
                    Already have a TaxiD account?{" "}
                    <button
                      type="button"
                      onClick={() => { setNotice(null); setTab("signin"); }}
                      className="font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      Sign in
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
