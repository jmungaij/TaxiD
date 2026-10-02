// etims-health — on-demand startup health check for the KRA eTIMS gateway.
// Verifies TAX_KE_BASE_URL is reachable and that the configured submit path
// is a real API endpoint (not a KRA HTML 404 page). Safe to call from the
// admin UI or from etims-submit before draining invoices.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { checkEtimsEndpoint, validateEtimsEnv } from "../_shared/etims.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const log = (event: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level: "info", fn: "etims-health", event, request_id: requestId, ts: new Date().toISOString(), ...extra }));

  try {
    const envProblems = validateEtimsEnv();
    if (envProblems.length > 0) {
      log("config_invalid", { problems: envProblems });
      return json({ ok: false, stage: "env", problems: envProblems }, 500);
    }

    const report = await checkEtimsEndpoint();
    log("checked", {
      ok: report.ok,
      base_status: report.base_status,
      health_status: report.health_status,
      looks_like_api: report.looks_like_api,
      duration_ms: Date.now() - startedAt,
    });
    return json(report, report.ok ? 200 : 503);
  } catch (err: any) {
    console.error(JSON.stringify({ level: "error", fn: "etims-health", event: "exception", request_id: requestId, error: err?.message || String(err) }));
    return json({ ok: false, error: err?.message || String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
