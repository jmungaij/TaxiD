// Drafts a tailored rider-support resolution with Lovable AI. Admin-only.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createOpenAI } from "npm:@ai-sdk/openai";
import { streamText } from "npm:ai";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  getLovableAiGatewayResponseHeaders,
} from "../_shared/run-id.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lovable-aig-run-id",
  "Access-Control-Expose-Headers": "X-Lovable-AIG-Run-ID",
};
const json = (body: unknown, status = 200, extra?: Headers) => {
  const h = getLovableAiGatewayResponseHeaders(extra, cors);
  h.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: h });
};

const SYSTEM = `You are a senior TaxiD rider-support specialist in Kenya.
Draft a resolution for a support admin to review before sending.
Use ONLY the facts provided; never invent refunds, amounts or policies not given.
Output in Markdown with these sections:
**Summary** (1-2 sentences), **Likely cause**, **Recommended actions** (numbered, for the admin),
**Compensation** (only if justified by the facts, else "None recommended"),
**Message to rider** (warm, concise, under 150 words, signed "TaxiD Support").`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await supa.auth.getUser();
  if (!u?.user) return json({ error: "Please sign in." }, 401);
  const { data: isAdmin } = await supa.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "Only support admins can draft resolutions." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const issue = String(body.issue ?? "").trim().slice(0, 4000);
  const trip = String(body.trip ?? "").trim().slice(0, 4000);
  const rider = String(body.rider ?? "").trim().slice(0, 500);
  const category = String(body.category ?? "general").slice(0, 60);
  if (!issue) return json({ error: "Describe the rider's issue." }, 400);

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json({ error: "AI is not configured for this project." }, 500);

  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(req));
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  try {
    const result = streamText({
      model: provider.responses("openai/gpt-6-astra"),
      system: SYSTEM,
      prompt: `Category: ${category}\nRider: ${rider || "not provided"}\n\nTrip details:\n${trip || "not provided"}\n\nIssue description:\n${issue}`,
      abortSignal: req.signal,
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    const text = await result.text;
    const h = new Headers();
    const runId = runIdFetch.getRunId();
    if (runId) h.set("X-Lovable-AIG-Run-ID", runId);
    if (!text.trim()) return json({ error: "The AI declined to draft a response for this case." }, 422, h);
    return json({ draft: text }, 200, h);
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499, headers: cors });
    const status = (e as { statusCode?: number })?.statusCode ?? 500;
    const msg =
      status === 429 ? "AI is busy right now — please try again in a minute."
      : status === 402 ? "AI credits are used up. Add credits in Settings → Plans & credits."
      : status === 403 ? "AI access is blocked for this workspace."
      : "Couldn't draft a resolution. Please try again.";
    console.error("rider-support-draft failed", status, e);
    return json({ error: msg }, status);
  }
});
