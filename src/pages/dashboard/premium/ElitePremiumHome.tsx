/**
 * Elite Premium tier cockpit.
 *
 * Summarises tier status, the KPIs an elite operator is accountable for, and
 * the next recommended actions. Data is drawn from the existing charter
 * services (bookings + corporate wallets) — no new backend surface.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight, Crown, Wallet, FileCheck2, Gauge, Building2, ShieldCheck, Sparkles,
} from "lucide-react";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useAuth } from "@/hooks/useAuth";
import { charterApi, type CharterBookingRow, type CorporateWalletRow } from "@/lib/charter/api";

const money = (n: number) => `KSh ${Math.round(n || 0).toLocaleString("en-KE")}`;

const NEXT_ACTIONS = [
  {
    label: "Clear the quotation approvals queue",
    to: "/dashboard/admin/ccb-operations?tab=approvals",
    why: "Unapproved quotations block settlement and delay mission release.",
  },
  {
    label: "Review today's bookings and operator assignments",
    to: "/dashboard/admin/ccb-operations?tab=today",
    why: "Confirm every mission departing today has an operator and asset.",
  },
  {
    label: "Fund or reconcile corporate wallets",
    to: "/dashboard/corporate-charter?tab=wallets",
    why: "Pre-funded balances keep corporate missions settling without STK prompts.",
  },
  {
    label: "Verify pricing governance is current",
    to: "/dashboard/corporate-charter?tab=policies",
    why: "Rate cards and surcharge rules should be re-attested each period.",
  },
];

export default function ElitePremiumHome() {
  const { user } = useAuth();
  const { tier, label, blurb, isElite } = useEntitlements();
  const [bookings, setBookings] = useState<CharterBookingRow[]>([]);
  const [wallets, setWallets] = useState<CorporateWalletRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([charterApi.listBookings(), charterApi.listCorporateWallets()])
      .then(([b, w]) => {
        if (!alive) return;
        if (b.status === "fulfilled") setBookings(b.value);
        if (w.status === "fulfilled") setWallets(w.value.wallets);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const kpis = useMemo(() => {
    const committed = bookings.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const unpaid = bookings.filter((b) => !["paid", "completed", "cancelled"].includes(b.payment_status));
    const balance = wallets.reduce((s, w) => s + (Number(w.balance_kes) || 0), 0);
    const settledPct = bookings.length
      ? Math.round(((bookings.length - unpaid.length) / bookings.length) * 100)
      : 0;
    return { committed, unpaid: unpaid.length, balance, settledPct, missions: bookings.length };
  }, [bookings, wallets]);

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/12 via-card to-primary-glow/10 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Tier cockpit</p>
        <h1 className="mt-2 flex items-center gap-2 text-2xl md:text-3xl font-bold tracking-tight">
          <Crown className="h-6 w-6 text-primary" aria-hidden />
          {label}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{blurb}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Tier: {tier}</Badge>
          {isElite && <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">All premium sections unlocked</Badge>}
          <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
        </div>
      </header>

      <section aria-label="Tier KPIs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Building2} label="Charter missions" value={loading ? null : String(kpis.missions)} />
        <Kpi icon={FileCheck2} label="Awaiting settlement" value={loading ? null : String(kpis.unpaid)} />
        <Kpi icon={Gauge} label="Committed value" value={loading ? null : money(kpis.committed)} />
        <Kpi icon={Wallet} label="Wallet balance" value={loading ? null : money(kpis.balance)} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Settlement health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={kpis.settledPct} aria-label="Share of missions settled" />
          <p className="text-sm text-muted-foreground">
            {kpis.settledPct}% of charter missions are fully settled.
            {kpis.unpaid > 0 && ` ${kpis.unpaid} still need a payment route or approval.`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Next recommended actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {NEXT_ACTIONS.map((a) => (
            <div key={a.to} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border p-4">
              <div className="min-w-0">
                <p className="font-medium">{a.label}</p>
                <p className="text-sm text-muted-foreground">{a.why}</p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={a.to}>Open<ArrowRight className="ml-2 h-4 w-4" aria-hidden /></Link>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
            Premium sections available to you
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {[
            { to: "/dashboard/corporate-charter", label: "Corporate Charter Business workspace" },
            { to: "/dashboard/corporate-charter?tab=booking", label: "Enterprise Booking Centre" },
            { to: "/dashboard/admin/ccb-operations", label: "CCB Operations Centre" },
            { to: "/dashboard/corporate-charter?tab=reports", label: "Reports & analytics" },
          ].map((l) => (
            <Button key={l.to} asChild variant="secondary" className="justify-between">
              <Link to={l.to}>{l.label}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value,
}: { icon: typeof Wallet; label: string; value: string | null }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </div>
        {value === null ? (
          <Skeleton className="mt-2 h-7 w-24" />
        ) : (
          <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}
