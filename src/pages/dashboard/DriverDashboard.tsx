import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  Wallet, TrendingUp, Briefcase, PiggyBank, Car, Receipt,
  Shield, GraduationCap, Award, Activity, AlertTriangle,
  Star, Clock, ArrowUpRight, Target, FileCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { TopUpDialog } from "@/components/dashboard/TopUpDialog";
import { supabase } from "@/integrations/supabase/client";
import { AppLink } from "@/components/nav/AppLink";
import { DriverDutyPanel } from "@/components/driver/DriverDutyPanel";

/**
 * Driver Command Center — every figure here is read from the database.
 * When a source has no data yet the tile shows "—" rather than an invented value.
 */

type Tile = { label: string; value: string; sub?: string; icon: typeof Wallet; href?: string };
type Category = {
  key: string;
  title: string;
  subtitle: string;
  icon: typeof Wallet;
  accent: string;
  tiles: Tile[];
};

interface Snapshot {
  balanceCents: number;
  walletId: string;
  todayCents: number;
  todayTrips: number;
  weekCents: number;
  prevWeekCents: number;
  lifetimeCents: number;
  tripsCompleted: number;
  rating: number | null;
  onlineMinutes: number;
  docsVerified: number;
  docsPending: number;
  docsTotal: number;
  nextExpiry: string | null;
  complianceScore: number | null;
  complianceStatus: string | null;
  openIncidents: number;
  coursesDone: number;
  coursesTotal: number;
  certifications: number;
  plate: string | null;
  pendingPayoutCents: number;
  lastPayoutStatus: string | null;
  savingsCents: number;
  weeklyGoalCents: number;
}

const EMPTY: Snapshot = {
  balanceCents: 0, walletId: "", todayCents: 0, todayTrips: 0, weekCents: 0, prevWeekCents: 0,
  lifetimeCents: 0, tripsCompleted: 0, rating: null, onlineMinutes: 0,
  docsVerified: 0, docsPending: 0, docsTotal: 0, nextExpiry: null,
  complianceScore: null, complianceStatus: null, openIncidents: 0,
  coursesDone: 0, coursesTotal: 0, certifications: 0, plate: null,
  pendingPayoutCents: 0, lastPayoutStatus: null, savingsCents: 0, weeklyGoalCents: 0,
};

const EARNING_KINDS = new Set(["ride_earning", "tip", "bonus", "incentive"]);

function dayStart(offsetDays = 0): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.getTime();
}

export default function DriverDashboard() {
  const { user } = useAuth();
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const c: any = supabase;
    const errors: string[] = [];

    const { data: wallet, error: wErr } = await supabase
      .from("wallets")
      .select("id,balance_cents")
      .eq("user_id", user.id)
      .eq("wallet_type", "driver")
      .maybeSingle();
    if (wErr) errors.push(wErr.message);

    const { data: driver } = await c
      .from("drivers")
      .select("id,driver_rating,status")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: txns, error: tErr } = await c
      .from("wallet_transactions")
      .select("amount_cents,kind,created_at,direction")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (tErr) errors.push(tErr.message);

    const rows: { amount_cents: number; kind: string; created_at: string }[] = txns ?? [];
    const t0 = dayStart(0), w0 = dayStart(7), w1 = dayStart(14);
    let todayCents = 0, todayTrips = 0, weekCents = 0, prevWeekCents = 0, lifetimeCents = 0;
    for (const r of rows) {
      if (!EARNING_KINDS.has(r.kind)) continue;
      const ts = new Date(r.created_at).getTime();
      lifetimeCents += r.amount_cents;
      if (ts >= t0) { todayCents += r.amount_cents; if (r.kind === "ride_earning") todayTrips += 1; }
      if (ts >= w0) weekCents += r.amount_cents;
      else if (ts >= w1) prevWeekCents += r.amount_cents;
    }

    let driverExtras: Partial<Snapshot> = {};
    if (driver?.id) {
      const [
        { count: tripsCompleted },
        { data: docs },
        { data: comp },
        { count: openIncidents },
        { data: training },
        { count: certifications },
        { data: metrics },
        { data: assignment },
        { data: payouts },
        { data: savings },
      ] = await Promise.all([
        c.from("trip_bookings").select("*", { count: "exact", head: true }).eq("driver_id", driver.id).eq("status", "completed"),
        c.from("driver_documents").select("status,expiry_date").eq("driver_id", user.id),
        c.from("driver_compliance").select("compliance_score,overall_status").eq("driver_id", driver.id).maybeSingle(),
        c.from("driver_incidents").select("*", { count: "exact", head: true }).eq("driver_id", driver.id).neq("status", "resolved"),
        c.from("driver_training_records").select("status").eq("driver_id", driver.id),
        c.from("driver_certifications").select("*", { count: "exact", head: true }).eq("driver_id", driver.id),
        c.from("driver_daily_metrics").select("online_minutes,metric_date").eq("driver_id", driver.id).order("metric_date", { ascending: false }).limit(1),
        c.from("driver_vehicle_assignments").select("vehicles(license_plate)").eq("driver_id", driver.id).eq("status", "active").limit(1).maybeSingle(),
        c.from("driver_payouts").select("amount_cents,status,created_at").eq("driver_id", user.id).order("created_at", { ascending: false }).limit(20),
        c.from("driver_savings").select("balance_cents").eq("driver_id", driver.id).maybeSingle(),
      ]);

      const docRows: { status: string; expiry_date: string | null }[] = docs ?? [];
      const verified = docRows.filter((d) => ["APPROVED", "VERIFIED"].includes((d.status ?? "").toUpperCase())).length;
      const pending = docRows.filter((d) => (d.status ?? "").toUpperCase() === "PENDING").length;
      const expiries = docRows
        .map((d) => d.expiry_date)
        .filter((x): x is string => !!x)
        .sort();
      const trainingRows: { status: string }[] = training ?? [];
      const payoutRows: { amount_cents: number; status: string }[] = payouts ?? [];

      driverExtras = {
        tripsCompleted: tripsCompleted ?? 0,
        docsVerified: verified,
        docsPending: pending,
        docsTotal: docRows.length,
        nextExpiry: expiries.find((d) => new Date(d).getTime() >= Date.now()) ?? expiries[0] ?? null,
        complianceScore: comp?.compliance_score ?? null,
        complianceStatus: comp?.overall_status ?? null,
        openIncidents: openIncidents ?? 0,
        coursesDone: trainingRows.filter((r) => r.status === "completed").length,
        coursesTotal: trainingRows.length,
        certifications: certifications ?? 0,
        onlineMinutes: metrics?.[0]?.online_minutes ?? 0,
        plate: assignment?.vehicles?.license_plate ?? null,
        pendingPayoutCents: payoutRows
          .filter((p) => ["PENDING", "QUEUED", "PROCESSING"].includes((p.status ?? "").toUpperCase()))
          .reduce((s, p) => s + p.amount_cents, 0),
        lastPayoutStatus: payoutRows[0]?.status ?? null,
        savingsCents: savings?.balance_cents ?? 0,
      };
    }

    setSnap({
      ...EMPTY,
      balanceCents: wallet?.balance_cents ?? 0,
      walletId: wallet?.id ?? "",
      todayCents, todayTrips, weekCents, prevWeekCents, lifetimeCents,
      rating: driver?.driver_rating ?? null,
      weeklyGoalCents: Math.max(prevWeekCents, weekCents) || 0,
      ...driverExtras,
    });
    setLoadError(errors[0] ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const kes = (cents: number) => `KES ${(cents / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
  const orDash = (v: string | number | null | undefined, fmt?: (x: any) => string) =>
    v === null || v === undefined ? "—" : fmt ? fmt(v) : String(v);

  const weekDelta = useMemo(() => {
    if (!snap.prevWeekCents) return snap.weekCents ? "first tracked week" : "no earnings yet";
    const pct = Math.round(((snap.weekCents - snap.prevWeekCents) / snap.prevWeekCents) * 100);
    return `${pct >= 0 ? "+" : ""}${pct}% vs last week`;
  }, [snap.weekCents, snap.prevWeekCents]);

  const goalPct = snap.weeklyGoalCents ? Math.min(100, Math.round((snap.weekCents / snap.weeklyGoalCents) * 100)) : 0;

  const categories: Category[] = [
    {
      key: "earnings",
      title: "Earnings & Wealth",
      subtitle: "Ledger-backed income and payouts",
      icon: Wallet,
      accent: "from-primary/15 to-primary/5",
      tiles: [
        { label: "Wallet Balance", value: kes(snap.balanceCents), icon: Wallet, href: "/dashboard/driver/wallet" },
        { label: "Today", value: kes(snap.todayCents), sub: `${snap.todayTrips} paid trip${snap.todayTrips === 1 ? "" : "s"}`, icon: TrendingUp, href: "/dashboard/driver/wallet" },
        { label: "Last 7 days", value: kes(snap.weekCents), sub: weekDelta, icon: ArrowUpRight, href: "/dashboard/driver/wallet" },
        {
          label: "Payouts",
          value: snap.pendingPayoutCents ? kes(snap.pendingPayoutCents) : orDash(snap.lastPayoutStatus),
          sub: snap.pendingPayoutCents ? "in progress" : "withdraw to M-Pesa",
          icon: PiggyBank,
          href: "/dashboard/driver/payouts",
        },
      ],
    },
    {
      key: "growth",
      title: "Growth & Prestige",
      subtitle: "Training, certifications, ratings",
      icon: GraduationCap,
      accent: "from-primary/15 to-primary-glow/5",
      tiles: [
        {
          label: "Academy Progress",
          value: snap.coursesTotal ? `${Math.round((snap.coursesDone / snap.coursesTotal) * 100)}%` : "—",
          sub: snap.coursesTotal ? `${snap.coursesDone} / ${snap.coursesTotal} courses` : "no courses enrolled",
          icon: GraduationCap,
          href: "/driver/training",
        },
        { label: "Certifications", value: String(snap.certifications), sub: snap.certifications ? "on record" : "none yet", icon: Award },
        { label: "Savings", value: snap.savingsCents ? kes(snap.savingsCents) : "—", sub: "driver savings pot", icon: Target, href: "/driver/benefits" },
        { label: "Rating", value: orDash(snap.rating, (r) => Number(r).toFixed(2)), sub: `${snap.tripsCompleted} completed trips`, icon: Star },
      ],
    },
    {
      key: "operations",
      title: "Operations & Compliance",
      subtitle: "Documents, tax, vehicle, hours",
      icon: Briefcase,
      accent: "from-primary/15 to-primary-glow/5",
      tiles: [
        {
          label: "Documents",
          value: snap.docsTotal ? `${snap.docsVerified}/${snap.docsTotal}` : "0",
          sub: snap.docsPending ? `${snap.docsPending} awaiting review` : snap.nextExpiry ? `next expiry ${new Date(snap.nextExpiry).toLocaleDateString("en-KE")}` : "upload required documents",
          icon: FileCheck,
          href: "/dashboard/driver/documents",
        },
        { label: "Tax & eTIMS", value: "Open", sub: "view statements", icon: Receipt, href: "/dashboard/driver/tax" },
        { label: "Vehicle", value: orDash(snap.plate), sub: snap.plate ? "assigned vehicle" : "no active assignment", icon: Car },
        { label: "Online Today", value: snap.onlineMinutes ? `${Math.floor(snap.onlineMinutes / 60)}h ${snap.onlineMinutes % 60}m` : "—", sub: "from duty log", icon: Clock },
      ],
    },
    {
      key: "safety",
      title: "Safety & Support",
      subtitle: "Compliance score, incidents, help",
      icon: Shield,
      accent: "from-primary/15 to-primary-glow/5",
      tiles: [
        {
          label: "Compliance Score",
          value: orDash(snap.complianceScore, (s) => String(Math.round(Number(s)))),
          sub: snap.complianceStatus ?? "not assessed",
          icon: Shield,
          href: "/dashboard/driver/documents",
        },
        { label: "Open Incidents", value: String(snap.openIncidents), sub: snap.openIncidents ? "needs attention" : "all clear", icon: AlertTriangle, href: "/driver/support" },
        { label: "Safety Centre", value: "Open", sub: "guides & SOS", icon: Activity, href: "/driver/safety" },
        { label: "Support", value: "Open", sub: "raise a ticket", icon: AlertTriangle, href: "/driver/support" },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {loadError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Some dashboard data could not be loaded — figures may be incomplete. {loadError}
        </div>
      )}

      {/* Hero */}
      <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-primary-glow/10 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary">Driver Command Center</Badge>
              {snap.complianceStatus && <Badge variant="outline">{snap.complianceStatus}</Badge>}
            </div>
            <h1 className="text-2xl md:text-3xl font-bold">Good day, {user?.email?.split("@")[0] ?? "driver"}.</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {loading ? "Loading your business snapshot…" : "Your business at a glance — earnings, growth, operations and safety."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <TopUpDialog walletType="driver" walletId={snap.walletId} onSuccess={(b) => setSnap((s) => ({ ...s, balanceCents: b }))} />
            <Button asChild variant="outline">
              <AppLink to="/dashboard/driver/payouts" trackId="driver-cc:payouts">Payouts</AppLink>
            </Button>
            <Button asChild>
              <AppLink to="/dashboard/driver/documents" trackId="driver-cc:documents">Documents</AppLink>
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          <KpiPill label="Lifetime Earnings" value={kes(snap.lifetimeCents)} />
          <KpiPill label="Trips Completed" value={String(snap.tripsCompleted)} />
          <KpiPill label="Rating" value={orDash(snap.rating, (r) => Number(r).toFixed(2))} />
          <KpiPill label="Docs Verified" value={snap.docsTotal ? `${snap.docsVerified}/${snap.docsTotal}` : "0"} />
        </div>
      </div>

      <DriverDutyPanel />

      {/* 4-category grid */}
      <div className="grid lg:grid-cols-2 gap-5">
        {categories.map((c) => (
          <Card key={c.key} className="overflow-hidden">
            <div className={`bg-gradient-to-br ${c.accent} px-6 py-5 border-b`}>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-background/70 border flex items-center justify-center">
                  <c.icon className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">{c.title}</CardTitle>
                  <p className="text-xs text-muted-foreground">{c.subtitle}</p>
                </div>
              </div>
            </div>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-3">
                {c.tiles.map((t) => {
                  const inner = (
                    <div className="rounded-lg border p-3 h-full hover:bg-muted/40 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">{t.label}</span>
                        <t.icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="text-lg font-semibold leading-tight">{t.value}</div>
                      {t.sub && <div className="text-xs text-muted-foreground mt-0.5">{t.sub}</div>}
                    </div>
                  );
                  return t.href ? (
                    <AppLink key={t.label} to={t.href} trackId={`driver-cc:${c.key}:${t.label}`}>{inner}</AppLink>
                  ) : (
                    <div key={t.label}>{inner}</div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Weekly pace — benchmarked against your own previous week, never a fictional target */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly pace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {snap.weeklyGoalCents ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{kes(snap.weekCents)} of {kes(snap.weeklyGoalCents)} (your best recent week)</span>
                <span className="font-medium">{goalPct}%</span>
              </div>
              <Progress value={goalPct} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No earnings recorded yet. Go online from the duty panel above to start accepting trips.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/60 border px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}
