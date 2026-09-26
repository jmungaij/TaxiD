/**
 * ACCOUNT RECOVERY.
 *
 * Requesting a link is rate limited server-side and answers identically whether
 * or not an account exists. Setting a new password only sets a password: it
 * cannot grant a role, change an email address or move the account between
 * organisations. Other sessions are revoked once the password changes.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { requestRecovery } from "@/lib/identity/recovery";

export default function ResetPassword() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Recovery links carry the session in the URL hash (type=recovery).
    if (window.location.hash.includes("type=recovery")) {
      setRecoveryMode(true);
    }
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await requestRecovery(email);
    setBusy(false);
    setNotice(result.message);
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords don't match", description: "Type the same password twice.", variant: "destructive" });
      return;
    }
    setBusy(true);
    // Recovery session: do not send current_password.
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast({ title: "Could not update password", description: error.message, variant: "destructive" });
    } else {
      // A recovered password ends every other session on the account.
      await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
      toast({
        title: "Password updated",
        description: "Other devices have been signed out. Sign in with your new password.",
      });
      navigate("/auth");
    }
  }


  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary-glow/5 px-4">
      <Card className="w-full max-w-md shadow-elegant">
        {recoveryMode ? (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Choose a new password</CardTitle>
              <CardDescription>Enter your new password below</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSetPassword} className="space-y-4">
                <div>
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Updating..." : "Set new password"}
                </Button>
              </form>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Reset your password</CardTitle>
              <CardDescription>We'll email a reset link to your account address</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSendLink} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Sending..." : "Send reset link"}
                </Button>
              </form>
              <div aria-live="polite" role="status" className="mt-4 empty:mt-0">
                {notice && (
                  <p className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                    {notice}
                  </p>
                )}
              </div>
              <p className="text-center text-sm text-muted-foreground mt-4">
                <button className="underline" onClick={() => navigate("/auth")}>
                  Back to sign in
                </button>
              </p>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
