/**
 * Supabase-backed management panels for the 4 delivery modules.
 *
 * State is now persisted to:
 *   - `delivery_onboarding` (wizard progress per user × module)
 *   - `driver_documents` + `delivery_document_events` (KYC + audit timeline)
 *   - `vehicles` (filtered by `module` discriminator)
 *
 * All writes go through RLS — users only see/modify their own rows;
 * admins/operations admins can see everything.
 */
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileCheck,
  Trash2,
  Plus,
  CheckCircle2,
  Clock,
  ArrowRight,
  ArrowLeft,
  Car,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ModuleMeta } from "./ModuleShell";
import { DocumentUploader, type UploadedDoc, type DocStatus, type DocEvent } from "./DocumentUploader";
import { useAuth } from "@/hooks/useAuth";

/* ----------------------------- Onboarding ------------------------------ */

interface OnboardingRow {
  id?: string;
  step: number;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  service_area: string | null;
  fleet_size: number | null;
  submitted_at: string | null;
}

const EMPTY_ONBOARDING: OnboardingRow = {
  step: 0,
  company_name: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  service_area: "",
  fleet_size: null,
  submitted_at: null,
};

export function OnboardingWizard({ module }: { module: ModuleMeta }) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<OnboardingRow>(EMPTY_ONBOARDING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("delivery_onboarding" as never)
      .select("*")
      .eq("user_id", user.id)
      .eq("module", module.id)
      .maybeSingle();
    if (error) {
      toast.error("Could not load onboarding state");
    }
    setState((data as OnboardingRow) ?? EMPTY_ONBOARDING);
    setLoading(false);
  }, [user, module.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function persist(next: OnboardingRow) {
    if (!user) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      module: module.id,
      step: next.step,
      company_name: next.company_name,
      contact_name: next.contact_name,
      contact_email: next.contact_email,
      contact_phone: next.contact_phone,
      service_area: next.service_area,
      fleet_size: next.fleet_size,
      submitted_at: next.submitted_at,
    };
    const { error } = await supabase
      .from("delivery_onboarding" as never)
      .upsert(payload as never, { onConflict: "user_id,module" });
    setSaving(false);
    if (error) toast.error("Could not save progress");
  }

  function update<K extends keyof OnboardingRow>(k: K, v: OnboardingRow[K]) {
    setState((s) => ({ ...s, [k]: v }));
  }

  const steps = [
    { title: "Company", fields: ["company_name"] as const },
    { title: "Primary contact", fields: ["contact_name", "contact_email", "contact_phone"] as const },
    { title: "Operations", fields: ["service_area", "fleet_size"] as const },
    { title: "Review", fields: [] as const },
  ];
  const total = steps.length;
  const pct = Math.min(100, Math.round(((state.step + 1) / total) * 100));

  async function next() {
    const required = steps[state.step].fields;
    for (const f of required) {
      const v = state[f as keyof OnboardingRow];
      if (v === null || v === undefined || String(v).trim() === "") {
        toast.error("Please fill all fields");
        return;
      }
    }
    const updated = { ...state, step: Math.min(total - 1, state.step + 1) };
    setState(updated);
    await persist(updated);
  }
  async function back() {
    const updated = { ...state, step: Math.max(0, state.step - 1) };
    setState(updated);
    await persist(updated);
  }
  async function submit() {
    const updated = { ...state, submitted_at: new Date().toISOString() };
    setState(updated);
    await persist(updated);
    toast.success(`${module.label} onboarding submitted for review`);
  }
  async function reset() {
    const updated = { ...EMPTY_ONBOARDING };
    setState(updated);
    await persist(updated);
  }

  if (authLoading || loading) {
    return (
      <Card className="p-6 space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-20 w-full" />
      </Card>
    );
  }
  if (!user) return <SignedOutNotice what="onboarding" />;

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Onboarding wizard</h3>
          <p className="text-xs text-muted-foreground">
            Step {Math.min(state.step + 1, total)} of {total} · {steps[state.step].title}
            {saving ? " · saving…" : ""}
          </p>
        </div>
        {state.submitted_at ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Submitted
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" /> In progress
          </Badge>
        )}
      </div>
      <Progress value={pct} className="h-2" />

      {state.step === 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Company / operator name</Label>
          <Input
            value={state.company_name ?? ""}
            onChange={(e) => update("company_name", e.target.value)}
            placeholder={`e.g. ${module.label} Co.`}
          />
        </div>
      )}

      {state.step === 1 && (
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Full name</Label>
            <Input value={state.contact_name ?? ""} onChange={(e) => update("contact_name", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              value={state.contact_email ?? ""}
              onChange={(e) => update("contact_email", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Phone (+254…)</Label>
            <Input value={state.contact_phone ?? ""} onChange={(e) => update("contact_phone", e.target.value)} />
          </div>
        </div>
      )}

      {state.step === 2 && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Primary service area</Label>
            <Input
              value={state.service_area ?? ""}
              onChange={(e) => update("service_area", e.target.value)}
              placeholder="Nairobi · Mombasa · …"
            />
          </div>
          <div>
            <Label className="text-xs">Fleet size (vehicles)</Label>
            <Input
              type="number"
              min={0}
              value={state.fleet_size ?? ""}
              onChange={(e) =>
                update("fleet_size", e.target.value === "" ? null : Number(e.target.value))
              }
            />
          </div>
        </div>
      )}

      {state.step === 3 && (
        <Card className="p-4 bg-muted/40 text-sm space-y-1">
          <div><span className="text-muted-foreground">Company:</span> {state.company_name || "—"}</div>
          <div>
            <span className="text-muted-foreground">Contact:</span>{" "}
            {state.contact_name || "—"} · {state.contact_email || "—"} · {state.contact_phone || "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Operations:</span> {state.service_area || "—"} ·{" "}
            {state.fleet_size ?? 0} vehicles
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 justify-between">
        <Button variant="ghost" size="sm" onClick={reset}>Reset</Button>
        <div className="flex gap-2">
          {state.step > 0 && (
            <Button variant="outline" size="sm" onClick={back}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}
          {state.step < total - 1 ? (
            <Button size="sm" onClick={next}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={submit}>Submit onboarding</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------- KYC & documents ------------------------- */

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);

function mapStatus(s: string): DocStatus {
  switch (s) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "EXPIRED":
      return "expired";
    case "PENDING":
      return "pending";
    default:
      return "missing";
  }
}

export function KycDocumentsPanel({ module }: { module: ModuleMeta }) {
  const { user, loading: authLoading } = useAuth();
  const [docsByLabel, setDocsByLabel] = useState<Record<string, UploadedDoc | undefined>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("driver_documents")
      .select("id,doc_type,doc_label,status,file_url,file_name,file_size,rejection_reason,verified_at")
      .eq("driver_id", user.id)
      .eq("module", module.id);
    if (error) {
      toast.error("Could not load documents");
      setLoading(false);
      return;
    }
    const ids = (data ?? []).map((d) => d.id);
    let eventsByDoc: Record<string, DocEvent[]> = {};
    if (ids.length) {
      const { data: evs } = await supabase
        .from("delivery_document_events" as never)
        .select("id,document_id,event_type,notes,created_at")
        .in("document_id", ids)
        .order("created_at", { ascending: true });
      eventsByDoc = ((evs as Array<DocEvent & { document_id: string }>) ?? []).reduce(
        (acc, e) => {
          (acc[e.document_id] ??= []).push(e);
          return acc;
        },
        {} as Record<string, DocEvent[]>
      );
    }
    const map: Record<string, UploadedDoc> = {};
    for (const d of (data ?? []) as Array<{
      id: string;
      doc_type: string;
      doc_label: string | null;
      status: string;
      file_url: string | null;
      file_name: string | null;
      file_size: number | null;
      rejection_reason: string | null;
      verified_at: string | null;
    }>) {
      const label = d.doc_label ?? d.doc_type;
      map[label] = {
        id: d.id,
        doc_label: label,
        doc_type: d.doc_type,
        status: mapStatus(d.status),
        file_url: d.file_url,
        file_name: d.file_name,
        file_size: d.file_size,
        rejection_reason: d.rejection_reason,
        verified_at: d.verified_at,
        events: eventsByDoc[d.id] ?? [],
      };
    }
    setDocsByLabel(map);
    setLoading(false);
  }, [user, module.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (authLoading || loading) {
    return (
      <Card className="p-6 space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }
  if (!user) return <SignedOutNotice what="documents" />;

  const items = module.kycChecklist.map((label) => ({
    label,
    existing: docsByLabel[label],
  }));
  const verified = items.filter((i) => i.existing?.status === "approved").length;
  const pct = Math.round((verified / Math.max(1, items.length)) * 100);

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-primary" /> KYC & documents
          </h3>
          <p className="text-xs text-muted-foreground">
            {verified} of {items.length} verified · {module.label} checklist
          </p>
        </div>
        <Badge variant={pct === 100 ? "default" : "outline"}>{pct}% complete</Badge>
      </div>
      <Progress value={pct} className="h-2" />

      <div className="space-y-2">
        {items.map((item) => (
          <DocumentUploader
            key={item.label}
            slug={slugify(item.label)}
            label={item.label}
            module={module.id}
            existing={item.existing}
            onChanged={load}
          />
        ))}
      </div>
    </Card>
  );
}

/* ----------------------------- Vehicles -------------------------------- */

interface ModuleVehicle {
  id: string;
  vehicle_category: string | null;
  number_plate: string;
  make: string;
  model: string;
  year: number | null;
  vehicle_status: string;
  vehicle_type: string;
}

export function VehiclesPanel({ module }: { module: ModuleMeta }) {
  const { user, loading: authLoading } = useAuth();
  const [vehicles, setVehicles] = useState<ModuleVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState(module.vehicleCategories[0]);
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("vehicles")
      .select("id,vehicle_category,number_plate,make,model,year,vehicle_status,vehicle_type")
      .eq("owner_id", user.id)
      .eq("module", module.id)
      .order("created_at", { ascending: false });
    if (error) toast.error("Could not load vehicles");
    setVehicles((data as ModuleVehicle[]) ?? []);
    setLoading(false);
  }, [user, module.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!user) return;
    if (!plate || !make || !model) {
      toast.error("Plate, make and model are required");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("vehicles")
      .insert({
        owner_id: user.id,
        module: module.id,
        vehicle_category: category,
        vehicle_type: module.id,
        number_plate: plate.toUpperCase(),
        make,
        model,
        year: year ? Number(year) : null,
        vehicle_status: "active",
      } as never);
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("vehicles_number_plate_key")
          ? "That number plate is already registered."
          : error.message
      );
      return;
    }
    setPlate(""); setMake(""); setModel(""); setYear("");
    toast.success("Vehicle added");
    void load();
  }

  async function remove(id: string) {
    setBusy(true);
    const { error } = await supabase.from("vehicles").delete().eq("id", id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vehicle removed");
    void load();
  }

  async function toggle(v: ModuleVehicle) {
    const next = v.vehicle_status === "active" ? "inactive" : "active";
    setBusy(true);
    const { error } = await supabase
      .from("vehicles")
      .update({ vehicle_status: next } as never)
      .eq("id", v.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    void load();
  }

  if (authLoading || loading) {
    return (
      <Card className="p-6 space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }
  if (!user) return <SignedOutNotice what="vehicles" />;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Car className="h-4 w-4 text-primary" /> Vehicles
        </h3>
        <Badge variant="outline">{vehicles.length} registered</Badge>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        <div>
          <Label className="text-xs">Category</Label>
          <select
            className="w-full h-10 border rounded-md px-2 bg-background text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {module.vehicleCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Plate</Label>
          <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="KDX 123A" />
        </div>
        <div>
          <Label className="text-xs">Make</Label>
          <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" />
        </div>
        <div>
          <Label className="text-xs">Model</Label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Hiace" />
        </div>
        <div>
          <Label className="text-xs">Year</Label>
          <Input
            type="number"
            min={1990}
            max={new Date().getFullYear() + 1}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
      </div>
      <Button size="sm" onClick={add} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
        Add vehicle
      </Button>

      <div className="space-y-2">
        {vehicles.length === 0 && (
          <p className="text-sm text-muted-foreground">No vehicles registered yet.</p>
        )}
        {vehicles.map((v) => (
          <div key={v.id} className="flex flex-wrap items-center gap-3 border rounded-lg p-3 text-sm">
            <div className="flex-1 min-w-[200px]">
              <div className="font-medium">
                {v.number_plate} · {v.make} {v.model}
                {v.year ? ` (${v.year})` : ""}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {v.vehicle_category ?? "—"}
              </div>
            </div>
            <Badge variant={v.vehicle_status === "active" ? "default" : "secondary"}>
              {v.vehicle_status}
            </Badge>
            <Button size="sm" variant="outline" onClick={() => toggle(v)} disabled={busy}>
              {v.vehicle_status === "active" ? "Deactivate" : "Activate"}
            </Button>
            <Button size="icon" variant="ghost" onClick={() => remove(v.id)} disabled={busy}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ----------------------------- Helpers --------------------------------- */

function SignedOutNotice({ what }: { what: string }) {
  return (
    <Card className="p-6 flex items-start gap-3 bg-status-warning/10 border-status-warning/30 dark:bg-status-warning/30 dark:border-status-warning/30">
      <AlertTriangle className="h-5 w-5 text-status-warning mt-0.5" />
      <div className="text-sm">
        <div className="font-semibold">Sign in required</div>
        <p className="text-muted-foreground">
          You need to be signed in to manage {what} for this delivery module.
        </p>
        <a className="text-primary underline mt-2 inline-block" href="/auth">
          Sign in
        </a>
      </div>
    </Card>
  );
}
