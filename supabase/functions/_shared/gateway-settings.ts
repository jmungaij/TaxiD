// Loads payout (B2C) and KRA eTIMS settings saved through the super-admin
// Payment Credentials form (payment_gateway_settings). Values never leave the
// backend. Falls back to environment variables of the same legacy names.
import { createClient } from "npm:@supabase/supabase-js@2";

const MAP: Record<string, string> = {
  MPESA_B2C_INITIATOR_NAME: "b2c_initiator_name",
  MPESA_B2C_SECURITY_CREDENTIAL: "b2c_security_credential",
  MPESA_B2C_SHORTCODE: "b2c_short_code",
  TAX_KE_API_KEY: "etims_api_key",
  TAX_KE_BASE_URL: "etims_base_url",
  TAX_KE_WEBHOOK_SECRET: "etims_webhook_secret",
  TAX_KE_DEVICE_MODE: "etims_device_mode",
  TAX_KE_DEVICE_SERIAL: "etims_device_serial",
};

let cache: Record<string, string | null> = {};
let at = 0;

export async function primeGatewaySettings(): Promise<void> {
  if (Date.now() - at < 60_000) return;
  const env = Deno.env.get("MPESA_ENV") || "production";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await admin.from("payment_gateway_settings")
    .select(Object.values(MAP).join(","))
    .eq("gateway", "mpesa").eq("environment", env).maybeSingle();
  cache = (data ?? {}) as Record<string, string | null>;
  at = Date.now();
}

/** Saved value for a legacy setting name, else the environment variable. */
export function setting(name: string): string | undefined {
  const col = MAP[name];
  const v = col ? cache[col] : null;
  return (v && String(v).trim()) || Deno.env.get(name) || undefined;
}
