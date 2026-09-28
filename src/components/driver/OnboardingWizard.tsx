import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { trackDriverEvent } from "@/lib/driverAnalytics";
import {
  User, Car, FileCheck, ShieldCheck, GraduationCap, CheckCircle2, Rocket, ChevronLeft, ChevronRight, Save,
} from "lucide-react";

interface Draft {
  identity?: { national_id?: string; full_name?: string; phone?: string; selfie_confirmed?: boolean };
  license?:  { license_no?: string; psv_no?: string; years_experience?: number };
  vehicle?:  { make?: string; model?: string; year?: number; plate?: string; insurance_ref?: string };
  compliance?: { background_consent?: boolean; criminal_consent?: boolean };
  training?: { safety_done?: boolean; platform_done?: boolean };
  approval?: { reviewed?: boolean };
}

const STAGES = [
  { id: 1, title: "Identity",      icon: User,          desc: "National ID, photo and selfie verification." },
  { id: 2, title: "Driving",       icon: FileCheck,     desc: "Driving licence, PSV licence and experience." },
  { id: 3, title: "Vehicle",       icon: Car,           desc: "Vehicle registration, inspection and insurance." },
  { id: 4, title: "Compliance",    icon: ShieldCheck,   desc: "Background, criminal and fraud screening." },
  { id: 5, title: "Training",      icon: GraduationCap, desc: "Safety and platform training modules." },
  { id: 6, title: "Approval",      icon: CheckCircle2,  desc: "Automated + manual review." },
  { id: 7, title: "Activation",    icon: Rocket,        desc: "Dashboard access and wallet creation." },
];

const LOCAL_KEY = "yr_driver_onboarding_draft";

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [userId, setUserId] = useState<string | null>(null);
  const [stage, setStage] = useState(1);
  const [data, setData] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load local draft immediately, then merge server draft if signed in.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.data) setData(parsed.data);
        if (parsed?.stage) setStage(parsed.stage);
      }
    } catch { /* noop */ }

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      const { data: draft } = await supabase
        .from("driver_onboarding_drafts")
        .select("current_stage,data,status")
        .eq("driver_id", user.id)
        .maybeSingle();
      if (draft) {
        setData((draft.data as Draft) ?? {});
        setStage(draft.current_stage ?? 1);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Persist on every change
  useEffect(() => {
    if (loading) return;
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ stage, data })); } catch { /* noop */ }
  }, [stage, data, loading]);

  const update = <K extends keyof Draft>(key: K, val: Draft[K]) =>
    setData((d) => ({ ...d, [key]: { ...(d[key] as object ?? {}), ...(val as object) } }));

  async function saveServer() {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase.from("driver_onboarding_drafts").upsert(
      { driver_id: userId, current_stage: stage, data: data as never, status: "DRAFT" },
      { onConflict: "driver_id" },
    );
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else toast({ title: "Progress saved" });
    trackDriverEvent("onboarding_saved", { funnel_stage: `stage_${stage}` });
  }

  async function submit() {
    if (!userId) {
      toast({ title: "Sign in to submit", description: "Create a free account to finish your application." });
      navigate("/auth?mode=register&redirect=/driver/onboarding");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("driver_onboarding_drafts").upsert(
      { driver_id: userId, current_stage: 7, data: data as never, status: "SUBMITTED", submitted_at: new Date().toISOString() },
      { onConflict: "driver_id" },
    );
    setSaving(false);
    if (error) {
      toast({ title: "Submission failed", description: error.message, variant: "destructive" });
      return;
    }
    trackDriverEvent("onboarding_submitted", { funnel_stage: "complete" });
    toast({ title: "Application submitted", description: "Our team will review and contact you within 24 hours." });
    try { localStorage.removeItem(LOCAL_KEY); } catch { /* noop */ }
    setStage(7);
  }

  const pct = Math.round(((stage - 1) / (STAGES.length - 1)) * 100);

  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Stage rail */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Stage {stage} of {STAGES.length}</div>
            <h2 className="text-2xl font-bold mt-1">{STAGES[stage - 1].title}</h2>
            <p className="text-sm text-muted-foreground">{STAGES[stage - 1].desc}</p>
          </div>
          <Button variant="outline" size="sm" onClick={saveServer} disabled={!userId || saving}>
            <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save & resume later"}
          </Button>
        </div>
        <Progress value={pct} className="h-2" />
        <div className="hidden md:grid grid-cols-7 gap-2 mt-4">
          {STAGES.map((s) => {
            const Icon = s.icon;
            const done = s.id < stage;
            const active = s.id === stage;
            return (
              <button
                key={s.id}
                onClick={() => setStage(s.id)}
                className={`p-2 rounded-lg border text-xs text-center transition ${
                  active ? "border-primary bg-primary/10" : done ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:bg-muted"
                }`}
              >
                <Icon className={`h-4 w-4 mx-auto mb-1 ${done ? "text-primary" : active ? "text-primary" : "text-muted-foreground"}`} />
                {s.title}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stage body */}
      <div className="p-6 md:p-8 rounded-2xl bg-card border border-border shadow-sm">
        {stage === 1 && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Full name (as on ID)">
              <Input value={data.identity?.full_name ?? ""} onChange={(e) => update("identity", { full_name: e.target.value })} maxLength={120} />
            </Field>
            <Field label="National ID / Passport number">
              <Input value={data.identity?.national_id ?? ""} onChange={(e) => update("identity", { national_id: e.target.value })} maxLength={32} />
            </Field>
            <Field label="Phone (M-Pesa)">
              <Input type="tel" placeholder="07XX XXX XXX" value={data.identity?.phone ?? ""} onChange={(e) => update("identity", { phone: e.target.value })} maxLength={20} />
            </Field>
            <Field label="Selfie verification" className="sm:col-span-2">
              <label className="flex items-center gap-2 p-3 rounded-md border border-border bg-background cursor-pointer">
                <input type="checkbox" checked={!!data.identity?.selfie_confirmed} onChange={(e) => update("identity", { selfie_confirmed: e.target.checked })} />
                <span className="text-sm">I confirm I will complete the live selfie + biometric check in the driver app.</span>
              </label>
            </Field>
          </div>
        )}

        {stage === 2 && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Driving licence number"><Input value={data.license?.license_no ?? ""} onChange={(e) => update("license", { license_no: e.target.value })} maxLength={32} /></Field>
            <Field label="PSV licence number (if applicable)"><Input value={data.license?.psv_no ?? ""} onChange={(e) => update("license", { psv_no: e.target.value })} maxLength={32} /></Field>
            <Field label="Years driving experience" className="sm:col-span-2">
              <Input type="number" min={0} max={60} value={data.license?.years_experience ?? ""} onChange={(e) => update("license", { years_experience: Number(e.target.value) })} />
            </Field>
          </div>
        )}

        {stage === 3 && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Vehicle make"><Input value={data.vehicle?.make ?? ""} onChange={(e) => update("vehicle", { make: e.target.value })} /></Field>
            <Field label="Vehicle model"><Input value={data.vehicle?.model ?? ""} onChange={(e) => update("vehicle", { model: e.target.value })} /></Field>
            <Field label="Year of manufacture"><Input type="number" min={2005} max={new Date().getFullYear()} value={data.vehicle?.year ?? ""} onChange={(e) => update("vehicle", { year: Number(e.target.value) })} /></Field>
            <Field label="Number plate"><Input value={data.vehicle?.plate ?? ""} onChange={(e) => update("vehicle", { plate: e.target.value.toUpperCase() })} maxLength={16} /></Field>
            <Field label="Insurance reference" className="sm:col-span-2"><Input value={data.vehicle?.insurance_ref ?? ""} onChange={(e) => update("vehicle", { insurance_ref: e.target.value })} maxLength={64} /></Field>
          </div>
        )}

        {stage === 4 && (
          <div className="space-y-3">
            <Consent label="I consent to background screening (employment + reference checks)." checked={!!data.compliance?.background_consent} onChange={(c) => update("compliance", { background_consent: c })} />
            <Consent label="I authorise TaxiD to verify my criminal record with relevant authorities." checked={!!data.compliance?.criminal_consent} onChange={(c) => update("compliance", { criminal_consent: c })} />
            <p className="text-xs text-muted-foreground pt-2">Background and fraud checks typically complete within 48 hours.</p>
          </div>
        )}

        {stage === 5 && (
          <div className="space-y-3">
            <Consent label="I have read the Road Safety Fundamentals module." checked={!!data.training?.safety_done} onChange={(c) => update("training", { safety_done: c })} />
            <Consent label="I have read the Platform Operations module." checked={!!data.training?.platform_done} onChange={(c) => update("training", { platform_done: c })} />
            <Button asChild variant="outline" size="sm"><a href="/driver/training">Open Driver Academy</a></Button>
          </div>
        )}

        {stage === 6 && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-secondary/40 border border-border text-sm">
              Review your details below. Submitting moves your application into our review queue.
            </div>
            <Textarea readOnly rows={10} value={JSON.stringify(data, null, 2)} className="font-mono text-xs" />
          </div>
        )}

        {stage === 7 && (
          <div className="py-8 text-center">
            <Rocket className="mx-auto mb-4 h-12 w-12 text-primary" aria-hidden="true" />
            <h3 className="mb-2 text-2xl font-bold tracking-tight">Application Successfully Submitted</h3>
            <p className="mx-auto mb-2 max-w-xl text-muted-foreground">
              Your application is with our Driver Compliance Team. Verification is normally completed within 24 hours.
            </p>
            <p className="mx-auto mb-6 max-w-xl text-sm text-muted-foreground">
              You'll be notified by email, SMS and in-app notification. On approval, your driver dashboard and
              settlement wallet activate automatically.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={() => navigate("/dashboard/driver")}>Go to driver dashboard</Button>
              <Button asChild variant="outline"><a href="/driver/support">Contact driver support</a></Button>
            </div>
          </div>
        )}

        {/* Nav */}
        {stage < 7 && (
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
            <Button variant="outline" onClick={() => setStage((s) => Math.max(1, s - 1))} disabled={stage === 1}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            {stage < 6 ? (
              <Button onClick={() => setStage((s) => Math.min(7, s + 1))}>
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={saving}>{saving ? "Submitting…" : "Submit application"}</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-sm">{label}</Label>
      {children}
    </div>
  );
}

function Consent({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 p-3 rounded-md border border-border bg-background cursor-pointer hover:bg-muted/50">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <span className="text-sm">{label}</span>
    </label>
  );
}
