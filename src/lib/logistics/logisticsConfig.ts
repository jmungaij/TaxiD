/**
 * Delivery & Logistics domain model, SLA config and persistence helpers.
 * Extracted from the Stage 6 workspace composition so the composition file
 * remains a pure presentation layer (Wave Gate v1.0.0-frozen contract).
 */
export type ServiceType = "express" | "standard" | "bulk";

export type DeliveryPin = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  status: "en_route" | "idle" | "incident";
  sla: number;
  region: string;
  courier: string;
  partner: string;
  serviceType: ServiceType;
  updatedAt: number;
};

export type AuditEntry = {
  id: string;
  ts: number;
  actor: string;
  action: string;
  target: string;
  detail?: string;
};

export type NotifyChannel = "email" | "sms" | "push";

export type DispatchAttempt = {
  ts: number;
  attempt: number;
  event: "queued" | "sending" | "delivered" | "failed" | "retry";
  detail?: string;
};

export type LogisticsNotification = {
  id: string;
  ts: number;
  packageId: string;
  channels: NotifyChannel[];
  audience: string;
  status: "queued" | "sending" | "delivered" | "failed";
  attempts: number;
  lastError?: string;
  acknowledged: boolean;
  timeline: DispatchAttempt[];
};

/** Scheduled audit-log export with saved filters, emailed automatically. */
export type ExportSchedule = {
  id: string;
  name: string;
  cadence: "daily" | "weekly" | "monthly";
  format: "csv" | "pdf";
  recipients: string;
  partner: string;
  order: string;
  from: string;
  to: string;
  lastRunAt?: number;
};

export const NOW = Date.now();
export const SEED_PINS: DeliveryPin[] = [
  { id: "PKG-1042", label: "PKG-1042 · Westlands",  lat: -1.2647, lng: 36.8028, status: "en_route", sla: 96, region: "Nairobi",  courier: "Otieno J.",  partner: "Sendy Logistics",   serviceType: "express",  updatedAt: NOW -  5 * 60_000 },
  { id: "PKG-1043", label: "PKG-1043 · CBD",        lat: -1.2864, lng: 36.8172, status: "en_route", sla: 88, region: "Nairobi",  courier: "Wambui A.",  partner: "Sendy Logistics",   serviceType: "express",  updatedAt: NOW - 15 * 60_000 },
  { id: "PKG-1044", label: "PKG-1044 · Karen",      lat: -1.3197, lng: 36.7076, status: "idle",     sla: 74, region: "Nairobi",  courier: "Kariuki P.", partner: "Nairobi Express Co", serviceType: "standard", updatedAt: NOW - 25 * 60_000 },
  { id: "PKG-1045", label: "PKG-1045 · Kilimani",   lat: -1.2921, lng: 36.7828, status: "incident", sla: 41, region: "Nairobi",  courier: "Njeri M.",   partner: "Nairobi Express Co", serviceType: "standard", updatedAt: NOW - 35 * 60_000 },
  { id: "PKG-1046", label: "PKG-1046 · Mombasa Rd", lat: -1.3308, lng: 36.8933, status: "en_route", sla: 92, region: "Nairobi",  courier: "Omondi K.",  partner: "Rift Freight Ltd",   serviceType: "bulk",     updatedAt: NOW - 45 * 60_000 },
  { id: "PKG-1047", label: "PKG-1047 · Thika",      lat: -1.0332, lng: 37.0692, status: "idle",     sla: 66, region: "Central",  courier: "Achieng L.", partner: "Rift Freight Ltd",   serviceType: "bulk",     updatedAt: NOW - 55 * 60_000 },
];

export const SERVICE_TYPES: ServiceType[] = ["express", "standard", "bulk"];
export const SERVICE_LABEL: Record<ServiceType, string> = {
  express: "Express (same-day)",
  standard: "Standard (next-day)",
  bulk: "Bulk / freight",
};
/** Default per-service-type SLA breach thresholds (%). Operator-configurable. */
export const DEFAULT_THRESHOLDS: Record<ServiceType, number> = { express: 90, standard: 75, bulk: 60 };
export const THRESHOLD_STORAGE_KEY = "yeos.logistics.slaThresholds.v1";
export const PREFS_STORAGE_KEY = "yeos.logistics.notifyPrefs.v1";
export const SCHEDULES_STORAGE_KEY = "yeos.logistics.auditExportSchedules.v1";

/** Audience rows for notification preferences: partners + internal teams. */
export const INTERNAL_TEAMS = ["Internal · Dispatch", "Internal · NOC"];
export const NOTIFY_CHANNELS: NotifyChannel[] = ["email", "sms", "push"];
export const DEFAULT_PREF: Record<NotifyChannel, boolean> = { email: true, sms: false, push: false };

export const prefKey = (audience: string, svc: ServiceType) => `${audience}|${svc}`;

export type NotifyPrefs = Record<string, Record<NotifyChannel, boolean>>;

export function loadThresholds(): Record<ServiceType, number> {
  try {
    const raw = localStorage.getItem(THRESHOLD_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THRESHOLDS };
    const parsed = JSON.parse(raw) as Partial<Record<ServiceType, number>>;
    return {
      express: Number(parsed.express ?? DEFAULT_THRESHOLDS.express),
      standard: Number(parsed.standard ?? DEFAULT_THRESHOLDS.standard),
      bulk: Number(parsed.bulk ?? DEFAULT_THRESHOLDS.bulk),
    };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function persistJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* non-fatal */ }
}


export const STATUS_STYLE: Record<DeliveryPin["status"], { color: string; label: string }> = {
  en_route: { color: "hsl(var(--map-route))",    label: "En route" },
  idle:     { color: "hsl(var(--map-idle))",     label: "Idle" },
  incident: { color: "hsl(var(--map-incident))", label: "Incident" },
};



/** Aliases so consumers avoid inline generic type expressions. */
export type ServiceThresholds = Record<ServiceType, number>;
export type ChannelPrefs = Record<NotifyChannel, boolean>;
export type PinStatus = DeliveryPin["status"];
export type PinStatusFilter = PinStatus | "all";
export type ExportCadence = ExportSchedule["cadence"];
export type ExportFormat = ExportSchedule["format"];

/** Resolve a design-token color to a concrete CSS color for canvas/map APIs. */
export function tokenColor(varName: string, fallback = "hsl(0 0% 100%)"): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return raw ? `hsl(${raw})` : fallback;
  } catch {
    return fallback;
  }
}
