/**
 * Client transport for the enquiry-only logistics services.
 *
 * Topics, required facts, response windows and the reason a service is quoted
 * by a person all come from the server. The page never hardcodes them, so the
 * public promise and the platform's behaviour cannot drift apart.
 */
import { supabase } from "@/integrations/supabase/client";

export type ShipmentFrequency = "ONE_OFF" | "WEEKLY" | "MONTHLY" | "CONTRACT";

export interface EnquiryTopic {
  code: string;
  label: string;
  summary: string;
  why_enquiry: string;
  requires: { weight: boolean; volume: boolean; targetDate: boolean };
  response_hours: number;
  cargo_hint: string;
}

export interface EnquiryFacts {
  topic_code: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string | null;
  company_name?: string | null;
  origin_label: string;
  destination_label: string;
  cargo_description: string;
  weight_kg?: number | null;
  volume_cbm?: number | null;
  shipment_frequency: ShipmentFrequency;
  target_date?: string | null;
  budget_amount?: number | null;
  requirements?: string | null;
  source_page?: string | null;
  website?: string;
  elapsed_ms?: number;
}

export interface EnquiryReceipt {
  recorded: true;
  reference: string;
  status: string;
  respond_by: string;
  response_hours: number;
  service: string;
  desk_notified: boolean;
  contact: { phone: string; email: string };
  correlation_id: string;
}

export type EnquiryOutcome =
  | { ok: true; receipt: EnquiryReceipt }
  | {
      ok: false;
      error: string;
      message: string;
      fields?: Record<string, string[]>;
      missing?: string[];
      correlationId?: string;
    };

const FN = "logistics-enquiry";

/** Read the accepted enquiry topics. */
export async function fetchEnquiryTopics(): Promise<{
  topics: EnquiryTopic[];
  frequencies: ShipmentFrequency[];
}> {
  const { data, error } = await supabase.functions.invoke(FN, { method: "GET" });
  if (error) throw new Error(error.message);
  return {
    topics: (data?.topics ?? []) as EnquiryTopic[],
    frequencies: (data?.frequencies ?? ["ONE_OFF"]) as ShipmentFrequency[],
  };
}

const FRIENDLY: Record<string, string> = {
  validation_failed: "Some details still need correcting before we can record this.",
  missing_required_facts: "We need a little more detail before the desk can quote this.",
  unknown_topic: "That service is not handled as an enquiry.",
  rate_limited: "Too many enquiries from this connection. Please call us instead.",
  enquiry_not_recorded: "We could not record your enquiry. Please call or email us so nothing is lost.",
};

/**
 * Submit an enquiry. Only a committed server record returns ok:true — a failed
 * hand-off is surfaced, never presented as a successful submission.
 */
export async function submitEnquiry(facts: EnquiryFacts): Promise<EnquiryOutcome> {
  const { data, error } = await supabase.functions.invoke(FN, { body: facts });

  if (error) {
    let payload: Record<string, unknown> = {};
    const ctx = (error as { context?: { text?: () => Promise<string> } }).context;
    if (ctx?.text) {
      try {
        payload = JSON.parse(await ctx.text());
      } catch {
        /* non-JSON error body */
      }
    }
    const code = String(payload.error ?? "request_failed");
    return {
      ok: false,
      error: code,
      message: String(payload.message ?? FRIENDLY[code] ?? error.message),
      fields: payload.fields as Record<string, string[]> | undefined,
      missing: payload.missing as string[] | undefined,
      correlationId: payload.correlation_id as string | undefined,
    };
  }

  if (!data?.recorded) {
    const code = String(data?.error ?? "request_failed");
    return {
      ok: false,
      error: code,
      message: String(data?.message ?? FRIENDLY[code] ?? "The enquiry was not recorded."),
      fields: data?.fields,
      missing: data?.missing,
      correlationId: data?.correlation_id,
    };
  }

  return { ok: true, receipt: data as EnquiryReceipt };
}

export const FREQUENCY_LABELS: Record<ShipmentFrequency, string> = {
  ONE_OFF: "One-off shipment",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  CONTRACT: "Contracted programme",
};

/** Map a server missing-fact code to the field label the customer sees. */
export const MISSING_FACT_LABELS: Record<string, string> = {
  weight_kg: "Total weight",
  volume_cbm: "Volume",
  target_date: "Target date",
};
