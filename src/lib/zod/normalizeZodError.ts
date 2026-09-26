/**
 * Shared Zod v4 error normalizer.
 *
 * Single source of truth for turning a ZodError into a stable, UI-friendly
 * shape. All forms and callers MUST use this helper instead of touching
 * `.issues` (or the removed v3 `.errors`) directly, so a future Zod API
 * change only requires updating this file.
 */
import type { ZodError, ZodIssue } from "zod";

export interface NormalizedZodError {
  /** First human-readable message (safe for inline form errors). */
  firstMessage: string;
  /** Per-path messages keyed by dotted path ("user.email"). */
  fieldErrors: Record<string, string[]>;
  /** Top-level (form-wide) messages with no path. */
  formErrors: string[];
  /** Raw issues, exposed for advanced callers. */
  issues: ZodIssue[];
}

export function normalizeZodError(error: ZodError | null | undefined): NormalizedZodError {
  const issues: ZodIssue[] = error?.issues ?? [];
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];

  for (const issue of issues) {
    if (!issue.path || issue.path.length === 0) {
      formErrors.push(issue.message);
    } else {
      const key = issue.path.map((p) => String(p)).join(".");
      (fieldErrors[key] ||= []).push(issue.message);
    }
  }

  const firstMessage =
    issues[0]?.message ?? formErrors[0] ?? "Invalid input";

  return { firstMessage, fieldErrors, formErrors, issues };
}

/** Convenience: return the first message from a ZodError. */
export function firstZodMessage(error: ZodError | null | undefined): string {
  return normalizeZodError(error).firstMessage;
}
