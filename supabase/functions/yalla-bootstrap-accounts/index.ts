// TEMPORARY one-time function: creates confirmed Yalla Beena work accounts. Deleted after use.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ALLOWED = ["jmungai@yalla.africa", "charles.gateru@yalla.africa", "hr@yalla.africa"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || password.length < 8) return new Response("bad", { status: 400, headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const out: Record<string, string> = {};
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const email of ALLOWED) {
    if (list?.users.some((u) => u.email?.toLowerCase() === email)) { out[email] = "exists"; continue; }
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    out[email] = error ? error.message : "created";
  }
  return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
