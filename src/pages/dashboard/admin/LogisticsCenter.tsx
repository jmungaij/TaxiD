/// <reference types="google.maps" />
import type { LooseRow } from "@/lib/types/loose";
/**
 * Phase 4 · Wave 1 · Stage 6 — Delivery & Logistics Workspace Composition.
 *
 * Reuse-only composition from the frozen Enterprise Composition Framework
 * (Wave Gate v1.0.0-frozen). All new sections (live map, performance
 * dashboard, export, partner onboarding) are composed from certified
 * primitives only — no new components, tokens, hooks, or schemas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Package,
  Activity,
  Gauge,
  RefreshCw,
  Truck,
  ClipboardCheck,
  Download,
  Filter,
  MapPin,
  UserPlus,
  History,
  Bell,
  SlidersHorizontal,
  Mail,
  MessageSquare,
  ShieldCheck,

} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/common/StatCard";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { AiAssistantPanel } from "@/components/layout/AiAssistantPanel";
import { MapOverlayLegend } from "@/components/layout/MapOverlayLegend";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { LogisticsEnterprisePanels } from "@/components/dashboard/LogisticsEnterprisePanels";
import { LogisticsIntelligencePanels } from "@/components/dashboard/LogisticsIntelligencePanels";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import { useWorkspaceHealth, formatFreshness } from "@/lib/workspaces/health";
import { WORKSPACES } from "@/lib/workspaces/config";
import { ROUTE_BY_PATH } from "@/lib/routes";
import { useAuth } from "@/hooks/useAuth";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { guardDemoDataset } from "@/lib/logistics/domain";


import {
  DEFAULT_PREF, DEFAULT_THRESHOLDS, INTERNAL_TEAMS, NOTIFY_CHANNELS,
  PREFS_STORAGE_KEY, SCHEDULES_STORAGE_KEY, SEED_PINS, SERVICE_LABEL,
  SERVICE_TYPES, STATUS_STYLE, THRESHOLD_STORAGE_KEY,
  loadJson, loadThresholds, persistJson, prefKey, tokenColor,
} from "@/lib/logistics/logisticsConfig";
import type {
  AuditEntry, ChannelPrefs, DeliveryPin, DispatchAttempt, ExportCadence,
  ExportFormat, ExportSchedule, LogisticsNotification, NotifyChannel,
  NotifyPrefs, PinStatusFilter, ServiceThresholds, ServiceType,
} from "@/lib/logistics/logisticsConfig";

export default function LogisticsCenter() {
  const { roles } = useAuth();
  const health = useWorkspaceHealth("delivery_logistics");

  const workspace = useMemo(
    () => WORKSPACES.find((w) => w.key === "delivery_logistics"),
    [],
  );

  const items = useMemo(() => {
    const list = workspace?.items ?? [];
    return list
      .filter((i) => i.path !== workspace?.overviewPath)
      .map((i) => {
        const bare = i.path.split("?")[0];
        const r = ROUTE_BY_PATH.get(bare);
        const allowed =
          !r?.rolesAllowed ||
          r.rolesAllowed.length === 0 ||
          r.rolesAllowed.some((role) => roles.includes(role));
        return { ...i, allowed, title: r?.title ?? i.label };
      })
      .filter((i) => i.allowed);
  }, [workspace, roles]);

  // ---------- Filters ----------
  const [region, setRegion] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState("all" as PinStatusFilter);
  const [courierQuery, setCourierQuery] = useState<string>("");

  // ---------- Live pins (mutated by realtime + playback) ----------
  // Gate 0 — Production Safety: demo pins may never seed a production surface.
  const [pins, setPins] = useState(guardDemoDataset(SEED_PINS) as DeliveryPin[]);
  const [rtStatus, setRtStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const alertedRef = useRef(new Set() as Set<string>);

  // ---------- Audit trail ----------
  const [audit, setAudit] = useState([] as AuditEntry[]);
  const pushAudit = useCallback((action: string, target: string, detail?: string) => {
    const entry: AuditEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      actor: roles[0] ?? "operator",
      action,
      target,
      detail,
    };
    setAudit((a) => [entry, ...a].slice(0, 50));
    // Best-effort server-side audit; RLS requires actor_user_id = auth.uid().
    void (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return; // no session: skip the insert instead of tripping RLS
      await (supabase as LooseRow).from("audit_logs").insert({
        actor_user_id: uid,
        actor_role: roles[0] ?? "operator",
        action,
        entity_type: "delivery_logistics",
        after_data: { target, detail: detail ?? null, ts: entry.ts },
      }).then(() => undefined, () => undefined);
    })();
  }, [roles]);


  // ---------- Playback & clustering controls ----------
  const [playbackMin, setPlaybackMin] = useState<number>(60); // show last N minutes
  const [clusterOn, setClusterOn] = useState<boolean>(true);

  const regions = useMemo(() => {
    const set = new Set(pins.map((p) => p.region));
    return ["all", ...Array.from(set)];
  }, [pins]);

  const filtered = useMemo(() => {
    const cutoff = Date.now() - playbackMin * 60_000;
    return pins.filter((p) => {
      if (p.updatedAt < cutoff) return false;
      if (region !== "all" && p.region !== region) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (courierQuery && !p.courier.toLowerCase().includes(courierQuery.toLowerCase())) return false;
      return true;
    });
  }, [pins, region, statusFilter, courierQuery, playbackMin]);

  // Simple grid-based clustering: bucket ~0.02° cells (~2km) and merge.
  const clusters = useMemo(() => {
    if (!clusterOn) {
      return filtered.map((p) => ({ ...p, size: 1 }));
    }
    const cells = new Map<string, { lat: number; lng: number; size: number; sample: DeliveryPin }>();
    for (const p of filtered) {
      const key = `${Math.round(p.lat / 0.02)}:${Math.round(p.lng / 0.02)}`;
      const c = cells.get(key);
      if (c) {
        c.lat = (c.lat * c.size + p.lat) / (c.size + 1);
        c.lng = (c.lng * c.size + p.lng) / (c.size + 1);
        c.size += 1;
      } else {
        cells.set(key, { lat: p.lat, lng: p.lng, size: 1, sample: p });
      }
    }
    return Array.from(cells.values()).map((c) => ({ ...c.sample, lat: c.lat, lng: c.lng, size: c.size }));
  }, [filtered, clusterOn]);

  // ---------- Configurable per-service-type SLA thresholds ----------
  const [thresholds, setThresholds] = useState((): ServiceThresholds => loadThresholds());
  const thresholdFor = useCallback(
    (p: DeliveryPin) => thresholds[p.serviceType] ?? DEFAULT_THRESHOLDS[p.serviceType],
    [thresholds],
  );
  const setThreshold = useCallback((svc: ServiceType, value: number) => {
    setThresholds((prev) => {
      const next = { ...prev, [svc]: Math.max(0, Math.min(100, value)) };
      try { localStorage.setItem(THRESHOLD_STORAGE_KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
      return next;
    });
    // Re-arm alerting so the new threshold is evaluated immediately.
    alertedRef.current.clear();
  }, []);

  // ---------- Derived KPIs (drill-down) ----------
  const kpi = useMemo(() => {
    const total = filtered.length || 1;
    const enRoute = filtered.filter((p) => p.status === "en_route").length;
    const idle = filtered.filter((p) => p.status === "idle").length;
    const incidents = filtered.filter((p) => p.status === "incident").length;
    const slaAvg = Math.round(filtered.reduce((s, p) => s + p.sla, 0) / total);
    const breaching = filtered.filter((p) => p.sla < thresholdFor(p));
    return {
      total: filtered.length,
      enRoute,
      idle,
      incidents,
      slaAvg,
      breaches: breaching.length,
      breachIds: breaching.map((p) => p.id),
    };
  }, [filtered, thresholdFor]);

  // ---------- Threshold impact preview (instant KPI deltas) ----------
  const thresholdImpact = useMemo(
    () =>
      SERVICE_TYPES.map((svc) => {
        const rows = filtered.filter((p) => p.serviceType === svc);
        const limit = thresholds[svc];
        const breaching = rows.filter((p) => p.sla < limit);
        const avg = rows.length
          ? Math.round(rows.reduce((s, p) => s + p.sla, 0) / rows.length)
          : 0;
        const atDefault = rows.filter((p) => p.sla < DEFAULT_THRESHOLDS[svc]).length;
        return {
          svc,
          limit,
          count: rows.length,
          avg,
          breaches: breaching.length,
          delta: breaching.length - atDefault,
        };
      }),
    [filtered, thresholds],
  );

  // ---------- Notification preferences (per audience × service type) ----------
  const partners = useMemo(
    () => Array.from(new Set(pins.map((p) => p.partner))),
    [pins],
  );
  const audiences = useMemo(() => [...partners, ...INTERNAL_TEAMS], [partners]);
  const [prefs, setPrefs] = useState((): NotifyPrefs => loadJson(PREFS_STORAGE_KEY, {} as NotifyPrefs));

  const prefFor = useCallback(
    (audience: string, svc: ServiceType): ChannelPrefs =>
      prefs[prefKey(audience, svc)] ?? { ...DEFAULT_PREF },
    [prefs],
  );

  const togglePref = useCallback(
    (audience: string, svc: ServiceType, channel: NotifyChannel, value: boolean) => {
      setPrefs((prev) => {
        const key = prefKey(audience, svc);
        const next: NotifyPrefs = {
          ...prev,
          [key]: { ...(prev[key] ?? DEFAULT_PREF), [channel]: value },
        };
        persistJson(PREFS_STORAGE_KEY, next);
        return next;
      });
    },
    [],
  );

  // ---------- Dispatch notifications (email / SMS / push) ----------
  const [notifications, setNotifications] = useState([] as LogisticsNotification[]);

  const patchNotification = useCallback((id: string, patch: Partial<LogisticsNotification>) => {
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const appendTimeline = useCallback((id: string, entry: DispatchAttempt) => {
    setNotifications((list) =>
      list.map((n) => (n.id === id ? { ...n, timeline: [...n.timeline, entry] } : n)),
    );
  }, []);

  /** Send with bounded retry (3 attempts, linear backoff) + delivery tracking. */
  const sendNotification = useCallback(async (n: LogisticsNotification, pin?: DeliveryPin) => {
    const maxAttempts = 3;
    for (let attempt = n.attempts + 1; attempt <= maxAttempts; attempt++) {
      patchNotification(n.id, { status: "sending", attempts: attempt });
      appendTimeline(n.id, {
        ts: Date.now(),
        attempt,
        event: "sending",
        detail: `channels ${n.channels.join("/")} → ${n.audience}`,
      });
      try {
        const { error } = await supabase.functions.invoke("alert-dispatch", {
          body: {
            rule_id: "logistics-sla-breach",
            rule_name: `SLA breach · ${n.packageId}`,
            severity: "critical",
            metric_key: "delivery_sla_pct",
            message: pin
              ? `${n.packageId} (${SERVICE_LABEL[pin.serviceType]}) at ${pin.sla}% — threshold ${thresholdFor(pin)}%. Courier ${pin.courier}, partner ${pin.partner}.`
              : `SLA breach detected for ${n.packageId}.`,
            channels: n.channels,
            target_roles: ["admin", "dispatch"],
          },
        });
        if (error) throw error;
        patchNotification(n.id, { status: "delivered", lastError: undefined });
        appendTimeline(n.id, { ts: Date.now(), attempt, event: "delivered" });
        pushAudit("sla.notification.delivered", n.packageId, `channels=${n.channels.join("/")} attempt=${attempt}`);
        return;
      } catch (e: LooseRow) {
        const msg = e?.message ?? "dispatch failed";
        const final = attempt >= maxAttempts;
        patchNotification(n.id, { status: final ? "failed" : "queued", lastError: msg });
        appendTimeline(n.id, {
          ts: Date.now(),
          attempt,
          event: final ? "failed" : "retry",
          detail: msg,
        });
        if (final) {
          pushAudit("sla.notification.failed", n.packageId, `attempts=${attempt} error=${msg}`);
          return;
        }
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
  }, [patchNotification, appendTimeline, pushAudit, thresholdFor]);

  /**
   * Resolve which channels each audience wants for this pin's service type,
   * then queue one tracked dispatch per audience. Preferences are consulted
   * BEFORE anything is dispatched.
   */
  const dispatchBreachNotification = useCallback((pin: DeliveryPin) => {
    const targets = [pin.partner, ...INTERNAL_TEAMS];
    const queued: LogisticsNotification[] = [];
    for (const audience of targets) {
      const pref = prefFor(audience, pin.serviceType);
      const active = NOTIFY_CHANNELS.filter((c) => pref[c]);
      if (active.length === 0) continue;
      queued.push({
        id: `${pin.id}-${audience}-${Date.now()}`,
        ts: Date.now(),
        packageId: pin.id,
        channels: active,
        audience,
        status: "queued",
        attempts: 0,
        acknowledged: false,
        timeline: [{ ts: Date.now(), attempt: 0, event: "queued", detail: `preferences: ${active.join("/")}` }],
      });
    }
    if (queued.length === 0) {
      toast({
        title: `No channels enabled · ${pin.id}`,
        description: `Notification preferences suppress all channels for ${SERVICE_LABEL[pin.serviceType]}.`,
      });
      return;
    }
    setNotifications((list) => [...queued, ...list].slice(0, 60));
    queued.forEach((n) => void sendNotification(n, pin));
  }, [prefFor, sendNotification]);


  const retryNotification = useCallback((id: string) => {
    const n = notifications.find((x) => x.id === id);
    if (!n) return;
    const pin = pins.find((p) => p.id === n.packageId);
    void sendNotification({ ...n, attempts: 0 }, pin);
  }, [notifications, pins, sendNotification]);

  // ---------- SLA breach alerts (threshold-aware, instant) ----------
  useEffect(() => {
    for (const p of filtered) {
      const limit = thresholdFor(p);
      if (p.sla < limit && !alertedRef.current.has(p.id)) {
        alertedRef.current.add(p.id);
        toast({
          title: `SLA breach · ${p.id}`,
          description: `${SERVICE_LABEL[p.serviceType]} — ${p.sla}% (threshold ${limit}%). Dispatch notified.`,
          variant: "destructive",
        });
        pushAudit("sla.breach.notify", p.id, `sla=${p.sla}% threshold=${limit}% service=${p.serviceType}`);
        dispatchBreachNotification(p);
      }
      // Reset once SLA recovers so future breaches re-alert.
      if (p.sla >= limit && alertedRef.current.has(p.id)) {
        alertedRef.current.delete(p.id);
      }
    }
  }, [filtered, pushAudit, thresholdFor, dispatchBreachNotification]);

  // ---------- Alert drawer (acknowledge + dispatch action) ----------
  const [drawerPin, setDrawerPin] = useState(null as DeliveryPin | null);
  const acknowledgeBreach = useCallback((pin: DeliveryPin) => {
    setNotifications((list) =>
      list.map((n) => (n.packageId === pin.id ? { ...n, acknowledged: true } : n)),
    );
    pushAudit("sla.breach.acknowledged", pin.id, `by=${roles[0] ?? "operator"}`);
    toast({ title: `Acknowledged · ${pin.id}`, description: "Breach marked as owned by dispatch." });
  }, [pushAudit, roles]);

  const dispatchAction = useCallback((pin: DeliveryPin, action: "reassign" | "reroute") => {
    setPins((prev) =>
      prev.map((p) =>
        p.id === pin.id
          ? { ...p, status: action === "reassign" ? "idle" : "en_route", updatedAt: Date.now() }
          : p,
      ),
    );
    pushAudit(`delivery.${action}`, pin.id, `courier=${pin.courier} service=${pin.serviceType}`);
    toast({
      title: action === "reassign" ? `Reassignment queued · ${pin.id}` : `Reroute queued · ${pin.id}`,
      description: "Dispatch console notified; assignment change recorded in the audit trail.",
    });
    setDrawerPin(null);
  }, [pushAudit]);


  // ---------- Realtime WebSocket subscription ----------
  useEffect(() => {
    const channel = supabase
      .channel("yeos:delivery_logistics:live")
      .on("postgres_changes", { event: "*", schema: "public", table: "package_events" }, (payload: LooseRow) => {
        const row: LooseRow = payload.new ?? payload.old ?? {};
        const pkgId = row.package_id ?? row.id;
        if (!pkgId) return;
        setPins((prev) => {
          const idx = prev.findIndex((p) => p.id === pkgId);
          if (idx === -1) return prev;
          const next = prev.slice();
          const status: DeliveryPin["status"] =
            row.event_type === "incident" ? "incident" :
            row.event_type === "delivered" || row.event_type === "idle" ? "idle" : "en_route";
          next[idx] = { ...next[idx], status, updatedAt: Date.now() };
          return next;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_orders" }, () => {
        // Any delivery order change bumps last-seen so playback stays fresh.
        setPins((prev) => prev.map((p) => ({ ...p, updatedAt: Math.max(p.updatedAt, Date.now() - 60_000) })));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRtStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRtStatus("offline");
      });
    return () => { void supabase.removeChannel(channel); };
  }, []);

  // ---------- Live map ----------
  const mapRef = useRef(null as HTMLDivElement | null);
  const mapInstance = useRef<any>(null);
  const markersRef = useRef<LooseRow[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapRef.current) return;
        mapInstance.current = new google.maps.Map(mapRef.current, {
          center: { lat: -1.2921, lng: 36.8219 },
          zoom: 11,
          disableDefaultUI: false,
          streetViewControl: false,
          mapTypeControl: false,
        });
      })
      .catch((e) => !cancelled && setMapError(e?.message ?? "Map unavailable"));
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync markers (clustered or raw) + polyline through visible pins.
  useEffect(() => {
    const g = (window as LooseRow).google;
    if (!g?.maps || !mapInstance.current) return;
    markersRef.current.forEach((m) => m.setMap?.(null));
    markersRef.current = [];

    clusters.forEach((p: LooseRow) => {
      const marker = new g.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapInstance.current,
        title: p.size > 1
          ? `${p.size} deliveries · ${STATUS_STYLE[p.status].label}`
          : `${p.label} · ${STATUS_STYLE[p.status].label} · SLA ${p.sla}%`,
        label: p.size > 1 ? { text: String(p.size), color: tokenColor("--primary-foreground"), fontSize: "11px" } : undefined,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: p.size > 1 ? 10 + Math.min(p.size, 6) : 8,
          fillColor: STATUS_STYLE[p.status].color,
          fillOpacity: 0.95,
          strokeColor: "hsl(var(--card))",
          strokeWeight: 2,
        },
      });
      markersRef.current.push(marker);
    });

    if (!clusterOn && filtered.length >= 2) {
      const path = filtered.map((p) => ({ lat: p.lat, lng: p.lng }));
      const line = new g.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: "hsl(var(--map-route))",
        strokeOpacity: 0.7,
        strokeWeight: 3,
        map: mapInstance.current,
      });
      markersRef.current.push(line);
    }
  }, [clusters, clusterOn, filtered]);

  // ---------- Export ----------
  const exportCsv = () => {
    const header = ["package_id", "region", "courier", "status", "sla_pct", "lat", "lng"].join(",");
    const rows = filtered.map((p) =>
      [p.id, p.region, `"${p.courier}"`, p.status, p.sla, p.lat, p.lng].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delivery-performance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => window.print();

  // ---------- Audit log export (partner / order / date-range filters) ----------
  const [auditPartner, setAuditPartner] = useState("");
  const [auditOrder, setAuditOrder] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditExporting, setAuditExporting] = useState(false);

  const exportAuditLogs = useCallback(async (format: "csv" | "pdf") => {
    setAuditExporting(true);
    try {
      let q = (supabase as LooseRow)
        .from("audit_logs")
        .select("created_at, action, entity_type, entity_id, actor_user_id, after_data")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (auditOrder) q = q.ilike("after_data->>target", `%${auditOrder}%`);
      if (auditFrom) q = q.gte("created_at", `${auditFrom}T00:00:00`);
      if (auditTo) q = q.lte("created_at", `${auditTo}T23:59:59`);
      const { data, error } = await q;
      if (error) throw error;

      const needle = auditPartner.trim().toLowerCase();
      const rows = ((data as LooseRow[]) ?? []).filter((r) =>
        !needle ||
        String(r.actor_user_id ?? "").toLowerCase().includes(needle) ||
        JSON.stringify(r.after_data ?? {}).toLowerCase().includes(needle),
      );

      if (rows.length === 0) {
        toast({ title: "Nothing to export", description: "No audit rows match those filters." });
        return;
      }

      if (format === "csv") {
        const header = ["created_at", "action", "entity_type", "entity_id", "actor_user_id", "after_data"].join(",");
        const body = rows.map((r) =>
          [
            r.created_at,
            r.action,
            r.entity_type ?? "",
            (r.after_data?.target ?? ""),
            r.actor_user_id ?? "",
            `"${JSON.stringify(r.after_data ?? {}).replace(/"/g, "'")}"`,
          ].join(","),
        );
        const blob = new Blob([[header, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const w = window.open("", "_blank");
        if (!w) {
          toast({ title: "Popup blocked", description: "Allow popups to export the PDF.", variant: "destructive" });
          return;
        }
        const esc = (s: unknown) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
        w.document.write(
          `<h1>SAFARID · Audit Log Export</h1><p>${esc(rows.length)} rows · partner: ${esc(auditPartner || "any")} · order: ${esc(auditOrder || "any")} · ${esc(auditFrom || "…")} → ${esc(auditTo || "…")}</p>` +
          `<table border="1" cellspacing="0" cellpadding="4" style="font:12px sans-serif;border-collapse:collapse"><tr><th>Time</th><th>Action</th><th>Resource</th><th>Target</th><th>Actor</th></tr>` +
          rows.map((r) => `<tr><td>${esc(r.created_at)}</td><td>${esc(r.action)}</td><td>${esc(r.entity_type)}</td><td>${esc(r.after_data?.target)}</td><td>${esc(r.actor_user_id)}</td></tr>`).join("") +
          `</table>`,
        );
        w.document.close();
        w.print();
      }
      toast({ title: `Audit ${format.toUpperCase()} exported`, description: `${rows.length} rows included.` });
    } catch (e: LooseRow) {
      toast({ title: "Audit export failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setAuditExporting(false);
    }
  }, [auditPartner, auditOrder, auditFrom, auditTo]);

  // ---------- Scheduled audit-log exports (saved filters, emailed) ----------
  const [schedules, setSchedules] = useState((): ExportSchedule[] => loadJson(SCHEDULES_STORAGE_KEY, [] as ExportSchedule[]));
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleCadence, setScheduleCadence] = useState("daily" as ExportCadence);
  const [scheduleFormat, setScheduleFormat] = useState("csv" as ExportFormat);
  const [scheduleRecipients, setScheduleRecipients] = useState("");
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);

  const writeSchedules = useCallback((next: ExportSchedule[]) => {
    setSchedules(next);
    persistJson(SCHEDULES_STORAGE_KEY, next);
  }, []);

  const saveSchedule = useCallback(() => {
    const recipients = scheduleRecipients.trim();
    if (!recipients) {
      toast({ title: "Recipients required", description: "Add at least one email address.", variant: "destructive" });
      return;
    }
    const next: ExportSchedule = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: scheduleName.trim() || `Audit export (${scheduleCadence})`,
      cadence: scheduleCadence,
      format: scheduleFormat,
      recipients,
      partner: auditPartner,
      order: auditOrder,
      from: auditFrom,
      to: auditTo,
    };
    writeSchedules([next, ...schedules]);
    setScheduleName("");
    pushAudit("audit.export.scheduled", next.name,
      `${next.cadence}/${next.format} → ${recipients} partner=${next.partner || "any"} order=${next.order || "any"}`);
    toast({
      title: "Schedule saved",
      description: `${next.name} — ${next.cadence} ${next.format.toUpperCase()} to ${recipients}.`,
    });
  }, [scheduleRecipients, scheduleName, scheduleCadence, scheduleFormat, auditPartner, auditOrder, auditFrom, auditTo, schedules, writeSchedules, pushAudit]);

  const deleteSchedule = useCallback((id: string) => {
    const gone = schedules.find((s) => s.id === id);
    writeSchedules(schedules.filter((s) => s.id !== id));
    if (gone) pushAudit("audit.export.schedule.deleted", gone.name, `${gone.cadence}/${gone.format}`);
  }, [schedules, writeSchedules, pushAudit]);

  /** Run a saved schedule now: query with its filters and email the export. */
  const runSchedule = useCallback(async (s: ExportSchedule) => {
    setRunningScheduleId(s.id);
    try {
      let q = (supabase as LooseRow)
        .from("audit_logs")
        .select("created_at, action, entity_type, entity_id, actor_user_id, after_data")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (s.order) q = q.ilike("after_data->>target", `%${s.order}%`);
      if (s.from) q = q.gte("created_at", `${s.from}T00:00:00`);
      if (s.to) q = q.lte("created_at", `${s.to}T23:59:59`);
      const { data, error } = await q;
      if (error) throw error;
      const needle = s.partner.trim().toLowerCase();
      const rows = ((data as LooseRow[]) ?? []).filter((r) =>
        !needle ||
        String(r.actor_user_id ?? "").toLowerCase().includes(needle) ||
        JSON.stringify(r.after_data ?? {}).toLowerCase().includes(needle),
      );

      const lines = rows.slice(0, 200).map((r) =>
        [r.created_at, r.action, r.entity_type ?? "", (r.after_data?.target ?? ""), r.actor_user_id ?? ""].join(","),
      );
      const { error: fnError } = await supabase.functions.invoke("alert-dispatch", {
        body: {
          rule_id: "logistics-audit-export",
          rule_name: `${s.name} · ${s.format.toUpperCase()}`,
          severity: "info",
          metric_key: "audit_export_rows",
          message:
            `Scheduled ${s.cadence} audit export (${s.format.toUpperCase()}) — ${rows.length} rows.\n` +
            `Filters: partner=${s.partner || "any"}, order=${s.order || "any"}, ${s.from || "…"} → ${s.to || "…"}\n\n` +
            ["created_at,action,entity_type,entity_id,actor_user_id", ...lines].join("\n"),
          channels: ["email"],
          email_recipients: s.recipients.split(",").map((e) => e.trim()).filter(Boolean),
          target_roles: ["admin"],
        },
      });
      if (fnError) throw fnError;

      writeSchedules(
        schedules.map((x) => (x.id === s.id ? { ...x, lastRunAt: Date.now() } : x)),
      );
      pushAudit("audit.export.emailed", s.name, `rows=${rows.length} to=${s.recipients}`);
      toast({ title: `Export emailed · ${s.name}`, description: `${rows.length} rows sent to ${s.recipients}.` });
    } catch (e: LooseRow) {
      pushAudit("audit.export.email.failed", s.name, e?.message ?? "unknown error");
      toast({ title: "Scheduled export failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setRunningScheduleId(null);
    }
  }, [schedules, writeSchedules, pushAudit]);

  // Due-check: fires any schedule whose cadence window has elapsed.
  const cadenceMs: Record<ExportCadence, number> = {
    daily: 24 * 3_600_000,
    weekly: 7 * 24 * 3_600_000,
    monthly: 30 * 24 * 3_600_000,
  };
  const dueRef = useRef(new Set() as Set<string>);
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      for (const s of schedules) {
        if (dueRef.current.has(s.id)) continue;
        const due = !s.lastRunAt || now - s.lastRunAt >= cadenceMs[s.cadence];
        if (due) {
          dueRef.current.add(s.id);
          void runSchedule(s);
        }
      }
    };
    const t = setTimeout(tick, 4000);
    const i = setInterval(tick, 15 * 60_000);
    return () => { clearTimeout(t); clearInterval(i); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules.length]);


  const isFirstPaint =
    health.connectionState === "offline" || health.primaryKpi?.value === "—";
  const degraded = health.connectionState === "degraded";
  const passed = health.status === "healthy";

  return (
    <div className="space-y-6">
      <EnterpriseHeroBand
        eyebrow={<span>Admin · Enterprise Logistics Operating System</span>}
        title={
          <span className="flex items-center gap-2">
            <Package className="h-6 w-6" /> Enterprise Logistics Operating System
          </span>
        }
        subtitle="One operating system for hubs, warehouses, distribution, inventory, courier, dispatch, routing, tracking, cold chain, reverse and executive logistics intelligence — every KPI is sourced from the certified delivery adapter."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "backdrop-blur bg-background/10 border-primary-foreground/30 text-primary-foreground",
              )}
            >
              <span
                className={cn(
                  "mr-2 inline-flex h-2 w-2 rounded-full",
                  passed ? "bg-status-success animate-pulse" : "bg-status-warning",
                )}
                aria-hidden
              />
              Delivery health {passed ? "green" : health.status} · {health.healthScore}/100
            </Badge>
            <span className="text-xs text-primary-foreground/70">
              {degraded ? "Degraded" : "Live"} · updated {formatFreshness(health.lastUpdated)}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.location.reload()}
              aria-label="Refresh delivery_logistics workspace"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        }
      />

      <AsyncState loading={isFirstPaint} error={null}>
        <SectionErrorBoundary sectionName="Delivery Scorecard">
          <section aria-label="Delivery scorecard">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Delivery Scorecard
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                title="Health score"
                value={`${health.healthScore}/100`}
                icon={<Gauge className="h-5 w-5 text-primary" />}
                description={passed ? "Within SLA threshold" : "Attention required"}
              />
              <StatCard
                title={health.primaryKpi?.label ?? "Active packages"}
                value={health.primaryKpi?.value ?? "—"}
                icon={<Package className="h-5 w-5 text-primary" />}
                description="In transit now"
                trend={
                  typeof health.trend === "number" && health.trend !== 0
                    ? { value: Math.abs(health.trend), isPositive: health.trend >= 0 }
                    : undefined
                }
              />
              <StatCard
                title={health.secondaryKpi?.label ?? "Dispatch queue"}
                value={health.secondaryKpi?.value ?? "—"}
                icon={<Truck className="h-5 w-5 text-primary" />}
                description="Awaiting assignment"
              />
              <StatCard
                title="Open alerts"
                value={health.activeAlerts ?? 0}
                icon={<Activity className="h-5 w-5 text-primary" />}
                description="Routing & POD"
              />
            </div>
          </section>
        </SectionErrorBoundary>

        <LogisticsEnterprisePanels />
        <LogisticsIntelligencePanels />

        <SectionErrorBoundary sectionName="Delivery Filters">
          <section aria-label="Delivery filters" className="mt-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Filter className="h-4 w-4" /> Filters &amp; Export
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <label className="text-xs text-muted-foreground">
                    Region
                    <select
                      aria-label="Filter by region"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {regions.map((r) => (
                        <option key={r} value={r}>{r === "all" ? "All regions" : r}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Status
                    <select
                      aria-label="Filter by delivery status"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as LooseRow)}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="all">All statuses</option>
                      <option value="en_route">En route</option>
                      <option value="idle">Idle</option>
                      <option value="incident">Incident</option>
                    </select>
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Courier
                    <Input
                      aria-label="Filter by courier name"
                      value={courierQuery}
                      onChange={(e) => setCourierQuery(e.target.value)}
                      placeholder="Search courier…"
                      className="mt-1"
                    />
                  </label>
                  <div className="flex items-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={exportCsv}
                      aria-label="Export filtered delivery metrics as CSV"
                    >
                      <Download className="h-4 w-4 mr-1" /> CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={exportPdf}
                      aria-label="Export delivery performance dashboard as PDF"
                    >
                      <Download className="h-4 w-4 mr-1" /> PDF
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Live Logistics Map">
          <section aria-label="Live logistics map" className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Live Logistics Map
              <Badge variant="outline" className="ml-2 text-[10px]">
                <span
                  className={cn(
                    "mr-1 inline-flex h-2 w-2 rounded-full",
                    rtStatus === "live" ? "bg-status-success animate-pulse" :
                    rtStatus === "connecting" ? "bg-status-warning" : "bg-status-danger",
                  )}
                  aria-hidden
                />
                Realtime {rtStatus}
              </Badge>
            </h2>
            <Card>
              <CardContent className="p-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <label className="text-xs text-muted-foreground md:col-span-2">
                    Time-range playback · last {playbackMin} min
                    <input
                      type="range"
                      min={5}
                      max={240}
                      step={5}
                      value={playbackMin}
                      onChange={(e) => setPlaybackMin(Number(e.target.value))}
                      aria-label="Playback time window in minutes"
                      className="mt-2 w-full accent-primary"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={clusterOn}
                      onChange={(e) => setClusterOn(e.target.checked)}
                      aria-label="Toggle pin clustering"
                    />
                    Pin clustering (~2 km cells)
                  </label>
                </div>
                <div className="relative">
                  <div
                    ref={mapRef}
                    role="region"
                    aria-label="Real-time delivery pins and route overlays"
                    className="h-[420px] w-full rounded-md overflow-hidden bg-secondary"
                  />
                  {mapError && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground p-4 text-center">
                      Map unavailable — {mapError}. Filters &amp; performance data below remain live.
                    </div>
                  )}
                  <div className="absolute top-3 right-3">
                    <MapOverlayLegend
                      items={[
                        { id: "en_route", label: "En route",  swatchClass: "bg-map-route",    count: kpi.enRoute },
                        { id: "idle",     label: "Idle",      swatchClass: "bg-map-idle",     count: kpi.idle },
                        { id: "incident", label: "Incident",  swatchClass: "bg-map-incident", count: kpi.incidents },
                      ]}
                      title="Delivery pins"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="SLA Threshold Settings">
          <section aria-label="SLA threshold settings" className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" /> SLA Threshold Settings
              <Badge variant="outline" className="ml-2 text-[10px]">
                <Bell className="h-3 w-3 mr-1" /> {kpi.breaches} active breach{kpi.breaches === 1 ? "" : "es"}
              </Badge>
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Breach thresholds per service type</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {SERVICE_TYPES.map((svc) => (
                    <label key={svc} className="block text-xs text-muted-foreground">
                      <span className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{SERVICE_LABEL[svc]}</span>
                        <span className="tabular-nums">{thresholds[svc]}%</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={thresholds[svc]}
                        onChange={(e) => setThreshold(svc, Number(e.target.value))}
                        aria-label={`SLA breach threshold for ${SERVICE_LABEL[svc]}`}
                        className="mt-2 w-full accent-primary"
                      />
                      <span className="flex items-center gap-3">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={thresholds[svc]}
                          onChange={(e) => setThreshold(svc, Number(e.target.value))}
                          aria-label={`Exact SLA breach threshold for ${SERVICE_LABEL[svc]}`}
                          className="h-8 w-24"
                        />
                        <span className="text-[11px]">
                          default {DEFAULT_THRESHOLDS[svc]}%
                        </span>
                      </span>
                    </label>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        SERVICE_TYPES.forEach((s) => setThreshold(s, DEFAULT_THRESHOLDS[s]));
                        pushAudit("sla.thresholds.reset", "delivery_logistics", "restored defaults");
                      }}
                      aria-label="Reset SLA thresholds to defaults"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reset defaults
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Applied instantly to alerts and KPI calculations.
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Live KPI impact of current thresholds</CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/60 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-3 py-2">Service type</th>
                        <th className="text-right px-3 py-2">Threshold</th>
                        <th className="text-right px-3 py-2">Deliveries</th>
                        <th className="text-right px-3 py-2">Avg SLA</th>
                        <th className="text-right px-3 py-2">Breaches</th>
                        <th className="text-right px-3 py-2">vs default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {thresholdImpact.map((r) => (
                        <tr key={r.svc} className="border-t border-border">
                          <td className="px-3 py-2">{SERVICE_LABEL[r.svc]}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.limit}%</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.count ? `${r.avg}%` : "—"}</td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", r.breaches > 0 && "text-status-danger font-semibold")}>
                            {r.breaches}
                          </td>
                          <td className={cn(
                            "px-3 py-2 text-right tabular-nums",
                            r.delta > 0 && "text-status-danger",
                            r.delta < 0 && "text-status-success",
                          )}>
                            {r.delta > 0 ? `+${r.delta}` : r.delta}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-muted-foreground px-3 py-3">
                    Recalculated instantly as you move a slider — “vs default” shows how many extra
                    (or fewer) breaches your configuration produces against platform defaults.
                  </p>
                </CardContent>
              </Card>
            </div>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Notification Preferences & Dispatch Status">
          <section aria-label="Notification preferences and dispatch status" className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Mail className="h-4 w-4" /> Notification Preferences &amp; Dispatch Status
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Channel preferences per partner &amp; service type
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/60 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-3 py-2">Audience</th>
                        <th className="text-left px-3 py-2">Service</th>
                        {NOTIFY_CHANNELS.map((c) => (
                          <th key={c} className="text-center px-3 py-2">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {audiences.map((audience) =>
                        SERVICE_TYPES.map((svc) => {
                          const pref = prefFor(audience, svc);
                          return (
                            <tr key={`${audience}-${svc}`} className="border-t border-border">
                              <td className="px-3 py-2 font-medium">{audience}</td>
                              <td className="px-3 py-2 capitalize">{svc}</td>
                              {NOTIFY_CHANNELS.map((c) => (
                                <td key={c} className="px-3 py-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={pref[c]}
                                    onChange={(e) => {
                                      togglePref(audience, svc, c, e.target.checked);
                                      pushAudit(
                                        "sla.notification.preference",
                                        audience,
                                        `${svc}/${c}=${e.target.checked ? "on" : "off"}`,
                                      );
                                    }}
                                    aria-label={`Notify ${audience} via ${c} for ${SERVICE_LABEL[svc]}`}
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        }),
                      )}
                    </tbody>
                  </table>
                  <p className="text-xs text-muted-foreground px-3 py-3 flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Preferences are consulted before any alert dispatch — audiences with all
                    channels off are skipped entirely.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Dispatch delivery status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary/60 text-xs uppercase tracking-wide">
                        <tr>
                          <th className="text-left px-3 py-2">Package</th>
                          <th className="text-left px-3 py-2">Audience</th>
                          <th className="text-left px-3 py-2">Channels</th>
                          <th className="text-left px-3 py-2">Status</th>
                          <th className="text-right px-3 py-2">Attempts</th>
                          <th className="text-right px-3 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {notifications.length === 0 && (
                          <tr>
                            <td colSpan={6} className="text-center text-muted-foreground py-6">
                              No dispatch notifications yet — breaches trigger partner + internal alerts automatically.
                            </td>
                          </tr>
                        )}
                        {notifications.map((n) => (
                          <tr key={n.id} className="border-t border-border">
                            <td className="px-3 py-2 font-medium">{n.packageId}</td>
                            <td className="px-3 py-2 text-xs">{n.audience}</td>
                            <td className="px-3 py-2 uppercase text-xs">{n.channels.join(" · ")}</td>

                            <td className="px-3 py-2">
                              <Badge
                                variant="outline"
                                className={cn(
                                  n.status === "delivered" && "text-status-success",
                                  n.status === "failed" && "text-status-danger",
                                  n.status === "sending" && "text-status-warning",
                                )}
                              >
                                {n.status}{n.acknowledged ? " · ack" : ""}
                              </Badge>
                              {n.lastError && (
                                <div className="text-[10px] text-muted-foreground mt-1">{n.lastError}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{n.attempts}</td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => retryNotification(n.id)}
                                aria-label={`Retry notification for ${n.packageId}`}
                              >
                                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        </SectionErrorBoundary>


        <SectionErrorBoundary sectionName="Delivery Performance Drill-down">
          <section aria-label="Delivery performance drill-down" className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Performance Drill-down
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <StatCard
                title="Deliveries (filtered)"
                value={kpi.total}
                icon={<Package className="h-5 w-5 text-primary" />}
                description="Matches current filters"
              />
              <StatCard
                title="Avg SLA compliance"
                value={`${kpi.slaAvg}%`}
                icon={<Gauge className="h-5 w-5 text-primary" />}
                description="Weighted across selection"
              />
              <StatCard
                title="Idle couriers"
                value={kpi.idle}
                icon={<Truck className="h-5 w-5 text-primary" />}
                description="Available for dispatch"
              />
              <StatCard
                title="Incidents"
                value={kpi.incidents}
                icon={<Activity className="h-5 w-5 text-primary" />}
                description="Requires operator review"
              />
            </div>
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/60 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-3 py-2">Package</th>
                      <th className="text-left px-3 py-2">Region</th>
                      <th className="text-left px-3 py-2">Service</th>
                      <th className="text-left px-3 py-2">Courier</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-right px-3 py-2">SLA</th>
                      <th className="text-right px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center text-muted-foreground py-6">
                          No deliveries match the current filters.
                        </td>
                      </tr>
                    )}
                    {filtered.map((p) => {
                      const limit = thresholdFor(p);
                      const breaching = p.sla < limit;
                      return (
                      <tr key={p.id} className="border-t border-border hover:bg-secondary/40">
                        <td className="px-3 py-2 font-medium">{p.id}</td>
                        <td className="px-3 py-2">{p.region}</td>
                        <td className="px-3 py-2 capitalize">{p.serviceType}</td>
                        <td className="px-3 py-2">{p.courier}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline">{STATUS_STYLE[p.status].label}</Badge>
                        </td>
                        <td className={cn("px-3 py-2 text-right tabular-nums", breaching && "text-status-danger font-semibold")}>
                          {p.sla}% <span className="text-[10px] text-muted-foreground">/ {limit}%</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {breaching && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDrawerPin(p)}
                                aria-label={`Open SLA breach alert drawer for ${p.id}`}
                              >
                                <Bell className="h-3.5 w-3.5 mr-1" /> Alert
                              </Button>
                            )}
                            <Link
                              to={`/delivery/ops/packages?focus=${encodeURIComponent(p.id)}`}
                              className="text-primary underline-offset-2 hover:underline"
                              aria-label={`Drill into ${p.id}`}
                            >
                              Inspect
                            </Link>
                          </div>
                        </td>
                      </tr>
                      );
                    })}

                  </tbody>
                </table>
              </CardContent>
            </Card>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Delivery Modules">
          <section aria-label="Delivery modules" className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" /> Operations Console &amp; Modules
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((i) => (
                <Link key={i.path} to={i.path} className="group focus:outline-none">
                  <Card className="h-full transition-all hover:border-primary hover:shadow-enterprise-lg focus-visible:ring-2 focus-visible:ring-ring">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between">
                        <span>{i.label}</span>
                        <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      {i.path}
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {items.length === 0 && (
                <div className="col-span-full text-sm text-muted-foreground">
                  No Delivery &amp; Logistics modules are available for your role.
                </div>
              )}
            </div>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Logistics Partner Onboarding">
          <section aria-label="Logistics partner onboarding" className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Logistics Partner Onboarding
            </h2>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Invite · Onboard · Assign</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <ol className="grid md:grid-cols-4 gap-3">
                  {[
                    { step: 1, title: "Invite", desc: "Send partner invite via secure link." },
                    { step: 2, title: "KYB Docs", desc: "Verify CR12, KRA PIN, Tax Compliance." },
                    { step: 3, title: "Contract", desc: "Countersign delivery SLA agreement." },
                    { step: 4, title: "Assign", desc: "Route packages to the new partner." },
                  ].map((s) => (
                    <li key={s.step} className="rounded-md border border-border bg-secondary/40 p-3">
                      <div className="text-xs text-muted-foreground">Step {s.step}</div>
                      <div className="font-medium">{s.title}</div>
                      <div className="text-xs text-muted-foreground mt-1">{s.desc}</div>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-2">
                  <Button
                    asChild
                    size="sm"
                    aria-label="Open partner invite console"
                    onClick={() => pushAudit("partner.invite.open", "partner-invite", "operator opened invite console")}
                  >
                    <Link to="/dashboard/admin/partner-invite">
                      <UserPlus className="h-4 w-4 mr-1" /> Invite logistics partner
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    aria-label="Open corporate KYB console"
                    onClick={() => pushAudit("partner.kyb.review", "corporate-kyb", "opened KYB queue")}
                  >
                    <Link to="/dashboard/admin/corporate-kyb">
                      <ClipboardCheck className="h-4 w-4 mr-1" /> Review KYB queue
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    aria-label="Open delivery dispatch to assign packages"
                    onClick={() => pushAudit("delivery.assign.open", "delivery-dispatch", "opened dispatch console")}
                  >
                    <Link to="/delivery/ops/dispatch">
                      <Truck className="h-4 w-4 mr-1" /> Assign deliveries
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Onboarding & Assignment Audit Trail">
          <section aria-label="Onboarding and assignment audit trail" className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <History className="h-4 w-4" /> Onboarding &amp; Assignment Audit Trail
              <Badge variant="outline" className="ml-2 text-[10px]">
                <Bell className="h-3 w-3 mr-1" /> Thresholds: express {thresholds.express}% · standard {thresholds.standard}% · bulk {thresholds.bulk}%
              </Badge>
            </h2>
            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Download className="h-4 w-4" /> Export audit log
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <label className="text-xs text-muted-foreground">
                    Partner / actor
                    <Input
                      aria-label="Filter audit log by partner"
                      value={auditPartner}
                      onChange={(e) => setAuditPartner(e.target.value)}
                      placeholder="Partner name or id…"
                      className="mt-1"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Delivery order
                    <Input
                      aria-label="Filter audit log by delivery order"
                      value={auditOrder}
                      onChange={(e) => setAuditOrder(e.target.value)}
                      placeholder="PKG-1042…"
                      className="mt-1"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    From date
                    <Input
                      type="date"
                      aria-label="Audit log from date"
                      value={auditFrom}
                      onChange={(e) => setAuditFrom(e.target.value)}
                      className="mt-1"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    To date
                    <Input
                      type="date"
                      aria-label="Audit log to date"
                      value={auditTo}
                      onChange={(e) => setAuditTo(e.target.value)}
                      className="mt-1"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={auditExporting}
                    onClick={() => void exportAuditLogs("csv")}
                    aria-label="Export filtered audit logs as CSV"
                  >
                    <Download className="h-4 w-4 mr-1" /> {auditExporting ? "Exporting…" : "Audit CSV"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={auditExporting}
                    onClick={() => void exportAuditLogs("pdf")}
                    aria-label="Export filtered audit logs as PDF"
                  >
                    <Download className="h-4 w-4 mr-1" /> Audit PDF
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Filters apply to partner/actor, delivery order and date range.
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" /> Scheduled audit exports (emailed automatically)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <label className="text-xs text-muted-foreground">
                    Schedule name
                    <Input
                      aria-label="Scheduled export name"
                      value={scheduleName}
                      onChange={(e) => setScheduleName(e.target.value)}
                      placeholder="Weekly partner audit…"
                      className="mt-1"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Cadence
                    <select
                      aria-label="Scheduled export cadence"
                      value={scheduleCadence}
                      onChange={(e) => setScheduleCadence(e.target.value as ExportSchedule["cadence"])}
                      className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Format
                    <select
                      aria-label="Scheduled export format"
                      value={scheduleFormat}
                      onChange={(e) => setScheduleFormat(e.target.value as ExportSchedule["format"])}
                      className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="csv">CSV</option>
                      <option value="pdf">PDF</option>
                    </select>
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Email recipients
                    <Input
                      aria-label="Scheduled export email recipients"
                      value={scheduleRecipients}
                      onChange={(e) => setScheduleRecipients(e.target.value)}
                      placeholder="ops@safarid.org, audit@…"
                      className="mt-1"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={saveSchedule} aria-label="Save scheduled audit export with current filters">
                    <ClipboardCheck className="h-4 w-4 mr-1" /> Save schedule with current filters
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Saves partner “{auditPartner || "any"}”, order “{auditOrder || "any"}”,
                    {" "}{auditFrom || "…"} → {auditTo || "…"}.
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/60 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-3 py-2">Schedule</th>
                        <th className="text-left px-3 py-2">Cadence</th>
                        <th className="text-left px-3 py-2">Saved filters</th>
                        <th className="text-left px-3 py-2">Recipients</th>
                        <th className="text-left px-3 py-2">Last sent</th>
                        <th className="text-right px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedules.length === 0 && (
                        <tr>
                          <td colSpan={6} className="text-center text-muted-foreground py-6">
                            No scheduled exports yet — set filters above and save a schedule.
                          </td>
                        </tr>
                      )}
                      {schedules.map((s) => (
                        <tr key={s.id} className="border-t border-border">
                          <td className="px-3 py-2 font-medium">
                            {s.name}
                            <Badge variant="outline" className="ml-2 text-[10px] uppercase">{s.format}</Badge>
                          </td>
                          <td className="px-3 py-2 capitalize">{s.cadence}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            partner: {s.partner || "any"} · order: {s.order || "any"} · {s.from || "…"} → {s.to || "…"}
                          </td>
                          <td className="px-3 py-2 text-xs">{s.recipients}</td>
                          <td className="px-3 py-2 text-xs">
                            {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "pending"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={runningScheduleId === s.id}
                                onClick={() => void runSchedule(s)}
                                aria-label={`Run and email ${s.name} now`}
                              >
                                <Mail className="h-3.5 w-3.5 mr-1" />
                                {runningScheduleId === s.id ? "Sending…" : "Run & email"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => deleteSchedule(s.id)}
                                aria-label={`Delete schedule ${s.name}`}
                              >
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>


            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/60 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-3 py-2">Time</th>
                      <th className="text-left px-3 py-2">Actor</th>
                      <th className="text-left px-3 py-2">Action</th>
                      <th className="text-left px-3 py-2">Target</th>
                      <th className="text-left px-3 py-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center text-muted-foreground py-6">
                          No audit events yet — actions taken on this page will appear here and are persisted server-side.
                        </td>
                      </tr>
                    )}
                    {audit.map((a) => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {new Date(a.ts).toLocaleTimeString()}
                        </td>
                        <td className="px-3 py-2">{a.actor}</td>
                        <td className="px-3 py-2 font-medium">{a.action}</td>
                        <td className="px-3 py-2">{a.target}</td>
                        <td className="px-3 py-2 text-muted-foreground">{a.detail ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Delivery Copilot">
          <section aria-label="Delivery copilot" className="mt-6">
            <AiAssistantPanel
              title="Delivery Copilot"
              subtitle="Ask about parcel SLAs, dispatch bottlenecks, courier utilization, POD exceptions, or partner onboarding."
              suggestions={[
                "Which packages are at risk of missing SLA in the next hour?",
                "Show idle couriers in Nairobi with open dispatch queue.",
                "Summarize POD exceptions and top failure reasons today.",
              ]}
            />
          </section>
        </SectionErrorBoundary>
      </AsyncState>

      <Sheet open={!!drawerPin} onOpenChange={(o) => !o && setDrawerPin(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" /> SLA breach · {drawerPin?.id}
            </SheetTitle>
            <SheetDescription>
              {drawerPin
                ? `${SERVICE_LABEL[drawerPin.serviceType]} — ${drawerPin.sla}% against a ${thresholdFor(drawerPin)}% threshold. Acknowledge ownership or trigger a dispatch action.`
                : ""}
            </SheetDescription>
          </SheetHeader>
          {drawerPin && (
            <div className="mt-6 space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Courier</dt>
                  <dd className="font-medium">{drawerPin.courier}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Region</dt>
                  <dd className="font-medium">{drawerPin.region}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Status</dt>
                  <dd><Badge variant="outline">{STATUS_STYLE[drawerPin.status].label}</Badge></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Partner</dt>
                  <dd className="font-medium">{drawerPin.partner}</dd>
                </div>
              </dl>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-primary mb-2 flex items-center gap-2">
                  <History className="h-3.5 w-3.5" /> Notification delivery timeline
                </h3>
                {notifications.filter((n) => n.packageId === drawerPin.id).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No dispatch attempts recorded for this package yet.
                  </p>
                )}
                <div className="space-y-3">
                  {notifications
                    .filter((n) => n.packageId === drawerPin.id)
                    .map((n) => (
                      <div key={n.id} className="rounded-md border border-border bg-secondary/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{n.audience}</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              n.status === "delivered" && "text-status-success",
                              n.status === "failed" && "text-status-danger",
                              n.status === "sending" && "text-status-warning",
                            )}
                          >
                            {n.status} · {n.attempts} attempt{n.attempts === 1 ? "" : "s"}
                          </Badge>
                        </div>
                        <div className="text-[10px] uppercase text-muted-foreground mt-1">
                          {n.channels.join(" · ")}
                        </div>
                        <ol className="mt-2 space-y-1">
                          {n.timeline.map((t, idx) => (
                            <li key={`${n.id}-${idx}`} className="text-[11px] flex items-start gap-2">
                              <span className="tabular-nums text-muted-foreground">
                                {new Date(t.ts).toLocaleTimeString()}
                              </span>
                              <span
                                className={cn(
                                  "font-medium",
                                  t.event === "delivered" && "text-status-success",
                                  t.event === "failed" && "text-status-danger",
                                  (t.event === "retry" || t.event === "sending") && "text-status-warning",
                                )}
                              >
                                {t.event}{t.attempt ? ` #${t.attempt}` : ""}
                              </span>
                              {t.detail && <span className="text-muted-foreground">{t.detail}</span>}
                            </li>
                          ))}
                        </ol>
                        {n.status === "failed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => retryNotification(n.id)}
                            aria-label={`Retry dispatch to ${n.audience} for ${n.packageId}`}
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry dispatch
                          </Button>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  onClick={() => acknowledgeBreach(drawerPin)}
                  aria-label={`Acknowledge SLA breach for ${drawerPin.id}`}
                >
                  <ShieldCheck className="h-4 w-4 mr-1" /> Acknowledge breach
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => dispatchAction(drawerPin, "reassign")}
                  aria-label={`Reassign ${drawerPin.id} to another courier`}
                >
                  <Truck className="h-4 w-4 mr-1" /> Reassign courier
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => dispatchAction(drawerPin, "reroute")}
                  aria-label={`Reroute ${drawerPin.id}`}
                >
                  <MapPin className="h-4 w-4 mr-1" /> Reroute delivery
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => drawerPin && dispatchBreachNotification(drawerPin)}
                  aria-label={`Re-send dispatch notification for ${drawerPin.id}`}
                >
                  <Mail className="h-4 w-4 mr-1" /> Re-notify partner &amp; internal teams
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
