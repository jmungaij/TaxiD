// Charter API — rebuilt service. Implements operator bookings (booking_list,
// flight_event, payment_status) and webhooks (webhook_list/save/delete/test/replay).
// Other actions answer with `not_available` instead of failing silently.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const OPS_ROLES = ["super_admin", "admin", "operations_admin", "dispatch_manager"];
const WEBHOOK_ROLES = ["super_admin", "admin", "operations_admin"];
const FLIGHT_STAGES = ["requested", "scheduled", "departed", "arrived"];
const EVENT_TYPES = ["booking.created", "booking.updated", "flight.status_changed", "payment.confirmed", "webhook.test"];

const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const fail = (error: string, message: string, status = 400) => json({ ok: false, error, message }, status);

async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeUrl(u: string) {
  try {
    const p = new URL(u);
    if (p.protocol !== "https:") return false;
    return !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(p.hostname);
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return fail("unauthorized", "Please sign in.", 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: c, error: cErr } = await admin.auth.getClaims(auth.slice(7));
    if (cErr || !c?.claims?.sub) return fail("unauthorized", "Please sign in.", 401);
    const uid = c.claims.sub as string;
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", uid);
    const roles = new Set((roleRows ?? []).map((r) => r.role as string));
    const isOps = OPS_ROLES.some((r) => roles.has(r));
    const canWebhooks = WEBHOOK_ROLES.some((r) => roles.has(r));

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";

    const loadBooking = async (id?: string, reference?: string) => {
      let q = admin.from("charter_bookings").select("*");
      q = id ? q.eq("id", id) : q.eq("reference", reference ?? "");
      const { data } = await q.maybeSingle();
      if (!data) return null;
      if (!isOps && data.user_id !== uid) return null;
      return data;
    };

    const deliver = async (endpoint: { id: string; url: string; secret: string | null }, event_type: string, payload: Record<string, unknown>, booking?: { id?: string; reference?: string }) => {
      const event_id = `evt_${crypto.randomUUID()}`;
      const raw = JSON.stringify({ id: event_id, type: event_type, created_at: new Date().toISOString(), data: payload });
      let response_status: number | null = null, error: string | null = null;
      try {
        const res = await fetch(endpoint.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-TaxiD-Event": event_type, "X-TaxiD-Signature": await hmac(endpoint.secret ?? "", raw) },
          body: raw, signal: AbortSignal.timeout(8000),
        });
        response_status = res.status;
        await res.body?.cancel();
        if (!res.ok) error = `HTTP ${res.status}`;
      } catch (e) { error = (e as Error).message; }
      const status = error ? "failed" : "delivered";
      const { data: delivery } = await admin.from("charter_webhook_deliveries").insert({
        endpoint_id: endpoint.id, event_type, event_id, booking_id: booking?.id ?? null, reference: booking?.reference ?? null,
        actor_user_id: uid, payload, attempts: 1, status, response_status, error,
      }).select("id,endpoint_id,event_type,event_id,reference,status,response_status,error,created_at").single();
      await admin.from("charter_webhook_endpoints").update({ last_status: status, last_delivered_at: new Date().toISOString() }).eq("id", endpoint.id);
      return { delivery, event_id, status, response_status, error };
    };

    switch (action) {
      case "booking_list": {
        let q = admin.from("charter_bookings").select("*").order("created_at", { ascending: false }).limit(200);
        if (!isOps) q = q.eq("user_id", uid);
        const { data, error } = await q;
        if (error) throw error;
        return json({ ok: true, bookings: data ?? [] });
      }
      case "flight_event": {
        if (!isOps) return fail("forbidden", "Only charter operations staff can update flight status.", 403);
        const p = z.object({ booking_id: z.string().uuid(), status: z.enum(FLIGHT_STAGES as [string, ...string[]]), note: z.string().max(500).optional() }).safeParse(body);
        if (!p.success) return fail("invalid_request", "Invalid flight update.");
        const b = await loadBooking(p.data.booking_id);
        if (!b) return fail("not_found", "Booking not found.", 404);
        const from = FLIGHT_STAGES.indexOf(b.flight_status ?? "requested");
        const to = FLIGHT_STAGES.indexOf(p.data.status);
        if (to !== from + 1) return fail("invalid_transition", `Cannot move from ${b.flight_status ?? "requested"} to ${p.data.status}.`, 409);
        const events = [...(Array.isArray(b.flight_events) ? b.flight_events : []), { status: p.data.status, at: new Date().toISOString(), actor_id: uid, note: p.data.note ?? null }];
        const { data, error } = await admin.from("charter_bookings").update({ flight_status: p.data.status, flight_events: events, updated_at: new Date().toISOString() }).eq("id", b.id).select("*").single();
        if (error) throw error;
        return json({ ok: true, booking: data });
      }
      case "payment_status": {
        const p = z.object({ booking_id: z.string().uuid().optional(), reference: z.string().max(80).optional() }).safeParse(body);
        if (!p.success || (!p.data.booking_id && !p.data.reference)) return fail("invalid_request", "Provide a booking.");
        const b = await loadBooking(p.data.booking_id, p.data.reference);
        if (!b) return fail("not_found", "Booking not found.", 404);
        const { data: events } = await admin.from("charter_payment_events")
          .select("result_code,result_desc,mpesa_receipt,amount_kes,applied_status,outcome,created_at")
          .eq("booking_id", b.id).order("created_at", { ascending: false });
        return json({ ok: true, booking: b, events: events ?? [] });
      }
      case "webhook_list": {
        if (!canWebhooks) return fail("forbidden", "Only administrators can manage webhooks.", 403);
        const [e, d] = await Promise.all([
          admin.from("charter_webhook_endpoints").select("id,label,url,events,active,description,last_status,last_delivered_at,created_at").order("created_at", { ascending: false }),
          admin.from("charter_webhook_deliveries").select("id,endpoint_id,event_type,event_id,reference,status,response_status,error,created_at").order("created_at", { ascending: false }).limit(100),
        ]);
        if (e.error) throw e.error;
        return json({ ok: true, endpoints: e.data ?? [], deliveries: d.data ?? [] });
      }
      case "webhook_save": {
        if (!canWebhooks) return fail("forbidden", "Only administrators can manage webhooks.", 403);
        const p = z.object({
          id: z.string().uuid().optional(), label: z.string().trim().min(1).max(120), url: z.string().url().max(500),
          events: z.array(z.string().regex(/^[a-z_]+\.[a-z_]+$/)).min(1).max(30), active: z.boolean().default(true),
          description: z.string().max(500).optional(),
        }).safeParse(body);
        if (!p.success) return fail("invalid_request", "Check the label, URL and events.");
        if (!safeUrl(p.data.url)) return fail("invalid_url", "Use a public https:// address.");
        const { id, ...fields } = p.data;
        if (id) {
          const { data, error } = await admin.from("charter_webhook_endpoints").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select("id,label,url,events,active,description,last_status,last_delivered_at,created_at").single();
          if (error) throw error;
          return json({ ok: true, endpoint: data });
        }
        const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
        const { data, error } = await admin.from("charter_webhook_endpoints").insert({ ...fields, secret, created_by: uid }).select("id,label,url,events,active,description,last_status,last_delivered_at,created_at").single();
        if (error) throw error;
        return json({ ok: true, endpoint: data, secret });
      }
      case "webhook_delete": {
        if (!canWebhooks) return fail("forbidden", "Only administrators can manage webhooks.", 403);
        const p = z.object({ id: z.string().uuid() }).safeParse(body);
        if (!p.success) return fail("invalid_request", "Invalid endpoint.");
        const { error } = await admin.from("charter_webhook_endpoints").delete().eq("id", p.data.id);
        if (error) throw error;
        return json({ ok: true });
      }
      case "webhook_test": {
        if (!canWebhooks) return fail("forbidden", "Only administrators can manage webhooks.", 403);
        const { data: eps } = await admin.from("charter_webhook_endpoints").select("id,url,secret").eq("active", true);
        if (!eps?.length) return fail("no_endpoints", "Add an active endpoint first.", 409);
        let event_id = "";
        for (const ep of eps) event_id = (await deliver(ep, "webhook.test", { message: "TaxiD test event" })).event_id;
        return json({ ok: true, event_id });
      }
      case "webhook_replay": {
        if (!canWebhooks) return fail("forbidden", "Only administrators can manage webhooks.", 403);
        const p = z.object({ endpoint_id: z.string().uuid(), event_type: z.string().max(80).optional(), delivery_id: z.string().uuid().optional() }).safeParse(body);
        if (!p.success) return fail("invalid_request", "Invalid replay request.");
        const { data: ep } = await admin.from("charter_webhook_endpoints").select("id,url,secret").eq("id", p.data.endpoint_id).maybeSingle();
        if (!ep) return fail("not_found", "Endpoint not found.", 404);
        let type = p.data.event_type ?? "webhook.test", payload: Record<string, unknown> = { message: "TaxiD replay" }, booking;
        if (p.data.delivery_id) {
          const { data: d } = await admin.from("charter_webhook_deliveries").select("*").eq("id", p.data.delivery_id).maybeSingle();
          if (!d) return fail("not_found", "Delivery not found.", 404);
          type = d.event_type; payload = { ...(d.payload ?? {}), replay_of: d.event_id }; booking = { id: d.booking_id, reference: d.reference };
        }
        const r = await deliver(ep, type, payload, booking);
        return json({ ok: true, delivery: r.delivery, replayed_event_id: r.event_id, status: r.status, response_status: r.response_status, error: r.error });
      }
      // ── Inventory & pricing (sourced only from taxid_rate_card) ──
      case "inventory": {
        let q = admin.from("charter_inventory").select("*").eq("active", true).order("base_rate");
        if (typeof body.category === "string" && body.category) q = q.eq("category_slug", body.category);
        const { data, error } = await q;
        if (error) throw error;
        return json({ ok: true, items: data ?? [] });
      }
      case "access":
        return json({ ok: true, access: { is_ops: isOps, can_webhooks: canWebhooks, roles: [...roles] } });
      case "pricing_active": {
        const { data } = await admin.from("charter_pricing_config").select("*").order("version", { ascending: false }).limit(1).maybeSingle();
        const { data: rates } = await admin.from("taxid_rate_card").select("section,vehicle_group,location,basis,amount_kes,km_cap,all_inclusive").eq("is_active", true);
        return json({ ok: true, config: { ...(data ?? { version: 0 }), rate_card: rates ?? [] } });
      }
      case "pricing_versions": {
        const { data } = await admin.from("charter_pricing_config").select("id,version,effective_at,actor_email,note,created_at").order("version", { ascending: false }).limit(50);
        return json({ ok: true, versions: data ?? [] });
      }
      case "pricing_publish": {
        if (!roles.has("super_admin")) return fail("forbidden", "Only the TaxiD super admin can publish charter pricing.", 403);
        const { data: last } = await admin.from("charter_pricing_config").select("version").order("version", { ascending: false }).limit(1).maybeSingle();
        const { data, error } = await admin.from("charter_pricing_config").insert({
          version: (last?.version ?? 0) + 1, actor_id: uid, note: String(body.note ?? "").slice(0, 500), config: body.config ?? {}, changes: body.changes ?? {},
        }).select("*").single();
        if (error) throw error;
        return json({ ok: true, config: data });
      }
      case "quote_create": {
        const p = z.object({
          category_slug: z.string().max(60), asset_name: z.string().max(200), inventory_id: z.string().uuid().optional(),
          duration: z.coerce.number().min(1).max(366).default(1), quantity: z.coerce.number().int().min(1).max(50).default(1),
          trip: z.record(z.unknown()).default({}), contact: z.record(z.unknown()).default({}),
          controls: z.record(z.unknown()).optional(), cost_settings: z.record(z.unknown()).optional(), pricing_version: z.number().optional(),
        }).safeParse(body);
        if (!p.success) return fail("invalid_request", "Check the quote details.");
        let inv = null;
        if (p.data.inventory_id) inv = (await admin.from("charter_inventory").select("*").eq("id", p.data.inventory_id).maybeSingle()).data;
        if (!inv) inv = (await admin.from("charter_inventory").select("*").eq("name", p.data.asset_name).eq("active", true).limit(1).maybeSingle()).data;
        const rateId = (inv?.metadata as Record<string, unknown> | null)?.rate_card_id as string | undefined;
        let breakdown: Record<string, unknown> = { source: "rfq", note: "No published TaxiD rate for this asset — priced by operations." };
        let total: number | null = null; let status = "rfq";
        if (rateId) {
          const { data: r } = await admin.from("taxid_rate_card").select("*").eq("id", rateId).eq("is_active", true).maybeSingle();
          if (r) {
            const days = Math.ceil(p.data.duration);
            if (r.basis === "per_day_min3" && days < 3) return fail("min_days", "Self-drive daily hire needs at least 3 days.");
            total = Number(r.amount_kes) * days * p.data.quantity;
            status = "quoted";
            breakdown = { source: "taxid_rate_card", rate_id: r.id, section: r.section, basis: r.basis, unit_kes: Number(r.amount_kes),
              units: days, quantity: p.data.quantity, km_cap: r.km_cap, all_inclusive: r.all_inclusive, total_kes: total,
              client_total: body.total ?? null };
          }
        }
        const reference = `CQ-${Date.now().toString(36).toUpperCase()}`;
        const { data, error } = await admin.from("charter_quotes").insert({
          reference, user_id: uid, category_slug: p.data.category_slug, inventory_id: inv?.id ?? null, asset_name: p.data.asset_name,
          duration: p.data.duration, quantity: p.data.quantity, controls: p.data.controls ?? {}, cost_settings: p.data.cost_settings ?? {},
          breakdown, trip: p.data.trip, contact: p.data.contact, currency: "KES", total, status, pricing_version: p.data.pricing_version ?? null,
          rfq_state: status === "rfq" ? "open" : "priced", rfq_state_at: new Date().toISOString(),
        }).select("*").single();
        if (error) throw error;
        return json({ ok: true, quote: data });
      }
      case "quote_list": {
        let q = admin.from("charter_quotes").select("*").order("created_at", { ascending: false }).limit(200);
        if (!isOps) q = q.eq("user_id", uid);
        const { data, error } = await q;
        if (error) throw error;
        return json({ ok: true, quotes: data ?? [] });
      }
      case "booking_by_key": {
        const key = String(body.idempotency_key ?? "");
        const { data } = await admin.from("charter_bookings").select("*").eq("user_id", uid).eq("trip->>idempotency_key", key).maybeSingle();
        if (!data) return fail("not_found", "No booking for this submission.", 404);
        return json({ ok: true, booking: data, recovered: true });
      }
      case "booking_create": {
        const p = z.object({
          quote_id: z.string().uuid(), passengers: z.array(z.record(z.string())).max(100).default([]),
          contact: z.record(z.unknown()).default({}), trip: z.record(z.unknown()).default({}),
          payment_method: z.string().max(40).default("mpesa"), idempotency_key: z.string().min(8).max(120),
        }).safeParse(body);
        if (!p.success) return fail("invalid_request", "Check the booking details.");
        const { data: dup } = await admin.from("charter_bookings").select("*").eq("user_id", uid).eq("trip->>idempotency_key", p.data.idempotency_key).maybeSingle();
        if (dup) return json({ ok: true, booking: dup, replayed: true });
        const { data: q } = await admin.from("charter_quotes").select("*").eq("id", p.data.quote_id).maybeSingle();
        if (!q || (q.user_id !== uid && !isOps)) return fail("not_found", "Quote not found.", 404);
        if (q.total == null) return fail("awaiting_quotation", "This request needs a price from TaxiD operations before it can be booked.", 409);
        const reference = `CB-${Date.now().toString(36).toUpperCase()}`;
        const { data, error } = await admin.from("charter_bookings").insert({
          reference, quote_id: q.id, user_id: uid, category_slug: q.category_slug, asset_name: q.asset_name,
          passengers: p.data.passengers, contact: p.data.contact, trip: { ...p.data.trip, idempotency_key: p.data.idempotency_key },
          amount: q.total, currency: "KES", payment_method: p.data.payment_method, payment_status: "unpaid",
          status: "pending_payment", flight_status: "requested", flight_events: [{ status: "requested", at: new Date().toISOString(), actor_id: uid }],
          commission_bps: 1500, financials_source: "taxid_rate_card",
        }).select("*").single();
        if (error) throw error;
        await admin.from("charter_quotes").update({ status: "booked", rfq_state: "booked", rfq_state_at: new Date().toISOString() }).eq("id", q.id);
        return json({ ok: true, booking: data });
      }
      // ── Corporate charter wallets (credits only via verified M-Pesa callback) ──
      case "wallet_ensure": {
        const name = String(body.organization_name ?? "").trim().slice(0, 200);
        if (!name) return fail("invalid_request", "Organisation name is required.");
        const { data: ex } = await admin.from("charter_corporate_wallets").select("*").eq("owner_id", uid).eq("organization_name", name).maybeSingle();
        if (ex) return json({ ok: true, wallet: ex, created: false });
        const { data, error } = await admin.from("charter_corporate_wallets").insert({
          owner_id: uid, organization_name: name, approver_name: body.approver_name ?? null, approver_title: body.approver_title ?? null,
          currency: "KES", balance_kes: 0, status: "active",
        }).select("*").single();
        if (error) throw error;
        return json({ ok: true, wallet: data, created: true });
      }
      case "wallet_list": {
        let w = admin.from("charter_corporate_wallets").select("*").order("created_at", { ascending: false });
        if (!isOps) w = w.eq("owner_id", uid);
        const { data: wallets } = await w;
        const ids = (wallets ?? []).map((x) => x.id);
        const { data: ledger } = ids.length ? await admin.from("charter_wallet_ledger").select("*").in("wallet_id", ids).order("created_at", { ascending: false }).limit(200) : { data: [] };
        return json({ ok: true, wallets: wallets ?? [], ledger: ledger ?? [] });
      }
      case "wallet_movement": {
        const p = z.object({ wallet_id: z.string().uuid(), direction: z.enum(["credit", "debit"]), amount_kes: z.number().positive().max(10_000_000),
          reference: z.string().max(80).optional(), booking_id: z.string().uuid().optional(), cost_center: z.string().max(80).optional(),
          approver_name: z.string().max(120).optional(), approver_title: z.string().max(120).optional() }).safeParse(body);
        if (!p.success) return fail("invalid_request", "Check the wallet movement.");
        if (p.data.direction === "credit") return fail("credit_forbidden", "Wallets are credited only by a confirmed M-Pesa payment.", 403);
        const { data: w } = await admin.from("charter_corporate_wallets").select("*").eq("id", p.data.wallet_id).maybeSingle();
        if (!w || w.owner_id !== uid) return fail("not_found", "Wallet not found.", 404);
        const bal = Number(w.balance_kes);
        if (bal < p.data.amount_kes) return fail("insufficient_funds", `Wallet balance is KES ${bal.toLocaleString()}. Top up first.`, 409);
        const { data: last } = await admin.from("charter_wallet_ledger").select("entry_hash").eq("wallet_id", w.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        const after = bal - p.data.amount_kes; const prev = last?.entry_hash ?? "GENESIS";
        const entry_hash = await hmac(prev, JSON.stringify({ w: w.id, d: "debit", a: p.data.amount_kes, after, r: p.data.reference ?? null, t: Date.now() }));
        const { data: upd } = await admin.from("charter_corporate_wallets").update({ balance_kes: after, updated_at: new Date().toISOString() }).eq("id", w.id).eq("balance_kes", w.balance_kes).select("*").maybeSingle();
        if (!upd) return fail("conflict", "The wallet changed at the same time. Try again.", 409);
        const { data: entry, error } = await admin.from("charter_wallet_ledger").insert({
          wallet_id: w.id, direction: "debit", amount_kes: p.data.amount_kes, balance_after: after, reference: p.data.reference ?? null,
          booking_id: p.data.booking_id ?? null, cost_center: p.data.cost_center ?? null, approver_name: p.data.approver_name ?? null,
          approver_title: p.data.approver_title ?? null, prev_hash: prev, entry_hash, actor_id: uid,
        }).select("*").single();
        if (error) throw error;
        if (p.data.booking_id) await admin.from("charter_bookings").update({ payment_status: "paid", payment_provider: "corporate_wallet", paid_at: new Date().toISOString(), status: "confirmed" }).eq("id", p.data.booking_id).eq("user_id", uid);
        return json({ ok: true, wallet: upd, entry });
      }
      case "wallet_funding_create": {
        const p = z.object({ wallet_id: z.string().uuid(), amount_kes: z.number().min(10).max(5_000_000), cost_center: z.string().trim().min(1).max(80),
          purpose: z.string().max(300).optional(), approver_name: z.string().max(120).optional(), approver_title: z.string().max(120).optional(),
          idempotency_key: z.string().max(120).optional() }).safeParse(body);
        if (!p.success) return fail("invalid_request", "Check the top-up amount and cost centre.");
        const { data: w } = await admin.from("charter_corporate_wallets").select("id,owner_id").eq("id", p.data.wallet_id).maybeSingle();
        if (!w || w.owner_id !== uid) return fail("not_found", "Wallet not found.", 404);
        const key = p.data.idempotency_key ?? crypto.randomUUID();
        const { data: ex } = await admin.from("charter_wallet_funding_requests").select("*").eq("idempotency_key", key).maybeSingle();
        if (ex) return json({ ok: true, request: ex, reused: true });
        const { data, error } = await admin.from("charter_wallet_funding_requests").insert({
          wallet_id: w.id, owner_id: uid, actor_id: uid, amount_kes: p.data.amount_kes, cost_center: p.data.cost_center, purpose: p.data.purpose ?? null,
          approver_name: p.data.approver_name ?? null, approver_title: p.data.approver_title ?? null, reference: `CWF-${Date.now().toString(36).toUpperCase()}`,
          idempotency_key: key, status: "pending", expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        }).select("*").single();
        if (error) throw error;
        return json({ ok: true, request: data, reused: false });
      }
      case "wallet_funding_mark_stk": {
        const p = z.object({ request_id: z.string().uuid(), phone: z.string().max(20), checkout_request_id: z.string().max(120), merchant_request_id: z.string().max(120).optional() }).safeParse(body);
        if (!p.success) return fail("invalid_request", "Invalid M-Pesa reference.");
        const { data, error } = await admin.from("charter_wallet_funding_requests").update({ phone: p.data.phone, checkout_request_id: p.data.checkout_request_id,
          merchant_request_id: p.data.merchant_request_id ?? null, status: "stk_sent", last_stk_at: new Date().toISOString() })
          .eq("id", p.data.request_id).eq("owner_id", uid).in("status", ["pending", "stk_sent"]).select("*").maybeSingle();
        if (error) throw error;
        if (!data) return fail("not_found", "Top-up request not found or already finished.", 404);
        return json({ ok: true, request: data });
      }
      case "wallet_funding_status":
      case "wallet_funding_cancel": {
        const id = String(body.request_id ?? "");
        const { data: r } = await admin.from("charter_wallet_funding_requests").select("*").eq("id", id).maybeSingle();
        if (!r || (r.owner_id !== uid && !isOps)) return fail("not_found", "Top-up request not found.", 404);
        if (action === "wallet_funding_cancel") {
          if (!["pending", "stk_sent"].includes(r.status)) return fail("invalid_state", "This top-up can no longer be cancelled.", 409);
          const { data } = await admin.from("charter_wallet_funding_requests").update({ status: "cancelled" }).eq("id", id).select("*").single();
          return json({ ok: true, request: data });
        }
        const { data: w } = await admin.from("charter_corporate_wallets").select("*").eq("id", r.wallet_id).maybeSingle();
        return json({ ok: true, request: r, wallet: w });
      }
      case "wallet_funding_list": {
        let q = admin.from("charter_wallet_funding_requests").select("*").order("created_at", { ascending: false }).limit(Math.min(Number(body.limit) || 100, 500));
        if (body.wallet_id) q = q.eq("wallet_id", body.wallet_id);
        if (!(isOps && body.scope === "all")) q = q.eq("owner_id", uid);
        const { data } = await q;
        return json({ ok: true, requests: data ?? [], reconciliation: null });
      }
      default:
        return fail("not_available", "This charter feature is not connected yet.", 501);
    }
  } catch (e) {
    console.error("charter-api", e);
    return fail("server_error", (e as Error).message ?? "Unexpected error", 500);
  }
});
