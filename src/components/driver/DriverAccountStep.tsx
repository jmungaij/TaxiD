/**
 * DRIVER ACCOUNT STEP.
 * Self-service sign-up / sign-in for the driver onboarding portal. Nothing is
 * simulated: this talks to the real auth service. With email confirmation on,
 * a new driver is NOT signed in until they click the link in their inbox.
 */
import * as React from "react";
import { CheckCircle2, Mail } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

const schema = z.object({
  email: z.string().trim().email({ message: "Enter a valid email address" }).max(255),
  password: z.string().min(8, { message: "Use at least 8 characters" }).max(72),
  fullName: z.string().trim().max(120).optional(),
});

export default function DriverAccountStep({ user }: { user: User | null }) {
  const [mode, setMode] = React.useState<"signup" | "signin">("signup");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [checkInbox, setCheckInbox] = React.useState(false);

  if (user) {
    return (
      <Card className="border-primary/30">
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <CardTitle className="text-base">Your account is ready</CardTitle>
            <CardDescription>Signed in as {user.email}</CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }

  if (checkInbox) {
    return (
      <Card className="border-primary/30">
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <Mail className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <CardTitle className="text-base">Check your email</CardTitle>
            <CardDescription>
              We sent a confirmation link to {email}. Open it to finish creating your account, then come back
              to this page to add your payout number.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }

  const submit = async () => {
    const parsed = schema.safeParse({ email, password, fullName });
    if (!parsed.success) {
      toast({ title: "Check your details", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: `${window.location.origin}/driver/start`,
            data: fullName.trim() ? { full_name: fullName.trim() } : undefined,
          },
        });
        if (error) throw error;
        if (!data.session) setCheckInbox(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (error) throw error;
        toast({ title: "Welcome back" });
      }
    } catch (e) {
      toast({
        title: mode === "signup" ? "Could not create the account" : "Could not sign in",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {mode === "signup" ? "Create your driver account" : "Sign in to continue"}
        </CardTitle>
        <CardDescription>
          {mode === "signup"
            ? "Your email and a password. This is the account you will use for trips, earnings and payouts."
            : "Use the email and password you signed up with."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === "signup" && (
          <div className="space-y-1">
            <Label htmlFor="ds-name">Your full name</Label>
            <Input id="ds-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ds-email">Email</Label>
            <Input
              id="ds-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ds-password">Password</Label>
            <Input
              id="ds-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create my account" : "Sign in"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            disabled={busy}
          >
            {mode === "signup" ? "I already have an account" : "I need to create an account"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
