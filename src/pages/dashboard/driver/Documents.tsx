import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  FileCheck, Upload, ShieldAlert, Clock, CheckCircle2, XCircle, Eye, RefreshCw,
} from "lucide-react";

/**
 * Driver document control — the only driver-facing write path into
 * public.driver_documents. Files land in the private `driver-documents`
 * bucket under `<auth.uid()>/…` (storage policy requires that prefix) and
 * driver_documents.driver_id is the authenticated user id (matches RLS).
 */

interface DocRow {
  id: string;
  doc_type: string;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  document_number: string | null;
  status: string;
  rejection_reason: string | null;
  expiry_date: string | null;
  created_at: string;
  verified_at: string | null;
}

// `type` MUST match the public.driver_documents doc_type CHECK constraint
// (NATIONAL_ID, PASSPORT, SELFIE, DRIVING_LICENSE, PSV_LICENSE, VEHICLE_LOGBOOK,
//  VEHICLE_INSPECTION, VEHICLE_INSURANCE, GOOD_CONDUCT, KRA_PIN, OTHER).
const REQUIRED_DOCS: { type: string; label: string; hint: string; needsNumber: boolean; needsExpiry: boolean }[] = [
  { type: "NATIONAL_ID", label: "National ID", hint: "Both sides, clearly legible", needsNumber: true, needsExpiry: false },
  { type: "DRIVING_LICENSE", label: "Driving licence", hint: "Valid Kenyan driving licence", needsNumber: true, needsExpiry: true },
  { type: "PSV_LICENSE", label: "PSV badge", hint: "Required for ride-hailing service", needsNumber: true, needsExpiry: true },
  { type: "GOOD_CONDUCT", label: "Certificate of good conduct", hint: "DCI certificate, issued within 3 years", needsNumber: true, needsExpiry: false },
  { type: "VEHICLE_LOGBOOK", label: "Vehicle logbook", hint: "NTSA logbook for the vehicle you drive", needsNumber: true, needsExpiry: false },
  { type: "VEHICLE_INSURANCE", label: "Vehicle insurance", hint: "PSV/commercial insurance certificate", needsNumber: true, needsExpiry: true },
  { type: "VEHICLE_INSPECTION", label: "NTSA inspection", hint: "Current inspection certificate", needsNumber: false, needsExpiry: true },
  { type: "KRA_PIN", label: "KRA PIN certificate", hint: "Required for eTIMS and payouts", needsNumber: true, needsExpiry: false },
];


const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;

function statusMeta(status: string, expiry: string | null) {
  const s = status.toUpperCase();
  if (s === "APPROVED" || s === "VERIFIED") {
    const expired = expiry && new Date(expiry).getTime() < Date.now();
    if (expired) return { label: "Expired", tone: "destructive" as const, icon: ShieldAlert };
    return { label: "Verified", tone: "default" as const, icon: CheckCircle2 };
  }
  if (s === "REJECTED") return { label: "Rejected", tone: "destructive" as const, icon: XCircle };
  return { label: "Pending review", tone: "secondary" as const, icon: Clock };
}

export default function DriverDocumentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [meta, setMeta] = useState<Record<string, { number: string; expiry: string }>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const refresh = useCallback(async () => {
    if (!user) return;
    const c: any = supabase;
    const { data, error } = await c
      .from("driver_documents")
      .select("id,doc_type,file_url,file_name,file_size,document_number,status,rejection_reason,expiry_date,created_at,verified_at")
      .eq("driver_id", user.id)
      .order("created_at", { ascending: false });
    setLoadError(error?.message ?? null);
    setDocs(((data as DocRow[]) ?? []));
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  // Latest submission per document type.
  const latest = useMemo(() => {
    const map = new Map<string, DocRow>();
    for (const d of docs) if (!map.has(d.doc_type)) map.set(d.doc_type, d);
    return map;
  }, [docs]);

  const progress = useMemo(() => {
    let verified = 0;
    for (const r of REQUIRED_DOCS) {
      const d = latest.get(r.type);
      if (d && statusMeta(d.status, d.expiry_date).label === "Verified") verified += 1;
    }
    return { verified, total: REQUIRED_DOCS.length, submitted: REQUIRED_DOCS.filter((r) => latest.has(r.type)).length };
  }, [latest]);

  async function upload(docType: string, file: File) {
    if (!user) return;
    const spec = REQUIRED_DOCS.find((r) => r.type === docType);
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: "Maximum size is 10 MB.", variant: "destructive" });
      return;
    }
    const m = meta[docType] ?? { number: "", expiry: "" };
    if (spec?.needsNumber && !m.number.trim()) {
      toast({ title: "Document number required", description: `Enter the number shown on your ${spec.label}.`, variant: "destructive" });
      return;
    }
    if (spec?.needsExpiry && !m.expiry) {
      toast({ title: "Expiry date required", description: `Enter the expiry date of your ${spec.label}.`, variant: "destructive" });
      return;
    }

    setBusyType(docType);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const path = `${user.id}/${docType.toLowerCase()}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("driver-documents")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) throw upErr;

      const { error: insErr } = await (supabase as any).from("driver_documents").insert({
        driver_id: user.id,
        doc_type: docType,
        file_url: path,
        file_name: file.name,
        file_size: file.size,
        document_number: m.number.trim() || null,
        expiry_date: m.expiry || null,
        status: "PENDING",
      });
      if (insErr) {
        // Compensating action: the object is already in storage but no row references
        // it, so remove it to keep storage and the database consistent (no orphans).
        const { error: cleanupErr } = await supabase.storage.from("driver-documents").remove([path]);
        if (cleanupErr) {
          console.error("[driver-documents] orphaned storage object", path, cleanupErr.message);
        }
        throw insErr;
      }


      toast({ title: "Document submitted", description: `${spec?.label ?? docType} is now queued for verification.` });
      setMeta((prev) => ({ ...prev, [docType]: { number: "", expiry: "" } }));
      if (inputs.current[docType]) inputs.current[docType]!.value = "";
      await refresh();
    } catch (err) {
      toast({ title: "Upload failed", description: err?.message ?? "Could not submit the document.", variant: "destructive" });
    } finally {
      setBusyType(null);
    }
  }

  async function view(doc: DocRow) {
    const { data, error } = await supabase.storage.from("driver-documents").createSignedUrl(doc.file_url, 120);
    if (error || !data?.signedUrl) {
      toast({ title: "Cannot open file", description: error?.message ?? "Signed link unavailable.", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/10 via-background to-primary-glow/10 p-6 border-b">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="secondary">Compliance</Badge>
                <Badge variant="outline">{progress.verified} of {progress.total} verified</Badge>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold">Documents &amp; verification</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Upload each required document. Our compliance team reviews submissions and you keep driving while renewals are processed.
              </p>
            </div>
            <Button variant="outline" onClick={refresh}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
        </div>
      </Card>

      {loadError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Your documents could not be loaded. {loadError}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading your documents…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {REQUIRED_DOCS.map((spec) => {
            const current = latest.get(spec.type);
            const s = current ? statusMeta(current.status, current.expiry_date) : null;
            const needsAction = !current || s?.label === "Rejected" || s?.label === "Expired";
            const m = meta[spec.type] ?? { number: "", expiry: "" };
            return (
              <Card key={spec.type}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileCheck className="h-4 w-4 text-muted-foreground" /> {spec.label}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">{spec.hint}</p>
                    </div>
                    {s ? (
                      <Badge variant={s.tone} className="shrink-0">
                        <s.icon className="h-3 w-3 mr-1" /> {s.label}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0">Not submitted</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {current && (
                    <div className="rounded-md border p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{current.file_name ?? current.file_url.split("/").pop()}</span>
                        <Button size="sm" variant="ghost" onClick={() => view(current)}>
                          <Eye className="h-3.5 w-3.5 mr-1" /> View
                        </Button>
                      </div>
                      <div className="text-muted-foreground">
                        Submitted {new Date(current.created_at).toLocaleDateString("en-KE")}
                        {current.document_number ? ` · No. ${current.document_number}` : ""}
                        {current.expiry_date ? ` · Expires ${new Date(current.expiry_date).toLocaleDateString("en-KE")}` : ""}
                      </div>
                      {current.rejection_reason && (
                        <div className="text-destructive">Reason: {current.rejection_reason}</div>
                      )}
                    </div>
                  )}

                  {needsAction && (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {spec.needsNumber && (
                          <div>
                            <Label htmlFor={`num-${spec.type}`} className="text-xs">Document number</Label>
                            <Input
                              id={`num-${spec.type}`}
                              value={m.number}
                              onChange={(e) => setMeta((p) => ({ ...p, [spec.type]: { ...m, number: e.target.value } }))}
                              placeholder="As printed on the document"
                            />
                          </div>
                        )}
                        {spec.needsExpiry && (
                          <div>
                            <Label htmlFor={`exp-${spec.type}`} className="text-xs">Expiry date</Label>
                            <Input
                              id={`exp-${spec.type}`}
                              type="date"
                              value={m.expiry}
                              onChange={(e) => setMeta((p) => ({ ...p, [spec.type]: { ...m, expiry: e.target.value } }))}
                            />
                          </div>
                        )}
                      </div>
                      <input
                        ref={(el) => { inputs.current[spec.type] = el; }}
                        id={`file-${spec.type}`}
                        type="file"
                        accept={ACCEPT}
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) upload(spec.type, f);
                        }}
                      />
                      <Button
                        onClick={() => inputs.current[spec.type]?.click()}
                        disabled={busyType === spec.type}
                        aria-label={`Upload ${spec.label}`}
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        {busyType === spec.type ? "Uploading…" : current ? "Replace document" : "Upload document"}
                      </Button>
                      <p className="text-[11px] text-muted-foreground">JPG, PNG, WebP or PDF · up to 10 MB</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {docs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submission history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {docs.map((d) => {
              const s = statusMeta(d.status, d.expiry_date);
              return (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-md border p-2 text-xs">
                  <span className="font-medium">
                    {REQUIRED_DOCS.find((r) => r.type === d.doc_type)?.label ?? d.doc_type}
                  </span>
                  <span className="text-muted-foreground">{new Date(d.created_at).toLocaleString("en-KE")}</span>
                  <Badge variant={s.tone}>{s.label}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
