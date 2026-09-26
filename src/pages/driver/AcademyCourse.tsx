import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MarketingPage } from "@/components/marketing/PageHero";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, CheckCircle2, Clock, GraduationCap, PlayCircle, Award, FileText } from "lucide-react";
import { ExamRunner } from "@/components/academy/ExamRunner";
import { VideoLessonPlayer, type AcademyVideo } from "@/components/academy/VideoLessonPlayer";

interface Course {
  id: string; code: string; slug: string; title: string; level: number;
  description: string | null; duration_minutes: number; pass_mark: number;
  required_for_activation: boolean; certification_kind: string | null; cpd_points: number;
}
interface Module { id: string; title: string; description: string | null; sort_order: number; duration_minutes: number; }
interface Lesson { id: string; module_id: string; title: string; lesson_type: string; content_md: string | null; duration_minutes: number; sort_order: number; }
interface Assessment { id: string; title: string; kind: string; pass_mark: number; time_limit_min: number | null; }
interface Cert { id: string; certificate_number: string; title: string; issued_at: string; expires_at: string | null; }

export default function AcademyCourse() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [cert, setCert] = useState<Cert | null>(null);
  const [showExam, setShowExam] = useState(false);
  const [videosByLesson, setVideosByLesson] = useState<Record<string, AcademyVideo>>({});

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data: c } = await supabase.from("training_courses").select("*").eq("slug", slug).maybeSingle();
      if (!c) return;
      setCourse(c as Course);
      const [{ data: mods }, { data: ass }] = await Promise.all([
        supabase.from("training_modules").select("*").eq("course_id", c.id).order("sort_order"),
        supabase.from("training_assessments").select("*").eq("course_id", c.id).eq("kind", "final").maybeSingle(),
      ]);
      setModules((mods ?? []) as Module[]);
      setAssessment(ass as Assessment | null);
      if (mods?.length) {
        const ids = mods.map((m: any) => m.id);
        const { data: less } = await supabase
          .from("training_lessons").select("*").in("module_id", ids).order("sort_order");
        const lessonList = (less ?? []) as Lesson[];
        setLessons(lessonList);
        if (lessonList.length) {
          const { data: vids } = await supabase
            .from("training_videos")
            .select("id,lesson_id,title,url,provider,duration_seconds,min_watch_percent,checkpoints,is_mandatory")
            .in("lesson_id", lessonList.map((l) => l.id));
          const map: Record<string, AcademyVideo> = {};
          for (const v of (vids ?? []) as AcademyVideo[]) map[v.lesson_id] = v;
          setVideosByLesson(map);
        }
      }
    })();
  }, [slug]);

  useEffect(() => {
    if (!user || !course) return;
    (async () => {
      const { data: d } = await supabase.from("drivers").select("id").eq("user_id", user.id).maybeSingle();
      if (!d) return;
      setDriverId(d.id);
      const [{ data: prog }, { data: cs }] = await Promise.all([
        supabase.from("training_progress").select("lesson_id,status")
          .eq("driver_id", d.id).eq("course_id", course.id),
        supabase.from("training_certificates")
          .select("id,certificate_number,title,issued_at,expires_at")
          .eq("driver_id", d.id).eq("course_id", course.id).is("revoked_at", null).maybeSingle(),
      ]);
      setCompleted(new Set((prog ?? []).filter((p: any) => p.status === "completed").map((p: any) => p.lesson_id)));
      setCert(cs as Cert | null);
    })();
  }, [user, course]);

  async function enroll() {
    if (!user) { navigate("/auth"); return; }
    if (!course) return;
    const { error } = await supabase.rpc("training_enroll", { _course_id: course.id });
    if (error) toast({ title: "Could not enroll", description: error.message, variant: "destructive" });
    else toast({ title: "Enrolled", description: "Start your first lesson below." });
  }

  async function markLesson(lessonId: string) {
    if (!driverId) { toast({ title: "Sign in to track progress" }); return; }
    const { error } = await supabase.rpc("training_complete_lesson", { _lesson_id: lessonId });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setCompleted(prev => new Set(prev).add(lessonId));
    toast({ title: "Lesson completed" });
  }

  if (!course) {
    return <MarketingLayout><div className="container mx-auto py-20 text-center text-muted-foreground">Loading course…</div></MarketingLayout>;
  }

  const totalLessons = lessons.length;
  const doneLessons = lessons.filter(l => completed.has(l.id)).length;
  const pct = totalLessons ? Math.round((doneLessons / totalLessons) * 100) : 0;
  const examUnlocked = totalLessons > 0 && doneLessons === totalLessons;

  return (
    <MarketingPage>
      <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-12">
          <Button asChild variant="ghost" size="sm" className="text-ice hover:bg-ice/10 mb-4">
            <Link to="/driver/training"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Academy</Link>
          </Button>
          <div className="flex flex-wrap gap-2 mb-3">
            <Badge variant="secondary">Level {course.level}</Badge>
            {course.required_for_activation && <Badge variant="destructive">Required for activation</Badge>}
            {course.certification_kind && <Badge className="bg-primary text-primary-foreground">Certification</Badge>}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">{course.title}</h1>
          <p className="text-primary-foreground/90 max-w-3xl">{course.description}</p>
          <div className="flex flex-wrap gap-4 mt-4 text-sm">
            <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" /> {Math.round(course.duration_minutes / 60)} hours</span>
            <span className="inline-flex items-center gap-1"><GraduationCap className="h-4 w-4" /> Pass mark {course.pass_mark}%</span>
            <span className="inline-flex items-center gap-1"><Award className="h-4 w-4" /> {course.cpd_points} CPD points</span>
          </div>
          <div className="mt-6 flex gap-3">
            {!cert && <Button size="lg" className="bg-ice text-primary hover:bg-ice/90" onClick={enroll}>Enroll</Button>}
            {examUnlocked && !cert && assessment && (
              <Button size="lg" variant="outline" className="bg-ice/10 border-ice/30 text-ice hover:bg-ice/20"
                onClick={() => setShowExam(true)}>
                Take Final Exam
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-10 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {cert && (
            <Card className="border-status-success/30 bg-status-success/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-status-success">
                  <Award className="h-5 w-5" /> Certificate issued
                </CardTitle>
                <CardDescription className="text-status-success font-mono text-xs">{cert.certificate_number}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-status-success">
                Issued {new Date(cert.issued_at).toLocaleDateString()}
                {cert.expires_at && <> · Valid until {new Date(cert.expires_at).toLocaleDateString()}</>}
              </CardContent>
            </Card>
          )}

          {modules.map(m => {
            const ml = lessons.filter(l => l.module_id === m.id);
            return (
              <Card key={m.id}>
                <CardHeader>
                  <CardTitle className="text-base">{m.sort_order}. {m.title}</CardTitle>
                  <CardDescription>{Math.round(m.duration_minutes / 60 * 10) / 10} hours</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {ml.length === 0 && <p className="text-xs text-muted-foreground">Lesson content coming soon.</p>}
                  {ml.map(l => {
                    const done = completed.has(l.id);
                    const video = videosByLesson[l.id];
                    return (
                      <div key={l.id} className="space-y-3 rounded border p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {done
                              ? <CheckCircle2 className="h-5 w-5 text-status-success" />
                              : <PlayCircle className="h-5 w-5 text-primary" />}
                            <div>
                              <div className="text-sm font-medium">{l.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {l.lesson_type} · {l.duration_minutes} min
                              </div>
                            </div>
                          </div>
                          {!done && user && !video && (
                            <Button size="sm" variant="ghost" onClick={() => markLesson(l.id)}>
                              Mark complete
                            </Button>
                          )}
                        </div>
                        {video && user && (
                          <VideoLessonPlayer
                            video={video}
                            onCompleted={() => setCompleted(prev => new Set(prev).add(l.id))}
                          />
                        )}
                        {video && !user && (
                          <p className="text-xs text-muted-foreground">Sign in to watch and track progress.</p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{pct}%</div>
              <Progress value={pct} className="mt-2 h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                {doneLessons} / {totalLessons} lessons complete
              </p>
              {assessment && (
                <div className="mt-4 text-sm">
                  <FileText className="inline h-4 w-4 mr-1" /> Final exam: {assessment.pass_mark}% to pass
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">What you'll earn</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center gap-2"><Award className="h-4 w-4 text-primary" /> {course.certification_kind ?? "Certificate"}</div>
              <div className="flex items-center gap-2"><GraduationCap className="h-4 w-4 text-primary" /> {course.cpd_points} CPD points</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /> Verifiable QR-coded certificate</div>
            </CardContent>
          </Card>
        </aside>
      </section>

      {showExam && assessment && (
        <ExamRunner
          assessmentId={assessment.id}
          title={assessment.title}
          passMark={assessment.pass_mark}
          onClose={(passed) => {
            setShowExam(false);
            if (passed) {
              // refresh cert
              if (driverId && course) {
                supabase.from("training_certificates")
                  .select("id,certificate_number,title,issued_at,expires_at")
                  .eq("driver_id", driverId).eq("course_id", course.id).is("revoked_at", null).maybeSingle()
                  .then(({ data }) => setCert(data as Cert | null));
              }
            }
          }}
        />
      )}
    </MarketingPage>
  );
}
