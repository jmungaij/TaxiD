// etims-webhook — public endpoint for inbound tax.ke callbacks.
// Verifies X-TaxKe-Signature HMAC-SHA256 before mutating any state.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { verifyWebhookSignature } from "../_shared/etims.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rawBody = await req.text();
  const signature = req.headers.get("x-taxke-signature");
  const remoteAddress = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null;
  const rawHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => { rawHeaders[k] = v; });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let verified = false;
  try {
    verified = await verifyWebhookSignature(rawBody, signature);
  } catch (e) {
    console.error("Signature verify error", e);
  }

  let parsed: any = {};
  try { parsed = JSON.parse(rawBody); } catch { parsed = { raw: rawBody }; }

  const invoiceNumber = parsed?.invoice_number || parsed?.data?.invoice_number || null;

  // Resolve invoice early so we can attach the webhook row to it
  let inv: { id: string; status: string } | null = null;
  if (invoiceNumber) {
    const { data } = await supabase
      .from("etims_invoices")
      .select("id, status")
      .eq("invoice_number", invoiceNumber)
      .maybeSingle();
    inv = data || null;
  }

  const { data: hook } = await supabase
    .from("etims_webhooks")
    .insert({
      invoice_id: inv?.id ?? null,
      source: "TAX_KE",
      event_type: parsed?.event_type || parsed?.event || "unknown",
      raw_headers: rawHeaders,
      raw_payload: parsed,
      signature: signature,
      signature_verified: verified,
      remote_address: remoteAddress,
    })
    .select("id")
    .single();

  if (!verified) {
    await supabase.from("etims_webhooks").update({
      processed: true,
      processed_at: new Date().toISOString(),
      processing_error: "invalid signature",
    }).eq("id", hook?.id);
    return new Response(JSON.stringify({ error: "invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processingError: string | null = null;

  if (inv) {
    const eventType = (parsed?.event_type || parsed?.event || "").toString().toUpperCase();
    const isAccepted = eventType.includes("ACCEPTED") || eventType.includes("SYNCED") || eventType.includes("SUCCESS");
    const isRejected = eventType.includes("REJECTED") || eventType.includes("FAILED");

    if (isAccepted && (inv.status === "SYNCING" || inv.status === "RETRYING")) {
      const { error } = await supabase.from("etims_invoices").update({
        status: "SYNCED",
        kra_invoice_number: parsed?.kra_invoice_number || parsed?.data?.kra_invoice_number || null,
        kra_control_unit_id: parsed?.kra_control_unit_id || parsed?.data?.kra_control_unit_id || null,
        qr_code_payload: parsed?.qr_code_payload || parsed?.data?.qr_code_payload || null,
        kra_signature: parsed?.signed_invoice_hash || parsed?.data?.signature || null,
        synced_at: new Date().toISOString(),
      }).eq("id", inv.id);
      if (error) processingError = error.message;
      await supabase.from("etims_retry_queue").delete().eq("invoice_id", inv.id);
      await supabase.from("etims_sync_events").insert({
        invoice_id: inv.id,
        event_type: "WEBHOOK_ACK",
        attempt_number: 1,
        response_payload: parsed,
      });
    } else if (isRejected && (inv.status === "SYNCING" || inv.status === "RETRYING")) {
      const errStr = parsed?.error || parsed?.message || "Rejected by KRA";
      const { error } = await supabase.from("etims_invoices").update({
        status: "FAILED",
        last_error: errStr,
      }).eq("id", inv.id);
      if (error) processingError = error.message;
      await supabase.from("etims_sync_events").insert({
        invoice_id: inv.id,
        event_type: "WEBHOOK_REJECT",
        attempt_number: 1,
        response_payload: parsed,
        error_message: errStr,
      });
    }
  } else if (invoiceNumber) {
    processingError = `Unknown invoice_number ${invoiceNumber}`;
  }

  await supabase.from("etims_webhooks").update({
    processed: true,
    processed_at: new Date().toISOString(),
    processing_error: processingError,
  }).eq("id", hook?.id);

  return new Response(JSON.stringify({ ok: true, webhook_id: hook?.id }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
