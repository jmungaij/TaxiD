/**
 * Public projection of live logistics serviceability.
 *
 * `logistics_service_config` is the activation record the operations desk
 * maintains: it decides whether an offering may be booked by a customer
 * (`BOOKABLE`), must be quoted by a person (`ENQUIRY_ONLY`) or is not offered
 * at all. The public page renders that record — it never hard-codes a service
 * as available, so the website and the platform cannot drift apart.
 *
 * Operating limits, SLA targets and service names come from the frozen service
 * catalogue; coverage, hours, evidence requirements and the returns, claims and
 * restricted-goods policies come from the live record.
 */
import { supabase } from "@/integrations/supabase/client";
import { offering, type ServiceOffering } from "@/lib/logistics/domain/serviceCatalogue";

export type PublicLifecycle = "BOOKABLE" | "ENQUIRY_ONLY";

export interface PublicOfferingHours {
  days: number[];
  start: string;
  end: string;
}

export interface PublicOffering {
  code: string;
  name: string;
  description: string;
  lifecycle: PublicLifecycle;
  selfServiceBooking: boolean;
  enquiryEnabled: boolean;
  partnerEligibilityRequired: boolean;
  serviceAreas: string[];
  hours: PublicOfferingHours | null;
  podRequired: string[];
  returnsPolicy: string | null;
  claimsPolicy: string | null;
  restrictedGoodsPolicy: string | null;
  lastVerifiedAt: string | null;
  /** Catalogue facts, present when the offering exists in the frozen catalogue. */
  weightLimitKg: { min: number; max: number } | null;
  slaTarget: string | null;
  slaQualifier: string | null;
  /** Where the customer continues: booking journey or the enquiry desk. */
  actionHref: string;
  actionLabel: string;
}

const PUBLIC_COLUMNS =
  "offering_code, lifecycle, self_service_booking, enquiry_enabled, partner_eligibility_required, service_areas, operating_hours, pod_required, returns_policy, claims_policy, restricted_goods_policy, last_verified_at";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon–Sat, 07:00–20:00" from the activation record's operating hours. */
export function formatHours(hours: PublicOfferingHours | null): string | null {
  if (!hours?.days?.length) return null;
  const sorted = [...hours.days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  const label = contiguous && sorted.length > 1
    ? `${DAY_NAMES[sorted[0] % 7]}–${DAY_NAMES[sorted[sorted.length - 1] % 7]}`
    : sorted.map((d) => DAY_NAMES[d % 7]).join(", ");
  return `${label}, ${hours.start}–${hours.end}`;
}

const POD_LABEL: Record<string, string> = {
  PHOTO: "Delivery photograph",
  SIGNATURE: "Recipient signature",
  RECIPIENT_ID: "Recipient identity check",
  PIN: "One-time delivery PIN",
  BARCODE: "Barcode scan",
  PHOTO_SIGNATURE: "Photograph and signature",
};

export const podLabel = (code: string): string => POD_LABEL[code] ?? code.replace(/_/g, " ").toLowerCase();

function slaTarget(o: ServiceOffering | undefined): string | null {
  if (!o?.sla) return null;
  const parts: string[] = [];
  if (o.sla.pickupTargetMinutes) parts.push(`pickup within ${o.sla.pickupTargetMinutes} minutes`);
  if (o.sla.deliveryTargetHours) parts.push(`delivery within ${o.sla.deliveryTargetHours} hours`);
  return parts.length ? parts.join(", ") : null;
}

function action(code: string, lifecycle: PublicLifecycle, selfService: boolean, o?: ServiceOffering) {
  if (lifecycle === "BOOKABLE" && selfService) {
    const route = o?.presentationRoutes?.[0] ?? "/delivery/package";
    return { actionHref: route, actionLabel: "Book this service" };
  }
  return {
    actionHref: `/delivery/enquiry?topic=${encodeURIComponent(code)}`,
    actionLabel: "Request a quotation",
  };
}

/**
 * Publishable offerings, bookable services first. Returns an empty list when
 * the projection cannot be read — the page then states that availability is
 * confirmed by the operations desk rather than guessing.
 */
export async function fetchPublicOfferings(): Promise<PublicOffering[]> {
  const { data, error } = await supabase
    .from("logistics_service_config")
    .select(PUBLIC_COLUMNS)
    .in("lifecycle", ["BOOKABLE", "ENQUIRY_ONLY"]);

  if (error || !data) return [];

  const rows = data.map((r) => {
    const code = String(r.offering_code);
    const cat = offering(code);
    const lifecycle = r.lifecycle as PublicLifecycle;
    const selfService = Boolean(r.self_service_booking);
    const hours = (r.operating_hours ?? null) as unknown as PublicOfferingHours | null;

    return {
      code,
      name: cat?.name ?? code.replace(/_/g, " ").toLowerCase(),
      description: cat?.description ?? "",
      lifecycle,
      selfServiceBooking: selfService,
      enquiryEnabled: Boolean(r.enquiry_enabled),
      partnerEligibilityRequired: Boolean(r.partner_eligibility_required),
      serviceAreas: (r.service_areas ?? []) as string[],
      hours,
      podRequired: (r.pod_required ?? []) as string[],
      returnsPolicy: r.returns_policy ?? null,
      claimsPolicy: r.claims_policy ?? null,
      restrictedGoodsPolicy: r.restricted_goods_policy ?? null,
      lastVerifiedAt: r.last_verified_at ?? null,
      weightLimitKg: cat?.weightLimitKg ?? null,
      slaTarget: slaTarget(cat),
      slaQualifier: cat?.sla?.qualifier ?? null,
      ...action(code, lifecycle, selfService, cat),
    } satisfies PublicOffering;
  });

  return rows.sort((a, b) => {
    if (a.lifecycle !== b.lifecycle) return a.lifecycle === "BOOKABLE" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
