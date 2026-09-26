/**
 * Delivery & Logistics Partner Portal — public onboarding surface.
 *
 * Applicants (couriers, fleets, carriers, warehouses, merchants) submit a
 * business profile which lands in the Enterprise Logistics OS →
 * Partner Management → Onboarding Approvals queue for review.
 *
 * Composition-only: reuses MarketingLayout, EnterpriseHeroBand, Card, Input,
 * Button, Badge and the existing `delivery_onboarding` table.
 */
import { useCallback, useEffect, useState } from "react";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { AppLink } from "@/components/nav/AppLink";
import {
  Truck, Warehouse, Package, Building2, ShieldCheck, Clock, FileCheck,
} from "lucide-react";

const PARTNER_TYPES = [
  { key: "courier", label: "Courier / Rider", icon: Package, desc: "Independent riders and last-mile couriers." },
  { key: "fleet", label: "Fleet Operator", icon: Truck, desc: "Vans, trucks and dedicated delivery fleets." },
  { key: "carrier", label: "Line-haul Carrier", icon: Building2, desc: "Regional freight, cross-dock and line haul." },
  { key: "warehouse", label: "Warehouse / Hub", icon: Warehouse, desc: "Storage, fulfilment and distribution centres." },
] as const;

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  submitted: "bg-status-warning/12 text-status-warning border-status-warning/25",
  in_review: "bg-status-warning/12 text-status-warning border-status-warning/25",
  approved: "bg-status-success/12 text-status-success border-status-success/25",
  rejected: "bg-status-danger/12 text-status-danger border-status-danger/25",
};

interface FormState {
  partner_type: string;
  company_name: string;
  registration_number: string;
  tax_pin: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  country: string;
  city: string;
  service_area: string;
  fleet_size: string;
  vehicle_types: string;
  monthly_volume: string;
  notes: string;
}

const EMPTY: FormState = {
  partner_type: "courier",
  company_name: "",
  registration_number: "",
  tax_pin: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  country: "Kenya",
  city: "",
  service_area: "",
  fleet_size: "",
  vehicle_types: "",
  monthly_volume: "",
  notes: "",
};

export default function PartnerPortal() {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const set = <K extends keyof FormState>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let active = true;
    (async () => {
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from("delivery_onboarding")
        .select("*")
        .eq("user_id", user.id)
        .eq("module", "logistics_partner")
        .maybeSingle();
      if (!active) return;
      if (data) {
        setStatus(data.status as string);
        setReviewNotes((data.review_notes as string | null) ?? null);
        setForm({
          partner_type: (data.partner_type as string) ?? "courier",
          company_name: data.company_name ?? "",
          registration_number: (data.registration_number as string | null) ?? "",
          tax_pin: (data.tax_pin as string | null) ?? "",
          contact_name: data.contact_name ?? "",
          contact_email: data.contact_email ?? "",
          contact_phone: data.contact_phone ?? "",
          country: (data.country as string | null) ?? "Kenya",
          city: (data.city as string | null) ?? "",
          service_area: data.service_area ?? "",
          fleet_size: data.fleet_size != null ? String(data.fleet_size) : "",
          vehicle_types: (data.vehicle_types as string | null) ?? "",
          monthly_volume: data.monthly_volume != null ? String(data.monthly_volume) : "",
          notes: (data.notes as string | null) ?? "",
        });
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [user]);

  const submit = useCallback(async (nextStatus: "draft" | "submitted") => {
    if (!user) {
      toast({ title: "Sign in required", description: "Create an account to submit a partner application." });
      return;
    }
    if (nextStatus === "submitted") {
      const missing = !form.company_name || !form.contact_name || !form.contact_email || !form.contact_phone || !form.city;
      if (missing) {
        toast({ title: "Incomplete application", description: "Company, contact details and city are required.", variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    const { error } = await supabase.from("delivery_onboarding").upsert({
      user_id: user.id,
      module: "logistics_partner",
      step: nextStatus === "submitted" ? 5 : 1,
      status: nextStatus,
      partner_type: form.partner_type,
      company_name: form.company_name,
      registration_number: form.registration_number || null,
      tax_pin: form.tax_pin || null,
      contact_name: form.contact_name,
      contact_email: form.contact_email,
      contact_phone: form.contact_phone,
      country: form.country || null,
      city: form.city || null,
      service_area: form.service_area || null,
      fleet_size: form.fleet_size ? Number(form.fleet_size) : null,
      vehicle_types: form.vehicle_types || null,
      monthly_volume: form.monthly_volume ? Number(form.monthly_volume) : null,
      notes: form.notes || null,
      submitted_at: nextStatus === "submitted" ? new Date().toISOString() : null,
    }, { onConflict: "user_id,module" });
    setSaving(false);
    if (error) {
      toast({ title: "Could not save application", description: error.message, variant: "destructive" });
      return;
    }
    setStatus(nextStatus);
    toast({
      title: nextStatus === "submitted" ? "Application submitted" : "Draft saved",
      description: nextStatus === "submitted"
        ? "Our logistics onboarding team will review and respond shortly."
        : "You can return any time to complete your application.",
    });
  }, [form, user]);

  const locked = status === "approved" || status === "in_review";

  return (
    <MarketingLayout>
      <div className="container mx-auto max-w-[1200px] px-4 py-8 space-y-8">
        <EnterpriseHeroBand
          eyebrow="Delivery & Logistics"
          title={<h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Partner Portal</h1>}
          subtitle="Join the Yalla Mobility logistics network — couriers, fleets, carriers and warehouses. One application, governed review, live operational access on approval."
          actions={
            status ? (
              <Badge variant="outline" className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground">
                Application status: {status.replace("_", " ")}
              </Badge>
            ) : undefined
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PARTNER_TYPES.map((t) => {
            const Icon = t.icon;
            const active = form.partner_type === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => set("partner_type", t.key)}
                aria-pressed={active}
                className={`text-left rounded-xl border p-4 transition-all ${active ? "border-primary bg-primary/5 shadow-enterprise" : "border-border hover:border-primary/40"}`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4 text-primary" aria-hidden />
                  {t.label}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
              </button>
            );
          })}
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base tracking-tight">Business profile</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field id="company_name" label="Registered company / trading name" value={form.company_name} onChange={(v) => set("company_name", v)} disabled={locked} />
              <Field id="registration_number" label="Company registration number" value={form.registration_number} onChange={(v) => set("registration_number", v)} disabled={locked} />
              <Field id="tax_pin" label="KRA PIN" value={form.tax_pin} onChange={(v) => set("tax_pin", v)} disabled={locked} />
              <Field id="contact_name" label="Primary contact" value={form.contact_name} onChange={(v) => set("contact_name", v)} disabled={locked} />
              <Field id="contact_email" label="Contact email" type="email" value={form.contact_email} onChange={(v) => set("contact_email", v)} disabled={locked} />
              <Field id="contact_phone" label="Contact phone" value={form.contact_phone} onChange={(v) => set("contact_phone", v)} disabled={locked} />
              <Field id="country" label="Country" value={form.country} onChange={(v) => set("country", v)} disabled={locked} />
              <Field id="city" label="City / base of operations" value={form.city} onChange={(v) => set("city", v)} disabled={locked} />
              <Field id="service_area" label="Service coverage" value={form.service_area} onChange={(v) => set("service_area", v)} disabled={locked} />
              <Field id="vehicle_types" label="Vehicle types" value={form.vehicle_types} onChange={(v) => set("vehicle_types", v)} disabled={locked} />
              <Field id="fleet_size" label="Fleet size" type="number" value={form.fleet_size} onChange={(v) => set("fleet_size", v)} disabled={locked} />
              <Field id="monthly_volume" label="Monthly delivery volume" type="number" value={form.monthly_volume} onChange={(v) => set("monthly_volume", v)} disabled={locked} />
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="notes">Anything else we should know</Label>
                <Textarea id="notes" rows={4} value={form.notes} disabled={locked} onChange={(e) => set("notes", e.target.value)} />
              </div>
              <div className="sm:col-span-2 flex flex-wrap gap-3 pt-1">
                <Button onClick={() => submit("submitted")} disabled={saving || loading || locked}>
                  {status === "submitted" ? "Resubmit application" : "Submit application"}
                </Button>
                <Button variant="outline" onClick={() => submit("draft")} disabled={saving || loading || locked}>
                  Save draft
                </Button>
                {!user && (
                  <AppLink to="/auth?redirect=/delivery/portal" trackId="portal:signin" className="self-center text-sm text-primary underline">
                    Sign in to submit
                  </AppLink>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base tracking-tight">Onboarding journey</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  { icon: FileCheck, t: "Application", d: "Submit your business profile and coverage." },
                  { icon: ShieldCheck, t: "Compliance review", d: "KRA PIN, registration and insurance checks." },
                  { icon: Clock, t: "Operational review", d: "Capacity, SLA and service-area fit." },
                  { icon: Truck, t: "Activation", d: "Dispatch access, POD tooling and settlement." },
                ].map((s, i) => (
                  <div key={s.t} className="flex gap-3">
                    <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary text-xs font-semibold">{i + 1}</div>
                    <div>
                      <div className="font-medium">{s.t}</div>
                      <p className="text-xs text-muted-foreground">{s.d}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {status && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base tracking-tight">Your application</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Badge variant="outline" className={STATUS_TONE[status] ?? STATUS_TONE.draft}>
                    {status.replace("_", " ")}
                  </Badge>
                  {reviewNotes && <p className="text-xs text-muted-foreground">Reviewer note: {reviewNotes}</p>}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
}

function Field({
  id, label, value, onChange, type = "text", disabled,
}: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
