// Steps 3–5 of the Corporate Self-Registration wizard.
//
// Step 4 uploads documents through the `corporate-kyb-doc` edge function using
// short-lived signed URLs against the private `corporate-kyb` storage bucket.
// The server performs virus scanning, encrypts at rest, and validates business
// rules (permit expiry, name match, mime/size) before persisting.
//
// Step 5 pulls the server-side validation result and blocks submission until
// every required document is uploaded, scan-clean, and rule-clean.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Building2, CheckCircle2, FileCheck2, FileText, Info, Loader2, ShieldCheck,
  UploadCloud, XCircle, ShieldAlert, Eye,
} from "lucide-react";
import { useDraftCtx } from "./context";
import type { BusinessRegistrationType } from "./useRegistrationDraft";
import { OcrGrid } from "./ApplicantStatus";

// ---------- Shared catalogue (mirrors _shared/corp-kyb.ts on the server) -----

type SlotKey =
  | "certificate_of_incorporation" | "cr12"
  | "single_business_permit" | "business_registration_certificate"
  | "letter_of_authority" | "national_id_front" | "national_id_back"
  | "kra_pin_certificate" | "company_logo";

interface DocSlot {
  key: SlotKey; label: string; required: boolean;
  hint?: string; accept?: string;
  /** Slots that need extra applicant-declared metadata (e.g. permit expiry). */
  declares?: Array<"expiry_date" | "business_name" | "cr12_registration_date">;
}

const ACCEPT_DOCS = "application/pdf,image/jpeg,image/png";
const MAX_BYTES = 20 * 1024 * 1024;

const LIMITED_DOCS: DocSlot[] = [
  { key: "certificate_of_incorporation", label: "Certificate of Incorporation", required: true,
    hint: "Issued by the Business Registration Service (BRS). PDF, JPEG or PNG up to 20 MB.", accept: ACCEPT_DOCS },
  { key: "cr12", label: "Current CR12", required: true,
    hint: "Must be the latest CR12 reflecting current directors and shareholders (issued within the last 3 months).",
    accept: ACCEPT_DOCS, declares: ["cr12_registration_date"] },
];
const REGISTERED_DOCS: DocSlot[] = [
  { key: "single_business_permit", label: "Valid Single Business Permit", required: true,
    hint: "Current (unexpired) County permit. We validate the expiry date and that it matches your registered name.",
    accept: ACCEPT_DOCS, declares: ["expiry_date", "business_name"] },
  { key: "business_registration_certificate", label: "Business Registration Certificate", required: false,
    hint: "Optional — helps speed up verification for Sole Proprietorships and Partnerships.", accept: ACCEPT_DOCS },
];
const SHARED_DOCS: DocSlot[] = [
  { key: "letter_of_authority", label: "Letter of Authority", required: true, accept: ACCEPT_DOCS,
    hint: "Signed by a director / business owner authorizing you to transact on behalf of the business." },
  { key: "national_id_front", label: "National ID (front)", required: true, accept: ACCEPT_DOCS },
  { key: "national_id_back",  label: "National ID (back)",  required: true, accept: ACCEPT_DOCS },
  { key: "kra_pin_certificate", label: "KRA PIN Certificate", required: true, accept: ACCEPT_DOCS },
  { key: "company_logo", label: "Company Logo", required: false,
    hint: "Optional — square PNG works best for receipts and the dashboard.",
    accept: "image/jpeg,image/png,image/svg+xml" },
];
function slotsForType(brt?: BusinessRegistrationType | null): DocSlot[] {
  if (!brt) return [];
  return [...(brt === "limited_company" ? LIMITED_DOCS : REGISTERED_DOCS), ...SHARED_DOCS];
}

interface DocRow {
  id: string;
  slot_key: SlotKey;
  original_name: string;
  mime: string;
  size_bytes: number;
  scan_status: "pending" | "clean" | "infected" | "error";
  scan_result: Record<string, unknown>;
  validation: { ok?: boolean; errors?: string[] };
  admin_decision?: "approved" | "rejected" | null;
  admin_reason?: string | null;
  extracted?: Record<string, unknown>;
  ocr_confidence?: Record<string, number>;
  ocr_provider?: string | null;
  reupload_required?: boolean;
  current_version?: number;
  uploaded_at: string;
}
interface DocVersion {
  id: string; version: number; original_name: string; size_bytes: number;
  scan_status: string; validation: { ok?: boolean; errors?: string[] };
  admin_decision: "approved" | "rejected" | null; admin_reason: string | null;
  admin_reviewed_at: string | null; review_id: string | null;
  superseded_at: string | null; created_at: string;
  extracted?: Record<string, unknown>;
  ocr_confidence?: Record<string, number>;
}
interface DraftValidation {
  ok: boolean;
  missing: string[];
  failing: Array<{ slot_key: string; errors: string[] }>;
  checked_at: string;
}

// ---------- Session key helper (mirrors useRegistrationDraft) ----------------
function getSessionKey(): string {
  return localStorage.getItem("yalla.corp_reg.session_key") ?? "";
}

async function callDocApi<T = unknown>(op: string, extra: Record<string, unknown> = {}): Promise<T> {
  const session_key = getSessionKey();
  const { data, error } = await supabase.functions.invoke("corporate-kyb-doc", {
    body: { op, session_key, ...extra },
  });
  if (error) throw error;
  return data as T;
}

// ============================================================================
// Step 3 — Verification overview (unchanged UX, dynamic checklist)
// ============================================================================

export function Step3Verification() {
  const nav = useNavigate();
  const { draft } = useDraftCtx();
  const brt = draft?.business_registration_type;
  const checklist = useMemo(() => slotsForType(brt), [brt]);
  const primaryLabel = brt === "limited_company" ? "Limited Company"
    : brt === "registered_business" ? "Registered Business" : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Business verification</h2>
        <p className="text-sm text-muted-foreground">
          Here is exactly what Yalla will collect and verify for your registration type.
        </p>
      </div>

      {!brt ? (
        <Alert>
          <Info className="h-4 w-4" aria-hidden />
          <AlertTitle>Select a registration type first</AlertTitle>
          <AlertDescription>Return to Step 2 and choose Limited Company or Registered Business.</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-4">
            {brt === "limited_company"
              ? <Building2 className="h-5 w-5 text-primary" aria-hidden />
              : <FileCheck2 className="h-5 w-5 text-primary" aria-hidden />}
            <div>
              <div className="text-sm font-medium">Registration type: {primaryLabel}</div>
              <div className="text-xs text-muted-foreground">
                {brt === "limited_company"
                  ? "We'll verify your Certificate of Incorporation and current CR12 against the BRS registry."
                  : "We'll verify your Single Business Permit against the issuing County Government records."}
              </div>
            </div>
          </div>

          <section aria-labelledby="checklist">
            <h3 id="checklist" className="mb-3 text-sm font-medium">Yalla admin verification checklist</h3>
            <ul className="grid gap-2 text-sm md:grid-cols-2">
              {checklist.map((s) => (
                <li key={s.key} className="flex items-start gap-2 rounded-md border p-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                  <div>
                    <div className="font-medium">
                      {s.label} {s.required && <span className="text-destructive">*</span>}
                    </div>
                    {s.hint && <p className="text-xs text-muted-foreground">{s.hint}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={() => nav("/corporate/register/business")}>← Back</Button>
        <Button onClick={() => nav("/corporate/register/documents")} disabled={!brt}>
          Continue → Upload documents
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Step 4 — Secure document upload
// ============================================================================

export function Step4Documents() {
  const nav = useNavigate();
  const { draft, save } = useDraftCtx();
  const brt = draft?.business_registration_type;
  const slots = useMemo(() => slotsForType(brt), [brt]);

  const [docs, setDocs] = useState<Record<string, DocRow>>({});
  const [validation, setValidation] = useState<DraftValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await callDocApi<{ documents: DocRow[]; draft_validation: DraftValidation }>("list");
      const m: Record<string, DocRow> = {};
      for (const d of res.documents) m[d.slot_key] = d;
      setDocs(m);
      setValidation(res.draft_validation);
    } catch { /* draft may not exist yet */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (draft) refresh();
    else setLoading(false);
  }, [draft, refresh]);

  const upload = useCallback(async (slot: DocSlot, file: File, declared?: { expiry_date?: string; business_name?: string; cr12_registration_date?: string }) => {
    const accepted = (slot.accept ?? ACCEPT_DOCS).split(",").map((s) => s.trim());
    if (!accepted.includes(file.type)) {
      setErrors((e) => ({ ...e, [slot.key]: `Unsupported file type. Accepted: ${accepted.join(", ")}` })); return;
    }
    if (file.size > MAX_BYTES) {
      setErrors((e) => ({ ...e, [slot.key]: "File exceeds 20 MB limit." })); return;
    }
    setErrors((e) => ({ ...e, [slot.key]: undefined }));
    setBusy(slot.key);
    try {
      const signed = await callDocApi<{ bucket: string; path: string; token: string }>("sign_upload", {
        slot_key: slot.key, mime: file.type, size_bytes: file.size, original_name: file.name,
      });
      const { error: upErr } = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type, upsert: true });
      if (upErr) throw upErr;
      const fin = await callDocApi<{ document: DocRow; draft_validation: DraftValidation }>("finalize", {
        slot_key: slot.key, storage_path: signed.path, mime: file.type,
        size_bytes: file.size, original_name: file.name, declared,
      });
      setDocs((d) => ({ ...d, [slot.key]: fin.document }));
      setValidation(fin.draft_validation);
      // Also mirror into draft.documents JSON so review can render offline.
      await save({ documents: { ...(draft?.documents ?? {}), [slot.key]: {
        name: file.name, size: file.size, mime: file.type,
        storage_path: signed.path, uploaded_at: fin.document.uploaded_at,
      } } });
    } catch (e) {
      setErrors((er) => ({ ...er, [slot.key]: (e as Error).message ?? "Upload failed" }));
    } finally { setBusy(null); }
  }, [draft?.documents, save]);

  const remove = useCallback(async (slot: DocSlot) => {
    setBusy(slot.key);
    try {
      const res = await callDocApi<{ draft_validation: DraftValidation }>("delete", { slot_key: slot.key });
      setDocs((d) => { const n = { ...d }; delete n[slot.key]; return n; });
      setValidation(res.draft_validation);
      const nextDocs = { ...(draft?.documents ?? {}) };
      delete (nextDocs as any)[slot.key];
      await save({ documents: nextDocs });
    } finally { setBusy(null); }
  }, [draft?.documents, save]);

  const preview = useCallback(async (slot: DocSlot) => {
    try {
      const res = await callDocApi<{ url: string }>("signed_url", { slot_key: slot.key });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErrors((er) => ({ ...er, [slot.key]: (e as Error).message ?? "Preview unavailable" }));
    }
  }, []);

  const rerunOcr = useCallback(async (slot: DocSlot) => {
    setBusy(slot.key);
    try {
      const res = await callDocApi<{ extracted: Record<string, unknown>; ocr_confidence: Record<string, number>; ocr_provider: string; validation: DocRow["validation"]; draft_validation: DraftValidation }>("rerun_ocr", { slot_key: slot.key });
      setDocs((d) => d[slot.key] ? ({ ...d, [slot.key]: { ...d[slot.key], extracted: res.extracted, ocr_confidence: res.ocr_confidence, ocr_provider: res.ocr_provider, validation: res.validation } }) : d);
      setValidation(res.draft_validation);
    } catch (e) {
      setErrors((er) => ({ ...er, [slot.key]: (e as Error).message ?? "Re-run OCR failed" }));
    } finally { setBusy(null); }
  }, []);

  const canContinue = !!brt && !!validation?.ok && !busy;

  const onContinue = async () => {
    if (!canContinue) return;
    await save({
      current_step: 5,
      completed_steps: Array.from(new Set([...(draft?.completed_steps ?? []), 3, 4])),
    });
    nav("/corporate/register/review");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Document upload</h2>
        <p className="text-sm text-muted-foreground">
          Drag &amp; drop or browse. Files are virus-scanned, encrypted at rest, and validated for expiry &amp; name match before submission.
        </p>
      </div>

      {!brt ? (
        <Alert>
          <Info className="h-4 w-4" aria-hidden />
          <AlertTitle>Select a registration type first</AlertTitle>
          <AlertDescription>Return to Step 2 to choose Limited Company or Registered Business.</AlertDescription>
        </Alert>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading uploads…
        </div>
      ) : (
        <div className="grid gap-3">
          {slots.map((slot) => (
            <DocSlotCard
              key={slot.key}
              slot={slot}
              doc={docs[slot.key]}
              busy={busy === slot.key}
              error={errors[slot.key]}
              onFile={(f, declared) => upload(slot, f, declared)}
              onRemove={() => remove(slot)}
              onPreview={() => preview(slot)}
              onRerunOcr={() => rerunOcr(slot)}
            />
          ))}
        </div>
      )}

      {validation && !validation.ok && brt && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" aria-hidden />
          <AlertTitle className="text-sm">Not ready to continue</AlertTitle>
          <AlertDescription className="text-xs space-y-1">
            {validation.missing.length > 0 && (
              <div>Missing / not scan-clean: {validation.missing.join(", ")}</div>
            )}
            {validation.failing.length > 0 && (
              <ul className="list-disc pl-4">
                {validation.failing.map((f) => (
                  <li key={f.slot_key}>{f.slot_key}: {f.errors.join(", ")}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={() => nav("/corporate/register/verification")}>← Back</Button>
        <Button onClick={onContinue} disabled={!canContinue}>Continue → Review</Button>
      </div>
    </div>
  );
}

function DocSlotCard({
  slot, doc, busy, error, onFile, onRemove, onPreview, onRerunOcr,
}: {
  slot: DocSlot;
  doc?: DocRow;
  busy: boolean;
  error?: string;
  onFile: (f: File, declared?: { expiry_date?: string; business_name?: string; cr12_registration_date?: string }) => void;
  onRemove: () => void;
  onPreview: () => void;
  onRerunOcr: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState<string>(String((doc?.extracted as any)?.expiry_date ?? ""));
  const [permitName, setPermitName] = useState<string>(String((doc?.extracted as any)?.business_name ?? ""));
  const [cr12Date, setCr12Date] = useState<string>(String((doc?.extracted as any)?.cr12_registration_date ?? ""));
  const needsDeclare = (slot.declares?.length ?? 0) > 0;

  const submit = (f: File) => {
    if (needsDeclare) { setPendingFile(f); return; }
    onFile(f);
  };

  const declareValid = (
    (!slot.declares?.includes("expiry_date") || !!expiry)
    && (!slot.declares?.includes("business_name") || !!permitName)
    && (!slot.declares?.includes("cr12_registration_date") || !!cr12Date)
  );

  const confirmDeclare = () => {
    if (!pendingFile) return;
    onFile(pendingFile, {
      expiry_date: slot.declares?.includes("expiry_date") ? expiry : undefined,
      business_name: slot.declares?.includes("business_name") ? permitName : undefined,
      cr12_registration_date: slot.declares?.includes("cr12_registration_date") ? cr12Date : undefined,
    });
    setPendingFile(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0]; if (f) submit(f);
  };

  return (
    <div
      className={`rounded-lg border p-4 transition ${dragging ? "border-primary bg-primary/5" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4 text-primary" aria-hidden /> {slot.label}
            {slot.required
              ? <Badge variant="destructive" className="text-[10px] py-0">Required</Badge>
              : <Badge variant="secondary" className="text-[10px] py-0">Optional</Badge>}
            {doc && <ScanBadge status={doc.scan_status} validationOk={doc.validation?.ok} />}
            {doc?.admin_decision === "approved" && <Badge className="bg-status-success text-[10px] py-0">Approved</Badge>}
            {doc?.admin_decision === "rejected" && <Badge variant="destructive" className="text-[10px] py-0">Rejected</Badge>}
          </div>
          {slot.hint && <p className="mt-0.5 text-xs text-muted-foreground">{slot.hint}</p>}

          {doc ? (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden />
                <span className="truncate">{doc.original_name}</span>
                <span className="text-muted-foreground">· {(doc.size_bytes / 1024 / 1024).toFixed(2)} MB</span>
                {doc.current_version ? <Badge variant="secondary" className="text-[10px] py-0">v{doc.current_version}</Badge> : null}
                {doc.reupload_required && <Badge variant="destructive" className="text-[10px] py-0">Re-upload required</Badge>}
              </div>
              {doc.validation?.errors?.length ? (
                <p className="text-xs text-destructive">
                  Validation: {doc.validation.errors.join(", ")}
                </p>
              ) : null}
              {doc.admin_reason && (
                <p className="text-xs text-destructive">Admin note: {doc.admin_reason}</p>
              )}
              <OcrGrid extracted={doc.extracted} confidence={doc.ocr_confidence} provider={doc.ocr_provider ?? null} />
              <VersionHistory slot={slot.key} />
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">
              Drag &amp; drop PDF / JPEG / PNG here, or use Browse. Max 20 MB.
            </div>
          )}

          {pendingFile && needsDeclare && (
            <div className="mt-3 grid gap-2 rounded-md border bg-muted/30 p-3 md:grid-cols-2">
              <div className="md:col-span-2 text-xs text-muted-foreground">
                Provide details from the document so Yalla can verify it matches your business.
              </div>
              {slot.declares?.includes("expiry_date") && (
                <div>
                  <Label className="text-xs">Permit expiry date *</Label>
                  <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                </div>
              )}
              {slot.declares?.includes("business_name") && (
                <div>
                  <Label className="text-xs">Business name as printed *</Label>
                  <Input value={permitName} onChange={(e) => setPermitName(e.target.value)} />
                </div>
              )}
              {slot.declares?.includes("cr12_registration_date") && (
                <div>
                  <Label className="text-xs">CR12 registration date *</Label>
                  <Input type="date" value={cr12Date} max={new Date().toISOString().slice(0, 10)}
                         onChange={(e) => setCr12Date(e.target.value)} />
                  <p className="mt-0.5 text-[10px] text-muted-foreground">CR12 must be dated within the last 3 months.</p>
                </div>
              )}
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPendingFile(null)}>Cancel</Button>
                <Button size="sm" onClick={confirmDeclare} disabled={!declareValid}>
                  Confirm &amp; upload
                </Button>
              </div>
            </div>
          )}

          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {doc && (
            <>
              <Button size="sm" variant="ghost" onClick={onPreview} type="button" aria-label="Preview document">
                <Eye className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" onClick={onRerunOcr} type="button" disabled={busy}
                      title="Re-run OCR on this document" aria-label="Re-run OCR">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
              </Button>
            </>
          )}
          {doc ? (
            <Button size="sm" variant="ghost" onClick={onRemove} type="button" disabled={busy}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Replace"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Uploading</>
                     : <><UploadCloud className="mr-1 h-3 w-3" /> Browse</>}
            </Button>
          )}
          <input
            ref={inputRef} type="file" className="sr-only" accept={slot.accept ?? ACCEPT_DOCS}
            onChange={(e) => {
              const f = e.target.files?.[0]; if (f) submit(f);
              e.currentTarget.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ScanBadge({ status, validationOk }: { status: DocRow["scan_status"]; validationOk?: boolean }) {
  if (status === "clean" && validationOk !== false) return <Badge className="bg-status-success text-[10px] py-0">Scan clean</Badge>;
  if (status === "clean" && validationOk === false) return <Badge variant="destructive" className="text-[10px] py-0"><ShieldAlert className="mr-1 h-3 w-3" />Rules failed</Badge>;
  if (status === "pending") return <Badge variant="secondary" className="text-[10px] py-0">Scanning…</Badge>;
  if (status === "infected") return <Badge variant="destructive" className="text-[10px] py-0"><ShieldAlert className="mr-1 h-3 w-3" />Infected</Badge>;
  return <Badge variant="destructive" className="text-[10px] py-0">Scan error</Badge>;
}

function VersionHistory({ slot }: { slot: SlotKey }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (versions !== null) return;
    setLoading(true);
    try {
      const res = await callDocApi<{ versions: DocVersion[] }>("list_versions", { slot_key: slot });
      setVersions(res.versions);
    } catch { setVersions([]); }
    finally { setLoading(false); }
  };

  return (
    <details className="mt-1 text-xs" onToggle={(e) => {
      const isOpen = (e.currentTarget as HTMLDetailsElement).open;
      setOpen(isOpen); if (isOpen) load();
    }}>
      <summary className="cursor-pointer text-muted-foreground">Version history</summary>
      {open && (
        loading ? <div className="mt-1 text-muted-foreground">Loading…</div>
        : versions && versions.length > 0 ? (
          <ol className="mt-1 space-y-1">
            {versions.map((v) => (
              <li key={v.id} className="rounded border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] py-0">v{v.version}</Badge>
                  {v.admin_decision === "approved" && <Badge className="bg-status-success text-[10px] py-0">Approved</Badge>}
                  {v.admin_decision === "rejected" && <Badge variant="destructive" className="text-[10px] py-0">Rejected</Badge>}
                  {v.superseded_at && <span className="text-muted-foreground">superseded</span>}
                  <span className="ml-auto text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span>
                </div>
                <div className="truncate text-muted-foreground">{v.original_name}</div>
                {v.admin_reason && <div className="text-destructive">Note: {v.admin_reason}</div>}
              </li>
            ))}
          </ol>
        ) : <div className="mt-1 text-muted-foreground">No previous versions.</div>
      )}
    </details>
  );
}

// ============================================================================
// Step 5 — Review & submit (blocks until server validation is clean)
// ============================================================================

export function Step5Review() {
  const nav = useNavigate();
  const { draft, submit } = useDraftCtx();
  const brt = draft?.business_registration_type;
  const slots = useMemo(() => slotsForType(brt), [brt]);
  const [docs, setDocs] = useState<Record<string, DocRow>>({});
  const [validation, setValidation] = useState<DraftValidation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Guarantees we can never fire two concurrent submits, even if React state
  // hasn't flushed between clicks.
  const submitLock = useRef(false);

  useEffect(() => {
    if (!draft) return;
    (async () => {
      try {
        const res = await callDocApi<{ documents: DocRow[]; draft_validation: DraftValidation }>("list");
        const m: Record<string, DocRow> = {};
        for (const d of res.documents) m[d.slot_key] = d;
        setDocs(m); setValidation(res.draft_validation);
      } catch { /* noop */ }
    })();
  }, [draft]);

  const primaryLabel = brt === "limited_company" ? "Limited Company"
    : brt === "registered_business" ? "Registered Business" : "—";
  const canSubmit = !!validation?.ok && !submitting && !locked && !submitted;

  const doSubmit = async () => {
    if (submitLock.current) return;
    submitLock.current = true;
    setLocked(true);
    setSubmitting(true);
    setErr(null);
    try {
      const res = await submit();
      if (res?.already_submitted) {
        setAlreadySubmitted(true);
        setSubmitted(true);
        // Bounce to status page shortly so users see the banner briefly.
        setTimeout(() => nav("/corporate/register/status?reason=already_submitted", { replace: true }), 1200);
        return;
      }
      if (res?.ok) setSubmitted(true);
    } catch (e) {
      // Legacy REG-409 (older backend without idempotency) — treat as success.
      const msg = (e as { message?: string })?.message ?? "";
      const body = (e as { context?: { body?: string } })?.context?.body ?? "";
      if (msg.includes("REG-409") || body.includes("already_submitted") || msg.includes("409")) {
        setAlreadySubmitted(true);
        setSubmitted(true);
        setTimeout(() => nav("/corporate/register/status?reason=already_submitted", { replace: true }), 1200);
        return;
      }
      setErr((e as Error).message || "Submission failed. Please try again.");
      // Unlock so the user can retry only for genuine failures.
      submitLock.current = false;
      setLocked(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="space-y-4 text-center">
        {alreadySubmitted ? (
          <>
            <Alert>
              <Info className="h-4 w-4" aria-hidden />
              <AlertTitle className="text-sm">Application already submitted</AlertTitle>
              <AlertDescription className="text-xs">
                We've already received your registration. Redirecting you to the review status page…
              </AlertDescription>
            </Alert>
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          </>
        ) : (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-status-success" aria-hidden />
            <h2 className="text-xl font-semibold">Application submitted</h2>
            <p className="text-sm text-muted-foreground">
              Yalla's compliance team will verify your documents within 1–2 business days and email your authorized officer.
            </p>
          </>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => nav("/corporate/register/status")}>View review status</Button>
          <Button variant="outline" onClick={() => nav("/corporate/login")}>Go to corporate login</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Review &amp; submit</h2>
        <p className="text-sm text-muted-foreground">
          Confirm everything below. Only documents relevant to your registration type are shown.
        </p>
      </div>

      <section aria-labelledby="rv-business" className="rounded-lg border p-4">
        <h3 id="rv-business" className="mb-3 text-sm font-medium">Business</h3>
        <dl className="grid gap-2 text-sm md:grid-cols-2">
          <Row k="Registration type" v={primaryLabel} />
          <Row k="Registered name" v={draft?.business_info?.registered_name} />
          <Row k="Trading name" v={draft?.business_info?.trading_name} />
          {brt === "limited_company"
            ? <Row k="Certificate of Incorporation #" v={draft?.business_info?.certificate_of_incorporation_number} />
            : <Row k="Business Registration #" v={draft?.business_info?.registration_number} />}
          <Row k="KRA PIN" v={draft?.business_info?.kra_pin} />
          <Row k="Industry" v={draft?.business_info?.industry} />
          <Row k="Business type" v={draft?.business_info?.business_type} />
          <Row k="County / Town" v={[draft?.business_info?.county, draft?.business_info?.town].filter(Boolean).join(", ")} />
        </dl>
      </section>

      <section aria-labelledby="rv-applicant" className="rounded-lg border p-4">
        <h3 id="rv-applicant" className="mb-3 text-sm font-medium">Authorized officer</h3>
        <dl className="grid gap-2 text-sm md:grid-cols-2">
          <Row k="Name" v={[draft?.personal_info?.first_name, draft?.personal_info?.middle_name, draft?.personal_info?.last_name].filter(Boolean).join(" ")} />
          <Row k="Position" v={draft?.personal_info?.position} />
          <Row k="Corporate email" v={draft?.personal_info?.corporate_email} />
          <Row k="Corporate phone" v={draft?.personal_info?.corporate_phone} />
        </dl>
      </section>

      <section aria-labelledby="rv-docs" className="rounded-lg border p-4">
        <h3 id="rv-docs" className="mb-3 text-sm font-medium">Documents</h3>
        <ul className="space-y-2 text-sm">
          {slots.map((s) => {
            const doc = docs[s.key];
            const ok = doc && doc.scan_status === "clean" && doc.validation?.ok !== false;
            return (
              <li key={s.key} className="flex items-center justify-between gap-3 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  {ok ? <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden />
                       : s.required ? <XCircle className="h-4 w-4 text-destructive" aria-hidden />
                       : <Info className="h-4 w-4 text-muted-foreground" aria-hidden />}
                  <span>{s.label}</span>
                  {!s.required && <span className="text-xs text-muted-foreground">(optional)</span>}
                </div>
                <span className="truncate text-xs text-muted-foreground">
                  {doc
                    ? `${doc.original_name}${doc.scan_status !== "clean" ? ` · ${doc.scan_status}` : ""}${doc.validation?.errors?.length ? ` · ${doc.validation.errors.join(", ")}` : ""}`
                    : s.required ? "Missing" : "Not provided"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {validation && !validation.ok && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" aria-hidden />
          <AlertTitle className="text-sm">Cannot submit yet</AlertTitle>
          <AlertDescription className="text-xs space-y-1">
            {validation.missing.length > 0 && <div>Missing: {validation.missing.join(", ")}</div>}
            {validation.failing.length > 0 && (
              <ul className="list-disc pl-4">
                {validation.failing.map((f) => (
                  <li key={f.slot_key}>{f.slot_key}: {f.errors.join(", ")}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      {err && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" aria-hidden />
          <AlertTitle className="text-sm">Submission error</AlertTitle>
          <AlertDescription className="text-xs">{err}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={() => nav("/corporate/register/documents")}>← Back</Button>
        <Button onClick={doSubmit} disabled={!canSubmit}>
          {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Submitting…</> : "Create my corporate account"}
        </Button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate">{v || "—"}</dd>
    </>
  );
}
