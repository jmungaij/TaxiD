import { supabase } from '@/integrations/supabase/client';
import type {
  TrustCase, TrustIncident, TrustWatchlistEntry,
  PackageCustodyEvent, PackageTamperAlert,
  TrustCategory, TrustSeverity, TrustStatus, TrustSubjectType,
  TrustResolutionOutcome,
} from './types';
import { TRUST_SLA_HOURS } from './types';

export async function listTrustCases(filters: { status?: TrustStatus; severity?: TrustSeverity } = {}) {
  let q = supabase.from('trust_cases').select('*').order('created_at', { ascending: false }).limit(200);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.severity) q = q.eq('severity', filters.severity);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as TrustCase[];
}

export async function createTrustCase(input: {
  category: TrustCategory;
  severity: TrustSeverity;
  subject_type: TrustSubjectType;
  subject_id?: string | null;
  title: string;
  summary?: string;
  tags?: string[];
}) {
  const slaHours = TRUST_SLA_HOURS[input.severity];
  const sla_due_at = new Date(Date.now() + slaHours * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('trust_cases')
    .insert({ ...input, sla_due_at, opened_by: (await supabase.auth.getUser()).data.user?.id ?? null })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as TrustCase;
}

export async function updateTrustCase(id: string, patch: Partial<Pick<TrustCase,
  'status' | 'severity' | 'assigned_to' | 'summary' | 'tags'
>>) {
  const { data, error } = await supabase.from('trust_cases').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as unknown as TrustCase;
}

export async function listIncidentsForCase(caseId: string) {
  const { data, error } = await supabase
    .from('trust_incidents').select('*').eq('case_id', caseId).order('occurred_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as TrustIncident[];
}

export async function recordIncident(input: Omit<TrustIncident,
  'id' | 'created_at' | 'routed_at' | 'evidence_refs' | 'metadata'
> & { evidence_refs?: unknown[]; metadata?: Record<string, unknown> }) {
  const { data, error } = await supabase.from('trust_incidents').insert({
    ...input,
    evidence_refs: (input.evidence_refs ?? []) as never,
    metadata: (input.metadata ?? {}) as never,
  }).select().single();
  if (error) throw error;
  return data as unknown as TrustIncident;
}

export async function listWatchlist(active = true) {
  const { data, error } = await supabase
    .from('trust_watchlists').select('*').eq('active', active).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as TrustWatchlistEntry[];
}

export async function addToWatchlist(input: {
  subject_type: TrustSubjectType;
  subject_id?: string | null;
  subject_value?: string | null;
  risk_level: TrustSeverity;
  reason: string;
  expires_at?: string | null;
}) {
  const { data, error } = await supabase.from('trust_watchlists').insert(input).select().single();
  if (error) throw error;
  return data as unknown as TrustWatchlistEntry;
}

export async function deactivateWatchlistEntry(id: string) {
  const { error } = await supabase.from('trust_watchlists').update({ active: false }).eq('id', id);
  if (error) throw error;
}

/** Statuses after which a case must not be re-decided. */
export const TERMINAL_TRUST_STATUSES = ['resolved', 'closed'] as const;

export function isTerminalTrustStatus(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_TRUST_STATUSES as readonly string[]).includes(status);
}

export class TrustConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'TrustConflictError'; }
}

export async function resolveCase(input: {
  case_id: string;
  outcome: TrustResolutionOutcome;
  notes?: string;
  refund_amount?: number;
  refund_currency?: string;
}) {
  // Optimistic guard: a case already resolved/closed must not be re-decided.
  const { data: guard, error: guardErr } = await supabase.from('trust_cases')
    .select('id, status').eq('id', input.case_id).maybeSingle();
  if (guardErr) throw guardErr;
  if (!guard) throw new TrustConflictError('Case no longer exists.');
  if (isTerminalTrustStatus((guard as { status: string }).status)) {
    throw new TrustConflictError('This case was already resolved by another reviewer. Refresh to see the current decision.');
  }
  const { data, error } = await supabase.from('trust_resolutions').upsert({
    case_id: input.case_id,
    outcome: input.outcome,
    notes: input.notes ?? null,
    refund_amount: input.refund_amount ?? null,
    refund_currency: input.refund_currency ?? 'KES',
    decided_by: (await supabase.auth.getUser()).data.user?.id ?? null,
  }, { onConflict: 'case_id' }).select().single();
  if (error) throw error;
  const { data: closed, error: closeErr } = await supabase.from('trust_cases')
    .update({ status: 'resolved', closed_at: new Date().toISOString() })
    .eq('id', input.case_id)
    .not('status', 'in', '(resolved,closed)')
    .select('id');
  if (closeErr) throw closeErr;
  if (!closed || closed.length === 0) {
    throw new TrustConflictError('Resolution recorded, but the case was closed concurrently. Refresh to review.');
  }
  return data;
}

export async function packageCustodyTimeline(packageId: string) {
  const { data, error } = await supabase
    .from('package_chain_of_custody')
    .select('*')
    .eq('package_id', packageId)
    .order('occurred_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as PackageCustodyEvent[];
}

export async function listTamperAlerts(unackOnly = true) {
  let q = supabase.from('package_tamper_alerts').select('*').order('detected_at', { ascending: false }).limit(100);
  if (unackOnly) q = q.is('acknowledged_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as PackageTamperAlert[];
}

export async function ackTamperAlert(id: string) {
  const { data, error } = await supabase.from('package_tamper_alerts')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: (await supabase.auth.getUser()).data.user?.id ?? null })
    .eq('id', id)
    .is('acknowledged_at', null)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new TrustConflictError('This tamper alert was already acknowledged.');
  }
}
