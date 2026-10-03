// Shared corporate KYB helpers: checklist, AI document reading, validation.
// deno-lint-ignore-file no-explicit-any
export const KYB_BUCKET = "corporate-registration";
export const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/svg+xml"];
export const MAX_BYTES = 20 * 1024 * 1024;

type Slot = { key: string; label: string; required: boolean };
const LIMITED: Slot[] = [
  { key: "certificate_of_incorporation", label: "Certificate of Incorporation", required: true },
  { key: "cr12", label: "Current CR12", required: true },
];
const REGISTERED: Slot[] = [
  { key: "single_business_permit", label: "Valid Single Business Permit", required: true },
  { key: "business_registration_certificate", label: "Business Registration Certificate", required: false },
];
const SHARED: Slot[] = [
  { key: "letter_of_authority", label: "Letter of Authority", required: true },
  { key: "national_id_front", label: "National ID (front)", required: true },
  { key: "national_id_back", label: "National ID (back)", required: true },
  { key: "kra_pin_certificate", label: "KRA PIN Certificate", required: true },
  { key: "company_logo", label: "Company Logo", required: false },
];
export function checklistFor(type: string | null | undefined): Slot[] {
  if (type === "registered_business") return [...REGISTERED, ...SHARED];
  if (type === "limited_company") return [...LIMITED, ...SHARED];
  return [];
}
export const ALL_SLOT_KEYS = new Set([...LIMITED, ...REGISTERED, ...SHARED].map((s) => s.key));

/** Checks the first bytes so a renamed file can't pose as a PDF/image. */
export function sniffMime(bytes: Uint8Array): string | null {
  const h = Array.from(bytes.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (h.startsWith("25504446")) return "application/pdf";
  if (h.startsWith("ffd8ff")) return "image/jpeg";
  if (h.startsWith("89504e47")) return "image/png";
  const head = new TextDecoder().decode(bytes.slice(0, 256)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return null;
}

const FIELDS: Record<string, string[]> = {
  certificate_of_incorporation: ["business_name", "registration_number", "issue_date"],
  cr12: ["business_name", "registration_number", "issue_date"],
  single_business_permit: ["business_name", "permit_number", "expiry_date"],
  business_registration_certificate: ["business_name", "registration_number", "issue_date"],
  letter_of_authority: ["business_name", "signatory_name", "issue_date"],
  national_id_front: ["full_name", "id_number", "date_of_birth"],
  national_id_back: ["id_number"],
  kra_pin_certificate: ["business_name", "kra_pin"],
};

/** Reads a document with Lovable AI. Returns null when it can't be read. */
export async function aiExtract(slot: string, bytes: Uint8Array, mime: string) {
  const fields = FIELDS[slot];
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!fields || !key || mime === "image/svg+xml") return null;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const dataUrl = `data:${mime};base64,${btoa(bin)}`;
  const part = mime === "application/pdf"
    ? { type: "file", file: { filename: "doc.pdf", file_data: dataUrl } }
    : { type: "image_url", image_url: { url: dataUrl } };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You read Kenyan business and identity documents. Only report text actually visible. Never guess." },
        { role: "user", content: [{ type: "text", text: `This should be a "${slot.replace(/_/g, " ")}". Extract: ${fields.join(", ")}. Dates as YYYY-MM-DD.` }, part] },
      ],
      tools: [{
        type: "function",
        function: {
          name: "report",
          parameters: {
            type: "object",
            properties: {
              matches_document_type: { type: "boolean" },
              fields: { type: "object", properties: Object.fromEntries(fields.map((f) => [f, { type: ["string", "null"] }])) },
              confidence: { type: "object", properties: Object.fromEntries(fields.map((f) => [f, { type: "number" }])) },
            },
            required: ["matches_document_type", "fields", "confidence"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "report" } },
    }),
  });
  if (!res.ok) { console.error("aiExtract", res.status, await res.text()); return null; }
  const j = await res.json();
  const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return null;
  try {
    const p = JSON.parse(args);
    const extracted: Record<string, unknown> = {};
    for (const f of fields) if (p.fields?.[f]) extracted[f] = p.fields[f];
    extracted.matches_document_type = !!p.matches_document_type;
    return { extracted, confidence: (p.confidence ?? {}) as Record<string, number> };
  } catch { return null; }
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\b(limited|ltd|plc|llp|company|co)\b\.?/g, "").replace(/[^a-z0-9]/g, "");

/** Compares what the AI read with what the applicant typed. */
export function validateDoc(slot: string, extracted: Record<string, any> | null, draft: any, declared: Record<string, any> = {}) {
  const errors: string[] = [];
  const biz = draft?.business_info ?? {};
  if (extracted) {
    if (extracted.matches_document_type === false) errors.push("This file does not look like the requested document.");
    if (extracted.business_name && biz.registered_name && norm(extracted.business_name) !== norm(biz.registered_name))
      errors.push(`Name on document (“${extracted.business_name}”) does not match the registered name.`);
    if (extracted.kra_pin && biz.kra_pin && String(extracted.kra_pin).toUpperCase() !== String(biz.kra_pin).toUpperCase())
      errors.push("KRA PIN on document does not match the one entered.");
    const exp = extracted.expiry_date ?? declared.expiry_date;
    if (exp && new Date(exp) < new Date()) errors.push("Document has expired.");
  }
  if (slot === "cr12") {
    const d = extracted?.issue_date ?? declared.cr12_registration_date;
    if (d && Date.now() - new Date(d).getTime() > 92 * 864e5) errors.push("CR12 is older than 3 months.");
  }
  return { ok: errors.length === 0, errors };
}

export function draftValidation(type: string | null, docs: any[]) {
  const by = new Map(docs.map((d) => [d.slot_key, d]));
  const missing = checklistFor(type).filter((s) => s.required && !by.has(s.key)).map((s) => s.key);
  const failing = docs.filter((d) => d.validation?.ok === false).map((d) => ({ slot_key: d.slot_key, errors: d.validation.errors ?? [] }));
  return { ok: !!type && missing.length === 0 && failing.length === 0, missing, failing, checked_at: new Date().toISOString() };
}

/** Scan = file-signature check + AI read + validation. Not an antivirus scan. */
export async function scanDocument(admin: any, doc: any, draft: any, declared: Record<string, any> = {}) {
  const { data: blob, error } = await admin.storage.from(KYB_BUCKET).download(doc.storage_path);
  if (error || !blob) return { scan_status: "error", scan_result: { error: "file_missing" }, validation: { ok: false, errors: ["The file could not be read. Upload it again."] } };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const real = sniffMime(bytes);
  if (!real || real !== doc.mime) {
    return { scan_status: "infected", scan_result: { reason: "type_mismatch", detected: real }, validation: { ok: false, errors: ["The file content does not match its type. Upload a genuine PDF, JPEG or PNG."] } };
  }
  const ai = bytes.length <= 8 * 1024 * 1024 ? await aiExtract(doc.slot_key, bytes, real) : null;
  return {
    scan_status: "clean",
    scan_result: { checked: "file_signature", detected: real, ai_read: !!ai },
    extracted: ai?.extracted ?? {},
    ocr_confidence: ai?.confidence ?? {},
    ocr_provider: ai ? "lovable-ai/gemini-2.5-flash" : null,
    validation: validateDoc(doc.slot_key, ai?.extracted ?? null, draft, declared),
    last_scanned_at: new Date().toISOString(),
  };
}
