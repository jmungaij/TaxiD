import { setting, primeGatewaySettings } from "./gateway-settings.ts";
// tax.ke eTIMS adapter — single point of integration with the KRA-compliant gateway.
// All eTIMS HTTP calls must go through this module (no inline fetch elsewhere).

export type EtimsDeviceMode = "OSCU" | "VSCU";

export interface EtimsConfig {
  apiKey: string;
  webhookSecret: string;
  baseUrl: string;
  deviceMode: EtimsDeviceMode;
  submitPath: string;
  healthPath: string;
}

// KRA eTIMS default endpoint paths per device profile. VSCU/OSCU expose the
// same OSDC servlet family under different subpaths; we default to the OSCU
// sales-save endpoint. Override with TAX_KE_SUBMIT_PATH when your KRA
// onboarding pack specifies a different route (e.g. a taxpayer-specific
// gateway path).
const DEFAULT_PATHS: Record<EtimsDeviceMode, { submit: string; health: string }> = {
  OSCU: { submit: "/etims-api/saveTrnsSalesOsdc", health: "/etims-api/selectInitOsdcInfo" },
  VSCU: { submit: "/vscu/v1/trnsSales/saveSales", health: "/vscu/v1/init/selectInitInfo" },
};

function resolveDeviceMode(): EtimsDeviceMode {
  const raw = (setting("TAX_KE_DEVICE_MODE") || "OSCU").toUpperCase();
  return raw === "VSCU" ? "VSCU" : "OSCU";
}

export function getConfig(): EtimsConfig {
  const apiKey = setting("TAX_KE_API_KEY") || "";
  const webhookSecret = setting("TAX_KE_WEBHOOK_SECRET") || "";
  const baseUrl = (setting("TAX_KE_BASE_URL") || "").replace(/\/$/, "");
  if (!apiKey || !webhookSecret || !baseUrl) {
    throw new Error("eTIMS config missing (TAX_KE_API_KEY / TAX_KE_WEBHOOK_SECRET / TAX_KE_BASE_URL)");
  }
  const deviceMode = resolveDeviceMode();
  const defaults = DEFAULT_PATHS[deviceMode];
  const submitPath = normalizePath(Deno.env.get("TAX_KE_SUBMIT_PATH") || defaults.submit);
  const healthPath = normalizePath(Deno.env.get("TAX_KE_HEALTH_PATH") || defaults.health);
  return { apiKey, webhookSecret, baseUrl, deviceMode, submitPath, healthPath };
}

function normalizePath(p: string): string {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

// Fail-fast startup validator. Returns a list of human-readable problems so
// edge functions can surface clear 500s instead of masking config errors as
// upstream failures ("DEPLOYMENT_NOT_FOUND", "Body already consumed", etc.).
export function validateEtimsEnv(): string[] {
  const problems: string[] = [];
  const apiKey = setting("TAX_KE_API_KEY");
  const webhookSecret = setting("TAX_KE_WEBHOOK_SECRET");
  const baseUrl = setting("TAX_KE_BASE_URL");
  if (!apiKey) problems.push("TAX_KE_API_KEY is not set");
  if (!webhookSecret) problems.push("TAX_KE_WEBHOOK_SECRET is not set");
  if (!baseUrl) {
    problems.push("TAX_KE_BASE_URL is not set");
  } else {
    try {
      const u = new URL(baseUrl);
      if (!/^https?:$/.test(u.protocol)) problems.push(`TAX_KE_BASE_URL must be http(s), got ${u.protocol}`);
      if (/\.vercel\.app$/i.test(u.hostname)) {
        problems.push(`TAX_KE_BASE_URL points at a Vercel host (${u.hostname}); this must be the live KRA eTIMS gateway URL issued for your taxpayer`);
      }
      // Guard against pasting a taxpayer portal URL (browser UI) as the API base.
      if (/\/main\/service\//i.test(u.pathname)) {
        problems.push(`TAX_KE_BASE_URL looks like the eTIMS taxpayer portal (${u.pathname}); use the API gateway origin only, e.g. https://etims-api-sbx.kra.go.ke`);
      }
    } catch {
      problems.push(`TAX_KE_BASE_URL is not a valid URL: ${baseUrl}`);
    }
  }
  const mode = (setting("TAX_KE_DEVICE_MODE") || "OSCU").toUpperCase();
  if (mode !== "OSCU" && mode !== "VSCU") {
    problems.push(`TAX_KE_DEVICE_MODE must be OSCU or VSCU, got ${mode}`);
  }
  return problems;
}


export interface EtimsLineInput {
  description: string;
  quantity: number;
  unit_price_cents: number;
  taxable_cents: number;
  tax_cents: number;
  total_cents: number;
  tax_scheme_code: string;
  tax_rate_bps: number;
}

export interface EtimsSubmitPayload {
  invoice_number: string;
  invoice_type: string;
  currency: string;
  customer_kra_pin?: string | null;
  customer_name?: string | null;
  subtotal_cents: number;
  tax_total_cents: number;
  total_cents: number;
  issued_at: string;
  items: EtimsLineInput[];
  meta?: Record<string, unknown>;
}

export interface EtimsSubmitResponse {
  ok: boolean;
  status: number;
  kra_invoice_number?: string;
  kra_control_unit_id?: string;
  qr_code_payload?: string;
  signed_invoice_hash?: string;
  raw: unknown;
  error_reason?: string; // human-readable classification when !ok
  endpoint?: string;     // full URL that was called (for logs/UI)
}

// Classify a KRA response body so the UI/logs see the real upstream reason
// instead of a 1000-char blob of HTML from the KRA nginx 404 page.
function classifyFailure(status: number, contentType: string, rawText: string, url: string): string {
  const ct = (contentType || "").toLowerCase();
  const looksHtml = ct.includes("text/html") || /^\s*<(?:!doctype|html)/i.test(rawText);
  if (looksHtml) {
    // KRA sandbox returns a branded 404 HTML page when the submit path is wrong.
    if (status === 404) {
      return `KRA gateway returned HTML 404 for ${url} — the submit path is not registered on this host. Set TAX_KE_SUBMIT_PATH to the value from your KRA onboarding pack (OSCU/VSCU).`;
    }
    if (status === 401 || status === 403) {
      return `KRA gateway returned HTML ${status} for ${url} — request was rejected before reaching the API (likely wrong host, WAF block, or missing device auth).`;
    }
    return `KRA gateway returned an HTML page (status ${status}) for ${url} instead of JSON — TAX_KE_BASE_URL / TAX_KE_SUBMIT_PATH is not pointed at the eTIMS API.`;
  }
  if (status === 0) return `network error calling ${url}`;
  if (status >= 500) return `KRA gateway ${status} at ${url} — upstream error, will retry.`;
  return `KRA gateway ${status} at ${url}`;
}

export async function submitInvoice(payload: EtimsSubmitPayload): Promise<EtimsSubmitResponse> {
  const cfg = getConfig();
  const url = `${cfg.baseUrl}${cfg.submitPath}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiKey}`,
      "X-Idempotency-Key": payload.invoice_number,
      "X-Device-Mode": cfg.deviceMode,
    },
    body: JSON.stringify(payload),
  });

  // Read body exactly once, then attempt JSON.parse. Reading twice throws
  // "Body already consumed" in Deno's fetch implementation.
  const rawText = await res.text();
  const contentType = res.headers.get("content-type") || "";
  let raw: unknown = rawText;
  let parsedJson = false;
  if (rawText) {
    try { raw = JSON.parse(rawText); parsedJson = true; } catch { /* keep as text */ }
  }

  // If KRA served an HTML error page, surface a compact reason and a
  // truncated snippet instead of dumping the full HTML into logs/UI.
  if (!res.ok || !parsedJson) {
    const reason = classifyFailure(res.status, contentType, rawText, url);
    const snippet = typeof rawText === "string" ? rawText.replace(/\s+/g, " ").slice(0, 240) : "";
    if (!parsedJson) {
      raw = { error: reason, upstream_status: res.status, upstream_content_type: contentType, snippet };
    }
    return {
      ok: false,
      status: res.status,
      raw,
      error_reason: reason,
      endpoint: url,
    };
  }

  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    ok: res.ok,
    status: res.status,
    kra_invoice_number: (r.kra_invoice_number as string) || (r.invoice_number as string) || undefined,
    kra_control_unit_id: (r.kra_control_unit_id as string) || (r.cu_invoice_id as string) || undefined,
    qr_code_payload: (r.qr_code_payload as string) || (r.qr as string) || undefined,
    signed_invoice_hash: (r.signed_invoice_hash as string) || (r.signature as string) || undefined,
    raw,
    endpoint: url,
  };
}

export interface EtimsHealthReport {
  ok: boolean;
  base_url: string;
  device_mode: EtimsDeviceMode;
  submit_path: string;
  health_path: string;
  base_reachable: boolean;
  base_status?: number;
  health_status?: number;
  health_content_type?: string;
  looks_like_api: boolean;
  problems: string[];
}

// Startup / on-demand health check — verifies TAX_KE_BASE_URL is reachable
// and that the configured submit path does not immediately 404 with an
// HTML page. Safe to call before draining invoices.
export async function checkEtimsEndpoint(timeoutMs = 8000): Promise<EtimsHealthReport> {
  const envProblems = validateEtimsEnv();
  if (envProblems.length > 0) {
    return {
      ok: false,
      base_url: setting("TAX_KE_BASE_URL") || "",
      device_mode: resolveDeviceMode(),
      submit_path: Deno.env.get("TAX_KE_SUBMIT_PATH") || DEFAULT_PATHS[resolveDeviceMode()].submit,
      health_path: Deno.env.get("TAX_KE_HEALTH_PATH") || DEFAULT_PATHS[resolveDeviceMode()].health,
      base_reachable: false,
      looks_like_api: false,
      problems: envProblems,
    };
  }

  const cfg = getConfig();
  const problems: string[] = [];
  let baseStatus: number | undefined;
  let baseReachable = false;
  let healthStatus: number | undefined;
  let healthCt: string | undefined;
  let looksLikeApi = false;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 1) Base URL DNS + TCP + TLS handshake.
    try {
      const rBase = await fetch(cfg.baseUrl, { method: "GET", signal: controller.signal });
      baseStatus = rBase.status;
      baseReachable = true;
      await rBase.body?.cancel();
    } catch (e: any) {
      problems.push(`TAX_KE_BASE_URL unreachable (${cfg.baseUrl}): ${e?.message || String(e)}`);
    }

    // 2) Probe the configured health/submit path.
    if (baseReachable) {
      const url = `${cfg.baseUrl}${cfg.healthPath}`;
      try {
        const rHealth = await fetch(url, {
          method: "GET",
          headers: { "Authorization": `Bearer ${cfg.apiKey}`, "X-Device-Mode": cfg.deviceMode },
          signal: controller.signal,
        });
        healthStatus = rHealth.status;
        healthCt = rHealth.headers.get("content-type") || "";
        const bodySample = (await rHealth.text()).slice(0, 512);
        const isHtml = /text\/html/i.test(healthCt) || /^\s*<(?:!doctype|html)/i.test(bodySample);
        // Accept anything that isn't an HTML error page. 401/403 on a JSON
        // endpoint is fine — it proves the API is reachable, just unauth'd.
        looksLikeApi = !isHtml;
        if (isHtml && rHealth.status === 404) {
          problems.push(`Health probe hit KRA HTML 404 at ${url}. The submit path is not registered on this host — set TAX_KE_SUBMIT_PATH / TAX_KE_HEALTH_PATH to the values from your KRA onboarding pack.`);
        } else if (isHtml) {
          problems.push(`Health probe returned HTML (status ${rHealth.status}) at ${url}. TAX_KE_BASE_URL likely points at a portal/CDN, not the eTIMS API.`);
        }
      } catch (e: any) {
        problems.push(`Health probe failed for ${url}: ${e?.message || String(e)}`);
      }
    }
  } finally {
    clearTimeout(t);
  }

  return {
    ok: problems.length === 0 && baseReachable && looksLikeApi,
    base_url: cfg.baseUrl,
    device_mode: cfg.deviceMode,
    submit_path: cfg.submitPath,
    health_path: cfg.healthPath,
    base_reachable: baseReachable,
    base_status: baseStatus,
    health_status: healthStatus,
    health_content_type: healthCt,
    looks_like_api: looksLikeApi,
    problems,
  };
}

// HMAC-SHA256 verification for inbound webhooks.
// Expected header: X-TaxKe-Signature: sha256=<hex>
export async function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;
  const cfg = getConfig();
  const provided = signatureHeader.replace(/^sha256=/i, "").trim().toLowerCase();
  if (!provided) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(cfg.webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");

  // constant-time compare
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

// Exponential backoff in minutes: 1, 2, 4, 8, 16, 32, then 60 cap. Hard cap 72h.
export function nextRetryDelayMs(attempt: number): number {
  const minutes = attempt <= 5 ? Math.pow(2, attempt) : 60;
  return Math.min(minutes, 60) * 60 * 1000;
}

export const MAX_RETRY_WINDOW_MS = 72 * 60 * 60 * 1000;
