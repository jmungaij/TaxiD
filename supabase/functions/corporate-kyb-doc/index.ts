// Applicant-side KYB documents, keyed by the registration session_key.
// Ops: list, sign_upload, finalize, delete, signed_url, rerun_ocr,
// list_versions, validation, notifications_list, notifications_ack.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { ACCEPTED_MIME, ALL_SLOT_KEYS, KYB_BUCKET, MAX_BYTES, draftValidation, scanDocument } from "../_shared/kyb.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const Body = z.object({
  op: z.enum(["list", "sign_upload", "finalize", "delete", "signed_url", "rerun_ocr", "list_versions", "validation", "notifications_list", "notifications_ack"]),
  session_key: z.string().min(20).max(200),
  slot_key: z.string().max(60).optional(),
  mime: z.string().max(100).optional(),
  size_bytes: z.number().int().positive().optional(),
  original_name: z.string().max(255).optional(),
  storage_path: z.string().max(500).optional(),
  declared: z.record(z.string().max(100)).optional(),
  ids: z.array(z.string().uuid()).max(50).optional(),
});
const MAX_ACK = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const b = parsed.data;
    const { data: draft } = await admin.from("corporate_registration_drafts").select("*").eq("session_key", b.session_key).maybeSingle();
    if (!draft) return json({ error: "Registration not found. Start from step 1." }, 404);
    const locked = draft.status === "submitted" && draft.decision !== "changes_requested";

    const listDocs = async () => (await admin.from("corporate_registration_documents").select("*").eq("draft_id", draft.id)).data ?? [];
    const validate = async () => {
      const v = draftValidation(draft.business_registration_type, await listDocs());
      await admin.from("corporate_registration_drafts").update({ validation: v }).eq("id", draft.id);
      return v;
    };
    const needSlot = () => {
      if (!b.slot_key || !ALL_SLOT_KEYS.has(b.slot_key)) throw new Response(JSON.stringify({ error: "Unknown document." }), { status: 400 });
      return b.slot_key;
    };
    const getDoc = async (slot: string) => (await admin.from("corporate_registration_documents").select("*").eq("draft_id", draft.id).eq("slot_key", slot).maybeSingle()).data;

    switch (b.op) {
      case "list": {
        const docs = await listDocs();
        return json({ documents: docs, draft_validation: draftValidation(draft.business_registration_type, docs) });
      }
      case "validation":
        return json({ draft_validation: await validate() });
      case "sign_upload": {
        if (locked) return json({ error: "This application is under review and can't be changed." }, 409);
        const slot = needSlot();
        if (!b.mime || !ACCEPTED_MIME.includes(b.mime)) return json({ error: "Upload a PDF, JPEG or PNG." }, 400);
        if (!b.size_bytes || b.size_bytes > MAX_BYTES) return json({ error: "File exceeds 20 MB limit." }, 400);
        const ext = b.mime.split("/")[1].replace("svg+xml", "svg").replace("jpeg", "jpg");
        const path = `${draft.id}/${slot}/${crypto.randomUUID()}.${ext}`;
        const { data, error } = await admin.storage.from(KYB_BUCKET).createSignedUploadUrl(path);
        if (error) throw error;
        return json({ bucket: KYB_BUCKET, path, token: data.token });
      }
      case "finalize": {
        if (locked) return json({ error: "This application is under review and can't be changed." }, 409);
        const slot = needSlot();
        if (!b.storage_path?.startsWith(`${draft.id}/${slot}/`)) return json({ error: "Invalid upload." }, 400);
        const prev = await getDoc(slot);
        const version = (prev?.current_version ?? 0) + 1;
        const base = {
          draft_id: draft.id, session_key: b.session_key, slot_key: slot, storage_path: b.storage_path,
          original_name: b.original_name ?? "document", mime: b.mime ?? "application/pdf", size_bytes: b.size_bytes ?? 0,
        };
        const scan = await scanDocument(admin, base, draft, b.declared ?? {});
        const row = {
          ...base, ...scan, current_version: version, admin_decision: null, admin_reason: null,
          admin_reviewer: null, admin_reviewed_at: null, reupload_required: false,
          uploaded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        const { data: doc, error } = await admin.from("corporate_registration_documents").upsert(row, { onConflict: "draft_id,slot_key" }).select("*").single();
        if (error) throw error;
        if (prev) await admin.from("corporate_registration_document_versions").update({ superseded_at: new Date().toISOString() }).eq("document_id", doc.id).is("superseded_at", null);
        await admin.from("corporate_registration_document_versions").insert({
          document_id: doc.id, draft_id: draft.id, slot_key: slot, version, storage_path: base.storage_path,
          original_name: base.original_name, mime: base.mime, size_bytes: base.size_bytes, scan_status: scan.scan_status,
          scan_result: scan.scan_result, extracted: scan.extracted ?? {}, ocr_confidence: scan.ocr_confidence ?? {}, validation: scan.validation,
        });
        return json({ document: doc, draft_validation: await validate() });
      }
      case "delete": {
        if (locked) return json({ error: "This application is under review and can't be changed." }, 409);
        const doc = await getDoc(needSlot());
        if (doc) {
          await admin.storage.from(KYB_BUCKET).remove([doc.storage_path]);
          await admin.from("corporate_registration_documents").delete().eq("id", doc.id);
        }
        return json({ draft_validation: await validate() });
      }
      case "signed_url": {
        const doc = await getDoc(needSlot());
        if (!doc) return json({ error: "File not found." }, 404);
        const { data, error } = await admin.storage.from(KYB_BUCKET).createSignedUrl(doc.storage_path, 300);
        if (error) throw error;
        return json({ url: data.signedUrl });
      }
      case "rerun_ocr": {
        const doc = await getDoc(needSlot());
        if (!doc) return json({ error: "File not found." }, 404);
        const scan = await scanDocument(admin, doc, draft);
        await admin.from("corporate_registration_documents").update(scan).eq("id", doc.id);
        return json({ extracted: scan.extracted ?? {}, ocr_confidence: scan.ocr_confidence ?? {}, ocr_provider: scan.ocr_provider ?? null, validation: scan.validation, draft_validation: await validate() });
      }
      case "list_versions": {
        const { data } = await admin.from("corporate_registration_document_versions").select("*").eq("draft_id", draft.id).eq("slot_key", needSlot()).order("version", { ascending: false });
        return json({ versions: data ?? [] });
      }
      case "notifications_list": {
        const { data } = await admin.from("corporate_registration_notifications").select("*").eq("draft_id", draft.id).order("created_at", { ascending: false }).limit(100);
        return json({ notifications: data ?? [], max_ack_attempts: MAX_ACK });
      }
      case "notifications_ack": {
        const results = [];
        for (const id of b.ids ?? []) {
          const { data: n } = await admin.from("corporate_registration_notifications").select("id,ack_attempts").eq("id", id).eq("draft_id", draft.id).maybeSingle();
          if (!n) { results.push({ id, ok: false, attempts_used: 0, attempts_remaining: 0, error: "not_found" }); continue; }
          const used = (n.ack_attempts ?? 0) + 1;
          const { error } = await admin.from("corporate_registration_notifications").update({ read_at: new Date().toISOString(), ack_attempts: used, ack_last_attempt_at: new Date().toISOString(), ack_last_error: null }).eq("id", id);
          results.push({ id, ok: !error, attempts_used: used, attempts_remaining: Math.max(0, MAX_ACK - used), error: error?.message });
        }
        return json({ results, skipped: [], max_attempts: MAX_ACK });
      }
    }
  } catch (e) {
    if (e instanceof Response) return new Response(e.body, { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    console.error("corporate-kyb-doc", e);
    return json({ error: (e as Error).message ?? "Unexpected error" }, 500);
  }
});
