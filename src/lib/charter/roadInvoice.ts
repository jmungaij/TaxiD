/**
 * Road charter invoice & itinerary confirmation document.
 *
 * Wraps the shared forensic invoice renderer (`charterInvoicePdf`) with the
 * simplified three-line road fare — booking fee, night/Sunday surcharge and
 * platform commission — plus the journey itinerary (stops, coordinates,
 * departure) and a red UNPAID stamp until the booking is settled.
 */
import { charterApi } from "./api";
import { documentQrSeal } from "./documentQr";
import {
  buildCharterInvoicePdf,
  type CharterInvoiceInput,
  type InvoicePriceView,
} from "./charterInvoicePdf";
import {
  ROAD_SURCHARGE_MULTIPLIER,
  type RoadFare,
} from "./roadFare";
import { marketplaceServiceLabel, marketplaceServiceReason } from "./marketplaceService";
import { documentStatusBadge, resolveDocumentTitle } from "./documentTitles";

import { isRoadUnpaid, roadPaymentLabel } from "./roadPayment";

export interface RoadItineraryPoint {
  label: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
}

export interface RoadInvoiceInput {
  reference: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  vehicle: string;
  passengers: number;
  departAt?: string;
  returnAt?: string | null;
  fare: RoadFare;
  points: RoadItineraryPoint[];
  notes?: string | null;
  paymentStatus?: string | null;
  paymentMethod?: string;
  mpesaReceipt?: string | null;
}

const coord = (p: RoadItineraryPoint) =>
  p.lat != null && p.lng != null
    ? `lat ${p.lat.toFixed(5)}, lng ${p.lng.toFixed(5)}`
    : "coordinates pending confirmation";

/** Route summary used in headings, emails and share text. */
export function roadRouteLabel(points: RoadItineraryPoint[]): string {
  const named = points.filter((p) => p.address.trim());
  if (!named.length) return "Route to be confirmed";
  return named.map((p) => p.address).join("  →  ");
}

/** The three presentation lines, as an invoice-ready price view. */
export function roadInvoicePrice(fare: RoadFare, passengers: number): InvoicePriceView {
  const lines: InvoicePriceView["lines"] = [
    {
      label: "Mission base price (vehicle, fuel, driver & co-driver)",
      amountKes: fare.bookingFee,
      reason: "Covers the vehicle, fuel and the driver & co-driver for the requested journey.",
    },
    {
      label: `Night & Sunday surcharge (x${ROAD_SURCHARGE_MULTIPLIER})`,
      amountKes: fare.surcharge,
      reason: fare.surchargeApplies
        ? "Applied because this vehicle departs at night (20:00-06:00) or on a Sunday."
        : "Not applicable - this departure is outside the night and Sunday window.",
    },
    {
      label: marketplaceServiceLabel(fare.servicePct),
      amountKes: fare.commission,
      reason: marketplaceServiceReason(),
    },
  ];
  return {
    lines,
    taxableKes: fare.total,
    taxKes: 0,
    vatPct: 0,
    perSeatKes: Math.round(fare.total / Math.max(1, passengers)),
    totalKes: fare.total,
    invoiceMonthly: false,
  };
}

export function roadItineraryLines(input: RoadInvoiceInput): string[] {
  const rows = input.points
    .filter((p) => p.address.trim())
    .map((p, i) => `${i + 1}. ${p.label}: ${p.address} · ${coord(p)}`);
  if (input.departAt) {
    rows.push(`Departure: ${new Date(input.departAt).toLocaleString("en-KE")}`);
  }
  if (input.returnAt) {
    rows.push(`Return: ${new Date(input.returnAt).toLocaleString("en-KE")}`);
  }
  rows.push(`Vehicle: ${input.vehicle} · ${input.passengers} passenger${input.passengers === 1 ? "" : "s"}`);
  if (input.notes?.trim()) rows.push(`Journey notes: ${input.notes.trim()}`);
  return rows;
}

export function buildRoadInvoiceInput(input: RoadInvoiceInput): CharterInvoiceInput {
  const unpaid = isRoadUnpaid(input.paymentStatus);
  const title = resolveDocumentTitle({
    paymentStatus: input.paymentStatus,
    quoteOnly: !input.paymentStatus,
    corporate: input.paymentMethod === "corporate_wallet",
  });
  return {
    reference: input.reference,
    kind: unpaid ? "invoice" : "receipt",
    documentTitle: title.title,
    documentSubtitle: title.subtitle,
    documentNumberPrefix: title.numberPrefix,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail,
    route: roadRouteLabel(input.points),
    departAt: input.departAt,
    vehicle: input.vehicle,
    passengers: input.passengers,
    price: roadInvoicePrice(input.fare, input.passengers),
    itinerary: roadItineraryLines(input),
    unpaidNotice: unpaid
      ? `${documentStatusBadge(input.paymentStatus).toUpperCase()} — ${roadPaymentLabel(input.paymentStatus).toUpperCase()}`
      : undefined,
    paymentMethod: input.paymentMethod,
    mpesaReceipt: input.mpesaReceipt,
    templateVersion: "road-v2",
  };
}


/**
 * Builds, registers and downloads the road invoice & itinerary confirmation.
 *
 * The document is registered *before* rendering so the encrypted QR payload
 * returned by the registry can be embedded as a real QR image in the dossier.
 * Registration is best-effort: without it the document still prints, carrying
 * the control number and a verification URL QR instead.
 */
export async function downloadRoadInvoicePdf(
  input: RoadInvoiceInput,
  bookingId?: string,
  /** Procurement metadata + approving authority stamped onto the registry. */
  procurement?: {
    organization_name?: string; approver_name?: string; approver_title?: string;
    cost_center?: string; purchase_order?: string | null; invoice_schedule?: string;
  },
): Promise<{ fileName: string; controlNumber: string; fingerprint: string }> {
  const invoiceInput = buildRoadInvoiceInput(input);
  const kind = invoiceInput.kind ?? "invoice";
  const fileName = `yalla-road-${kind}-itinerary-${input.reference}.pdf`;
  const { fingerprint, controlNumber } = await roadInvoiceSeal(invoiceInput);

  let qrPayload: string | null = null;
  let verifyUrl: string | null = `${window.location.origin}/verify?control=${encodeURIComponent(controlNumber)}`;
  try {
    const registered = await charterApi.registerDocument({
      control_number: controlNumber,
      fingerprint,
      template_version: invoiceInput.templateVersion ?? "road-v1",
      reference: input.reference,
      booking_id: bookingId,
      document_kind: `road-${kind}`,
      file_name: fileName,
      amount_kes: input.fare.total,
      approver_name: procurement?.approver_name || undefined,
      approver_title: procurement?.approver_title || undefined,
      procurement: procurement as Record<string, unknown> | undefined,
    });
    qrPayload = registered.qr_payload ?? null;
    verifyUrl = registered.verify_url ?? verifyUrl;
  } catch {
    // Non-fatal: the printed control number still verifies once synced.
  }

  const seal = await documentQrSeal({ qrPayload, verifyUrl });
  const doc = await buildCharterInvoicePdf({
    ...invoiceInput,
    qr: seal ? { dataUrl: seal.dataUrl, encoded: seal.encoded } : undefined,
  });
  doc.save(fileName);
  return { fileName, controlNumber, fingerprint };
}

/** Deterministic fingerprint + control number for a road dossier. */
async function roadInvoiceSeal(invoiceInput: CharterInvoiceInput) {
  const { documentFingerprint, controlNumber: makeControl } = await import("./itineraryPdf");
  const fingerprint = documentFingerprint({
    r: invoiceInput.reference,
    t: invoiceInput.price.totalKes,
    v: invoiceInput.price.taxKes,
    s: "",
    tpl: invoiceInput.templateVersion ?? "road-v1",
    kind: `charter-${invoiceInput.kind ?? "invoice"}`,
  });
  return { fingerprint, controlNumber: makeControl(invoiceInput.reference, fingerprint) };
}

