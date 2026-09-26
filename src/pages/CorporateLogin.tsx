import { useEffect, useState } from "react";
import BrandLogo from "@/components/brand/BrandLogo";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Sparkles,
  Sparkle,
  User,
} from "lucide-react";
import { SeoHead } from "@/components/seo/SeoHead";
import { trackPortalLoginLanding } from "@/lib/charter/portalAnalytics";
import { isCharterPortalPath, splitPortalTarget } from "@/lib/charter/portalRoutes";

import { cn } from "@/lib/utils";
import { scoreAuthEvent } from "@/lib/authRiskScore";
import { firstZodMessage } from "@/lib/zod/normalizeZodError";
import heroImage from "@/assets/corporate-login-hero.jpg";
import { recordLoginEvent as recordLoginEventServerSide, type LoginEventType } from "@/lib/security/loginTelemetry";

const CORPORATE_ROLES = ["corporate_admin", "corporate_employee", "admin", "super_admin"];

const HIGHLIGHTS = [
  "Real-time spend controls and policy governance",
  "Dual-wallet architecture powered by M-Pesa Daraja",
  "Enterprise-grade audit trail and compliance",
];

const EmailSchema = z
  .string()
  .trim()
  .min(1, "Work email is required")
  .email("Enter a valid work email address")
  .max(255, "Email is too long");

const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

function mapAuthError(message?: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials"))
    return "The email or password you entered is incorrect.";
  if (m.includes("email not confirmed")) return "Please confirm your email before signing in.";
  if (m.includes("rate") || m.includes("too many"))
    return "Too many attempts. Please wait a moment and try again.";
  if (m.includes("network") || m.includes("fetch"))
    return "Network error. Check your connection and retry.";
  return message || "We couldn't sign you in. Please try again.";
}

// Hash-chained forensic record of every corporate login attempt.
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
  await recordLoginEventServerSide({ email, event_type, reason, surface: "corporate_login" });
}

async function loadRoles(userId: string): Promise<string[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role as string);
}

export default function CorporateLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get("redirect") || "/dashboard/corporate";
  const loginSearch = params.toString();
  // Self-service charter surfaces (/dashboard/charter/**) are open to ANY
  // signed-in customer — they are guarded with <RequireCorporate anyAuthenticated>.
  // Without this, personal customers were signed straight back out here and
  // could never complete a charter booking.
  const allowAnyRole = isCharterPortalPath(splitPortalTarget(redirectTo).pathname);


  // Records which charter element sent the user here and where they asked to go.
  useEffect(() => {
    trackPortalLoginLanding(loginSearch);
  }, [loginSearch]);

  const [tab, setTab] = useState<"magic" | "signin" | "signup">("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        setSessionChecking(false);
        return;
      }
      const roles = await loadRoles(data.session.user.id);
      if (allowAnyRole || roles.some((r) => CORPORATE_ROLES.includes(r))) {

        navigate(redirectTo, { replace: true });
      } else {
        setSessionChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, redirectTo, allowAnyRole]);

  const clearFormError = () => {
    if (formError) setFormError(null);
  };

  const finalizeSignedInSession = async (userId: string, userEmail: string) => {
    const roles = await loadRoles(userId);
    if (!allowAnyRole && !roles.some((r) => CORPORATE_ROLES.includes(r))) {

      await supabase.auth.signOut();
      const msg = "This account isn't authorized for the corporate dashboard.";
      setFormError(msg);
      toast({ title: "Access denied", description: msg, variant: "destructive" });
      await recordLoginEvent({
        email: userEmail,
        event_type: "login_failure",
        user_id: userId,
        reason: "no_corporate_role",
        risk_score: 60,
      });
      return;
    }
    await recordLoginEvent({
      email: userEmail,
      event_type: "login_success",
      user_id: userId,
    });
    toast({ title: "Welcome back", description: "Redirecting to your dashboard…" });
    navigate(redirectTo, { replace: true });
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const emailParsed = EmailSchema.safeParse(email);
    const passParsed = PasswordSchema.safeParse(password);
    if (!emailParsed.success || !passParsed.success) {
      setFormError(
        emailParsed.success
          ? firstZodMessage(passParsed.error)
          : firstZodMessage(emailParsed.error),
      );
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailParsed.data.toLowerCase(),
        password,
      });
      if (error || !data.user) {
        const msg = mapAuthError(error?.message);
        setFormError(msg);
        toast({ title: "Sign in failed", description: msg, variant: "destructive" });
        await recordLoginEvent({
          email: emailParsed.data,
          event_type: "login_failure",
          reason: error?.message,
          risk_score: 50,
        });
        scoreAuthEvent({ event_type: "login_failed", email: emailParsed.data, method: "password" });
        return;
      }
      scoreAuthEvent({ event_type: "login", email: emailParsed.data, method: "password", user_id: data.user.id });
      await finalizeSignedInSession(data.user.id, emailParsed.data);
    } catch (err) {
      const msg = mapAuthError(err instanceof Error ? err.message : undefined);
      setFormError(msg);
      toast({ title: "Sign in failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const emailParsed = EmailSchema.safeParse(email);
    if (!emailParsed.success) {
      setFormError(firstZodMessage(emailParsed.error));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: emailParsed.data.toLowerCase(),
        options: {
          emailRedirectTo: `${window.location.origin}/corporate/login${
            redirectTo !== "/dashboard/corporate"
              ? `?redirect=${encodeURIComponent(redirectTo)}`
              : ""
          }`,
          data: fullName ? { full_name: fullName } : undefined,
          shouldCreateUser: true,
        },
      });
      if (error) {
        setFormError(error.message);
        toast({
          title: "Could not send magic link",
          description: error.message,
          variant: "destructive",
        });
        await recordLoginEvent({
          email: emailParsed.data,
          event_type: "login_failure",
          reason: `magic_link: ${error.message}`,
          risk_score: 30,
        });
        scoreAuthEvent({ event_type: "login_failed", email: emailParsed.data, method: "magic_link" });
        return;
      }
      scoreAuthEvent({ event_type: "login", email: emailParsed.data, method: "magic_link" });
      toast({
        title: "Check your email",
        description: `We sent a one-tap sign-in link to ${emailParsed.data}.`,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const emailParsed = EmailSchema.safeParse(email);
    const passParsed = PasswordSchema.safeParse(password);
    if (!emailParsed.success || !passParsed.success) {
      setFormError(
        emailParsed.success
          ? firstZodMessage(passParsed.error)
          : firstZodMessage(emailParsed.error),
      );
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: emailParsed.data.toLowerCase(),
        password,
        options: {
          data: { full_name: fullName, phone },
          emailRedirectTo: `${window.location.origin}/corporate/login`,
        },
      });
      if (error) {
        setFormError(error.message);
        toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
        scoreAuthEvent({ event_type: "login_failed", email: emailParsed.data, method: "signup" });
        return;
      }
      scoreAuthEvent({ event_type: "signup", email: emailParsed.data, method: "password" });
      toast({
        title: "Account created",
        description: "Check your inbox for a confirmation link, then sign in.",
      });
      setTab("signin");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setFormError(null);
    try {
      scoreAuthEvent({ event_type: "login", method: "google" });
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/corporate/login${
          redirectTo !== "/dashboard/corporate"
            ? `?redirect=${encodeURIComponent(redirectTo)}`
            : ""
        }`,
      });
      if (result.error) {
        const msg = String(result.error);
        setFormError(msg);
        toast({ title: "Google sign in failed", description: msg, variant: "destructive" });
        await recordLoginEvent({
          email: "(google)",
          event_type: "login_failure",
          reason: `google_oauth: ${msg}`,
          risk_score: 40,
        });
        scoreAuthEvent({ event_type: "login_failed", method: "google" });
        return;
      }
      if (result.redirected) return;
      // Popup flow: session already set, resolve role gating.
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        await finalizeSignedInSession(data.user.id, data.user.email ?? "(google)");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Google sign in failed";
      setFormError(msg);
      toast({ title: "Google sign in failed", description: msg, variant: "destructive" });
    }
  };

  const busy = loading || sessionChecking;
  const inputBase = "h-12 pl-10 bg-secondary/40 border-border/70 focus-visible:bg-background";

  return (
    <>
      <SeoHead
        path="/corporate/login"
        title="Corporate Login | Yalla Africa"
        description="Secure sign-in for Yalla Africa corporate mobility accounts."
      />
      <main className="min-h-screen bg-background">
        <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
          {/* Brand / Hero panel — desktop */}
          <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-primary text-primary-foreground">
            <img
              src={heroImage}
              alt="Business travelers walking through a modern airport terminal at sunrise"
              className="absolute inset-0 h-full w-full object-cover opacity-40"
              width={1280}
              height={1600}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--primary) / 0.92) 0%, hsl(var(--primary) / 0.75) 45%, hsl(var(--primary) / 0.55) 100%)",
              }}
              aria-hidden="true"
            />

            <div className="relative z-10 p-10">
              <Link to="/" className="inline-flex items-center gap-3 group">
                <BrandLogo
                  tone="light"
                  className="h-8 max-w-[168px] transition-transform group-hover:scale-105"
                />
                <div className="leading-tight border-l border-ice/25 pl-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-ice/70">
                    Corporate Portal
                  </div>
                </div>
              </Link>
            </div>

            <div className="relative z-10 px-10 pb-4 max-w-xl">
              <span className="inline-flex items-center gap-2 rounded-full bg-ice/10 backdrop-blur-sm border border-ice/20 px-3 py-1 text-xs font-medium">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Enterprise mobility, reimagined
              </span>
              <h1 className="mt-6 text-4xl xl:text-5xl font-bold leading-[1.1] tracking-tight">
                Transform your business travel with a modern corporate portal.
              </h1>
              <p className="mt-4 text-base xl:text-lg text-ice/80 max-w-lg">
                Streamline operations, control costs, and elevate employee experience through
                intelligent travel management technology.
              </p>

              <ul className="mt-8 space-y-3">
                {HIGHLIGHTS.map((h) => (
                  <li key={h} className="flex items-start gap-3 text-sm text-ice/90">
                    <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-status-success" aria-hidden="true" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative z-10 p-10 flex items-center gap-6 text-xs text-ice/70">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                SOC 2 · ISO 27001 aligned
              </div>
              <div className="h-3 w-px bg-ice/20" />
              <div>Trusted by organisations managing business mobility</div>
            </div>
          </aside>

          {/* Form panel */}
          <section className="relative flex items-center justify-center px-5 py-10 sm:px-10 sm:py-14 lg:px-16">
            {/* Mobile/tablet hero band */}
            <div className="lg:hidden absolute inset-x-0 top-0 h-56 sm:h-64 overflow-hidden">
              <img
                src={heroImage}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, hsl(var(--primary) / 0.85) 0%, hsl(var(--primary) / 0.65) 55%, hsl(var(--background)) 100%)",
                }}
                aria-hidden="true"
              />
              <div className="relative z-10 flex items-center justify-between px-5 sm:px-10 pt-6">
                <Link to="/" className="inline-flex items-center gap-3 text-primary-foreground">
                  <BrandLogo tone="light" className="h-7 max-w-[148px]" />
                  <div className="leading-tight border-l border-ice/25 pl-3">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-ice/80">
                      Corporate Portal
                    </div>
                  </div>
                </Link>
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-ice/15 backdrop-blur-sm border border-ice/25 px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
                  <ShieldCheck className="h-3 w-3" /> Secure sign-in
                </span>
              </div>
            </div>

            <div className="relative z-10 w-full max-w-md mt-40 sm:mt-48 lg:mt-0 rounded-2xl bg-card/95 backdrop-blur-sm border border-border/60 shadow-elegant p-6 sm:p-8 lg:bg-transparent lg:border-0 lg:shadow-none lg:p-0 lg:backdrop-blur-0">
              <div className="space-y-2">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  Access your corporate account
                </h2>
                <p className="text-sm text-muted-foreground">
                  Sign in to manage your organization's mobility, spend and compliance.
                </p>
              </div>

              {formError && (
                <Alert variant="destructive" className="mt-6" role="alert">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Sign in issue</AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}

              <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-8">
                <TabsList className="grid w-full grid-cols-3 h-11 p-1 bg-secondary/60">
                  <TabsTrigger value="magic" className="text-xs sm:text-sm">Magic link</TabsTrigger>
                  <TabsTrigger value="signin" className="text-xs sm:text-sm">Password</TabsTrigger>
                  <TabsTrigger value="signup" className="text-xs sm:text-sm">Sign up</TabsTrigger>
                </TabsList>

                <TabsContent value="magic" className="mt-6">
                  <form onSubmit={handleMagicLink} className="space-y-5" noValidate>
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground flex gap-2">
                      <Sparkle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      Enter your work email — we'll send a one-tap sign-in link. No password required.
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="magic-name">Full name (optional)</Label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="magic-name"
                          placeholder="Jane Wanjiku"
                          value={fullName}
                          onChange={(e) => {
                            setFullName(e.target.value);
                            clearFormError();
                          }}
                          className={inputBase}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="magic-email">Work email</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="magic-email"
                          type="email"
                          required
                          placeholder="you@company.com"
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            clearFormError();
                          }}
                          className={inputBase}
                        />
                      </div>
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-12 text-base font-semibold shadow-elegant group"
                      disabled={busy || !email}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending link…
                        </>
                      ) : (
                        <>
                          Send magic link
                          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signin" className="mt-6">
                  <form onSubmit={handlePasswordSignIn} className="space-y-5" noValidate>
                    <div className="space-y-2">
                      <Label htmlFor="signin-email">Work email</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="signin-email"
                          type="email"
                          autoComplete="email"
                          required
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            clearFormError();
                          }}
                          className={inputBase}
                          placeholder="you@company.com"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="signin-password">Password</Label>
                        <Link
                          to="/reset-password"
                          className="text-xs font-medium text-primary hover:underline underline-offset-4"
                        >
                          Forgot password?
                        </Link>
                      </div>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="signin-password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          required
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            clearFormError();
                          }}
                          className={cn(inputBase, "pr-11")}
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-12 text-base font-semibold shadow-elegant group"
                      disabled={busy}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Signing you in…
                        </>
                      ) : sessionChecking ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Checking session…
                        </>
                      ) : (
                        <>
                          Sign in securely
                          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="signup" className="mt-6">
                  <form onSubmit={handleSignUp} className="space-y-5" noValidate>
                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Full name</Label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="signup-name"
                          required
                          value={fullName}
                          onChange={(e) => {
                            setFullName(e.target.value);
                            clearFormError();
                          }}
                          className={inputBase}
                          placeholder="Jane Wanjiku"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-phone">Phone</Label>
                      <div className="relative">
                        <Phone className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="signup-phone"
                          placeholder="0712345678"
                          value={phone}
                          onChange={(e) => {
                            setPhone(e.target.value);
                            clearFormError();
                          }}
                          className={inputBase}
                          inputMode="tel"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Work email</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="signup-email"
                          type="email"
                          required
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            clearFormError();
                          }}
                          className={inputBase}
                          placeholder="you@company.com"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="signup-password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          required
                          minLength={8}
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            clearFormError();
                          }}
                          className={cn(inputBase, "pr-11")}
                          placeholder="At least 8 characters"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-12 text-base font-semibold shadow-elegant group"
                      disabled={busy}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating account…
                        </>
                      ) : (
                        <>
                          Create account
                          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>

              <div className="mt-6">
                <div className="relative flex items-center">
                  <Separator className="flex-1" />
                  <span className="px-3 text-xs text-muted-foreground uppercase tracking-wider">
                    or
                  </span>
                  <Separator className="flex-1" />
                </div>
                <Button
                  variant="outline"
                  className="w-full h-12 mt-4 font-medium"
                  onClick={handleGoogle}
                  disabled={busy}
                  type="button"
                >
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Continue with Google
                </Button>
              </div>

              <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                Protected by enterprise SSO-ready security & audit logging.
              </div>

              <div className="mt-6 pt-6 border-t border-border/60 text-sm text-muted-foreground text-center">
                New to Yalla for Business?{" "}
                <Link
                  to="/corporate/register"
                  className="font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Create a corporate account
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
