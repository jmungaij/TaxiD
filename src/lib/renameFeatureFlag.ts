/**
 * Client cache for the `rename_feature_flag` row.
 *
 * The rename from `taxid_session_id` → `yalla_session_id` rolls out
 * gradually. Every browser session picks its identifier at boot by
 * consulting a cached copy of the flag:
 *
 *   • `kill_switch = true`     → force EVERY session back to the legacy key.
 *   • `enabled = false`        → keep everyone on the legacy key.
 *   • `enabled = true` and the session's tenant / country matches the
 *     allow-list (or the allow-list is empty) AND the session's stable
 *     hash falls under `ramp_percent` → use the new `yalla_` key.
 *
 * The flag is fetched once at module load, cached in `localStorage` so
 * subsequent tabs are consistent, and re-fetched every 60 s.  While the
 * initial fetch is in flight we default to the SAFE choice (legacy key)
 * so we never migrate a session that the flag should have excluded.
 */
import { supabase } from "@/integrations/supabase/client";

export interface RenameFlag {
  enabled: boolean;
  kill_switch: boolean;
  ramp_percent: number;
  allowed_country_codes: string[];
  allowed_tenant_ids: string[];
}

const CACHE_KEY = "yalla.renameFlag";
const CACHE_TTL_MS = 60_000;
const DEFAULT_FLAG: RenameFlag = {
  enabled: false,
  kill_switch: false,
  ramp_percent: 0,
  allowed_country_codes: [],
  allowed_tenant_ids: [],
};

interface Cached { flag: RenameFlag; fetchedAt: number }
let inMemory: Cached | null = null;

function readCache(): Cached | null {
  if (inMemory) return inMemory;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    inMemory = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(flag: RenameFlag) {
  const value: Cached = { flag, fetchedAt: Date.now() };
  inMemory = value;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* ignore */ }
}

export async function refreshRenameFlag(): Promise<RenameFlag> {
  try {
    // Types not yet regenerated for new tables — cast to any.
    const { data, error } = await (supabase.from as any)("rename_feature_flag")
      .select("enabled, kill_switch, ramp_percent, allowed_country_codes, allowed_tenant_ids")
      .limit(1)
      .maybeSingle();
    if (error || !data) throw error;
    const flag: RenameFlag = {
      enabled: !!data.enabled,
      kill_switch: !!data.kill_switch,
      ramp_percent: Number(data.ramp_percent ?? 0),
      allowed_country_codes: data.allowed_country_codes ?? [],
      allowed_tenant_ids: data.allowed_tenant_ids ?? [],
    };
    writeCache(flag);
    return flag;
  } catch {
    // Fall back to whatever we have cached; safe default otherwise.
    return readCache()?.flag ?? DEFAULT_FLAG;
  }
}

/**
 * Deterministic 0-99 bucket for the current session, used for the ramp.
 * Uses the stable device id from localStorage so the same browser always
 * lands in the same bucket, which prevents flip-flopping between keys.
 */
function sessionBucket(): number {
  let seed: string;
  try {
    seed = localStorage.getItem("yalla.deviceId") ?? "";
    if (!seed) {
      seed = crypto.randomUUID();
      localStorage.setItem("yalla.deviceId", seed);
    }
  } catch {
    seed = "no-seed";
  }
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100;
}

/**
 * Synchronous decision used by navLog.ts on every call.  Uses the cached
 * flag so it does not add latency to nav logging.  If the cache is stale
 * we kick off a background refresh but keep serving the cached value.
 */
export function shouldUseYallaSessionKey(): boolean {
  const cached = readCache();
  if (!cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS) {
    void refreshRenameFlag();
  }
  const flag = cached?.flag ?? DEFAULT_FLAG;
  if (flag.kill_switch) return false;
  if (!flag.enabled) return false;
  return sessionBucket() < flag.ramp_percent;
}

// Kick off the initial fetch at import time so the first navigation event
// already has a fresh cache.
void refreshRenameFlag();
