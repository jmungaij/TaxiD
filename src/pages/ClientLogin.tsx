/**
 * TaxiD client sign-in.
 *
 * The way a real corporate customer contact reaches their own account: a
 * one-tap email link, a password, or Google. Once signed in they land on My
 * Account, where their proformas, invoices and receipts are assembled by the
 * database under their own identity.
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
  AlertCircle, ArrowRight, Building2, Eye, EyeOff, FileText, Loader2, Lock, Mail, ShieldCheck, User,
} from "lucide-react";
import { SeoHead } from "@/components/seo/SeoHead";
import { firstZodMessage } from "@/lib/zod/normalizeZodError";
import { recordLoginEvent as recordLoginEventServerSide } from "@/lib/security/loginTelemetry";

const HIGHLIGHTS = [
  "Your quotations, proformas, invoices and receipts in one place",
  "Confirm receipt of a document — the confirmation is permanent",
  "Live balance, due date and payment instructions on every invoice",
  "Service schedules and agreements as they are recorded",
];

const EmailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address")
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
  if (m.includes("network") || m.includes("fetch")) return "Network error. Check your connection and retry.";
  return message || "We couldn't sign you in. Please try again.";
}

export default function ClientLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get("redirect") || "/dashboard/my-account";

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
    return () => {
      cancelled = true;
    };
  }, [navigate, redirectTo]);

  const callbackUrl = `${window.location.origin}/clients/login${
    redirectTo !== "/dashboard/my-account" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""
  }`;

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const emailParsed = EmailSchema.safeParse(email);
    const passParsed = PasswordSchema.safeParse(password);
    if (!emailParsed.success || !passParsed.success) {
      setFormError(
        emailParsed.success ? firstZodMessage(passParsed.error!) : firstZodMessage(emailParsed.error),
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
        await recordLoginEventServerSide({
          email: emailParsed.data,
          event_type: "login_failure",
          reason: error?.message,
          surface: "client_login",
        });
        return;
      }
      await recordLoginEventServerSide({
        email: emailParsed.data,
        event_type: "login_success",
        surface: "client_login",
      });
      toast({ title: "Welcome back", description: "Opening your account…" });
      navigate(redirectTo, { replace: true });
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
        options: { emailRedirectTo: callbackUrl, shouldCreateUser: true },
      });
      if (error) {
        setFormError(error.message);
        toast({ title: "Could not send sign-in link", description: error.message, variant: "destructive" });
        return;
      }
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
        emailParsed.success ? firstZodMessage(passParsed.error!) : firstZodMessage(emailParsed.error),
      );
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
      toast({ title: "Account created", description: "Check your inbox to confirm, then sign in." });
      setTab("signin");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setFormError(null);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: callbackUrl });
    if (result.error) {
      const msg = String(result.error);
      setFormError(msg);
      toast({ title: "Google sign in failed", description: msg, variant: "destructive" });
      return;
    }
    if (result.redirected) return;
    const { data } = await supabase.auth.getUser();
    if (data.user) navigate(redirectTo, { replace: true });
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
        title="Client Sign In — TaxiD Account & Invoices"
        description="Sign in to your TaxiD client account to view quotations, proforma invoices, tax invoices and payment receipts, and confirm receipt of documents."
        path="/clients/login"
      />
      <main className="min-h-screen grid lg:grid-cols-2 bg-background">
        <section className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 bg-gradient-to-br from-primary/90 via-primary to-primary/70 text-primary-foreground">
          <div className="absolute inset-0 opacity-20 [background:radial-gradient(circle_at_20%_20%,white,transparent_45%),radial-gradient(circle_at_80%_70%,white,transparent_40%)]" />
          <div className="relative">
            <div className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
              <Building2 className="h-5 w-5" /> TaxiD
            </div>
            <h1 className="mt-10 text-4xl font-bold leading-tight max-w-md">
              Your account, your documents, your balances.
            </h1>
            <p className="mt-4 max-w-md text-primary-foreground/80">
              Everything we have issued to your company, exactly as it was issued.
            </p>
            <ul className="mt-10 space-y-3">
              {HIGHLIGHTS.map((h) => (
                <li key={h} className="flex items-start gap-3 text-sm text-primary-foreground/90">
                  <FileText className="h-4 w-4 mt-0.5 shrink-0" /> {h}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative flex items-center gap-2 text-xs text-primary-foreground/70">
            <ShieldCheck className="h-4 w-4" /> Every sign-in is recorded. You only ever see your own company's records.
          </p>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-md space-y-6">
            <div className="lg:hidden flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
              <Building2 className="h-5 w-5" /> TaxiD
            </div>
            <div>
              <h2 className="text-2xl font-bold">Client sign in</h2>
              <p className="text-sm text-muted-foreground">
                For company contacts we invoice. Use the email address your documents are addressed to.
              </p>
            </div>

            {formError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Something went wrong</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Tabs
              value={tab}
              onValueChange={(v) => {
                setTab(v as typeof tab);
                setFormError(null);
              }}
            >
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="magic">Email link</TabsTrigger>
                <TabsTrigger value="signin">Password</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>

              <TabsContent value="magic">
                <form onSubmit={handleMagicLink} className="space-y-4 pt-4">
                  <Field icon={Mail} label="Work email" id="client-magic-email">
                    <Input
                      id="client-magic-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.co.ke"
                      required
                    />
                  </Field>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Send sign-in link <ArrowRight className="h-4 w-4 ml-1" />
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signin">
                <form onSubmit={handlePasswordSignIn} className="space-y-4 pt-4">
                  <Field icon={Mail} label="Work email" id="client-signin-email">
                    <Input
                      id="client-signin-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.co.ke"
                      required
                    />
                  </Field>
                  <Field icon={Lock} label="Password" id="client-signin-password">
                    <div className="relative">
                      <Input
                        id="client-signin-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((s) => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      >
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
                  <Field icon={User} label="Full name" id="client-signup-name">
                    <Input
                      id="client-signup-name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Grace Wanjiru"
                      autoComplete="name"
                    />
                  </Field>
                  <Field icon={Mail} label="Work email" id="client-signup-email">
                    <Input
                      id="client-signup-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.co.ke"
                      required
                    />
                  </Field>
                  <Field icon={Lock} label="Password" id="client-signup-password">
                    <Input
                      id="client-signup-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </Field>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            <Button variant="outline" className="w-full" onClick={handleGoogle}>
              Continue with Google
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Managing a corporate travel programme?{" "}
              <Link to="/corporate/login" className="underline">
                Corporate portal
              </Link>
              {" · "}
              <Link to="/contact" className="underline">
                Talk to us
              </Link>
            </p>
          </div>
        </section>
      </main>
    </>
  );
}

function Field({
  icon: Icon,
  label,
  id,
  children,
}: {
  icon: typeof Mail;
  label: string;
  id: string;
  children: React.ReactNode;
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
