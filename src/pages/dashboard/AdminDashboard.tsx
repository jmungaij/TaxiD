import { useAuth } from "@/hooks/useAuth";
import { Shield, Users, CreditCard, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ users: 0, wallets: 0, mpesa: 0, roles: 0 });
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("wallets").select("id", { count: "exact", head: true }),
      supabase.from("mpesa_transactions").select("id", { count: "exact", head: true }),
      supabase.from("user_roles").select("id", { count: "exact", head: true }),
    ]).then(([profiles, wallets, mpesa, roles]) => {
      // A failed count must never render as a confident "0" on the admin overview.
      const firstError = [profiles, wallets, mpesa, roles].find((r) => r.error)?.error;
      setStatsError(firstError ? firstError.message : null);
      setStats({
        users: profiles.count || 0,
        wallets: wallets.count || 0,
        mpesa: mpesa.count || 0,
        roles: roles.count || 0,
      });
    });
  }, [user]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
      </div>

      {statsError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Platform counters failed to load — the figures below are not authoritative. {statsError}
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Users</span>
            <Users className="h-5 w-5 text-primary" />
          </div>
          <p className="text-2xl font-bold mt-2">{stats.users}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Wallets</span>
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <p className="text-2xl font-bold mt-2">{stats.wallets}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">M-Pesa TXNs</span>
            <CreditCard className="h-5 w-5 text-status-success" />
          </div>
          <p className="text-2xl font-bold mt-2">{stats.mpesa}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Role Assignments</span>
            <Shield className="h-5 w-5 text-status-warning" />
          </div>
          <p className="text-2xl font-bold mt-2">{stats.roles}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="font-semibold mb-4">System Overview</h2>
        <p className="text-sm text-muted-foreground">
          Manage accounts in the <a className="underline" href="/dashboard/admin/users">Users Directory</a>, titles in
          {" "}<a className="underline" href="/dashboard/admin/roles">Staff &amp; Roles</a>, and payments from the Finance workspace.
        </p>
      </div>
    </div>
  );
}
