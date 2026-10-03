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
import { DocumentUploadField } from "@/components/common/DocumentUploadField";
import {
  User, Car, FileCheck, ShieldCheck, GraduationCap, CheckCircle2, Rocket, ChevronLeft, ChevronRight, Save, Info,
} from "lucide-react";

interface Draft {
  identity?: { 
    national_id?: string; 
    full_name?: string; 
    phone?: string; 
    kra_pin?: string; 
    selfie_confirmed?: boolean 
  };
  license?: { 
    license_no?: string; 
    psv_no?: string; 
    pcc_no?: string;
    years_experience?: number 
  };
  vehicle?: { 
    make?: string; 
    model?: string; 
    year?: number; 
    plate?: string; 
    insurance_ref?: string;
    logbook_ref?: string;
    inspection_ref?: string;
  };
  compliance?: { background_consent?: boolean; criminal_consent?: boolean };
  training?: { safety_done?: boolean; platform_done?: boolean };
  approval?: { reviewed?: boolean };
}

const STAGES = [
  { id: 1, title: "Identity",      icon: User,          desc: "National ID, KRA PIN and photo verification." },
  { id: 2, title: "Driving",       icon: FileCheck,     desc: "Licences, PSV badge and police clearance." },
  { id: 3, title: "Vehicle",       icon: Car,           desc: "Registration, inspection and insurance." },
  { id: 4, title: "Compliance",    icon: ShieldCheck,   desc: "Background, criminal and fraud screening." },
  { id: 5, title: "Training",      icon: GraduationCap, desc: "Safety and platform training modules." },
  { id: 6, title: "Review",        icon: CheckCircle2,  desc: "Final verification of submitted details." },
  { id: 7, title: "Activation",    icon: Rocket,        desc: "Dashboard access and wallet activation." },
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

  useEffect(() => {
    if (loading) return;
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ stage, data })); } catch { /* noop */ }
  }, [stage, data, loading]);

  const update = <K extends keyof Draft>(key: K, val: Partial<Draft[K]>) =>
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

  if (loading) return <div className="p-12 text-center text-muted-foreground italic">Syncing application status...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-primary font-bold">Step {stage} of {STAGES.length}</div>
            <h2 className="text-2xl font-bold mt-1">{STAGES[stage - 1].title}</h2>
            <p className="text-sm text-muted-foreground">{STAGES[stage - 1].desc}</p>
          </div>
          <Button variant="outline" size="sm" onClick={saveServer} disabled={!userId || saving} className="hidden sm:flex">
            <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save draft"}
          </Button>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      <div className="p-6 md:p-8 rounded-3xl bg-card border border-border shadow-sm">
        {stage === 1 && (
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="sm:col-span-2">
              <DocumentUploadField 
                label="Profile Photo (Selfie)" 
                description="Clear photo of your face. No hats or sunglasses. This will be shown to riders."
                required
              />
            </div>
            <Field label="Full name (as on National ID)">
              <Input value={data.identity?.full_name ?? ""} onChange={(e) => update("identity", { full_name: e.target.value })} placeholder="John Doe" />
            </Field>
            <Field label="National ID / Passport number">
              <Input value={data.identity?.national_id ?? ""} onChange={(e) => update("identity", { national_id: e.target.value })} placeholder="12345678" />
            </Field>
            <Field label="Phone (M-Pesa registered)">
              <Input type="tel" placeholder="07XX XXX XXX" value={data.identity?.phone ?? ""} onChange={(e) => update("identity", { phone: e.target.value })} />
            </Field>
            <Field label="KRA PIN Number">
              <Input value={data.identity?.kra_pin ?? ""} onChange={(e) => update("identity", { kra_pin: e.target.value.toUpperCase() })} placeholder="A00XXXXXXXX" maxLength={11} />
            </Field>
            <div className="sm:col-span-2">
              <DocumentUploadField label="National ID (Front & Back)" description="Scan or take a clear photo of both sides of your ID card." required />
            </div>
          </div>
        )}

        {stage === 2 && (
          <div className="grid sm:grid-cols-2 gap-6">
            <Field label="Driving licence number"><Input value={data.license?.license_no ?? ""} onChange={(e) => update("license", { license_no: e.target.value })} /></Field>
            <Field label="Years driving experience"><Input type="number" value={data.license?.years_experience ?? ""} onChange={(e) => update("license", { years_experience: Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2 space-y-6">
              <DocumentUploadField label="Driving Licence" description="Upload a clear photo of your valid NTSA driving licence." required />
              <div className="grid sm:grid-cols-2 gap-4">
                <DocumentUploadField label="PSV Badge" description="Required for all public service vehicle drivers." />
                <DocumentUploadField label="Police Clearance (Good Conduct)" description="Certificate issued within the last 6 months." />
              </div>
            </div>
          </div>
        )}

        {stage === 3 && (
          <div className="grid sm:grid-cols-2 gap-6">
            <Field label="Vehicle Make"><Input value={data.vehicle?.make ?? ""} onChange={(e) => update("vehicle", { make: e.target.value })} placeholder="Toyota" /></Field>
            <Field label="Vehicle Model"><Input value={data.vehicle?.model ?? ""} onChange={(e) => update("vehicle", { model: e.target.value })} placeholder="Fielder" /></Field>
            <Field label="Year (2012 or newer)"><Input type="number" value={data.vehicle?.year ?? ""} onChange={(e) => update("vehicle", { year: Number(e.target.value) })} /></Field>
            <Field label="Plate Number"><Input value={data.vehicle?.plate ?? ""} onChange={(e) => update("vehicle", { plate: e.target.value.toUpperCase() })} placeholder="KAA 001A" /></Field>
            <div className="sm:col-span-2 space-y-6">
              <DocumentUploadField label="Vehicle Inspection Report" description="Annual NTSA inspection certificate." required />
              <DocumentUploadField label="Vehicle Insurance / PSV Insurance" description="Current comprehensive or PSV insurance cover." required />
              <DocumentUploadField label="Logbook / Sales Agreement" description="Proof of ownership or authorized use." />
            </div>
          </div>
        )}

        {stage === 4 && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 flex gap-3">
              <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Security Screening</p>
                <p className="text-xs text-muted-foreground mt-0.5">We partner with verified vendors to ensure network safety. Checks include criminal record and employment history.</p>
              </div>
            </div>
            <Consent label="I consent to professional background screening and reference checks." checked={!!data.compliance?.background_consent} onChange={(c) => update("compliance", { background_consent: c })} />
            <Consent label="I authorise TaxiD to verify my criminal record with the DCI / Police." checked={!!data.compliance?.criminal_consent} onChange={(c) => update("compliance", { criminal_consent: c })} />
          </div>
        )}

        {stage === 5 && (
          <div className="space-y-4">
             <div className="p-4 rounded-xl bg-secondary/50 border border-border flex gap-3">
              <GraduationCap className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Driver Academy</p>
                <p className="text-xs text-muted-foreground mt-0.5">Please complete the mandatory safety and platform modules before activation.</p>
              </div>
            </div>
            <Consent label="I have read and understood the Road Safety Fundamentals." checked={!!data.training?.safety_done} onChange={(c) => update("training", { safety_done: c })} />
            <Consent label="I have completed the TaxiD Platform Operations training." checked={!!data.training?.platform_done} onChange={(c) => update("training", { platform_done: c })} />
            <Button asChild variant="outline" className="w-full mt-2"><a href="/driver/training">Open Academy Modules</a></Button>
          </div>
        )}

        {stage === 6 && (
          <div className="space-y-6">
            <div className="p-4 rounded-xl bg-success/5 border border-success/20 text-success text-sm flex gap-2 items-center">
              <CheckCircle2 className="h-4 w-4" />
              All steps complete. Please review your information below.
            </div>
            
            <div className="grid gap-6 sm:grid-cols-2 text-sm">
              <div className="space-y-3">
                <h4 className="font-bold border-b pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Identity & Documents</h4>
                <SummaryItem label="Full Name" value={data.identity?.full_name} />
                <SummaryItem label="ID Number" value={data.identity?.national_id} />
                <SummaryItem label="KRA PIN" value={data.identity?.kra_pin} />
                <SummaryItem label="Documents" value="Selfie, ID Scan uploaded" />
              </div>
              <div className="space-y-3">
                <h4 className="font-bold border-b pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Vehicle Details</h4>
                <SummaryItem label="Make/Model" value={`${data.vehicle?.make || ""} ${data.vehicle?.model || ""}`} />
                <SummaryItem label="Plate" value={data.vehicle?.plate} />
                <SummaryItem label="Year" value={data.vehicle?.year?.toString()} />
                <SummaryItem label="Documents" value="Insurance, Inspection uploaded" />
              </div>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Info className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Technical manifest</span>
              </div>
              <Textarea readOnly rows={4} value={JSON.stringify(data, null, 2)} className="font-mono text-[10px] bg-background/50" />
            </div>
          </div>
        )}

        {stage === 7 && (
          <div className="py-12 text-center">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Rocket className="h-10 w-10 text-primary" />
            </div>
            <h3 className="text-3xl font-bold tracking-tight mb-3">Application Submitted</h3>
            <p className="max-w-md mx-auto text-muted-foreground leading-relaxed">
              Your documents are now in the verification queue. Our compliance team typically reviews applications within 24 hours.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button onClick={() => navigate("/dashboard/driver")} size="lg" className="w-full sm:w-auto">Enter Driver Dashboard</Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto"><a href="/driver/support">Support Centre</a></Button>
            </div>
          </div>
        )}

        {stage < 7 && (
          <div className="flex items-center justify-between mt-10 pt-6 border-t border-border">
            <Button variant="ghost" onClick={() => setStage((s) => Math.max(1, s - 1))} disabled={stage === 1}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            {stage < 6 ? (
              <Button onClick={() => setStage((s) => Math.min(7, s + 1))} className="px-8">
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={saving} size="lg" className="px-10">
                {saving ? "Submitting..." : "Confirm & Submit"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold">{label}</Label>
      {children}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-right">{value || "—"}</span>
    </div>
  );
}

function Consent({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-start gap-4 p-4 rounded-xl border border-border bg-background cursor-pointer hover:bg-muted/30 transition-colors">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
      <span className="text-sm leading-tight">{label}</span>
    </label>
  );
}
