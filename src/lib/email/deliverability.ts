/**
 * Deliverability and reputation data layer.
 *
 * Authority:
 *  - `email_deliverability_daily` RPC: server-side, role-gated daily statistics
 *    deduplicated by message id (bounce / complaint / delivery rates).
 *  - `email_delivery_events`: append-only provider evidence (bounces,
 *    complaints, deliveries) written only by the verified webhook receiver.
 *  - `email_domain_auth_checks`: SPF/DKIM/DMARC readiness snapshots produced by
 *    the `email-domain-auth-check` function.
 */
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";

export interface DeliverabilityDay {
  day: string;
  total: number;
  sent: number;
  failed: number;
  dlq: number;
  bounced: number;
  complained: number;
  suppressed: number;
  bounce_rate: number;
  complaint_rate: number;
  delivery_rate: number;
}

export interface ProviderEventRow {
  id: string;
  provider: string;
  event_type: string;
  recipient_email: string;
  message_id: string | null;
  provider_message_id: string | null;
  bounce_type: string | null;
  reason: string | null;
  signature_verified: boolean;
  occurred_at: string;
}

export interface DomainAuthSnapshot {
  id: string;
  domain: string;
  spf_present: boolean;
  spf_record: string | null;
  dkim_present: boolean;
  dkim_selector: string | null;
  dmarc_present: boolean;
  dmarc_policy: string | null;
  mx_present: boolean;
  readiness_score: number;
  findings: string[];
  checked_at: string;
}

export async function fetchDeliverabilityDaily(days = 30): Promise<DeliverabilityDay[]> {
  const { data, error } = await untypedDb.rpc("email_deliverability_daily", {
    p_days: days,
  });
  if (error) throw error;
  return ((data ?? []) as DeliverabilityDay[]).map((row) => ({
    ...row,
    bounce_rate: Number(row.bounce_rate ?? 0),
    complaint_rate: Number(row.complaint_rate ?? 0),
    delivery_rate: Number(row.delivery_rate ?? 0),
  }));
}

export async function fetchProviderEvents(limit = 100): Promise<ProviderEventRow[]> {
  const { data, error } = await untypedDb
    .from("email_delivery_events")
    .select(
      "id, provider, event_type, recipient_email, message_id, provider_message_id, bounce_type, reason, signature_verified, occurred_at",
    )
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ProviderEventRow[];
}

export async function fetchDomainAuth(limit = 10): Promise<DomainAuthSnapshot[]> {
  const { data, error } = await untypedDb
    .from("email_domain_auth_checks")
    .select("*")
    .order("checked_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as DomainAuthSnapshot[]).map((row) => ({
    ...row,
    findings: Array.isArray(row.findings) ? row.findings : [],
  }));
}

/** Runs a live SPF/DKIM/DMARC probe and stores a new snapshot. */
export async function runDomainAuthCheck(domain?: string): Promise<DomainAuthSnapshot | null> {
  const { data, error } = await supabase.functions.invoke("email-domain-auth-check", {
    body: domain ? { domain } : {},
  });
  if (error) throw error;
  return (data ?? null) as DomainAuthSnapshot | null;
}

/** Reputation posture derived from the last 7 days of deduplicated sends. */
export interface ReputationSummary {
  total: number;
  deliveryRate: number;
  bounceRate: number;
  complaintRate: number;
  posture: "healthy" | "watch" | "at_risk";
  signals: string[];
}

export function summariseReputation(rows: DeliverabilityDay[], windowDays = 7): ReputationSummary {
  const slice = rows.slice(0, windowDays);
  const total = slice.reduce((n, r) => n + Number(r.total), 0);
  const sum = (key: keyof DeliverabilityDay) =>
    slice.reduce((n, r) => n + Number(r[key] ?? 0), 0);
  const rate = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 10000) / 100);

  const bounceRate = rate(sum("bounced"));
  const complaintRate = rate(sum("complained"));
  const deliveryRate = rate(sum("sent"));

  const signals: string[] = [];
  // Industry thresholds: bounces above 5% and complaints above 0.1% harm reputation.
  if (bounceRate >= 5) signals.push(`Bounce rate ${bounceRate}% exceeds the 5% safety threshold.`);
  else if (bounceRate >= 2) signals.push(`Bounce rate ${bounceRate}% is elevated (watch above 2%).`);
  if (complaintRate >= 0.3) signals.push(`Complaint rate ${complaintRate}% is critical (limit 0.1%).`);
  else if (complaintRate > 0.1) signals.push(`Complaint rate ${complaintRate}% exceeds the 0.1% target.`);
  if (total > 0 && deliveryRate < 90) signals.push(`Delivery rate ${deliveryRate}% is below 90%.`);
  if (total === 0) signals.push("No sends in the window — reputation cannot be assessed.");

  const posture: ReputationSummary["posture"] =
    bounceRate >= 5 || complaintRate >= 0.3 || (total > 0 && deliveryRate < 85)
      ? "at_risk"
      : bounceRate >= 2 || complaintRate > 0.1 || (total > 0 && deliveryRate < 95)
        ? "watch"
        : "healthy";

  return { total, deliveryRate, bounceRate, complaintRate, posture, signals };
}
