/**
 * Customer lifecycle notifications for charter operations.
 *
 * One recipient, one event, one email: payment confirmed, ticket issued and
 * documents ready. Terminology comes from the asset domain so a bus customer
 * never receives aviation wording.
 */
import { supabase } from "@/integrations/supabase/client";
import { domainLexicon } from "./assetDomains";
import type { CharterBookingRow } from "./api";

export type CharterLifecycleEvent = "payment_confirmed" | "ticket_issued" | "documents_ready";

const NOTE: Record<CharterLifecycleEvent, string> = {
  payment_confirmed: "Payment confirmed — your booking is fully secured.",
  ticket_issued: "Your ticket has been issued with your assigned seats.",
  documents_ready: "Your receipt and tax invoice are ready to download.",
};

/** Sends a lifecycle email for a booking. Resolves false when it could not send. */
export async function sendCharterLifecycleEmail(
  booking: CharterBookingRow,
  event: CharterLifecycleEvent,
  recipientEmail?: string,
): Promise<boolean> {
  const trip0 = (booking.trip ?? {}) as Record<string, unknown>;
  const lead = (booking.passengers ?? [])[0] ?? {};
  const to =
    recipientEmail ||
    (typeof trip0.contact_email === "string" ? trip0.contact_email : undefined) ||
    lead.email;
  if (!to) return false;
  const lex = domainLexicon(booking.category_slug);
  const trip = (booking.trip ?? {}) as Record<string, string>;
  try {
    const { error } = await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "charter-booking-confirmation",
        recipientEmail: to,
        idempotencyKey: `charter-${event}-${booking.id}`,
        templateData: {
          contactName: (typeof trip0.contact_name === "string" ? trip0.contact_name : lead.name) ?? "there",
          reference: booking.reference,
          assetName: booking.asset_name,
          categoryLabel: lex.brandName,
          origin: trip.origin ?? "—",
          destination: trip.destination ?? "—",
          departureDate: trip.date ?? "—",
          passengers: String((booking.passengers ?? []).length || 1),
          amount: new Intl.NumberFormat("en-KE").format(Math.round(booking.amount || 0)),
          currency: booking.currency ?? "KES",
          paymentMethod: booking.payment_method ?? "mpesa",
          paymentStatus: booking.payment_status ?? "pending",
          itineraryNote: NOTE[event],
        },
      },
    });
    return !error;
  } catch {
    return false;
  }
}
