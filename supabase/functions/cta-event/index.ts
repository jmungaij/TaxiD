import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const Text = (max: number) => z.string().trim().min(1).max(max);
const TrackBody = z.object({
  operation: z.literal("track"),
  button_name: Text(200),
  action_type: z.enum(["navigate", "external", "submit", "dialog", "scroll", "noop"]),
  target: z.string().trim().max(500).optional().nullable(),
  page_source: z.string().trim().max(500).optional().nullable(),
  session_id: Text(128),
  campaign_source: z.string().trim().max(200).optional().nullable(),
  utm_source: z.string().trim().max(200).optional().nullable(),
  utm_medium: z.string().trim().max(200).optional().nullable(),
  utm_campaign: z.string().trim().max(200).optional().nullable(),
  metadata: z.record(z.unknown()).default({}).refine((value) => JSON.stringify(value).length <= 8_192),
  client_authenticated: z.boolean().optional(),
  client_role_present: z.boolean().optional(),
}).strict();

const ConvertBody = z.object({
  operation: z.literal("convert"),
  session_id: Text(128),
  button_name: Text(200),
  value: z.number().finite().nonnegative().max(1_000_000_000).optional().nullable(),
}).strict();

const Body = z.discriminatedUnion("operation", [TrackBody, ConvertBody]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const raw = await req.text();
  if (raw.length > 16_384) return json({ error: "payload_too_large" }, 413);

  let input: unknown;
  try { input = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = Body.safeParse(input);
  if (!parsed.success) return json({ error: "validation_failed" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return json({ error: "service_unavailable" }, 503);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  let userId: string | null = null;
  let userRole: string | null = null;

  if (token) {
    const verifier = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data } = await verifier.auth.getUser(token);
    userId = data.user?.id ?? null;
    if (userId) {
      const { data: role } = await admin.from("user_roles").select("role").eq("user_id", userId).limit(1).maybeSingle();
      userRole = role?.role ?? null;
    }
  }

  if (parsed.data.operation === "track") {
    const { client_authenticated: _clientAuthenticated, client_role_present: _clientRolePresent, operation: _operation, ...event } = parsed.data;
    const { error } = await admin.from("cta_events").insert({
      ...event,
      user_id: userId,
      user_role: userRole,
      converted: false,
      converted_at: null,
      conversion_value: null,
    });
    if (error) {
      console.error("cta_event_insert_failed", { code: error.code });
      return json({ error: "event_not_recorded" }, 500);
    }
    return json({ ok: true }, 202);
  }

  // A conversion can only be claimed by the signed-in visitor who made the
  // event; anonymous or cross-user conversion claims are refused.
  if (!userId) return json({ error: "sign_in_required" }, 401);
  const { error } = await admin.from("cta_events")
    .update({ converted: true, converted_at: new Date().toISOString(), conversion_value: parsed.data.value ?? null })
    .eq("session_id", parsed.data.session_id)
    .eq("button_name", parsed.data.button_name)
    .eq("user_id", userId)
    .is("converted_at", null);
  if (error) {
    console.error("cta_conversion_update_failed", { code: error.code });
    return json({ error: "conversion_not_recorded" }, 500);
  }
  return json({ ok: true });
});