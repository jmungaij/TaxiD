// Corporate self-registration drafts. Applicants are identified by an opaque
// session_key (kept in their browser); signed-in applicants are also linked.
// Ops: load, save, submit, list_conflicts (staff only).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { draftValidation } from "../_shared/kyb.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Patch = z.object({
  current_step: z.number().int().min(1).max(5).optional(),
  completed_steps: z.array(z.number().int().min(1).max(5)).max(5).optional(),
  business_registration_type: z.enum(["limited_company", "registered_business"]).nullable().optional(),
  personal_info: z.record(z.unknown()).optional(),
  business_info: z.record(z.unknown()).optional(),
  documents: z.record(z.unknown()).optional(),
}).strict();
const Body = z.object({
  op: z.enum(["load", "save", "submit", "list_conflicts"]),
  session_key: z.string().min(20).max(200).optional(),
  patch: Patch.optional(),
  draft_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
const PUBLIC = "id,session_key,status,current_step,completed_steps,business_registration_type,personal_info,business_info,documents,submitted_at,updated_at,decision,decision_reason,validation";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
    const b = parsed.data;

    let uid: string | null = null;
    const auth = req.headers.get("Authorization");
    if (auth?.startsWith("Bearer ")) {
      const { data } = await admin.auth.getClaims(auth.slice(7));
      uid = (data?.claims?.sub as string) ?? null;
    }

    if (b.op === "list_conflicts") {
      if (!uid) return json({ error: "Please sign in." }, 401);
      const { data: r } = await admin.from("user_roles").select("role").eq("user_id", uid).in("role", ["super_admin", "admin", "compliance_admin"]);
      if (!r?.length) return json({ error: "Not allowed." }, 403);
      const { data } = await admin.from("corporate_registration_conflict_log").select("*").eq("draft_id", b.draft_id ?? "").order("created_at", { ascending: false }).limit(b.limit ?? 25);
      return json({ conflicts: data ?? [] });
    }

    if (!b.session_key) return json({ error: "Missing session." }, 400);
    const { data: existing } = await admin.from("corporate_registration_drafts").select(PUBLIC + ",user_id").eq("session_key", b.session_key).maybeSingle();

    const logConflict = (reason: string) => admin.from("corporate_registration_conflict_log").insert({
      draft_id: existing?.id ?? null, session_key: b.session_key, user_id: uid, op: b.op, reason,
      correlation_id: crypto.randomUUID(), request_ip: req.headers.get("x-forwarded-for"), user_agent: req.headers.get("user-agent"), detail: {},
    });

    if (b.op === "load") {
      if (!existing) return json({ draft: null });
      const { user_id: _u, ...draft } = existing as Record<string, unknown>;
      return json({ draft });
    }

    if (b.op === "save") {
      const patch = b.patch ?? {};
      if (existing && existing.status === "submitted" && existing.decision !== "changes_requested") {
        await logConflict("save_after_submit");
        const { user_id: _u, ...draft } = existing as Record<string, unknown>;
        return json({ draft, already_submitted: true });
      }
      const row = { ...patch, updated_at: new Date().toISOString(), ...(uid ? { user_id: uid } : {}) };
      const q = existing
        ? admin.from("corporate_registration_drafts").update({ ...row, ...(existing.status === "submitted" ? { status: "draft" } : {}) }).eq("id", existing.id)
        : admin.from("corporate_registration_drafts").insert({ ...row, session_key: b.session_key, status: "draft", current_step: patch.current_step ?? 1 });
      const { data, error } = await q.select(PUBLIC).single();
      if (error) throw error;
      return json({ draft: data });
    }

    // submit
    if (!existing) return json({ error: "Nothing to submit yet." }, 404);
    if (existing.status === "submitted" && existing.decision !== "changes_requested") {
      return json({ ok: true, id: existing.id, already_submitted: true, submission: { id: existing.id, status: existing.status, decision: existing.decision, submitted_at: existing.submitted_at } });
    }
    const p = existing.personal_info ?? {}, bi = existing.business_info ?? {};
    const missingInfo = [
      !p.first_name && "first name", !p.last_name && "last name", !p.corporate_email && "work email",
      !bi.registered_name && "registered name", !bi.kra_pin && "KRA PIN",
    ].filter(Boolean);
    if (missingInfo.length) return json({ error: `Please complete: ${missingInfo.join(", ")}.` }, 400);
    const { data: docs } = await admin.from("corporate_registration_documents").select("slot_key,validation,scan_status").eq("draft_id", existing.id);
    const v = draftValidation(existing.business_registration_type, docs ?? []);
    if (v.missing.length) return json({ error: `Missing documents: ${v.missing.join(", ")}.`, draft_validation: v }, 400);
    if ((docs ?? []).some((d) => d.scan_status === "infected")) return json({ error: "One or more files failed the safety check. Replace them first.", draft_validation: v }, 400);
    const now = new Date().toISOString();
    const { data, error } = await admin.from("corporate_registration_drafts").update({
      status: "submitted", decision: "pending", submitted_at: now, validation: v, ...(uid ? { user_id: uid } : {}),
    }).eq("id", existing.id).select("id,status,decision,submitted_at").single();
    if (error) throw error;
    await admin.from("corporate_kyb_audit_log").insert({ action: "submit", actor_kind: uid ? "user" : "applicant", actor_id: uid, actor_session_key: b.session_key, draft_id: existing.id, outcome: "ok", detail: { validation_ok: v.ok } });
    return json({ ok: true, id: data.id, submission: data });
  } catch (e) {
    console.error("corporate-registration-draft", e);
    return json({ error: (e as Error).message ?? "Unexpected error" }, 500);
  }
});
