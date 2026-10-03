/**
 * Edge function guard. Many screens restored from the legacy codebase call
 * backend functions whose source was never recovered. Calling them produces
 * the opaque "Failed to send a request to the Edge Function" error. This guard
 * short-circuits calls to functions that are not deployed and replaces the
 * opaque transport message with a plain explanation — it never fabricates data.
 */
import { supabase } from "@/integrations/supabase/client";

/** Functions present in supabase/functions (keep in sync when adding one). */
export const DEPLOYED_FUNCTIONS = new Set([
  "auth-email-hook", "backend-operations", "corporate-kyb-review", "charter-api", "corporate-kyb-doc", "corporate-registration-draft", "cta-event", "dispatch-engine",
  "dispatch-supply-refresh", "etims-health", "etims-retry", "etims-submit",
  "etims-webhook", "mcp", "mpesa-b2c-result", "mpesa-callback",
  "mpesa-reconcile-recent", "mpesa-status", "mpesa-stkpush",
  "notification-worker", "payment-credentials", "provider-payout-disburse",
  "provider-payout-run", "rider-support-draft",
]);

export const SERVICE_NOT_CONNECTED =
  "This service is not connected yet, so there is nothing to show here. No data was lost.";
const UNREACHABLE = "The service could not be reached. Check your connection and try again.";

class ServiceUnavailableError extends Error {
  context = null;
  constructor(message: string) {
    super(message);
    this.name = "FunctionsFetchError";
  }
}

let installed = false;
export function installEdgeFunctionGuard() {
  if (installed) return;
  installed = true;
  const fns = supabase.functions;
  const original = fns.invoke.bind(fns);
  (fns as { invoke: typeof fns.invoke }).invoke = (async (name: string, options?: unknown) => {
    if (!DEPLOYED_FUNCTIONS.has(name)) {
      return { data: null, error: new ServiceUnavailableError(SERVICE_NOT_CONNECTED), response: undefined };
    }
    const res = await original(name, options as never);
    if (res.error && /Failed to send a request/i.test(res.error.message ?? "")) {
      return { ...res, error: new ServiceUnavailableError(UNREACHABLE) };
    }
    return res;
  }) as typeof fns.invoke;
}
