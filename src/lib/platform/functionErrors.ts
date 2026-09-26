/**
 * Edge function error decoding.
 *
 * `supabase.functions.invoke` collapses every failed call into the generic
 * "Edge Function returned a non-2xx status code". The real reason lives in the
 * response body, so read it and surface it to the operator.
 */
import { FunctionsHttpError } from "@supabase/supabase-js";

type FunctionErrorBody = {
  error?: string | { message?: string; code?: string };
  message?: string;
  code?: string;
  details?: string;
};

/** Extract the upstream reason from a functions.invoke error. */
export async function describeFunctionError(error: unknown): Promise<string> {
  if (!(error instanceof FunctionsHttpError)) {
    return error instanceof Error ? error.message : "Unexpected error";
  }
  const status = error.context?.status;
  let raw = "";
  try {
    raw = await error.context.text();
  } catch {
    raw = "";
  }
  let body: FunctionErrorBody | null = null;
  try {
    body = raw ? (JSON.parse(raw) as FunctionErrorBody) : null;
  } catch {
    body = null;
  }
  const nested = typeof body?.error === "object" ? body?.error : undefined;
  const message =
    (typeof body?.error === "string" ? body.error : undefined) ??
    nested?.message ??
    body?.message ??
    body?.details ??
    (raw && !raw.trim().startsWith("<") ? raw.slice(0, 300) : "") ??
    "";
  const code = nested?.code ?? body?.code;
  const parts = [message || "The payment service rejected the request."];
  if (code) parts.push(`(${code})`);
  if (status) parts.push(`[HTTP ${status}]`);
  return parts.join(" ");
}
