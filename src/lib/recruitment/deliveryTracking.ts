/**
 * Recruitment 360 — appointment letter & onboarding document delivery tracking
 * (client surface).
 *
 * Reads are RLS-filtered; every transition is owned by the `rec-doc-delivery`
 * edge function, which in turn only calls governed database routines. Nothing
 * here writes a delivery lifecycle column.
 */
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type DeliveryState = "pending" | "sent" | "delivered" | "read" | "signed" | "failed";

export interface DocDelivery {
  id: string;
  request_id: string | null;
  document_id: string | null;
  kind: string;
  candidate_id: string | null;
  application_id: string | null;
  onboarding_case_id: string | null;
  channel: string;
  recipient_email: string;
  recipient_name: string;
  requires_signature: boolean;
  state: DeliveryState | string;
  sent_by: string | null;
  sent_at: string | null;
  provider: string | null;
  provider_message_id: string | null;
  delivered_at: string | null;
  first_read_at: string | null;
  last_read_at: string | null;
  read_count: number;
  signed_at: string | null;
  signed_by_name: string | null;
  signature_hash: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface DeliveryEvent {
  id: string;
  delivery_id: string;
  seq: number;
  event_type: string;
  actor_id: string | null;
  actor_label: string;
  detail: Record<string, unknown>;
  occurred_at: string;
  prev_hash: string;
  hash: string;
}

export const DELIVERY_STATE_LABEL: Record<string, string> = {
  pending: "Registered",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read by candidate",
  signed: "Signed",
  failed: "Failed",
};

/** The ladder a delivery climbs — never regresses. */
export const DELIVERY_LADDER: DeliveryState[] = ["pending", "sent", "delivered", "read", "signed"];

export function deliveryProgress(state: string): number {
  const index = DELIVERY_LADDER.indexOf(state as DeliveryState);
  return index < 0 ? 0 : Math.round(((index + 1) / DELIVERY_LADDER.length) * 100);
}

/* --------------------------------- reads -------------------------------- */

export async function listDeliveries(limit = 200): Promise<DocDelivery[]> {
  const { data, error } = await db.from("rec_doc_deliveries").select("*")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as DocDelivery[];
}

export async function listDeliveryEvents(deliveryId: string): Promise<DeliveryEvent[]> {
  const { data, error } = await db.from("rec_doc_delivery_events").select("*")
    .eq("delivery_id", deliveryId).order("seq", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DeliveryEvent[];
}

/** Server-side recomputation of the audit hash chain — the client never judges. */
export async function verifyDeliveryChain(deliveryId: string) {
  const { data, error } = await db.rpc("rec_delivery_chain_verify", { _delivery_id: deliveryId });
  if (error) throw new Error(error.message);
  return data as { delivery_id: string; events: number; chain_intact: boolean };
}

/* ------------------------------ transitions ----------------------------- */

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("rec-doc-delivery", { body });
  if (error) {
    const detail = (data as { error?: string } | null)?.error;
    throw new Error(detail ?? error.message);
  }
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

/** Emails the sealed document to the candidate and starts the delivery trail. */
export function sendDocument(requestId: string, requiresSignature?: boolean) {
  return invoke<{ delivery_id: string; state: string; requires_signature: boolean }>({
    action: "send",
    request_id: requestId,
    ...(typeof requiresSignature === "boolean" ? { requires_signature: requiresSignature } : {}),
  });
}

/** Records the provider's delivery confirmation — the only route to DELIVERED. */
export function confirmDelivered(input: { delivery_id?: string; provider_message_id?: string }) {
  return invoke<{ delivery_id: string; state: string }>({ action: "confirm", ...input });
}

/* --------------------------- candidate surfaces ------------------------- */

export interface AcknowledgementContext {
  valid: boolean;
  reason?: string;
  kind?: string;
  candidate_name?: string | null;
  document_ref?: string | null;
  already_signed?: boolean;
  signed_at?: string | null;
  state?: string;
}

export function inspectAcknowledgement(token: string) {
  return invoke<AcknowledgementContext>({ action: "inspect", token });
}

export function acknowledgeDocument(token: string, signerName: string, note?: string) {
  return invoke<{ delivery_id: string; state: string; already_signed?: boolean }>({
    action: "acknowledge",
    token,
    signer_name: signerName,
    note: note ?? null,
  });
}

/* ------------------------------- analytics ------------------------------ */

export interface DeliveryHealth {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  signed: number;
  failed: number;
  awaiting_signature: number;
  read_rate: number;
  signature_rate: number;
}

export function deliveryHealth(rows: DocDelivery[]): DeliveryHealth {
  const at = (s: string) => rows.filter((r) => r.state === s).length;
  const reached = (s: DeliveryState) =>
    rows.filter((r) => DELIVERY_LADDER.indexOf(r.state as DeliveryState) >= DELIVERY_LADDER.indexOf(s)).length;
  const issued = rows.filter((r) => r.state !== "pending" && r.state !== "failed").length;
  const signatureScope = rows.filter((r) => r.requires_signature).length;
  return {
    total: rows.length,
    sent: at("sent"),
    delivered: at("delivered"),
    read: at("read"),
    signed: at("signed"),
    failed: at("failed"),
    awaiting_signature: rows.filter((r) => r.requires_signature && !r.signed_at && r.state !== "failed").length,
    read_rate: issued ? Math.round((reached("read") / issued) * 100) : 0,
    signature_rate: signatureScope ? Math.round((at("signed") / signatureScope) * 100) : 0,
  };
}
