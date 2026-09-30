import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

// Super-admin-only management of payment gateway credentials (M-Pesa Daraja,
// eTIMS device). Secret values are write-only: status responses only report
// whether each credential is set, never its value.

const headers = { ...corsHeaders, "Content-Type": "application/json" };
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

const SaveSchema = z.object({
  environment: z.enum(["production", "sandbox"]).default("production"),
  short_code: z.string().trim().regex(/^\d{4,10}$/).optional(),
  consumer_key: z.string().trim().min(10).max(200).optional(),
  consumer_secret: z.string().trim().min(10).max(200).optional(),
  passkey: z.string().trim().min(10).max(200).optional(),
  b2c_initiator_name: z.string().trim().min(2).max(100).optional(),
  b2c_security_credential: z.string().trim().min(10).max(2000).optional(),
  etims_device_serial: z.string().trim().min(2).max(100).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return response({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return response({ error: "Backend configuration is incomplete" }, 500);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return response({ error: "Invalid session" }, 401);

  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: isSuperAdmin, error: roleError } = await service.rpc("has_role", {
    _user_id: authData.user.id,
    _role: "super_admin",
  });
  if (roleError || !isSuperAdmin) return response({ error: "Super admin access required" }, 403);

  if (req.method === "GET") {
    const { data, error } = await service
      .from("payment_gateway_settings")
      .select("gateway, environment, short_code, consumer_key, consumer_secret, passkey, b2c_initiator_name, b2c_security_credential, etims_device_serial, updated_at")
      .eq("gateway", "mpesa");
    if (error) return response({ error: "Could not load settings" }, 500);
    const rows = (data ?? []).map((row: Record<string, unknown>) => ({
      environment: row.environment,
      short_code: row.short_code ?? null,
      updated_at: row.updated_at,
      consumer_key_set: Boolean(row.consumer_key),
      consumer_secret_set: Boolean(row.consumer_secret),
      passkey_set: Boolean(row.passkey),
      b2c_initiator_name_set: Boolean(row.b2c_initiator_name),
      b2c_security_credential_set: Boolean(row.b2c_security_credential),
      etims_device_serial_set: Boolean(row.etims_device_serial),
    }));
    return response({ settings: rows });
  }

  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  let rawBody: unknown = {};
  try { rawBody = await req.json(); } catch { rawBody = {}; }
  const parsed = SaveSchema.safeParse(rawBody);
  if (!parsed.success) return response({ error: parsed.error.flatten().fieldErrors }, 400);

  const { environment, ...fields } = parsed.data;
  const updates: Record<string, unknown> = { updated_by: authData.user.id, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== "") updates[key] = value;
  }
  if (Object.keys(updates).length === 2) return response({ error: "No credentials provided" }, 400);

  const { error: upsertError } = await service
    .from("payment_gateway_settings")
    .upsert({ gateway: "mpesa", environment, ...updates }, { onConflict: "gateway,environment" });
  if (upsertError) return response({ error: "Could not save credentials" }, 500);

  return response({ saved: true, environment });
});
