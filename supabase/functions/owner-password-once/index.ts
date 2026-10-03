// TEMPORARY one-time function: sets the super admin owner's password. Deleted after use.
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_ID = "bf4f63a4-63ff-4c61-8e5f-3644bbcb3422";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("no", { status: 405 });
  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || password.length < 8) return new Response("bad", { status: 400 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await admin.auth.admin.updateUserById(OWNER_ID, { password, ban_duration: "none" });
  return new Response(JSON.stringify({ ok: !error, error: error?.message ?? null }), {
    headers: { "Content-Type": "application/json" },
  });
});
