// Corporate KYB review — staff-only queue for corporate registration drafts.
// Ops: list, get, decide_document, decide_draft, signed_url, rescan_now.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { KYB_BUCKET, checklistFor, draftValidation, scanDocument } from "../_shared/kyb.ts";

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
        const { data, error } = b.status === "submitted"
          ? await q.eq("status", "submitted").eq("decision", "pending")
          : await q.eq("decision", b.status);
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
        return json({
          draft: d.data, documents: docs.data ?? [], reviews: revs.data ?? [],
          checklist: checklistFor(d.data.business_registration_type),
          versions_by_slot, rescan_runs_by_document: {},
        });
      }
      case "signed_url": {
        const { data: doc } = await admin.from("corporate_registration_documents").select("storage_path").eq("id", b.document_id).maybeSingle();
        if (!doc?.storage_path) return json({ error: "File not found." }, 404);
        const { data } = await admin.storage.from(KYB_BUCKET).createSignedUrl(doc.storage_path, 300);
        if (data?.signedUrl) return json({ url: data.signedUrl });
        return json({ error: "The file could not be found in storage." }, 404);
      }
      case "rescan_now": {
        const { data: cd } = await admin.from("corporate_kyb_rescan_cooldowns").select("last_run_at").eq("scope", "draft").eq("key", b.draft_id).maybeSingle();
        const wait = cd?.last_run_at ? 60_000 - (Date.now() - new Date(cd.last_run_at).getTime()) : 0;
        if (wait > 0) return json({ error: "throttled", retry_after_ms: wait, reasons: [{ reason: "cooldown", scope: "draft", retry_after_ms: wait }] }, 429);
        await admin.from("corporate_kyb_rescan_cooldowns").upsert({ scope: "draft", key: b.draft_id, last_run_at: new Date().toISOString(), run_count_1m: 1, window_started_at: new Date().toISOString() }, { onConflict: "scope,key" });
        const { data: d } = await admin.from("corporate_registration_drafts").select("*").eq("id", b.draft_id).maybeSingle();
        if (!d) return json({ error: "Application not found." }, 404);
        let q = admin.from("corporate_registration_documents").select("*").eq("draft_id", b.draft_id);
        if (b.document_id) q = q.eq("id", b.document_id);
        const { data: docs } = await q;
        const { data: run } = await admin.from("corporate_registration_rescan_runs").insert({ detail: { draft_id: b.draft_id, by: uid } }).select("*").single();
        let changed = 0, newly_failed = 0;
        for (const doc of docs ?? []) {
          const scan = await scanDocument(admin, doc, d);
          if (JSON.stringify(scan.validation) !== JSON.stringify(doc.validation)) changed++;
          if (scan.validation.ok === false && doc.validation?.ok !== false) newly_failed++;
          await admin.from("corporate_registration_documents").update({ ...scan, last_rescan_run_id: run?.id ?? null }).eq("id", doc.id);
        }
        const finished = { finished_at: new Date().toISOString(), scanned_count: docs?.length ?? 0, changed_count: changed, newly_failed_count: newly_failed };
        const { data: done } = run ? await admin.from("corporate_registration_rescan_runs").update(finished).eq("id", run.id).select("*").single() : { data: null };
        const all = (await admin.from("corporate_registration_documents").select("slot_key,validation").eq("draft_id", b.draft_id)).data ?? [];
        await admin.from("corporate_registration_drafts").update({ validation: draftValidation(d.business_registration_type, all) }).eq("id", b.draft_id);
        await audit("rescan_now", finished, b.draft_id, b.document_id);
        return json({ run: done, scanned: finished.scanned_count, changed, newly_failed });
      }
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
        const { data: d } = await admin.from("corporate_registration_drafts").select("*").eq("id", b.draft_id).maybeSingle();
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
        if (d.decision === "approved") return json({ error: "This application is already approved." }, 409);
        let provisioned: Record<string, unknown> | null = null;
        if (b.decision === "approved") {
          const r = await provision(admin, d, uid);
          if ("error" in r) return json({ error: r.error }, 409);
          provisioned = r;
        }
        const { error } = await admin.from("corporate_registration_drafts").update({
          status: "submitted", decision: b.decision, decided_by: uid, decided_at: new Date().toISOString(), decision_reason: b.reason ?? null,
        }).eq("id", b.draft_id);
        if (error) throw error;
        await admin.from("corporate_registration_notifications").insert({
          draft_id: b.draft_id, kind: `application_${b.decision}`, title: `Application ${b.decision.replace("_", " ")}`,
          message: b.reason ?? "Your company application has been reviewed.", reason: b.reason ?? null, review_id: rev.id,
        });
        await audit("decide_draft", { decision: b.decision, review_id: rev.id, provisioned }, b.draft_id);
        return json({ ok: true, review_id: rev.id, provisioned });
      }
    }
  } catch (e) {
    console.error("corporate-kyb-review", e);
    return json({ error: (e as Error).message ?? "Unexpected error" }, 500);
  }
});

const PUBLIC_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "live.com", "proton.me", "protonmail.com", "ymail.com"]);

// deno-lint-ignore no-explicit-any
async function provision(admin: any, d: any, reviewer: string): Promise<{ error: string } | Record<string, unknown>> {
  const p = d.personal_info ?? {}, bi = d.business_info ?? {};
  const email = String(p.corporate_email ?? "").trim().toLowerCase();
  const kra = String(bi.kra_pin ?? "").trim().toUpperCase();
  if (!email || !bi.registered_name || !kra) return { error: "Application is missing the work email, registered name or KRA PIN." };
  const { data: dup } = await admin.from("corporate_accounts").select("id,legal_name").eq("kra_pin", kra).maybeSingle();
  if (dup) return { error: `A company with this KRA PIN already exists (${dup.legal_name}).` };
  const { data: acct, error } = await admin.from("corporate_accounts").insert({
    legal_name: bi.registered_name, trading_name: bi.trading_name ?? null, kra_pin: kra,
    registration_number: bi.certificate_of_incorporation_number ?? bi.registration_number ?? null,
    billing_email: email, billing_phone: p.corporate_phone ?? null,
    billing_address: [bi.building, bi.street, bi.town, bi.county].filter(Boolean).join(", ") || null,
    status: "ACTIVE", metadata: { source: "kyb_registration", draft_id: d.id, approved_by: reviewer, approved_at: new Date().toISOString() },
  }).select("id").single();
  if (error) return { error: error.message };
  const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ");
  await admin.from("corporate_employees").insert({
    corporate_id: acct.id, user_id: d.user_id ?? null, email, full_name: fullName || null, phone: p.corporate_phone ?? null,
    role: "corporate_admin", status: d.user_id ? "active" : "invited", invited_at: new Date().toISOString(),
    activated_at: d.user_id ? new Date().toISOString() : null, metadata: { first_admin: true, position: p.position ?? null },
  });
  if (d.user_id) await admin.from("user_roles").upsert({ user_id: d.user_id, role: "corporate_admin" }, { onConflict: "user_id,role" });
  const domain = email.split("@")[1];
  let work_domain: string | null = null;
  if (domain && !PUBLIC_DOMAINS.has(domain)) {
    const { error: wdErr } = await admin.from("corporate_work_domains").insert({ domain, corporate_id: acct.id });
    if (!wdErr) work_domain = domain;
  }
  return { corporate_id: acct.id, admin_email: email, linked_user: !!d.user_id, work_domain };
}
