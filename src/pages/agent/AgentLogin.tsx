import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRAND } from "@/config/brand";

const STAFF = ["support", "admin", "super_admin"];

function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/agent";
}

/** Separate sign-in for TaxiD support agents. Riders are turned away. */
export default function AgentLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (err || !data.user) { setBusy(false); setError(err?.message ?? "Sign in failed"); return; }
    const { data: rows } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    const isStaff = (rows ?? []).some((r: { role: string }) => STAFF.includes(r.role));
    if (!isStaff) {
      await supabase.auth.signOut();
      setBusy(false);
      setError("This portal is for TaxiD support agents only. Riders can sign in from the main app.");
      return;
    }
    navigate(safeNext(params.get("next")), { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{BRAND.name} Agent Portal</p>
          <h1 className="mt-1 text-2xl font-bold">Agent sign-in</h1>
          <p className="text-sm text-muted-foreground">Sign in to handle rider cases assigned to you.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-email">Work email</Label>
          <Input id="agent-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-password">Password</Label>
          <Input id="agent-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </main>
  );
}
