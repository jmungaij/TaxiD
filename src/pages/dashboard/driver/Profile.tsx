import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AppLink } from "@/components/nav/AppLink";
import {
  User, Shield, Car, Wallet, Star, TrendingUp, GraduationCap,
  FileCheck, Award, MapPin, Activity, ArrowRight,
} from "lucide-react";

interface DriverRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  driver_code: string | null;
  status: string | null;
  verification_status: string | null;
  driver_rating: number | null;
  created_at: string | null;
}

export default function DriverProfilePage() {
  const { user } = useAuth();
  const [driver, setDriver] = useState<DriverRow | null>(null);
  const [wallet, setWallet] = useState<{ balance_cents: number } | null>(null);
  const [compliance, setCompliance] = useState<any>(null);
  const [docCount, setDocCount] = useState(0);
  const [tripCount, setTripCount] = useState(0);
  const [training, setTraining] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const c: any = supabase;
      const { data: d } = await c.from("drivers")
        .select("id,first_name,last_name,driver_code,status,verification_status,driver_rating,created_at")
        .eq("user_id", user.id).maybeSingle();
      setDriver((d as DriverRow) ?? null);

      const { data: w } = await supabase.from("wallets")
        .select("balance_cents").eq("user_id", user.id).eq("wallet_type", "driver").maybeSingle();
      setWallet(w ?? null);

      if (d?.id) {
        const [{ data: comp }, { count: dc }, { count: tc }, { data: tr }] = await Promise.all([
          c.from("driver_compliance").select("compliance_score,overall_status").eq("driver_id", d.id).maybeSingle(),
          c.from("driver_documents").select("*", { count: "exact", head: true }).eq("driver_id", user.id),
          c.from("trip_bookings").select("*", { count: "exact", head: true }).eq("driver_id", d.id),
          c.from("driver_training_records").select("status").eq("driver_id", d.id),
        ]);
        setCompliance(comp ?? null);
        setDocCount(dc ?? 0);
        setTripCount(tc ?? 0);
        const rows = (tr as { status: string }[] | null) ?? [];
        setTraining({ done: rows.filter((r) => r.status === "completed").length, total: rows.length });
      }
      setLoading(false);
    })();
  }, [user]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading your driver profile…</div>;
  }

  const name = [driver?.first_name, driver?.last_name].filter(Boolean).join(" ") || user?.email?.split("@")[0] || "Driver";
  const memberSince = driver?.created_at ? new Date(driver.created_at).toLocaleDateString("en-KE", { year: "numeric", month: "long" }) : "—";
  const kes = (cents: number) => `KES ${(cents / 100).toLocaleString("en-KE")}`;
  const trainingPct = training.total ? Math.round((training.done / training.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Identity header */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/10 via-background to-primary-glow/10 p-6 border-b">
          <div className="flex flex-wrap items-start gap-5">
            <div className="h-20 w-20 rounded-full bg-primary/15 border flex items-center justify-center">
              <User className="h-10 w-10 text-primary" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold">{name}</h1>
                {driver?.status && <Badge variant="secondary">{driver.status}</Badge>}
                {driver?.verification_status && <Badge variant="outline">Verification: {driver.verification_status}</Badge>}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {driver?.driver_code ?? "—"} · Member since {memberSince}
              </div>
              <div className="flex flex-wrap gap-4 mt-3 text-sm">
                <span className="flex items-center gap-1"><Star className="h-4 w-4 text-status-warning" /> {driver?.driver_rating?.toFixed(2) ?? "—"}</span>
                <span className="flex items-center gap-1"><MapPin className="h-4 w-4 text-muted-foreground" /> {tripCount.toLocaleString()} trips</span>
                <span className="flex items-center gap-1"><Wallet className="h-4 w-4 text-muted-foreground" /> {kes(wallet?.balance_cents ?? 0)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <AppLink to="/dashboard/driver/wallet" trackId="driver-profile:wallet">Open Wallet <ArrowRight className="ml-1 h-4 w-4" /></AppLink>
              </Button>
              <Button asChild variant="outline">
                <AppLink to="/dashboard/driver/tax" trackId="driver-profile:tax">Tax & Payouts</AppLink>
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Workspace grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <WorkspaceCard icon={Wallet} title="Wallet & Earnings" to="/dashboard/driver/wallet"
          value={kes(wallet?.balance_cents ?? 0)} sub="Current balance" />
        <WorkspaceCard icon={TrendingUp} title="Performance" to="/dashboard/driver/wallet"
          value={driver?.driver_rating?.toFixed(2) ?? "—"} sub="Driver rating" />
        <WorkspaceCard icon={Shield} title="Compliance" to="/dashboard/driver/documents"
          value={`${Math.round(Number(compliance?.compliance_score ?? 0))}%`} sub={compliance?.overall_status ?? "—"} />
        <WorkspaceCard icon={FileCheck} title="Documents" to="/dashboard/driver/documents"
          value={docCount.toString()} sub="On file" />
        <WorkspaceCard icon={GraduationCap} title="Academy" to="/driver/training"
          value={`${trainingPct}%`} sub={`${training.done} / ${training.total} courses`} />
        <WorkspaceCard icon={Car} title="Trips" to="/dashboard/driver/trips"
          value={tripCount.toString()} sub="Lifetime completed" />
        <WorkspaceCard icon={Award} title="Rewards" to="/driver/benefits"
          value="—" sub="Badges & incentives" />
        <WorkspaceCard icon={Activity} title="Digital Twin" to="/dashboard/admin/digital-twin"
          value="View" sub="Forensic timeline" />
      </div>

      {/* Academy progress */}
      {training.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4" /> Academy progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{training.done} of {training.total} courses complete</span>
              <span className="font-medium">{trainingPct}%</span>
            </div>
            <Progress value={trainingPct} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WorkspaceCard({
  icon: Icon, title, to, value, sub,
}: { icon: typeof User; title: string; to: string; value: string; sub: string }) {
  return (
    <AppLink to={to} trackId={`driver-profile:card:${title}`}>
      <Card className="h-full hover:border-primary/50 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Icon className="h-5 w-5 text-primary" />
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className="text-xl font-semibold leading-tight mt-1">{value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
        </CardContent>
      </Card>
    </AppLink>
  );
}
