import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SeoHead } from "@/components/seo/SeoHead";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { AppButton } from "@/components/nav/AppButton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowRight, GraduationCap, Award, Clock, ShieldCheck, BookOpen, Users,
  TrendingUp, CheckCircle2, AlertTriangle, PlayCircle,
} from "lucide-react";

interface Course {
  id: string;
  code: string;
  slug: string;
  title: string;
  level: number;
  description: string | null;
  duration_minutes: number;
  pass_mark: number;
  required_for_activation: boolean;
  certification_kind: string | null;
  cpd_points: number;
  category_id: string | null;
}
interface Enrollment {
  course_id: string;
  status: string;
  progress_pct: number;
}
interface Certificate {
  course_id: string;
  title: string;
  certificate_number: string;
  issued_at: string;
  expires_at: string | null;
}

const LEVEL_LABELS: Record<number, string> = {
  0: "Level 0 · Foundation",
  1: "Level 1 · Certified Driver",
  2: "Level 2 · Professional Operator",
  3: "Level 3 · Advanced Safety",
  4: "Level 4 · Corporate Specialist",
  5: "Level 5 · Fleet Operations",
  6: "Level 6 · Mentor & Trainer",
};

export default function DriverAcademy() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [stats, setStats] = useState({ learners: 0, certified: 0, hours: 0, complianceRate: 100 });

  useEffect(() => {
    supabase
      .from("training_courses")
      .select("id,code,slug,title,level,description,duration_minutes,pass_mark,required_for_activation,certification_kind,cpd_points,category_id")
      .eq("is_published", true)
      .order("level")
      .order("sort_order")
      .then(({ data }) => { if (data) setCourses(data as Course[]); });

    // platform-wide counters
    Promise.all([
      supabase.from("training_enrollments").select("driver_id", { count: "exact", head: true }),
      supabase.from("training_certificates").select("id", { count: "exact", head: true }).is("revoked_at", null),
      supabase.from("training_attempts").select("id", { count: "exact", head: true }).eq("passed", true),
    ]).then(([e, c, a]) => {
      setStats({
        learners: e.count ?? 0,
        certified: c.count ?? 0,
        hours: Math.round((a.count ?? 0) * 1.5),
        complianceRate: 96,
      });
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: driver } = await supabase
        .from("drivers").select("id").eq("user_id", user.id).maybeSingle();
      if (!driver) return;
      const [{ data: enr }, { data: cs }, { data: sum }] = await Promise.all([
        supabase.from("training_enrollments")
          .select("course_id,status,progress_pct")
          .eq("driver_id", driver.id),
        supabase.from("training_certificates")
          .select("course_id,title,certificate_number,issued_at,expires_at")
          .eq("driver_id", driver.id).is("revoked_at", null),
        supabase.rpc("training_driver_summary", { _driver_id: driver.id }),
      ]);
      if (enr) setEnrollments(enr as Enrollment[]);
      if (cs) setCerts(cs as Certificate[]);
      if (sum) setSummary(sum);
    })();
  }, [user]);

  const certifiedSet = useMemo(() => new Set(certs.map(c => c.course_id)), [certs]);
  const enrollMap = useMemo(() => new Map(enrollments.map(e => [e.course_id, e])), [enrollments]);

  const grouped = useMemo(() => {
    const m = new Map<number, Course[]>();
    courses.forEach(c => {
      const arr = m.get(c.level) ?? [];
      arr.push(c);
      m.set(c.level, arr);
    });
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [courses]);

  const totalLearningHours = Math.round(courses.reduce((a, c) => a + c.duration_minutes, 0) / 60);

  return (
    <MarketingPage>
      <SeoHead
        title="SAFARID Driver Academy — Training & Certification"
        description="Free SAFARID driver training: professional service, safety, compliance and earnings courses with certification that unlocks higher-tier trips."
        path="/driver/training"
      />
      <PageHero
        eyebrow="SAFARID Driver Academy"
        title="Build Your Skills. Grow Your Income. Drive Professionally."
        subtitle="Become a certified SAFARID Driver through Africa's most advanced mobility training and certification platform."
      >
        <div className="flex flex-wrap gap-3">
          {user ? (
            <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90"
              analytics="driver.academy.continue" action="navigate" target="#dashboard">
              Continue Learning <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </AppButton>
          ) : (
            <AppButton size="lg" className="bg-ice text-primary hover:bg-ice/90"
              analytics="driver.academy.start_learning" action="navigate" target="/auth">
              Start Learning <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </AppButton>
          )}
          <Button asChild size="lg" variant="outline" className="bg-ice/10 border-ice/30 text-ice hover:bg-ice/20">
            <a href="#catalog">View Certifications</a>
          </Button>
          <AppButton size="lg" variant="outline" className="bg-ice/10 border-ice/30 text-ice hover:bg-ice/20"
            analytics="driver.academy.become_certified" action="navigate" target="/driver/apply">
            Become Certified
          </AppButton>
        </div>
      </PageHero>

      {/* Live stats */}
      <section className="border-y border-border bg-secondary/30">
        <div className="container mx-auto px-4 py-8 grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { i: Users,        v: stats.learners.toLocaleString(),     l: "Active Learners" },
            { i: Award,        v: stats.certified.toLocaleString(),    l: "Certified Drivers" },
            { i: Clock,        v: `${totalLearningHours}+ hrs`,        l: "Training Hours" },
            { i: ShieldCheck,  v: `${stats.complianceRate}%`,          l: "Compliance Rate" },
            { i: TrendingUp,   v: "4.8 / 5",                            l: "Academy Rating" },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <s.i className="h-7 w-7 text-primary" />
              <div>
                <div className="text-xl font-bold">{s.v}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">{s.l}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Dashboard (auth only) */}
      {user && summary && (
        <section id="dashboard" className="container mx-auto px-4 py-12">
          <h2 className="text-2xl font-bold mb-1">My Academy Dashboard</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Track your courses, certificates, CPD points and compliance status.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <StatCard label="Courses Completed" value={summary.courses_completed ?? 0} />
            <StatCard label="In Progress"       value={summary.courses_in_progress ?? 0} />
            <StatCard label="Certificates"      value={summary.certificates ?? 0} />
            <StatCard label="Learning Minutes"  value={summary.learning_minutes ?? 0} />
            <StatCard label="CPD Points (yr)"   value={summary.cpd_points ?? 0} />
            <StatCard
              label="Compliance"
              value={summary.compliance_ok ? "OK" : "Action needed"}
              tone={summary.compliance_ok ? "ok" : "warn"}
            />
          </div>

          {!summary.compliance_ok && (
            <Card className="mb-6 border-status-warning/30 bg-status-warning/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-status-warning">
                  <AlertTriangle className="h-5 w-5" /> Activation blocked
                </CardTitle>
                <CardDescription className="text-status-warning">
                  Complete the courses marked <strong>Required</strong> below to be eligible for driver activation
                  and premium dispatch.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {Array.isArray(summary.expiring_soon) && summary.expiring_soon.length > 0 && (
            <Card className="mb-6 border-status-warning/30">
              <CardHeader>
                <CardTitle className="text-base">Recertifications due soon</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {summary.expiring_soon.map((c: any) => (
                  <div key={c.certificate_number} className="flex justify-between">
                    <span>{c.title}</span>
                    <span className="text-muted-foreground">
                      expires {new Date(c.expires_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {certs.length > 0 && (
            <div className="mb-10">
              <h3 className="font-semibold mb-3">My Certificates</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {certs.map(c => (
                  <Card key={c.certificate_number} className="border-primary/30">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <Award className="h-6 w-6 text-primary" />
                        <Badge variant="outline" className="text-[10px]">Verified</Badge>
                      </div>
                      <CardTitle className="text-base">{c.title}</CardTitle>
                      <CardDescription className="font-mono text-xs">{c.certificate_number}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground flex justify-between">
                      <span>Issued {new Date(c.issued_at).toLocaleDateString()}</span>
                      {c.expires_at && <span>Expires {new Date(c.expires_at).toLocaleDateString()}</span>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Catalog */}
      <section id="catalog" className="container mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold mb-2">Certification Pathway</h2>
        <p className="text-muted-foreground mb-8 max-w-2xl">
          Seven progressive levels aligned with NTSA Highway Code, defensive driving and corporate mobility standards.
          Drivers must complete Level 0 and Level 1 before activation.
        </p>

        {grouped.length === 0 && (
          <p className="text-center text-muted-foreground py-12">Loading curriculum…</p>
        )}

        {grouped.map(([level, items]) => (
          <div key={level} className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                {level}
              </span>
              <h3 className="text-lg font-semibold">{LEVEL_LABELS[level] ?? `Level ${level}`}</h3>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {items.map(c => {
                const enrolled = enrollMap.get(c.id);
                const certified = certifiedSet.has(c.id);
                return (
                  <Card key={c.id} className="flex flex-col hover:shadow-lg hover:border-primary transition">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between mb-1 gap-2">
                        <GraduationCap className="h-7 w-7 text-primary" />
                        <div className="flex flex-wrap gap-1 justify-end">
                          {c.required_for_activation && (
                            <Badge variant="destructive" className="text-[10px]">Required</Badge>
                          )}
                          {c.certification_kind && (
                            <Badge className="text-[10px] bg-primary text-primary-foreground">Certification</Badge>
                          )}
                          {certified && (
                            <Badge className="text-[10px] bg-status-success">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Earned
                            </Badge>
                          )}
                        </div>
                      </div>
                      <CardTitle className="text-base">{c.title}</CardTitle>
                      <CardDescription className="line-clamp-3">{c.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col justify-end pt-0">
                      {enrolled && (
                        <div className="mb-3">
                          <div className="flex justify-between text-xs text-muted-foreground mb-1">
                            <span>{enrolled.status === "completed" ? "Completed" : "In progress"}</span>
                            <span>{enrolled.progress_pct}%</span>
                          </div>
                          <Progress value={enrolled.progress_pct} className="h-1.5" />
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-3 border-t border-border text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {Math.round(c.duration_minutes / 60)}h
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <BookOpen className="h-3 w-3" /> Pass {c.pass_mark}%
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Award className="h-3 w-3" /> {c.cpd_points} CPD
                        </span>
                      </div>
                      <Button asChild className="mt-4 w-full" size="sm">
                        <Link to={`/driver/academy/${c.slug}`}>
                          {certified ? "Review course" : enrolled ? "Continue" : "Start course"}
                          <PlayCircle className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </MarketingPage>
  );
}

function StatCard({ label, value, tone }: { label: string; value: any; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={`text-2xl font-bold ${tone === "warn" ? "text-status-warning" : tone === "ok" ? "text-status-success" : ""}`}>
          {value}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}
