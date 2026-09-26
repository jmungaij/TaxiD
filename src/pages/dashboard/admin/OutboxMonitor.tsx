import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Activity, RefreshCw, Send, AlertOctagon, CheckCircle2, Clock, Download, RotateCcw, AlertTriangle, FlaskConical, History, ShieldCheck, Search, Bug, Timer, List, Infinity as InfinityIcon, ArrowUpDown } from "lucide-react";
import { toCsv, downloadCsv, streamDownloadCsv } from "@/lib/csv";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { AppButton } from "@/components/nav/AppButton";
import { AnalyticsEvents } from "@/lib/analyticsEvents";
import { logExportAudit } from "@/lib/exportAudit";

// Debounce delay (ms) for schema-validation filter inputs. Short enough to feel
// instant, long enough to skip per-keystroke recomputation of filtered lists
// and CSV previews on large invalid-payload sets.
const VF_DEBOUNCE_MS = 250;
type VfSort = "time_desc" | "time_asc" | "observed_desc" | "observed_asc";
const VF_SORT_VALUES: VfSort[] = ["time_desc", "time_asc", "observed_desc", "observed_asc"];
const VF_SORT_LABEL: Record<VfSort, string> = {
  time_desc: "Run time · newest first",
  time_asc: "Run time · oldest first",
  observed_desc: "Observed count · high → low",
  observed_asc: "Observed count · low → high",
};

interface RunRow {
  id: string;
  ran_at: string;
  source: string;
  processed: number;
  failed: number;
  total: number;
  duration_ms: number | null;
  webhook_url: string | null;
  notes: string | null;
}

interface OutboxRow {
  id: string;
  aggregate: string;
  event_type: string;
  status: string;
  attempts: number;
  dedupe_key: string;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-status-warning/10 text-status-warning",
  processed: "bg-status-success/10 text-status-success",
  dead_letter: "bg-status-danger/10 text-status-danger",
};

const DEAD_LETTER_THRESHOLD_KEY = "outbox_dead_letter_threshold";
const REPLAY_COOLDOWN_KEY = "outbox_replay_blocked_until";
const TIMELINE_PAGE_SIZE = 20;
// Virtualized mode: uniform row height (px) + viewport height. Overscan keeps
// a few extra rows above/below the visible area to smooth fast scrolling.
const VIRTUAL_ROW_HEIGHT = 96;
const VIRTUAL_VIEWPORT_HEIGHT = 560;
const VIRTUAL_OVERSCAN = 4;

type TlKind = "emitted" | "suppressed" | "test" | "invalid";
interface TlItem {
  id: string;
  ran_at: string;
  kind: TlKind;
  observed: number | null;
  threshold: number | null;
  validation_errors: string[] | null;
  raw: string;
}

function TimelineRow({ e }: { e: TlItem }) {
  const tone =
    e.kind === "emitted" ? "bg-status-danger/10 text-status-danger"
    : e.kind === "suppressed" ? "bg-status-warning/10 text-status-warning"
    : e.kind === "invalid" ? "bg-ai/10 text-ai"
    : "bg-ai/10 text-ai";
  const dot =
    e.kind === "emitted" ? "bg-status-danger"
    : e.kind === "suppressed" ? "bg-status-warning"
    : e.kind === "invalid" ? "bg-ai"
    : "bg-ai";
  return (
    <li className="relative" data-testid="tl-row">
      <span className={`absolute -left-[22px] top-1 h-3 w-3 rounded-full ring-2 ring-background ${dot}`} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge className={tone}>{e.kind}</Badge>
        <span className="font-mono text-xs">{new Date(e.ran_at).toLocaleString()}</span>
        {e.observed !== null && e.threshold !== null && (
          <span className="text-xs text-muted-foreground">
            dead-letter {e.observed} ≥ threshold {e.threshold}
          </span>
        )}
      </div>
      {e.kind === "invalid" && e.validation_errors && e.validation_errors.length > 0 && (
        <ul className="mt-1 ml-2 text-xs text-ai list-disc pl-4 space-y-0.5">
          {e.validation_errors.slice(0, 2).map((err, i) => <li key={i} className="font-mono truncate">{err}</li>)}
          {e.validation_errors.length > 2 && (
            <li className="text-ai">+{e.validation_errors.length - 2} more</li>
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * Virtualized infinite-scroll timeline.
 * Uniform row height windowing — only the rows inside the visible viewport
 * (plus a small overscan) are mounted, so 10k+ events scroll smoothly.
 * Pure scrollTop math, no external dependency.
 */
function VirtualTimeline({ items }: { items: TlItem[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const total = items.length;
  const totalHeight = total * VIRTUAL_ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
  const endIndex = Math.min(
    total,
    Math.ceil((scrollTop + VIRTUAL_VIEWPORT_HEIGHT) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN,
  );
  const visible = items.slice(startIndex, endIndex);
  const offsetY = startIndex * VIRTUAL_ROW_HEIGHT;

  return (
    <div className="space-y-2">
      <div
        ref={scrollerRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        className="relative border rounded-md overflow-auto bg-card"
        style={{ height: VIRTUAL_VIEWPORT_HEIGHT }}
        data-testid="tl-virtual-scroller"
        role="list"
        aria-label={`Virtualized timeline, ${total} events`}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          {/* Use <ul>+<li> here and let TimelineRow render its own <li>; we wrap
              in a plain <div> with fixed height so we keep uniform-row windowing
              without introducing illegal <li> nesting. */}
          <ol
            className="relative border-l border-border pl-4 absolute left-0 right-0 m-0 p-0 list-none"
            style={{ transform: `translateY(${offsetY}px)`, paddingLeft: "1rem" }}
            data-testid="tl-virtual-list"
          >
            {visible.map((e) => (
              <div key={e.id} style={{ height: VIRTUAL_ROW_HEIGHT, paddingTop: 8, paddingBottom: 8 }}>
                <TimelineRow e={e} />
              </div>
            ))}
          </ol>
        </div>
      </div>
      <div className="text-xs text-muted-foreground flex items-center justify-between">
        <span>Showing rows {total === 0 ? 0 : startIndex + 1}–{endIndex} of {total}</span>
        <span className="opacity-70">Scroll to load more — rows are rendered on demand</span>
      </div>
    </div>
  );
}

export default function OutboxMonitor() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [tab, setTab] = useState<"pending" | "processed" | "dead_letter">("pending");
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [deadLetterCount, setDeadLetterCount] = useState(0);
  // Rate-limit countdown: when the replay edge function returns 429, store the
  // server-provided unlock timestamp in localStorage so the countdown survives
  // a page refresh and is consistent across tabs.
  const [replayBlockedUntil, setReplayBlockedUntil] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(REPLAY_COOLDOWN_KEY);
    if (!stored) return null;
    const n = Number(stored);
    if (!Number.isFinite(n) || n <= Date.now()) {
      window.localStorage.removeItem(REPLAY_COOLDOWN_KEY);
      return null;
    }
    return n;
  });
  const [nowTick, setNowTick] = useState(Date.now());
  // ---- URL-backed state for timeline + validation-failure filters/sort ----
  // We keep React state as the source of truth for inputs (so typing stays
  // local + responsive) and mirror the *debounced* / validated values back
  // into the URL so refresh / shareable links restore the same view without
  // URL-churn per keystroke.
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- Timeline filters (persisted) ----
  const TL_KINDS_ALL = { emitted: true, suppressed: true, test: true, invalid: true } as const;
  const validKinds = new Set<TlKind>(["emitted", "suppressed", "test", "invalid"]);
  const [tlKinds, setTlKinds] = useState<{ emitted: boolean; suppressed: boolean; test: boolean; invalid: boolean }>(() => {
    const raw = searchParams.get("tl_kinds");
    if (!raw) return { ...TL_KINDS_ALL };
    const tokens = raw.split(",").map((s) => s.trim()).filter((t) => validKinds.has(t as TlKind));
    if (tokens.length === 0) return { ...TL_KINDS_ALL };
    return {
      emitted: tokens.includes("emitted"),
      suppressed: tokens.includes("suppressed"),
      test: tokens.includes("test"),
      invalid: tokens.includes("invalid"),
    };
  });
  const [tlSearch, setTlSearch] = useState(() => (searchParams.get("tl_q") ?? "").slice(0, 200));
  const [tlFrom, setTlFrom] = useState<string>(() => (searchParams.get("tl_from") ?? "").slice(0, 32));
  const [tlTo, setTlTo] = useState<string>(() => (searchParams.get("tl_to") ?? "").slice(0, 32));
  const [tlVisible, setTlVisible] = useState(TIMELINE_PAGE_SIZE);
  // Timeline browsing mode: paginated (Load more) or virtualized (infinite scroll).
  const [tlMode, setTlMode] = useState<"paginated" | "virtual">(() => {
    const m = searchParams.get("tl_mode");
    return m === "virtual" ? "virtual" : "paginated";
  });

  // Debounced timeline search — URL + filter computation use the stabilized value.
  const dTlSearch = useDebouncedValue(tlSearch, VF_DEBOUNCE_MS);

  // ---- Validation-failures filters/sort (persisted + validated) ----
  // Caps protect against tampered/over-long URL values; sort is enum-validated;
  // version must be a non-negative integer or it's discarded.
  const VF_MAX_LEN = 200;
  const sanitizeText = (raw: string | null) => (raw ?? "").slice(0, VF_MAX_LEN);
  const sanitizeVersion = (raw: string | null) => {
    if (!raw) return "";
    const trimmed = raw.trim();
    if (!/^\d{1,9}$/.test(trimmed)) return "";
    return trimmed;
  };
  const [vfRunId, setVfRunId] = useState(() => sanitizeText(searchParams.get("vf_run")));
  const [vfSchema, setVfSchema] = useState(() => sanitizeText(searchParams.get("vf_schema")));
  const [vfVersion, setVfVersion] = useState<string>(() => sanitizeVersion(searchParams.get("vf_version")));
  const [vfErrorType, setVfErrorType] = useState(() => sanitizeText(searchParams.get("vf_err")));
  const [vfSort, setVfSort] = useState<VfSort>(() => {
    const s = searchParams.get("vf_sort") as VfSort | null;
    return s && VF_SORT_VALUES.includes(s) ? s : "time_desc";
  });

  // Debounced mirrors — drive the filtered list, CSV preview, and URL sync.
  const dVfRunId = useDebouncedValue(vfRunId, VF_DEBOUNCE_MS);
  const dVfSchema = useDebouncedValue(vfSchema, VF_DEBOUNCE_MS);
  const dVfVersion = useDebouncedValue(vfVersion, VF_DEBOUNCE_MS);
  const dVfErrorType = useDebouncedValue(vfErrorType, VF_DEBOUNCE_MS);
  const [threshold, setThreshold] = useState<number>(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(DEAD_LETTER_THRESHOLD_KEY) : null;
    return stored ? Number(stored) : 5;
  });

  // Sync filter values into the URL so the view is shareable and survives
  // refresh. Only non-default keys are written to keep URLs tidy.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const set = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k));
        // Validation-failure filters (capped + sanitized at write time too).
        set("vf_run", dVfRunId.trim().slice(0, VF_MAX_LEN));
        set("vf_schema", dVfSchema.trim().slice(0, VF_MAX_LEN));
        set("vf_version", sanitizeVersion(dVfVersion));
        set("vf_err", dVfErrorType.trim().slice(0, VF_MAX_LEN));
        if (vfSort !== "time_desc") next.set("vf_sort", vfSort);
        else next.delete("vf_sort");
        // Timeline filters
        const kindList = (Object.entries(tlKinds) as Array<[TlKind, boolean]>) 
          .filter(([, v]) => v).map(([k]) => k);
        if (kindList.length === 4) next.delete("tl_kinds");
        else next.set("tl_kinds", kindList.join(","));
        set("tl_q", dTlSearch.trim().slice(0, VF_MAX_LEN));
        set("tl_from", tlFrom);
        set("tl_to", tlTo);
        if (tlMode !== "paginated") next.set("tl_mode", tlMode);
        else next.delete("tl_mode");
        return next;
      },
      { replace: true },
    );
  }, [
    dVfRunId, dVfSchema, dVfVersion, dVfErrorType, vfSort,
    tlKinds, dTlSearch, tlFrom, tlTo, tlMode,
    setSearchParams,
  ]);


  // Persist the cooldown deadline. Writing `null` clears it.
  const setCooldownUntil = (until: number | null) => {
    setReplayBlockedUntil(until);
    if (typeof window === "undefined") return;
    if (until && until > Date.now()) window.localStorage.setItem(REPLAY_COOLDOWN_KEY, String(until));
    else window.localStorage.removeItem(REPLAY_COOLDOWN_KEY);
  };




  // Tick every second while a replay block is active so the countdown updates.
  // Also auto-clears persisted state once the deadline passes.
  useEffect(() => {
    if (!replayBlockedUntil) return;
    const i = setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      if (replayBlockedUntil <= now) setCooldownUntil(null);
    }, 1000);
    return () => clearInterval(i);
  }, [replayBlockedUntil]);

  // Cross-tab sync: if another tab triggers a rate-limit, mirror the deadline.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== REPLAY_COOLDOWN_KEY) return;
      const v = e.newValue ? Number(e.newValue) : null;
      setReplayBlockedUntil(v && v > Date.now() ? v : null);
      setNowTick(Date.now());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const replayCooldownSec = replayBlockedUntil ? Math.max(0, Math.ceil((replayBlockedUntil - nowTick) / 1000)) : 0;
  const replayBlocked = replayCooldownSec > 0;


  const load = async () => {
    setLoading(true);
    const [{ data: runsData }, { data: msgData, error: msgErr }, { count: dlCount }] = await Promise.all([
      supabase.from("outbox_runs").select("*").order("ran_at", { ascending: false }).limit(50),
      supabase
        .from("event_outbox")
        .select("id, aggregate, event_type, status, attempts, dedupe_key, last_error, created_at, processed_at")
        .eq("status", tab)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("event_outbox").select("id", { count: "exact", head: true }).eq("status", "dead_letter"),
    ]);
    if (msgErr) toast.error(msgErr.message);
    setRuns((runsData as RunRow[]) ?? []);
    setOutbox((msgData as OutboxRow[]) ?? []);
    setDeadLetterCount(dlCount ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("outbox-monitor")
      .on("postgres_changes", { event: "*", schema: "public", table: "outbox_runs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_outbox" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const trigger = async () => {
    setTriggering(true);
    const { error } = await supabase.functions.invoke("outbox-processor", { body: { source: "manual" } });
    if (error) toast.error(error.message);
    else toast.success("Processor invoked");
    setTriggering(false);
  };

  // Admin-only replay via edge function. The function verifies the caller's role,
  // resets the row (keeping dedupe_key), and writes an audit_logs entry.
  const replay = async (row: OutboxRow) => {
    setReplayingId(row.id);
    const { data, error } = await supabase.functions.invoke("outbox-replay", {
      body: { message_id: row.id },
    });
    // The Functions client surfaces non-2xx as FunctionsHttpError with the
    // Response stashed on `.context`. Parse it to extract retry_after_sec.
    if (error) {
      let parsed: { error?: string; retry_after_sec?: number; max?: number; recent_replays?: number } | null = null;
      try {
        const ctx = (error as unknown as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") parsed = await ctx.clone().json();
      } catch { /* ignore */ }
      if (parsed?.error === "rate_limited" && parsed.retry_after_sec) {
        // Use the server-provided retry_after value as the source of truth and
        // persist the deadline so a refresh / new tab keeps the countdown.
        const until = Date.now() + parsed.retry_after_sec * 1000;
        setCooldownUntil(until);
        setNowTick(Date.now());
        toast.error(`Rate limited — try again in ${parsed.retry_after_sec}s (${parsed.recent_replays}/${parsed.max} in window)`);
      } else if (parsed?.error === "forbidden") {
        toast.error("Admin role required");
      } else {
        toast.error(parsed?.error ?? error.message);
      }
    } else if (data && (data as { error?: string }).error) {
      toast.error((data as { error: string }).error === "forbidden" ? "Admin role required" : (data as { error: string }).error);
    } else {
      toast.success("Re-queued — dedupe_key preserved, replay audited");
    }
    setReplayingId(null);
  };

  const testAlert = async () => {
    const { data, error } = await supabase.functions.invoke("outbox-processor", {
      body: { test_alert: true, threshold, dead_letter_count: Math.max(threshold + 1, deadLetterCount) },
    });
    if (error) return toast.error(error.message);
    const result = data as { delivery?: { ok: boolean; status: number }; webhook_used: string | null };
    if (!result.webhook_used) toast.info("Test alert generated (no OUTBOX_ALERT_WEBHOOK_URL configured)");
    else if (result.delivery?.ok) toast.success(`Webhook delivered (status ${result.delivery.status})`);
    else toast.error(`Webhook failed (status ${result.delivery?.status ?? 0})`);
  };

  // CSV exports include derived `alert` + parsed `threshold` so investigators can
  // correlate threshold breaches against run timelines.
  const exportRunsCsv = () => {
    if (runs.length === 0) return toast.info("No runs to export");
    const enriched = runs.map((r) => {
      const note = r.notes ?? "";
      const isAlert = note.startsWith("dead_letter_alert:");
      const isSuppressed = note.startsWith("dead_letter_alert_suppressed:");
      const isTest = note.startsWith("dead_letter_alert_test:");
      const m = note.match(/(\d+)\s*>=\s*(\d+)/);
      return {
        ...r,
        alert_emitted: isAlert,
        alert_suppressed: isSuppressed,
        alert_test: isTest,
        observed_dead_letter_count: m ? Number(m[1]) : "",
        threshold_at_run: m ? Number(m[2]) : "",
        current_threshold: threshold,
      };
    });
    const csv = toCsv(enriched);
    downloadCsv(`outbox-runs-${Date.now()}.csv`, csv);
    void logExportAudit({ dataset: "outbox.runs", exportType: "csv", rowCount: enriched.length, byteSize: new Blob([csv]).size, filters: { threshold } });
    toast.success(`Exported ${enriched.length} runs`);
  };

  const exportMessagesCsv = () => {
    if (outbox.length === 0) return toast.info("No messages to export");
    const enriched = outbox.map((m) => ({
      ...m,
      tab,
      alert_threshold: threshold,
      dead_letter_total_at_export: deadLetterCount,
      exported_at: new Date().toISOString(),
    }));
    const csv = toCsv(enriched);
    downloadCsv(`outbox-${tab}-${Date.now()}.csv`, csv);
    void logExportAudit({ dataset: `outbox.messages.${tab}`, exportType: "csv", rowCount: enriched.length, byteSize: new Blob([csv]).size, filters: { tab, threshold } });
    toast.success(`Exported ${enriched.length} messages`);
  };


  const saveThreshold = (v: number) => {
    setThreshold(v);
    if (typeof window !== "undefined") window.localStorage.setItem(DEAD_LETTER_THRESHOLD_KEY, String(v));
  };

  const totals = useMemo(() => {
    const recent = runs.slice(0, 10);
    return {
      processed: recent.reduce((a, r) => a + r.processed, 0),
      failed: recent.reduce((a, r) => a + r.failed, 0),
      runs: recent.length,
      lastRun: recent[0]?.ran_at ?? null,
    };
  }, [runs]);

  // Derive alert timeline from outbox_runs.notes. Four event flavours:
  //   - dead_letter_alert:             emitted to webhook
  //   - dead_letter_alert_suppressed:  cooldown blocked re-emission
  //   - dead_letter_alert_test:        synthetic test fire
  //   - dead_letter_alert_invalid:     schema validation rejected the payload
  const alertTimelineAll = useMemo<TlItem[]>(() => {
    const items: TlItem[] = [];
    for (const r of runs) {
      const n = r.notes ?? "";
      let kind: TlKind | null = null;
      if (n.startsWith("dead_letter_alert_suppressed:")) kind = "suppressed";
      else if (n.startsWith("dead_letter_alert_test:")) kind = "test";
      else if (n.startsWith("dead_letter_alert_invalid:")) kind = "invalid";
      else if (n.startsWith("dead_letter_alert:")) kind = "emitted";
      if (!kind) continue;
      const m = n.match(/(\d+)\s*>=\s*(\d+)/);
      let validation_errors: string[] | null = null;
      const f = n.match(/fields=(\[.*\])/);
      if (f) { try { validation_errors = JSON.parse(f[1]); } catch { /* ignore */ } }
      items.push({
        id: r.id, ran_at: r.ran_at, kind,
        observed: m ? Number(m[1]) : null,
        threshold: m ? Number(m[2]) : null,
        validation_errors,
        raw: n,
      });
    }
    return items;
  }, [runs]);

  const alertTimeline = useMemo(() => {
    const fromMs = tlFrom ? Date.parse(tlFrom) : 0;
    const toMs = tlTo ? Date.parse(tlTo) : Number.MAX_SAFE_INTEGER;
    const q = dTlSearch.trim().toLowerCase();
    return alertTimelineAll.filter((e) => {
      if (!tlKinds[e.kind]) return false;
      const t = Date.parse(e.ran_at);
      if (t < fromMs || t > toMs) return false;
      if (q && !e.raw.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [alertTimelineAll, tlKinds, dTlSearch, tlFrom, tlTo]);

  // Every invalid item carries `schema` + `schema_version` so investigators can
  // narrow on contract changes. Today both are constants in the processor, but
  // we still expose them so the filters keep working when the contract evolves.
  const validationFailures = useMemo(
    () => alertTimelineAll
      .filter((e) => e.kind === "invalid")
      .map((e) => ({ ...e, schema: "outbox.dead_letter_alert", schema_version: 1 })),
    [alertTimelineAll],
  );

  const filteredValidationFailures = useMemo(() => {
    const runQ = dVfRunId.trim().toLowerCase();
    const schemaQ = dVfSchema.trim().toLowerCase();
    const versionQ = dVfVersion.trim();
    const errQ = dVfErrorType.trim().toLowerCase();
    const filtered = validationFailures.filter((v) => {
      if (runQ && !v.id.toLowerCase().includes(runQ)) return false;
      if (schemaQ && !v.schema.toLowerCase().includes(schemaQ)) return false;
      if (versionQ && String(v.schema_version) !== versionQ) return false;
      if (errQ && !(v.validation_errors ?? []).some((er) => er.toLowerCase().includes(errQ))) return false;
      return true;
    });
    // Apply the active sort. Stable enough for our needs since we sort on the
    // primary key only — ties keep their relative input order.
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (vfSort) {
        case "time_asc":      return Date.parse(a.ran_at) - Date.parse(b.ran_at);
        case "observed_desc": return (b.observed ?? -1) - (a.observed ?? -1);
        case "observed_asc":  return (a.observed ?? Number.MAX_SAFE_INTEGER) - (b.observed ?? Number.MAX_SAFE_INTEGER);
        case "time_desc":
        default:              return Date.parse(b.ran_at) - Date.parse(a.ran_at);
      }
    });
    return sorted;
  }, [validationFailures, dVfRunId, dVfSchema, dVfVersion, dVfErrorType, vfSort]);

  // Distinct error-type tokens (the leading word of each validation error
  // message, e.g. "schema", "version", "dead_letter_count") for the dropdown.
  const validationErrorTypes = useMemo(() => {
    const set = new Set<string>();
    for (const v of validationFailures) {
      for (const er of v.validation_errors ?? []) {
        const token = er.split(/\s+/)[0];
        if (token) set.add(token);
      }
    }
    return Array.from(set).sort();
  }, [validationFailures]);

  // Reset pagination whenever the filtered set changes so investigators always
  // start from the top of a freshly narrowed list.
  useEffect(() => { setTlVisible(TIMELINE_PAGE_SIZE); }, [tlKinds, dTlSearch, tlFrom, tlTo]);

  const [vfExporting, setVfExporting] = useState(false);
  // 0..1 progress for the streamed CSV export — drives the progress bar UI.
  const [vfProgress, setVfProgress] = useState(0);
  const [vfRetry, setVfRetry] = useState<{ attempt: number; reason: string } | null>(null);

  // Export invalid (schema-rejected) webhook payloads. Honors the active
  // validation-failure filters (run_id / schema / version / error type) AND
  // the active sort order — the file matches exactly what's on screen.
  //
  // Uses `streamDownloadCsv` so large filtered sets (10k+ rows) don't freeze
  // the tab. On a transient stream error the helper retries automatically
  // (with backoff); the UI surfaces both progress and retry attempts.
  const exportInvalidPayloadsCsv = async () => {
    if (vfExporting) return; // guard against double-clicks
    const source = filteredValidationFailures;
    if (source.length === 0) return toast.info("No invalid payloads to export");
    const rows = source.map((v) => {
      const payload = {
        schema: v.schema,
        version: v.schema_version,
        test: false,
        dead_letter_count: v.observed,
        threshold: v.threshold,
        cooldown_minutes: null,
        source: null,
        at: v.ran_at,
      };
      return {
        ran_at: v.ran_at,
        schema: v.schema,
        schema_version: v.schema_version,
        observed_dead_letter_count: v.observed ?? "",
        threshold: v.threshold ?? "",
        validation_errors: (v.validation_errors ?? []).join(" | "),
        validation_errors_count: v.validation_errors?.length ?? 0,
        raw_payload: JSON.stringify(payload),
        raw_note: v.raw,
        run_id: v.id,
        sort_order: vfSort,
      };
    });
    setVfExporting(true);
    setVfProgress(0);
    setVfRetry(null);
    try {
      await streamDownloadCsv(`outbox-invalid-payloads-${Date.now()}.csv`, rows, {
        chunkSize: 500,
        onProgress: (done, total) => setVfProgress(total > 0 ? done / total : 1),
        maxRetries: 2,
        onRetry: (attempt, err) => {
          const reason = err instanceof Error ? err.message : String(err);
          setVfRetry({ attempt, reason });
          setVfProgress(0);
          toast.error(`CSV stream error — retrying (attempt ${attempt})`);
        },
      });
      const filterLabel = (dVfRunId || dVfSchema || dVfVersion || dVfErrorType)
        ? ` (filtered from ${validationFailures.length})` : "";
      void logExportAudit({
        dataset: "outbox.invalid_payloads",
        exportType: "csv",
        rowCount: rows.length,
        filters: { run_id: dVfRunId, schema: dVfSchema, version: dVfVersion, error_type: dVfErrorType },
      });
      toast.success(`Exported ${rows.length} invalid payload(s)${filterLabel}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast.error(`CSV export failed after retries: ${reason}`);
    } finally {
      setVfExporting(false);
      setVfProgress(0);
      setVfRetry(null);
    }
  };








  const exportReplayAuditCsv = async () => {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, created_at, actor_user_id, actor_role, entity_type, entity_id, action, ip_address, user_agent, before_data, after_data")
      .eq("entity_type", "event_outbox")
      .in("action", ["replay", "replay_denied"])
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) return toast.error(error.message);
    if (!data || data.length === 0) return toast.info("No replay audit entries");
    const rows = data.map((r) => {
      const after = (r.after_data ?? {}) as Record<string, unknown>;
      return {
        created_at: r.created_at,
        actor_user_id: r.actor_user_id ?? "",
        actor_role: r.actor_role ?? "",
        action: r.action,
        outcome: r.action === "replay" ? "allowed" : "denied",
        denial_reason: r.action === "replay_denied" ? String(after.reason ?? "") : "",
        entity_type: r.entity_type,
        entity_id: r.entity_id ?? "",
        dedupe_key: String((r.after_data as Record<string, unknown> | null)?.dedupe_key ?? ""),
        ip_address: r.ip_address ?? "",
        user_agent: r.user_agent ?? "",
        before_data: JSON.stringify(r.before_data ?? {}),
        after_data: JSON.stringify(r.after_data ?? {}),
      };
    });
    const csv = toCsv(rows);
    downloadCsv(`outbox-replay-audit-${Date.now()}.csv`, csv);
    void logExportAudit({ dataset: "outbox.replay_audit", exportType: "csv", rowCount: rows.length, byteSize: new Blob([csv]).size });
    toast.success(`Exported ${rows.length} replay audit entries`);
  };

  const alertActive = deadLetterCount >= threshold && threshold > 0;

  return (
    <MarketingLayout>
      <section className="bg-gradient-to-br from-primary to-primary-glow text-primary-foreground">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Activity className="h-7 w-7" /> Outbox Processor Monitor
          </h1>
          <p className="opacity-90 text-sm">Run history, webhook deliveries, dead-letter messages.</p>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
        {alertActive && (
          <Card className="p-4 border-status-danger/30 bg-status-danger/10 dark:bg-status-danger/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-status-danger mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-status-danger">Dead-letter threshold breached</div>
                <div className="text-sm text-status-danger/80">
                  {deadLetterCount} messages in dead-letter (threshold: {threshold}). Investigate webhook delivery or replay safely.
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setTab("dead_letter")}>View</Button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Processed (last 10)</div>
            <div className="text-2xl font-bold">{totals.processed}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertOctagon className="h-3 w-3" /> Failed (last 10)</div>
            <div className="text-2xl font-bold text-status-danger">{totals.failed}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><RefreshCw className="h-3 w-3" /> Dead-letter total</div>
            <div className={`text-2xl font-bold ${alertActive ? "text-status-danger" : ""}`}>{deadLetterCount}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Last run</div>
            <div className="text-sm font-medium">{totals.lastRun ? new Date(totals.lastRun).toLocaleString() : "—"}</div>
          </Card>
        </div>

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium">Dead-letter alert threshold</label>
            <Input
              type="number"
              min={0}
              className="w-24"
              value={threshold}
              onChange={(e) => saveThreshold(Math.max(0, Number(e.target.value) || 0))}
            />
            <span className="text-xs text-muted-foreground flex-1 min-w-[200px]">Banner shows when dead-letter count reaches this number. Backend cooldown prevents alert spam.</span>
            <Button size="sm" variant="outline" onClick={testAlert}>
              <FlaskConical className="h-4 w-4 mr-1" /> Test alert
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <History className="h-4 w-4" /> Dead-letter alert timeline
            </h2>
            <div className="flex items-center gap-2">
              {/* View-mode toggle: paginated "Load more" vs virtualized infinite scroll */}
              <div className="flex border rounded-md overflow-hidden" role="tablist" aria-label="Timeline view mode">
                <Button
                  size="sm"
                  variant={tlMode === "paginated" ? "default" : "ghost"}
                  className="h-7 rounded-none text-xs"
                  onClick={() => setTlMode("paginated")}
                  data-testid="tl-mode-paginated"
                  role="tab"
                  aria-selected={tlMode === "paginated"}
                >
                  <List className="h-3.5 w-3.5 mr-1" /> Paginated
                </Button>
                <Button
                  size="sm"
                  variant={tlMode === "virtual" ? "default" : "ghost"}
                  className="h-7 rounded-none text-xs"
                  onClick={() => setTlMode("virtual")}
                  data-testid="tl-mode-virtual"
                  role="tab"
                  aria-selected={tlMode === "virtual"}
                >
                  <InfinityIcon className="h-3.5 w-3.5 mr-1" /> Infinite scroll
                </Button>
              </div>
              <span className="text-xs text-muted-foreground" data-testid="tl-count">
                {alertTimeline.length} / {alertTimelineAll.length} events
              </span>
            </div>
          </div>

          {/* Filters: kind toggles, time range, free-text search */}
          <div className="flex flex-wrap items-end gap-2 mb-4 pb-3 border-b">
            <div className="flex flex-wrap gap-1">
              {(["emitted", "suppressed", "test", "invalid"] as const).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={tlKinds[k] ? "default" : "outline"}
                  onClick={() => setTlKinds((s) => ({ ...s, [k]: !s[k] }))}
                  className="h-7 text-xs"
                >
                  {k}
                </Button>
              ))}
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] text-muted-foreground uppercase">From</label>
              <Input type="datetime-local" value={tlFrom} onChange={(e) => setTlFrom(e.target.value)} className="h-8 w-44 text-xs" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] text-muted-foreground uppercase">To</label>
              <Input type="datetime-local" value={tlTo} onChange={(e) => setTlTo(e.target.value)} className="h-8 w-44 text-xs" />
            </div>
            <div className="flex flex-col flex-1 min-w-[180px]">
              <label className="text-[10px] text-muted-foreground uppercase">Search</label>
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={tlSearch} onChange={(e) => setTlSearch(e.target.value)} placeholder="Search notes…" className="h-8 pl-7 text-xs" />
              </div>
            </div>
            {(tlSearch || tlFrom || tlTo || !Object.values(tlKinds).every(Boolean)) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => { setTlSearch(""); setTlFrom(""); setTlTo(""); setTlKinds({ emitted: true, suppressed: true, test: true, invalid: true }); }}
              >
                Reset
              </Button>
            )}
          </div>

          {alertTimeline.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No alert events match the current filters.</p>
          ) : tlMode === "virtual" ? (
            <VirtualTimeline items={alertTimeline} />
          ) : (
            <>
              <ol className="relative border-l border-border pl-4 space-y-3" data-testid="tl-list">
                {alertTimeline.slice(0, tlVisible).map((e) => <TimelineRow key={e.id} e={e} />)}
              </ol>
              {/* Pagination — show "Load more" when more results exist, plus a counter. */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t text-xs">
                <span className="text-muted-foreground" data-testid="tl-page-status">
                  Showing {Math.min(tlVisible, alertTimeline.length)} of {alertTimeline.length}
                </span>
                <div className="flex gap-2">
                  {tlVisible < alertTimeline.length && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTlVisible((v) => v + TIMELINE_PAGE_SIZE)}
                      data-testid="tl-load-more"
                    >
                      Load {Math.min(TIMELINE_PAGE_SIZE, alertTimeline.length - tlVisible)} more
                    </Button>
                  )}
                  {tlVisible > TIMELINE_PAGE_SIZE && (
                    <Button size="sm" variant="ghost" onClick={() => setTlVisible(TIMELINE_PAGE_SIZE)} data-testid="tl-collapse">
                      Collapse
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </Card>

        {validationFailures.length > 0 && (
          <Card className="p-5 border-ai/30 bg-ai/40">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-ai">
                <Bug className="h-4 w-4" /> Webhook schema-validation failures
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-ai" data-testid="vf-count">
                  {filteredValidationFailures.length} / {validationFailures.length} payload(s)
                </span>
                <AppButton
                  size="sm"
                  variant="outline"
                  analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD}
                  action="submit"
                  onClick={exportInvalidPayloadsCsv}
                  disabled={vfExporting}
                  aria-busy={vfExporting}
                  aria-label={vfExporting ? `Exporting CSV, ${Math.round(vfProgress * 100)} percent complete` : "Export filtered invalid payloads as CSV"}
                  data-testid="vf-export"
                  trackingMeta={{ dataset: "outbox.invalid_payloads", export_type: "csv" }}
                >
                  <Download className="h-4 w-4 mr-1" />
                  {vfExporting ? `Exporting ${Math.round(vfProgress * 100)}%` : "CSV"}
                </AppButton>
              </div>
            </div>
            {vfExporting && (
              <div className="mb-3" data-testid="vf-export-progress" aria-live="polite">
                <div className="flex items-center justify-between text-[11px] text-ai mb-1">
                  <span>
                    Streaming CSV… {Math.round(vfProgress * 100)}%
                    {vfRetry && <> · retry #{vfRetry.attempt} ({vfRetry.reason})</>}
                  </span>
                  <span className="font-mono">{Math.round(vfProgress * filteredValidationFailures.length)} / {filteredValidationFailures.length}</span>
                </div>
                <div
                  className="h-1.5 w-full rounded-full bg-ai/10 overflow-hidden"
                  role="progressbar"
                  aria-label="CSV export progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(vfProgress * 100)}
                >
                  <div
                    className="h-full bg-ai transition-[width] duration-150"
                    style={{ width: `${Math.round(vfProgress * 100)}%` }}
                  />
                </div>
              </div>
            )}
            <p className="text-xs text-ai/80 mb-3">
              Filters &amp; sort persist in the URL so views are shareable. Inputs are debounced and the streamed CSV export honors both the active filters and sort order.
            </p>


            {/* Filters: run_id, schema, schema_version, error type — plus sort */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4 pb-3 border-b border-ai/30">
              <div className="flex flex-col">
                <label className="text-[10px] text-ai uppercase">Run ID</label>
                <Input value={vfRunId} onChange={(e) => setVfRunId(e.target.value)} placeholder="Substring…" className="h-8 text-xs" data-testid="vf-filter-run" />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-ai uppercase">Schema</label>
                <Input value={vfSchema} onChange={(e) => setVfSchema(e.target.value)} placeholder="outbox.dead_letter_alert" className="h-8 text-xs" data-testid="vf-filter-schema" />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-ai uppercase">Version</label>
                <Input type="number" min={0} value={vfVersion} onChange={(e) => setVfVersion(e.target.value)} placeholder="any" className="h-8 text-xs" data-testid="vf-filter-version" />
              </div>
              <div className="flex flex-col">
                <label htmlFor="vf-filter-error-select" className="text-[10px] text-ai uppercase">Error type</label>
                <select
                  id="vf-filter-error-select"
                  value={vfErrorType}
                  onChange={(e) => setVfErrorType(e.target.value)}
                  className="h-8 text-xs rounded-md border bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai/30"
                  data-testid="vf-filter-error"
                  aria-label="Filter validation failures by error type"
                >
                  <option value="">any</option>
                  {validationErrorTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex flex-col">
                <label htmlFor="vf-sort-select" className="text-[10px] text-ai uppercase flex items-center gap-1">
                  <ArrowUpDown className="h-3 w-3" aria-hidden="true" /> Sort
                </label>
                {/*
                  Native <select> is keyboard-accessible by default:
                  Tab focus, Space/Enter to open, arrow keys to change, Esc to
                  close. We add an explicit id+label association and aria-label
                  so screen readers announce the control purpose, plus a
                  visible focus ring for keyboard users.
                */}
                <select
                  id="vf-sort-select"
                  value={vfSort}
                  onChange={(e) => setVfSort(e.target.value as VfSort)}
                  onKeyDown={(e) => {
                    // Quick-cycle with Alt+ArrowUp/Down for power users.
                    if (!e.altKey) return;
                    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                    e.preventDefault();
                    const i = VF_SORT_VALUES.indexOf(vfSort);
                    const next = e.key === "ArrowDown"
                      ? VF_SORT_VALUES[(i + 1) % VF_SORT_VALUES.length]
                      : VF_SORT_VALUES[(i - 1 + VF_SORT_VALUES.length) % VF_SORT_VALUES.length];
                    setVfSort(next);
                  }}
                  className="h-8 text-xs rounded-md border bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai/30"
                  data-testid="vf-sort"
                  aria-label={`Sort validation failures — currently ${VF_SORT_LABEL[vfSort]}`}
                  title="Alt+↑ / Alt+↓ to cycle sort options"
                >
                  {VF_SORT_VALUES.map((s) => (
                    <option key={s} value={s} aria-label={VF_SORT_LABEL[s]}>
                      {VF_SORT_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>

              {(vfRunId || vfSchema || vfVersion || vfErrorType || vfSort !== "time_desc") && (
                <div className="col-span-2 md:col-span-5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-ai"
                    onClick={() => { setVfRunId(""); setVfSchema(""); setVfVersion(""); setVfErrorType(""); setVfSort("time_desc"); }}
                    data-testid="vf-filter-reset"
                  >
                    Reset filters &amp; sort
                  </Button>
                </div>
              )}
            </div>


            {filteredValidationFailures.length === 0 ? (
              <p className="text-sm text-ai/70 py-4 text-center">No payloads match the current filters.</p>
            ) : (
              <ul className="space-y-2 text-sm" data-testid="vf-list">
                {filteredValidationFailures.slice(0, 10).map((v) => (
                  <li key={v.id} className="border-l-2 border-ai/30 pl-3">
                    <div className="font-mono text-xs text-ai">
                      {new Date(v.ran_at).toLocaleString()} · <span className="opacity-70">{v.schema} v{v.schema_version}</span>
                    </div>
                    <ul className="list-disc pl-5 text-xs text-ai">
                      {(v.validation_errors ?? ["(no field details)"]).map((er, i) => <li key={i}>{er}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}




        {replayBlocked && (
          <Card className="p-4 border-status-warning/30 bg-status-warning/10">
            <div className="flex items-center gap-3">
              <Timer className="h-5 w-5 text-status-warning" />
              <div className="flex-1">
                <div className="font-semibold text-status-warning">Replay rate-limited</div>
                <div className="text-sm text-status-warning">
                  Next replay allowed in <span className="font-mono font-bold">{replayCooldownSec}s</span>. The edge function enforces a per-actor cap to prevent runaway replays.
                </div>
              </div>
            </div>
          </Card>
        )}


        <Card className="p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Replay audit log
            </h2>
            <AppButton size="sm" variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
              aria-label="Export replay audit log to CSV" onClick={exportReplayAuditCsv}
              trackingMeta={{ dataset: "outbox.replay_audit", export_type: "csv" }}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </AppButton>
          </div>
          <p className="text-xs text-muted-foreground">
            Every dead-letter replay (allowed or denied) is recorded with actor identity, role, IP, user-agent and the entity key. Export to share investigations.
          </p>
        </Card>




        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent runs</h2>
            <div className="flex gap-2">
              <AppButton size="sm" variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
                aria-label="Export outbox runs to CSV" onClick={exportRunsCsv}
                trackingMeta={{ dataset: "outbox.runs", export_type: "csv" }}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </AppButton>
              <Button size="sm" onClick={trigger} disabled={triggering}>
                <Send className="h-4 w-4 mr-1" /> {triggering ? "Triggering…" : "Trigger processor"}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-3">Ran at</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3 text-right">Processed</th>
                  <th className="py-2 pr-3 text-right">Failed</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-3 text-right">Duration</th>
                  <th className="py-2 pr-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No runs yet.</td></tr>
                )}
                {runs.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">{new Date(r.ran_at).toLocaleString()}</td>
                    <td className="py-2 pr-3"><Badge variant="outline">{r.source}</Badge></td>
                    <td className="py-2 pr-3 text-right text-status-success">{r.processed}</td>
                    <td className="py-2 pr-3 text-right text-status-danger">{r.failed}</td>
                    <td className="py-2 pr-3 text-right">{r.total}</td>
                    <td className="py-2 pr-3 text-right">{r.duration_ms ?? 0}ms</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground truncate max-w-[20ch]">{r.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold">Messages</h2>
            <div className="flex flex-wrap gap-2">
              {(["pending", "processed", "dead_letter"] as const).map((s) => (
                <Button key={s} size="sm" variant={tab === s ? "default" : "outline"} onClick={() => setTab(s)}>
                  {s.replace("_", " ")}
                </Button>
              ))}
              <AppButton size="sm" variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
                aria-label={`Export ${tab.replace("_"," ")} messages to CSV`} onClick={exportMessagesCsv}
                trackingMeta={{ dataset: `outbox.messages.${tab}`, export_type: "csv" }}>
                <Download className="h-4 w-4 mr-1" /> CSV
              </AppButton>
            </div>
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : outbox.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No {tab.replace("_", " ")} messages.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3">Event</th>
                    <th className="py-2 pr-3">Aggregate</th>
                    <th className="py-2 pr-3">Dedupe key</th>
                    <th className="py-2 pr-3 text-right">Attempts</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Last error</th>
                    <th className="py-2 pr-3">Created</th>
                    {tab === "dead_letter" && <th className="py-2 pr-3 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {outbox.map((m) => (
                    <tr key={m.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3 font-medium">{m.event_type}</td>
                      <td className="py-2 pr-3 text-xs">{m.aggregate}</td>
                      <td className="py-2 pr-3 font-mono text-xs truncate max-w-[24ch]">{m.dedupe_key}</td>
                      <td className="py-2 pr-3 text-right">{m.attempts}</td>
                      <td className="py-2 pr-3">
                        <Badge className={STATUS_BADGE[m.status] ?? "bg-muted"}>{m.status}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs text-status-danger truncate max-w-[28ch]">{m.last_error ?? ""}</td>
                      <td className="py-2 pr-3 text-xs">{new Date(m.created_at).toLocaleString()}</td>
                      {tab === "dead_letter" && (
                        <td className="py-2 pr-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={replayingId === m.id || replayBlocked}
                            onClick={() => replay(m)}
                            title={replayBlocked ? `Rate-limited — wait ${replayCooldownSec}s` : undefined}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            {replayingId === m.id
                              ? "Replaying…"
                              : replayBlocked
                                ? `Wait ${replayCooldownSec}s`
                                : "Replay"}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </MarketingLayout>
  );
}
