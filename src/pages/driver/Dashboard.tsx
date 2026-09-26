import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import MarketingHeader from "@/components/marketing/MarketingHeader";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { DriverDutyPanel } from "@/components/driver/DriverDutyPanel";
import {
  ShieldCheck, FileWarning, Car, GraduationCap, AlertTriangle,
  Wallet, TrendingUp, ChevronRight, Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Driver {
  id: string;
  first_name: string;
  last_name: string;
  driver_code: string;
  status: string;
  verification_status: string;
  driver_rating: number | null;
  risk_score: number | null;
}
interface Compliance {
  compliance_score: number | null;
  license_valid: boolean | null;
  badge_valid: boolean | null;
  background_check_valid: boolean | null;
  insurance_valid: boolean | null;
  inspection_valid: boolean | null;
  overall_status: string | null;
}

export default function DriverDashboard() {
  const [driver, setDriver] = useState<Driver | null>(null);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [docCount, setDocCount] = useState(0);
  const [pendingDocs, setPendingDocs] = useState(0);
  const [expiringDocs, setExpiringDocs] = useState(0);
  const [incidents, setIncidents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSignedOut(true); setLoading(false); return; }

      const { data: d } = await untypedDb
        .from("drivers")
        .select("id, first_name, last_name, driver_code, status, verification_status, driver_rating, risk_score")
        .eq("user_id", user.id)
        .maybeSingle();
      if (d) setDriver(d as Driver);

      if (d?.id) {
        const { data: c } = await untypedDb
          .from("driver_compliance")
          .select("compliance_score, license_valid, badge_valid, background_check_valid, insurance_valid, inspection_valid, overall_status")
          .eq("driver_id", d.id)
          .maybeSingle();
        if (c) setCompliance(c as Compliance);

        const { count: dc } = await untypedDb.from("driver_documents").select("*", { count: "exact", head: true }).eq("driver_id", d.id);
        setDocCount(dc ?? 0);
        const { count: pc } = await untypedDb.from("driver_documents").select("*", { count: "exact", head: true }).eq("driver_id", d.id).in("status", ["pending", "in_review"]);
        setPendingDocs(pc ?? 0);
        const in30 = new Date(); in30.setDate(in30.getDate() + 30);
        const { count: ec } = await untypedDb.from("driver_documents").select("*", { count: "exact", head: true }).eq("driver_id", d.id).lte("expiry_date", in30.toISOString().slice(0, 10));
        setExpiringDocs(ec ?? 0);
        const { count: ic } = await untypedDb.from("driver_incidents").select("*", { count: "exact", head: true }).eq("driver_id", d.id).eq("status", "open");
        setIncidents(ic ?? 0);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading driver dashboard…</div>;

  if (signedOut) {
    return (
      <div className="min-h-screen bg-background">
        <MarketingHeader />
        <div className="container max-w-2xl py-24 text-center">
          <h1 className="text-3xl font-bold mb-4">Sign in to view your driver dashboard</h1>
          <p className="text-muted-foreground mb-8">Track compliance, earnings, training and incidents in one place.</p>
          <Button asChild size="lg"><Link to="/auth?next=/driver/dashboard">Sign in</Link></Button>
        </div>
        <MarketingFooter />
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="min-h-screen bg-background">
        <MarketingHeader />
        <div className="container max-w-2xl py-24 text-center">
          <h1 className="text-3xl font-bold mb-4">Complete your driver application</h1>
          <p className="text-muted-foreground mb-8">You haven't started onboarding yet. It only takes a few minutes.</p>
          <Button asChild size="lg"><Link to="/driver/onboarding">Start onboarding</Link></Button>
        </div>
        <MarketingFooter />
      </div>
    );
  }

  const score = compliance?.compliance_score ?? 0;
  const checks = [
    { label: "Driving Licence", ok: compliance?.license_valid },
    { label: "PSV Badge", ok: compliance?.badge_valid },
    { label: "Background Check", ok: compliance?.background_check_valid },
    { label: "Insurance", ok: compliance?.insurance_valid },
    { label: "Vehicle Inspection", ok: compliance?.inspection_valid },
  ];

  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader />
      <main className="container py-10 space-y-8">
        <header className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{driver.driver_code}</p>
            <h1 className="text-3xl font-bold">Welcome back, {driver.first_name}</h1>
            <div className="flex gap-2 mt-2">
              <Badge variant={driver.status === "active" ? "default" : "secondary"}>{driver.status}</Badge>
              <Badge variant="outline">Verification: {driver.verification_status}</Badge>
              {driver.driver_rating ? <Badge variant="outline">★ {Number(driver.driver_rating).toFixed(2)}</Badge> : null}
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline"><Link to="/driver/earnings">Earnings</Link></Button>
            <Button asChild variant="outline"><Link to="/driver/portal">Wallet & payouts</Link></Button>
            <Button asChild><Link to="/driver/onboarding">Resume application</Link></Button>
          </div>
        </header>

        <DriverDutyPanel />

        <section className="grid md:grid-cols-4 gap-4">
          <StatCard icon={ShieldCheck} label="Compliance score" value={`${Math.round(Number(score))}%`} hint={compliance?.overall_status ?? "—"} />
          <StatCard icon={FileWarning} label="Pending documents" value={pendingDocs.toString()} hint={`${docCount} total`} />
          <StatCard icon={Activity} label="Expiring ≤30d" value={expiringDocs.toString()} hint="Renew soon" />
          <StatCard icon={AlertTriangle} label="Open incidents" value={incidents.toString()} hint="Safety events" />
        </section>


        <section className="grid md:grid-cols-3 gap-4">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> Compliance status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1"><span>Overall</span><span className="font-medium">{Math.round(Number(score))}%</span></div>
                <Progress value={Number(score)} />
              </div>
              <ul className="grid sm:grid-cols-2 gap-3">
                {checks.map((c) => (
                  <li key={c.label} className="flex items-center justify-between rounded-md border p-3">
                    <span className="text-sm">{c.label}</span>
                    <Badge variant={c.ok ? "default" : "secondary"}>{c.ok ? "Valid" : "Action needed"}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" /> Quick links</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { to: "/driver/training", icon: GraduationCap, label: "Academy" },
                { to: "/driver/safety", icon: ShieldCheck, label: "Safety Center" },
                { to: "/driver/benefits", icon: Wallet, label: "Benefits & Rewards" },
                { to: "/driver/support", icon: Car, label: "Driver Support" },
              ].map((l) => (
                <Link key={l.to} to={l.to} className="flex items-center justify-between rounded-md border p-3 hover:bg-muted transition">
                  <span className="flex items-center gap-2 text-sm"><l.icon className="w-4 h-4 text-primary" />{l.label}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <Icon className="w-5 h-5 text-primary mb-2" />
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xs text-muted-foreground/70 mt-1">{hint}</div>
      </CardContent>
    </Card>
  );
}
