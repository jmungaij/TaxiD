// Corporate KYB review — staff-only queue for corporate registration drafts.
// Ops: list, get, decide_document, decide_draft, signed_url, rescan_now.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const REVIEWER_ROLES = ["super_admin", "admin", "compliance_admin"];
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list"), status: z.enum(["submitted", "approved", "rejected", "changes_requested"]).default("submitted") }),
  z.object({ op: z.literal("get"), draft_id: z.string().uuid() }),
  z.object({ op: z.literal("signed_url"), document_id: z.string().uuid() }),
  z.object({ op: z.literal("rescan_now"), draft_id: z.string().uuid(), document_id: z.string().uuid().optional() }),
  z.object({
    op: z.literal("decide_document"), document_id: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]), reason: z.string().max(1000).nullable().optional(),
    evidence: z.record(z.unknown()).optional(),
  }),
  z.object({
    op: z.literal("decide_draft"), draft_id: z.string().uuid(),
    decision: z.enum(["approved", "rejected", "changes_requested"]), reason: z.string().max(1000).nullable().optional(),
    evidence: z.record(z.unknown()).optional(),
  }),
]);

const CHECKLIST = {
  limited_company: [
    { key: "certificate_of_incorporation", label: "Certificate of Incorporation", required: true },
    { key: "cr12", label: "Certificate of Registration (CR12)", required: true },
    { key: "kra_pin", label: "KRA PIN certificate", required: true },
  ],
  registered_business: [
    { key: "business_registration", label: "Business registration certificate", required: true },
    { key: "kra_pin", label: "KRA PIN certificate", required: true },
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Please sign in." }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: claims, error: cErr } = await admin.auth.getClaims(auth.slice(7));
    if (cErr || !claims?.claims?.sub) return json({ error: "Please sign in." }, 401);
    const uid = claims.claims.sub as string;

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid).in("role", REVIEWER_ROLES);
    if (!roles?.length) return json({ error: "You do not have permission to review company applications." }, 403);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
    const b = parsed.data;
    const audit = (action: string, detail: Record<string, unknown>, draft_id?: string, document_id?: string) =>
      admin.from("corporate_kyb_audit_log").insert({
        action, actor_kind: "staff", actor_id: uid, draft_id: draft_id ?? null,
        document_id: document_id ?? null, outcome: "ok", detail,
      });

    switch (b.op) {
      case "list": {
        const q = admin.from("corporate_registration_drafts")
          .select("id,status,decision,submitted_at,business_registration_type,business_info,personal_info,validation")
          .order("submitted_at", { ascending: false, nullsFirst: false }).limit(200);
        const { data, error } = b.status === "submitted" ? await q.eq("status", "submitted") : await q.eq("decision", b.status);
        if (error) throw error;
        return json({ drafts: data ?? [] });
      }
      case "get": {
        const [d, docs, revs, vers] = await Promise.all([
          admin.from("corporate_registration_drafts").select("*").eq("id", b.draft_id).maybeSingle(),
          admin.from("corporate_registration_documents").select("*").eq("draft_id", b.draft_id),
          admin.from("corporate_registration_reviews").select("*").eq("draft_id", b.draft_id).order("created_at", { ascending: false }),
          admin.from("corporate_registration_document_versions").select("*").eq("draft_id", b.draft_id).order("version", { ascending: false }),
        ]);
        if (d.error) throw d.error;
        if (!d.data) return json({ error: "Application not found." }, 404);
        const versions_by_slot: Record<string, unknown[]> = {};
        for (const v of vers.data ?? []) (versions_by_slot[v.slot_key] ??= []).push(v);
        const type = (d.data.business_registration_type ?? "limited_company") as keyof typeof CHECKLIST;
        return json({
          draft: d.data, documents: docs.data ?? [], reviews: revs.data ?? [],
          checklist: CHECKLIST[type] ?? CHECKLIST.limited_company,
          versions_by_slot, rescan_runs_by_document: {},
        });
      }
      case "signed_url": {
        const { data: doc } = await admin.from("corporate_registration_documents").select("storage_path").eq("id", b.document_id).maybeSingle();
        if (!doc?.storage_path) return json({ error: "File not found." }, 404);
        const [bucket, ...rest] = doc.storage_path.split("/");
        const tryBuckets = [[bucket, rest.join("/")], ["corporate-documents", doc.storage_path]];
        for (const [bk, path] of tryBuckets) {
          const { data } = await admin.storage.from(bk).createSignedUrl(path, 300);
          if (data?.signedUrl) return json({ url: data.signedUrl });
        }
        return json({ error: "The file could not be found in storage." }, 404);
      }
      case "rescan_now":
        return json({ error: "Automatic document scanning is not connected yet. Review the files manually." }, 501);
      case "decide_document": {
        if (b.decision === "rejected" && !b.reason?.trim()) return json({ error: "A reason is required to reject." }, 400);
        const { data: doc } = await admin.from("corporate_registration_documents").select("id,draft_id").eq("id", b.document_id).maybeSingle();
        if (!doc) return json({ error: "Document not found." }, 404);
        const { data: rev, error: rErr } = await admin.from("corporate_registration_reviews").insert({
          draft_id: doc.draft_id, document_id: doc.id, reviewer_id: uid, scope: "document",
          decision: b.decision, reason: b.reason ?? null, evidence: b.evidence ?? {}, correlation_id: crypto.randomUUID(),
        }).select("id").single();
        if (rErr) throw rErr;
        const { error } = await admin.from("corporate_registration_documents").update({
          admin_decision: b.decision, admin_reason: b.reason ?? null, admin_reviewer: uid,
          admin_reviewed_at: new Date().toISOString(), reupload_required: b.decision === "rejected",
        }).eq("id", doc.id);
        if (error) throw error;
        await audit("decide_document", { decision: b.decision, review_id: rev.id }, doc.draft_id, doc.id);
        return json({ ok: true, review_id: rev.id });
      }
      case "decide_draft": {
        if (b.decision !== "approved" && !b.reason?.trim()) return json({ error: "A reason is required." }, 400);
        const { data: d } = await admin.from("corporate_registration_drafts").select("id,status").eq("id", b.draft_id).maybeSingle();
        if (!d) return json({ error: "Application not found." }, 404);
        if (b.decision === "approved") {
          const { data: docs } = await admin.from("corporate_registration_documents").select("admin_decision").eq("draft_id", b.draft_id);
          if (!docs?.length || docs.some((x) => x.admin_decision !== "approved"))
            return json({ error: "Approve every document before approving the application." }, 409);
        }
        const { data: rev, error: rErr } = await admin.from("corporate_registration_reviews").insert({
          draft_id: b.draft_id, reviewer_id: uid, scope: "draft", decision: b.decision,
          reason: b.reason ?? null, evidence: b.evidence ?? {}, correlation_id: crypto.randomUUID(),
        }).select("id").single();
        if (rErr) throw rErr;
        const status = b.decision === "changes_requested" ? "draft" : b.decision;
        const { error } = await admin.from("corporate_registration_drafts").update({
          status, decision: b.decision, decided_by: uid, decided_at: new Date().toISOString(), decision_reason: b.reason ?? null,
        }).eq("id", b.draft_id);
        if (error) throw error;
        await admin.from("corporate_registration_notifications").insert({
          draft_id: b.draft_id, kind: `application_${b.decision}`, title: `Application ${b.decision.replace("_", " ")}`,
          message: b.reason ?? "Your company application has been reviewed.", reason: b.reason ?? null, review_id: rev.id,
        });
        await audit("decide_draft", { decision: b.decision, review_id: rev.id }, b.draft_id);
        return json({ ok: true, review_id: rev.id });
      }
    }
  } catch (e) {
    console.error("corporate-kyb-review", e);
    return json({ error: (e as Error).message ?? "Unexpected error" }, 500);
  }
});
