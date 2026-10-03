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
      default:
        return fail("not_available", "This charter feature is not connected yet.", 501);
    }
  } catch (e) {
    console.error("charter-api", e);
    return fail("server_error", (e as Error).message ?? "Unexpected error", 500);
  }
});
