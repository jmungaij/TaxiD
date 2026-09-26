/**
 * Yalla Air client portal sign-in.
 *
 * Serves charter and leasing customers plus flight operators. Built on the same
 * authentication primitives, forensic login recording and risk scoring as the
 * corporate portal so every Yalla Mobility surface enforces one standard.
 */
import { useEffect, useState } from "react";
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
  AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, Plane, ShieldCheck, Sparkles, User,
} from "lucide-react";
import { SeoHead } from "@/components/seo/SeoHead";
import { scoreAuthEvent } from "@/lib/authRiskScore";
import { firstZodMessage } from "@/lib/zod/normalizeZodError";
import { recordLoginEvent as recordLoginEventServerSide, type LoginEventType } from "@/lib/security/loginTelemetry";

const HIGHLIGHTS = [
  "Live flight status, crew and aircraft assignment",
  "Generated pricing — every quote traced to a published version",
  "Empty-leg alerts with regulated 20–60% savings",
  "Governed cancellation, refund and settlement terms",
];

const EmailSchema = z.string().trim().min(1, "Email is required").email("Enter a valid email address").max(255, "Email is too long");
const PasswordSchema = z.string().min(8, "Password must be at least 8 characters").max(128, "Password is too long");

function mapAuthError(message?: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "The email or password you entered is incorrect.";
  if (m.includes("email not confirmed")) return "Please confirm your email before signing in.";
  if (m.includes("rate") || m.includes("too many")) return "Too many attempts. Please wait a moment and try again.";
  if (m.includes("network") || m.includes("fetch")) return "Network error. Check your connection and retry.";
  return message || "We couldn't sign you in. Please try again.";
}

/** Hash-chained forensic record of every portal login attempt. */
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
  await recordLoginEventServerSide({ email, event_type, reason, surface: "charter_login" });
}

export default function CharterLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get("redirect") || "/charter/booking-status";

  const [tab, setTab] = useState<"magic" | "signin" | "signup">("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) navigate(redirectTo, { replace: true });
      else setSessionChecking(false);
    });
    return () => { cancelled = true; };
  }, [navigate, redirectTo]);

  const callbackUrl = `${window.location.origin}/charter/login${
    redirectTo !== "/charter/booking-status" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""
  }`;

  const finalize = async (userId: string, userEmail: string) => {
    await recordLoginEvent({ email: userEmail, event_type: "login_success", user_id: userId });
    toast({ title: "Welcome to Yalla Air", description: "Taking you to your flights…" });
    navigate(redirectTo, { replace: true });
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const emailParsed = EmailSchema.safeParse(email);
    const passParsed = PasswordSchema.safeParse(password);
    if (!emailParsed.success || !passParsed.success) {
      setFormError(emailParsed.success ? firstZodMessage(passParsed.error!) : firstZodMessage(emailParsed.error));
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailParsed.data.toLowerCase(), password,
      });
      if (error || !data.user) {
        const msg = mapAuthError(error?.message);
        setFormError(msg);
        toast({ title: "Sign in failed", description: msg, variant: "destructive" });
        await recordLoginEvent({ email: emailParsed.data, event_type: "login_failure", reason: error?.message, risk_score: 50 });
        scoreAuthEvent({ event_type: "login_failed", email: emailParsed.data, method: "password" });
        return;
      }
      scoreAuthEvent({ event_type: "login", email: emailParsed.data, method: "password", user_id: data.user.id });
      await finalize(data.user.id, emailParsed.data);
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const emailParsed = EmailSchema.safeParse(email);
    if (!emailParsed.success) return setFormError(firstZodMessage(emailParsed.error));
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: emailParsed.data.toLowerCase(),
        options: {
          emailRedirectTo: callbackUrl,
          data: fullName ? { full_name: fullName } : undefined,
          shouldCreateUser: true,
        },
      });
      if (error) {
        setFormError(error.message);
        toast({ title: "Could not send sign-in link", description: error.message, variant: "destructive" });
        scoreAuthEvent({ event_type: "login_failed", email: emailParsed.data, method: "magic_link" });
        return;
      }
      scoreAuthEvent({ event_type: "login", email: emailParsed.data, method: "magic_link" });
      toast({ title: "Check your email", description: `We sent a one-tap sign-in link to ${emailParsed.data}.` });
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
      setFormError(emailParsed.success ? firstZodMessage(passParsed.error!) : firstZodMessage(emailParsed.error));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: emailParsed.data.toLowerCase(),
        password,
        options: { data: { full_name: fullName }, emailRedirectTo: callbackUrl },
      });
      if (error) {
        setFormError(error.message);
        toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
        return;
      }
      scoreAuthEvent({ event_type: "signup", email: emailParsed.data, method: "password" });
      toast({ title: "Account created", description: "Check your inbox to confirm, then sign in." });
      setTab("signin");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setFormError(null);
    scoreAuthEvent({ event_type: "login", method: "google" });
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: callbackUrl });
    if (result.error) {
      const msg = String(result.error);
      setFormError(msg);
      toast({ title: "Google sign in failed", description: msg, variant: "destructive" });
      await recordLoginEvent({ email: "(google)", event_type: "login_failure", reason: `google_oauth: ${msg}`, risk_score: 40 });
      return;
    }
    if (result.redirected) return;
    const { data } = await supabase.auth.getUser();
    if (data.user) await finalize(data.user.id, data.user.email ?? "(google)");
  };

  if (sessionChecking) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <SeoHead
        title="Yalla Air Client Portal — Charter & Leasing Sign In"
        description="Sign in to the Yalla Air client portal to manage private charter and aircraft leasing bookings, live flight status, quotes and settlement."
        path="/charter/login"
      />
      <main className="min-h-screen grid lg:grid-cols-2 bg-background">
        {/* Brand panel */}
        <section className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 bg-gradient-to-br from-primary/90 via-primary to-primary/70 text-primary-foreground">
          <div className="absolute inset-0 opacity-20 [background:radial-gradient(circle_at_20%_20%,white,transparent_45%),radial-gradient(circle_at_80%_70%,white,transparent_40%)]" />
          <div className="relative">
            <div className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
              <Plane className="h-5 w-5" /> Yalla Air
            </div>
            <h1 className="mt-10 text-4xl font-bold leading-tight max-w-md">
              Private aviation, operated with enterprise discipline.
            </h1>
            <p className="mt-4 max-w-md text-primary-foreground/80">
              One portal for charter and leasing clients — every quote generated, every price versioned, every flight tracked.
            </p>
            <ul className="mt-10 space-y-3">
              {HIGHLIGHTS.map((h) => (
                <li key={h} className="flex items-start gap-3 text-sm text-primary-foreground/90">
                  <Sparkles className="h-4 w-4 mt-0.5 shrink-0" /> {h}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative flex items-center gap-2 text-xs text-primary-foreground/70">
            <ShieldCheck className="h-4 w-4" /> Forensic login auditing and adaptive risk scoring on every attempt.
          </p>
        </section>

        {/* Auth panel */}
        <section className="flex items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-md space-y-6">
            <div className="lg:hidden flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
              <Plane className="h-5 w-5" /> Yalla Air
            </div>
            <div>
              <h2 className="text-2xl font-bold">Client portal</h2>
              <p className="text-sm text-muted-foreground">
                Charter and leasing customers, operators and flight partners.
              </p>
            </div>

            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Something went wrong</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setFormError(null); }}>
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="magic">Magic link</TabsTrigger>
                <TabsTrigger value="signin">Password</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>

              <TabsContent value="magic">
                <form onSubmit={handleMagicLink} className="space-y-4 pt-4">
                  <Field icon={Mail} label="Email" id="magic-email">
                    <Input id="magic-email" type="email" autoComplete="email" value={email}
                      onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
                  </Field>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Send sign-in link <ArrowRight className="h-4 w-4 ml-1" /></>}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signin">
                <form onSubmit={handlePasswordSignIn} className="space-y-4 pt-4">
                  <Field icon={Mail} label="Email" id="signin-email">
                    <Input id="signin-email" type="email" autoComplete="email" value={email}
                      onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
                  </Field>
                  <Field icon={Lock} label="Password" id="signin-password">
                    <div className="relative">
                      <Input id="signin-password" type={showPassword ? "text" : "password"} autoComplete="current-password"
                        value={password} onChange={(e) => setPassword(e.target.value)} required />
                      <button type="button" aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((s) => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4 pt-4">
                  <Field icon={User} label="Full name" id="signup-name">
                    <Input id="signup-name" value={fullName} onChange={(e) => setFullName(e.target.value)}
                      placeholder="Amina Otieno" autoComplete="name" />
                  </Field>
                  <Field icon={Mail} label="Email" id="signup-email">
                    <Input id="signup-email" type="email" autoComplete="email" value={email}
                      onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
                  </Field>
                  <Field icon={Lock} label="Password" id="signup-password">
                    <Input id="signup-password" type="password" autoComplete="new-password" value={password}
                      onChange={(e) => setPassword(e.target.value)} required />
                  </Field>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="flex items-center gap-3">
              <Separator className="flex-1" /><span className="text-xs text-muted-foreground">or</span><Separator className="flex-1" />
            </div>

            <Button variant="outline" className="w-full" onClick={handleGoogle}>Continue with Google</Button>

            <p className="text-xs text-muted-foreground text-center">
              Looking for corporate mobility? <Link to="/corporate/login" className="underline">Corporate portal</Link>
              {" · "}
              <Link to="/charter" className="underline">Browse aircraft</Link>
            </p>
          </div>
        </section>
      </main>
    </>
  );
}

function Field({ icon: Icon, label, id, children }: {
  icon: typeof Mail; label: string; id: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {label}
      </Label>
      {children}
    </div>
  );
}
