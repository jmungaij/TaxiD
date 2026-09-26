/**
 * QUALIFY A LEAD AND OPEN IT AS A REAL DEAL, IN ONE STEP.
 *
 * A deal is only created when the specialist states a value they can stand
 * behind and the reason the customer is qualified. The database refuses a second
 * deal for the same lead, so the button can never double-count the pipeline.
 */
import { supabase } from "@/integrations/supabase/client";

export type QualifiedDeal = {
  lead_id: string;
  opportunity_id: string;
  opportunity_ref?: string;
  estimated_value_kes?: number;
  idempotent?: boolean;
};

export async function qualifyAndOpenDeal(input: {
  leadId: string;
  estimatedValueKes: number;
  note: string;
}): Promise<QualifiedDeal> {
  const { data, error } = await supabase.rpc("sales_lead_qualify_open_deal", {
    p: {
      lead_id: input.leadId,
      estimated_value_kes: input.estimatedValueKes,
      note: input.note,
    },
  });
  if (error) throw error;
  return data as unknown as QualifiedDeal;
}

export function qualifyRefusal(code: string): string {
  if (code.includes("VALUE_REQUIRED")) return "State the value you can stand behind before opening the deal.";
  if (code.includes("QUALIFICATION_NOTE_REQUIRED")) return "Write what qualified this customer — a few words at least.";
  if (code.includes("LEAD_ALREADY_CLOSED")) return "This lead is already closed, so it cannot become a deal.";
  if (code.includes("LEAD_NOT_YOURS")) return "This lead belongs to another specialist.";
  return code;
}
