import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

// One-time: creates the confirmed owner account. Deleted immediately after use.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || password.length < 8) {
    return new Response(JSON.stringify({ error: "bad input" }), { status: 400, headers: corsHeaders });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const email = "ustaxid@gmail.com";
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email);
  let id: string;
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    id = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    id = data.user!.id;
  }
  for (const role of ["super_admin", "admin"]) {
    await admin.from("user_roles").upsert({ user_id: id, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
  }
  return new Response(JSON.stringify({ ok: true, created: !existing }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
