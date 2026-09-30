import { useAuth } from "@/hooks/useAuth";
import { Shield, Users, CreditCard, Wallet, ArrowUpRight, Headphones, Activity, FileSearch, Car, Building2, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function AdminDashboard() {
  const { user, isSuperAdmin } = useAuth();
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
        <div><h1 className="text-2xl font-bold">{isSuperAdmin ? "Super Admin Control Centre" : "Admin Dashboard"}</h1>
          {isSuperAdmin && <p className="text-sm text-muted-foreground">Govern people, operations, payments and platform assurance from one place.</p>}</div>
      </div>

      {isSuperAdmin && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { to: "/dashboard/admin/roles", title: "Staff & access", text: "Grant or revoke roles with an audit trail", icon: Shield },
          { to: "/dashboard/admin/users", title: "Users directory", text: "Find and review rider accounts", icon: Users },
          { to: "/agent", title: "Assigned cases", text: "Open your own rider conversations", icon: Headphones },
          { to: "/dashboard/admin/security-audit", title: "Security audit", text: "Investigate access and security activity", icon: FileSearch },
          { to: "/dashboard/admin/observability", title: "Platform health", text: "Review operational events and alerts", icon: Activity },
          { to: "/dashboard/admin/mpesa-payments", title: "Payments", text: "Monitor M-Pesa transactions", icon: CreditCard },
          { to: "/dashboard/admin/role-grant-governance", title: "Role governance", text: "Review privileged execution grants", icon: Shield },
          { to: "/dashboard/admin/export-audit-trail", title: "Export audit", text: "Review data exports and accountability", icon: FileSearch },
        ].map(({ to, title, text, icon: Icon }) => <Link key={to} to={to} className="group rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent">
          <div className="flex items-center justify-between"><Icon className="h-5 w-5 text-primary" /><ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" /></div>
          <h2 className="mt-3 font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{text}</p>
        </Link>)}
      </div>}

      {isSuperAdmin && (
        <section aria-label="Your TaxiD portals" className="space-y-3">
          <h2 className="text-lg font-semibold">Your TaxiD portals</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { to: "/rider", title: "Rider", icon: UserRound },
              { to: "/driver/workspace", title: "Driver", icon: Car },
              { to: "/business/portal", title: "Power Business", icon: Building2 },
              { to: "/staff/workspace", title: "Staff 360", icon: Shield },
            ].map(({ to, title, icon: Icon }) => (
              <Link key={to} to={to} className="flex items-center gap-3 rounded-md border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent">
                <Icon className="h-5 w-5 text-primary" aria-hidden />
                <span className="font-medium">{title}</span>
                <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">Each portal shows records linked to your own account. Driver and business features require the corresponding account setup.</p>
        </section>
      )}

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
