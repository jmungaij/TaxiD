import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GraduationCap, Award, FileQuestion, Users } from "lucide-react";

interface Course {
  id: string; code: string; title: string; level: number; duration_minutes: number;
  pass_mark: number; required_for_activation: boolean; certification_kind: string | null;
  is_published: boolean;
}

export default function AdminAcademy() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [stats, setStats] = useState({ enrollments: 0, certs: 0, attempts: 0, passRate: 0 });
  const [recentCerts, setRecentCerts] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("training_courses").select("id,code,title,level,duration_minutes,pass_mark,required_for_activation,certification_kind,is_published")
      .order("level").order("sort_order")
      .then(({ data }) => setCourses((data ?? []) as Course[]));

    Promise.all([
      supabase.from("training_enrollments").select("id", { count: "exact", head: true }),
      supabase.from("training_certificates").select("id", { count: "exact", head: true }).is("revoked_at", null),
      supabase.from("training_attempts").select("id", { count: "exact", head: true }),
      supabase.from("training_attempts").select("id", { count: "exact", head: true }).eq("passed", true),
    ]).then(([e, c, a, p]) => {
      const total = a.count ?? 0;
      setStats({
        enrollments: e.count ?? 0,
        certs: c.count ?? 0,
        attempts: total,
        passRate: total ? Math.round(((p.count ?? 0) / total) * 100) : 0,
      });
    });

    supabase.from("training_certificates")
      .select("certificate_number,title,issued_at,driver_id")
      .order("issued_at", { ascending: false }).limit(10)
      .then(({ data }) => setRecentCerts(data ?? []));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Academy Administration</h1>
        <p className="text-sm text-muted-foreground">
          Manage courses, certifications, question banks and analytics for the Driver Academy.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Enrollments" value={stats.enrollments} />
        <StatCard icon={Award} label="Active certificates" value={stats.certs} />
        <StatCard icon={FileQuestion} label="Exam attempts" value={stats.attempts} />
        <StatCard icon={GraduationCap} label="Pass rate" value={`${stats.passRate}%`} />
      </div>

      <Tabs defaultValue="courses">
        <TabsList>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="certs">Recent certificates</TabsTrigger>
        </TabsList>

        <TabsContent value="courses" className="space-y-3">
          {courses.map(c => (
            <Card key={c.id}>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">
                    Level {c.level} · {c.title}
                    <span className="ml-2 text-xs text-muted-foreground">{c.code}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {Math.round(c.duration_minutes / 60)} hours · pass mark {c.pass_mark}%
                  </div>
                </div>
                <div className="flex gap-2">
                  {c.required_for_activation && <Badge variant="destructive">Required</Badge>}
                  {c.certification_kind && <Badge>{c.certification_kind}</Badge>}
                  <Badge variant={c.is_published ? "default" : "outline"}>
                    {c.is_published ? "Published" : "Draft"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="certs">
          <Card>
            <CardHeader><CardTitle className="text-base">Most recent issuances</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              {recentCerts.length === 0 && <p className="text-muted-foreground">No certificates issued yet.</p>}
              {recentCerts.map((c) => (
                <div key={c.certificate_number} className="flex justify-between border-b py-2">
                  <span className="font-mono text-xs">{c.certificate_number}</span>
                  <span>{c.title}</span>
                  <span className="text-muted-foreground">{new Date(c.issued_at).toLocaleString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: any) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className="h-8 w-8 text-primary" />
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
