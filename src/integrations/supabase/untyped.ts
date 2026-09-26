/**
 * Single documented access path for database objects that are NOT yet described
 * by the generated Supabase types (`src/integrations/supabase/types.ts`).
 *
 * Why this module exists
 * ---------------------
 * Large parts of the platform (logistics, readiness, certification, staff
 * governance) were built ahead of the generated type refresh, so their tables
 * and RPCs are unknown to the typed client. Before this module, each call site
 * worked around that with an inline `untypedDb` cast — dozens of
 * untracked, ungreppable escape hatches with no owner and no migration path.
 *
 * Rules
 * -----
 * 1. New code MUST use the typed `supabase` client. Only reach for `untypedDb`
 *    when the object genuinely is not in the generated types yet.
 * 2. Every use is a tracked migration item: when the generated types catch up,
 *    switch the call site to `supabase` and delete the import.
 * 3. Never widen this module's surface to hide real type errors in app logic —
 *    it exists to describe the *client*, not to soften business types.
 */
import { supabase } from "./client";
import type { LooseRow } from "@/lib/types/loose";

/** Result of an untyped query. `data` is unverified — narrow it at the call site. */
export interface UntypedResult {
  data: LooseRow;
  error: { message: string; code?: string; details?: string } | null;
  count?: number | null;
  status?: number;
}

/**
 * The chainable PostgREST surface actually used by this codebase. Every method
 * returns the same builder so existing call chains keep working unchanged.
 */
export interface UntypedQuery extends PromiseLike<UntypedResult> {
  select(columns?: string, options?: Record<string, unknown>): UntypedQuery;
  insert(values: unknown, options?: Record<string, unknown>): UntypedQuery;
  update(values: unknown, options?: Record<string, unknown>): UntypedQuery;
  upsert(values: unknown, options?: Record<string, unknown>): UntypedQuery;
  delete(options?: Record<string, unknown>): UntypedQuery;
  eq(column: string, value: unknown): UntypedQuery;
  neq(column: string, value: unknown): UntypedQuery;
  gt(column: string, value: unknown): UntypedQuery;
  gte(column: string, value: unknown): UntypedQuery;
  lt(column: string, value: unknown): UntypedQuery;
  lte(column: string, value: unknown): UntypedQuery;
  like(column: string, pattern: string): UntypedQuery;
  ilike(column: string, pattern: string): UntypedQuery;
  is(column: string, value: unknown): UntypedQuery;
  in(column: string, values: readonly unknown[]): UntypedQuery;
  contains(column: string, value: unknown): UntypedQuery;
  overlaps(column: string, value: unknown): UntypedQuery;
  not(column: string, operator: string, value: unknown): UntypedQuery;
  or(filters: string, options?: Record<string, unknown>): UntypedQuery;
  filter(column: string, operator: string, value: unknown): UntypedQuery;
  match(query: Record<string, unknown>): UntypedQuery;
  order(column: string, options?: Record<string, unknown>): UntypedQuery;
  limit(count: number, options?: Record<string, unknown>): UntypedQuery;
  range(from: number, to: number, options?: Record<string, unknown>): UntypedQuery;
  single(): UntypedQuery;
  maybeSingle(): UntypedQuery;
  csv(): UntypedQuery;
  throwOnError(): UntypedQuery;
  abortSignal(signal: AbortSignal): UntypedQuery;
}

export interface UntypedClient {
  from(relation: string): UntypedQuery;
  rpc(fn: string, args?: Record<string, unknown>, options?: Record<string, unknown>): UntypedQuery;
}

/**
 * The same live Supabase client and session as `supabase` — identical auth, RLS
 * and network path. Only the compile-time view differs.
 */
export const untypedDb = supabase as unknown as UntypedClient;
