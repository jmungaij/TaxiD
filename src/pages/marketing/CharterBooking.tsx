import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

/** Bare shell used when the planner renders inside the charter business portal. */
const PortalShell = ({ children }: { children: ReactNode }) => <div className="space-y-6">{children}</div>;

import { aircraftKeyFor } from "@/lib/charter/aircraftMatch";
import { airportByCode, searchAirports } from "@/lib/charter/airportRegistry";
import { SeoHead } from "@/components/seo/SeoHead";
import { MarketingPage } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, ArrowRight, CheckCircle2, Download, FileText, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { FlightTimeline } from "@/components/charter/FlightTimeline";
import { AircraftGallery } from "@/components/charter/AircraftGallery";
import { AirportIntelPanel } from "@/components/charter/AirportIntelPanel";
import { CabinSeatPicker } from "@/components/charter/CabinSeatPicker";
import { layoutsFor, layoutByKey } from "@/lib/charter/cabinLayouts";
import {
  GROUND_SERVICES, emptyGroundDetail, groundSummaryLines, groundTotal, validateGroundPackage,
  type GroundDetail,
} from "@/lib/charter/groundTransport";
import { groundResolutions, type GroundResolution } from "@/lib/charter/groundResolutions";
import { recordCharterBookingChange } from "@/lib/charter/bookingAudit";

import { downloadItineraryPdf } from "@/lib/charter/itineraryPdf";
import { MANIFEST_ISSUE_LABEL, isVerifiableEmail, manifestIsValid, passengerIssues } from "@/lib/charter/passengerValidation";

import { useAuth } from "@/hooks/useAuth";
import { corporateLoginHref, charterPlannerPath } from "@/lib/charter/portalRoutes";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

import {
  categoryBySlug,
  computeQuote,
  defaultCostSettings,
  formatMoney,
  RATE_UNIT_LABEL,
  type CostSettings,
} from "@/lib/charter/catalog";
import { charterApi, isIdempotencyError, CharterApiError, DEFAULT_CHARTER_PREFS, type CharterBookingRow, type CharterNotificationPrefs } from "@/lib/charter/api";
import { downloadReceiptPdf } from "@/lib/charter/receiptPdf";
import { AIRCRAFT_CATEGORIES, computeAviationPrice, type PriceBreakdown } from "@/lib/charter/aviationPricing";
import { fetchPublishedPricing, type PublishedPricing } from "@/lib/charter/publishedPricing";
import { domainLexicon, isAviationDomain } from "@/lib/charter/assetDomains";
import { recordPricingRecovery } from "@/lib/charter/pricingTelemetry";
import { requiresPublishedPricing } from "@/lib/charter/pricingGovernance";

import { Switch } from "@/components/ui/switch";
import { AddressSearchInput } from "@/components/rider/AddressSearchInput";
import type { BookingPoint } from "@/components/rider/bookingTypes";
import { RoadQuoteApproval } from "@/components/charter/RoadQuoteApproval";
import { matchVehicle } from "@/lib/charter/vehicleMatch";
import { AiConciergeFeed } from "@/components/charter/AiConciergeFeed";
import { MissionReadinessPanel } from "@/components/charter/MissionReadinessPanel";
import { MissionSummarySidebar } from "@/components/charter/MissionSummarySidebar";
import { ValidationBlockerAlert } from "@/components/charter/ValidationBlockerAlert";
import { EnterpriseProcurementPanel } from "@/components/charter/EnterpriseProcurementPanel";
import { ConciergeServicesPanel, CONCIERGE_SERVICES } from "@/components/charter/ConciergeServicesPanel";
import {
  DelegateCompositionPanel,
  EMPTY_DELEGATES,
  delegateLines,
  delegateTotal,
  type DelegateComposition,
} from "@/components/charter/DelegateCompositionPanel";
import { conciergeAdvisories, missionReadiness, type MissionState } from "@/lib/charter/missionReadiness";
import { charterValidationReport, charterValidationSummary, type CharterValidationReport } from "@/lib/charter/validationErrors";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  emptyProcurement,
  deriveOrganizationName,
  procurementPayload,
  procurementReady,
  type ProcurementDetails,
} from "@/lib/charter/corporateApproval";
import { roadFareLines, type RoadFare } from "@/lib/charter/roadFare";
import { useRoadCharterPrice } from "@/lib/pricing360/useRoadCharterPrice";
import { snapshotQuote } from "@/lib/pricing360/api";
import { useAp360Quote } from "@/hooks/useAp360Quote";
import { ap360CategoryForAircraft } from "@/lib/pricing360/ap360AssetMap";
import { PricingExplained } from "@/components/pricing360/PricingExplained";
import { RoadApprovalTimeline } from "@/components/charter/RoadApprovalTimeline";
import { VehicleImage } from "@/components/charter/VehicleImage";
import { vehicleImageFor } from "@/lib/charter/vehicleImages";
import { downloadRoadInvoicePdf, roadItineraryLines, roadRouteLabel } from "@/lib/charter/roadInvoice";
import { RoadRouteMap } from "@/components/charter/RoadRouteMap";
import { DocumentPreviewCard } from "@/components/charter/DocumentPreviewCard";
import {
  PassengerIntelligencePanel,
  EMPTY_PASSENGER_INTELLIGENCE,
  passengerIntelligenceLines,
  type PassengerIntelligence,
} from "@/components/charter/PassengerIntelligence";

import {
  ROAD_TRAVEL_STAGE_LABELS,
  isRoadUnpaid,
  roadPaymentLabel,
  roadTravelStage,
} from "@/lib/charter/roadPayment";

/**
 * Manifest entry. Regulators accept a national ID on domestic sectors, so
 * `passportNumber` is optional there — but every passenger must carry at least
 * one document, and a passport is mandatory once the sector crosses a border.
 */
type Passenger = {
  name: string;
  document: string;
  idNumber: string;
  passportNumber: string;
  phone: string;
  email: string;
  seat: string;
};

const emptyPassenger = (seat = ""): Passenger => ({
  name: "", document: "", idNumber: "", passportNumber: "", phone: "", email: "", seat,
});

const STEPS = ["Request quote", "Passenger details", "Notifications", "Payment", "Confirmation"] as const;
/** Road charter (bus, van & coach) has no manifest step — quote → notify → pay. */
const ROAD_STEP_INDEXES = [0, 2, 3, 4] as const;

const PREF_OPTIONS: Array<{ key: keyof CharterNotificationPrefs; label: string; hint: string }> = [
  { key: "quote_emails", label: "Quote emails", hint: "Email me the priced quote summary when it is generated." },
  { key: "booking_emails", label: "Booking confirmation emails", hint: "Email me the confirmation with trip and payment details." },
  { key: "status_emails", label: "Flight status updates", hint: "Notify me when the flight status changes." },
  { key: "downloadable_summaries", label: "Downloadable summaries", hint: "Offer an offline copy of my quote and confirmation." },
];

const PAYMENT_METHODS = [
  { id: "mpesa", label: "M-Pesa", hint: "STK push to your registered number" },
  { id: "card", label: "Card", hint: "Visa / Mastercard authorization hold" },
  { id: "corporate_wallet", label: "Corporate wallet", hint: "Charged to your company account" },
  { id: "invoice", label: "Invoice", hint: "Net-14 invoice issued by operations" },
];

/**
 * Categories priced by the SAFARID Air dynamic engine rather than the legacy
 * rate card. Sourced from the shared pricing-governance module so the booking
 * page and the edge function can never disagree about which slugs require a
 * published pricing version.
 */


/**
 * Slug guard. Resolving the category here keeps every hook inside
 * `CharterBookingForm` unconditional — an early return placed between hooks
 * changes hook order between renders and crashes React.
 */
const CharterBooking = () => {
  const { slug = "" } = useParams();
  if (!categoryBySlug(slug)) return <Navigate to="/charter" replace />;
  return <CharterBookingForm />;
};

const CharterBookingForm = () => {
  const { slug = "" } = useParams();
  const inPortal = useLocation().pathname.startsWith("/dashboard");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  // Non-null by construction: `CharterBooking` redirects unknown slugs before
  // this component mounts.
  const category = categoryBySlug(slug)!;
  // Asset Type Resolver → Domain Renderer: all customer-visible terminology.
  const lex = domainLexicon(slug);
  const aviation = isAviationDomain(slug);

  const [step, setStep] = useState(0);
  /** Set when Continue is pressed while the step is incomplete — reveals field-level reasons. */
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Stable across retries of the same submission so a network retry or a
  // double-click can never create a second confirmation record.
  const [submitKey] = useState(() =>
    (globalThis.crypto?.randomUUID?.() ?? `ck-${Date.now()}-${Math.random().toString(16).slice(2)}`),
  );
  const [booking, setBooking] = useState<CharterBookingRow | null>(null);


  const assetName = params.get("asset") ?? category?.inventory[0]?.name ?? "";
  const baseRate = Number(params.get("rate")) || category?.inventory[0]?.rate || 0;
  const controls = (params.get("controls") ?? "").split(",").filter(Boolean);
  const offerDiscountPct = Number(params.get("offer")) || 0;

  const [duration, setDuration] = useState(Number(params.get("duration")) || category?.defaultDuration || 1);
  const [quantity, setQuantity] = useState(Number(params.get("qty")) || 1);
  const [delegates, setDelegates] = useState<DelegateComposition>(EMPTY_DELEGATES);
  const [conciergeIds, setConciergeIds] = useState<string[]>([]);
  /** Field-level report of the last payment validation failure. */
  const [blockReport, setBlockReport] = useState<CharterValidationReport | null>(null);
  const [costs] = useState<CostSettings>(() =>
    category ? { ...defaultCostSettings(category), ...parseCosts(params.get("costs")) } : ({} as CostSettings),
  );

  const [trip, setTrip] = useState({ origin: "", destination: "", date: "", time: "", notes: "" });
  // Mapped endpoints (latitude/longitude) for the road itinerary confirmation.
  const [originPoint, setOriginPoint] = useState<BookingPoint | null>(null);
  const [destinationPoint, setDestinationPoint] = useState<BookingPoint | null>(null);
  // Passenger sign-off gate before any road charter payment option is offered.
  const [approved, setApproved] = useState(false);
  // Corporate organisation approval replaces passenger sign-off for charters.
  const [procurement, setProcurement] = useState<ProcurementDetails>(() => emptyProcurement({}));
  // Passenger profile facts that drive the vehicle recommendation.
  const [passengerIntel, setPassengerIntel] = useState<PassengerIntelligence>(
    EMPTY_PASSENGER_INTELLIGENCE,
  );

  const [contact, setContact] = useState({ name: "", email: "", phone: "", company: "" });
  // Seats chosen in the search experience pre-seed the manifest rows.
  const [passengers, setPassengers] = useState<Passenger[]>(() => {
    const seats = (params.get("seats") ?? "").split(",").filter(Boolean);
    return seats.length ? seats.map((s) => emptyPassenger(s)) : [emptyPassenger()];
  });
  const [method, setMethod] = useState("mpesa");

  // Keep the approving authority in step with the contact details already
  // typed, so the organisation can never contradict the booking contact.
  useEffect(() => {
    setProcurement((prev) => ({
      ...prev,
      organizationName: prev.organizationName || deriveOrganizationName(contact),
      approverName: prev.approverName || contact.name.trim(),
    }));
  }, [contact.company, contact.email, contact.name]);
  const [prefs, setPrefs] = useState<CharterNotificationPrefs>(DEFAULT_CHARTER_PREFS);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [pricing, setPricing] = useState<PublishedPricing | null>(null);

  // Cabin arrangement + seats chosen by the customer for this aircraft.
  const aircraftKey = aircraftKeyFor(assetName);
  const cabinSeats = AIRCRAFT_CATEGORIES.find((a) => a.key === aircraftKey)?.seats ?? 8;
  const [layoutKey, setLayoutKey] = useState(() => layoutsFor(aircraftKey, cabinSeats)[0].key as string);
  const [cabinSelection, setCabinSelection] = useState<string[]>(
    () => (params.get("seats") ?? "").split(",").filter(Boolean),
  );

  // Ground transportation package (chauffeur, transfers) attached to the itinerary.
  const [groundKeys, setGroundKeys] = useState<string[]>(
    () => (params.get("ground") ?? "").split(",").filter(Boolean),
  );
  const [groundDetails, setGroundDetails] = useState<Record<string, GroundDetail>>({});
  // Post-confirmation cabin amendment.
  const [amending, setAmending] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  /** Issued road invoice document — control number quoted in shares and emails. */
  const [invoiceDoc, setInvoiceDoc] = useState<{ controlNumber: string; fileName: string } | null>(null);
  // Duplicate-submission recovery (idempotency_conflict / duplicate_in_flight).
  const [recovery, setRecovery] = useState<{ code: string; message: string } | null>(null);
  const [recovering, setRecovering] = useState(false);
  // M-Pesa STK push state.
  const [payPhone, setPayPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const [payment, setPayment] = useState<{
    amount_kes: number; phone_masked: string; checkout_request_id: string | null; message: string;
  } | null>(null);
  // Friendly duplicate-payment recovery (mpesa duplicate / idempotency_conflict).
  const [payRecovery, setPayRecovery] = useState<{ code: string; message: string } | null>(null);
  const [payChecking, setPayChecking] = useState(false);
  const [payLedger, setPayLedger] = useState<
    { applied_status: string; mpesa_receipt: string | null; result_desc: string | null; created_at: string }[]
  >([]);

  /** Slugs governed by published pricing == slugs priced by the SAFARID Air engine. */
  const needsPublishedPricing = requiresPublishedPricing(slug);
  const isAviation = needsPublishedPricing;

  // Customer quotes read the same published pricing version the admin console
  // governs. Aviation submissions wait for this to resolve so they never echo
  // back a stale version 0 and trip the server-side staleness guard. Categories
  // that are *not* governed (bus, marine, machinery) never block on it.
  const [pricingLoading, setPricingLoading] = useState(() => requiresPublishedPricing(slug));
  const [pricingError, setPricingError] = useState<string | null>(null);

  /** (Re)loads the published pricing version in force. Returns it when governed. */
  const loadPricing = useCallback(async (): Promise<PublishedPricing | null> => {
    if (!needsPublishedPricing) { setPricingLoading(false); return null; }
    setPricingLoading(true);
    setPricingError(null);
    try {
      const p = await fetchPublishedPricing();
      setPricing(p);
      if (p.fallback) setPricingError("Live pricing is unavailable — showing platform defaults.");
      return p;
    } catch (e) {
      setPricingError(e instanceof Error ? e.message : "Could not load published pricing.");
      return null;
    } finally {
      setPricingLoading(false);
    }
  }, [needsPublishedPricing]);

  useEffect(() => {
    let alive = true;
    void loadPricing().then(() => { if (!alive) return; });
    return () => { alive = false; };
  }, [loadPricing]);

  /**
   * Confirm is blocked only when this slug actually requires published pricing
   * and that pricing has not resolved yet — never merely because `pricing` is
   * null (bus, marine and machinery legitimately have none).
   */
  const pricingBlocked = needsPublishedPricing && (pricingLoading || !pricing);


  useEffect(() => {
    if (user?.email) setContact((c) => (c.email ? c : { ...c, email: user.email! }));
  }, [user]);

  // Load any previously saved notification preferences for this customer.
  useEffect(() => {
    if (!user) return;
    charterApi.getPrefs().then(setPrefs).catch(() => undefined);
  }, [user]);

  // Live flight status: subscribe to this booking row once it exists.
  useEffect(() => {
    if (!booking?.id) return;
    const channel = supabase
      .channel(`charter-booking-${booking.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "charter_bookings", filter: `id=eq.${booking.id}` },
        (payload) => {
          const next = payload.new as CharterBookingRow;
          setBooking((prev) => (prev ? { ...prev, ...next } : next));
          if (prefs.status_emails) {
            toast({ title: "Flight status updated", description: `Now ${next.flight_status}` });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [booking?.id, prefs.status_emails]);


  const quote = useMemo(
    () =>
      category
        ? computeQuote({ category, baseRate, duration, quantity, activeControls: controls, offerDiscountPct, costs })
        : null,
    [category, baseRate, duration, quantity, controls, offerDiscountPct, costs],
  );

  /** Dynamic aviation price — generated from the published configuration. */
  const airQuote: PriceBreakdown | null = useMemo(() => {
    if (!isAviation || !category || !pricing) return null;
    return computeAviationPrice({
      aircraftKey: aircraftKeyFor(assetName),
      origin: trip.origin,
      destination: trip.destination,
      passengers: Math.max(1, passengers.filter((p) => p.name.trim()).length),
      roundTrip: controls.includes("round-trip"),
      waitingHours: Math.max(0, duration - 1),
      emptyLeg: offerDiscountPct > 0 || controls.includes("empty-leg"),
      operatorHourlyRate: baseRate > 0 ? baseRate : undefined,
      controls: pricing.config.controls,
      airportTable: pricing.config.airports,
    });
  }, [isAviation, category, pricing, assetName, trip.origin, trip.destination, passengers, controls, duration, offerDiscountPct, baseRate]);

  /**
   * Authoritative aviation price — Asset Pricing 360 (`ap360_quote`).
   *
   * The block-hour engine, indexed fuel, governed tax rule, demand ceiling and
   * operator economic floor all live on the server. Whenever a published pricing
   * version governs this aircraft category, its figure is the price; the legacy
   * client-side build-up is only used while a category has no published version,
   * and it is labelled as an indicative estimate when it is.
   */
  const ap360AirCategory = isAviation ? ap360CategoryForAircraft(aircraftKeyFor(assetName)) : null;
  const airAuthority = useAp360Quote(
    ap360AirCategory
      ? {
          category_code: ap360AirCategory,
          hours: Math.max(1, duration),
          positioning_hours: controls.includes("round-trip") ? 1 : 0.5,
          landings: controls.includes("round-trip") ? 2 : 1,
          passengers: Math.max(1, passengers.filter((p) => p.name.trim()).length),
          discount_pct: offerDiscountPct,
        }
      : null,
    !!ap360AirCategory,
  );

  const groundCost = groundTotal(groundKeys);
  const namedPassengers = passengers.filter((p) => p.name.trim()).length;
  /** Conflict checks between the ground package and the quoted itinerary. */
  const groundIssues = useMemo(
    () =>
      validateGroundPackage(groundKeys, groundDetails, {
        origin: trip.origin,
        destination: trip.destination,
        date: trip.date,
        manifestPassengers: namedPassengers,
        cabinSeats,
      }),
    [groundKeys, groundDetails, trip.origin, trip.destination, trip.date, namedPassengers, cabinSeats],
  );
  /**
   * Road charter price — resolved by the governed Pricing 360 engine on the
   * server. The client no longer builds a price from vehicle, fuel and crew
   * costs: it asks the published rate card what this mission costs. When the
   * configuration cannot price the request, no figure is shown at all.
   */
  const departAt = trip.time ? `${trip.date}T${trip.time}` : trip.date;
  const roadPrice = useRoadCharterPrice(
    {
      assetName,
      origin: trip.origin,
      destination: trip.destination,
      duration,
      quantity,
      when: departAt,
    },
    !aviation,
  );
  const roadFare: RoadFare | null = useMemo(() => {
    const g = roadPrice.fare;
    if (!g) return null;
    return {
      bookingFee: g.bookingFee,
      surchargeMultiplier: g.bookingFee > 0 ? 1 + g.surcharge / g.bookingFee : 1,
      surcharge: g.surcharge,
      surchargeApplies: g.surchargeApplies,
      commission: g.commission,
      servicePct: g.servicePct,
      total: g.total,
      perUnit: g.perUnit,
    };
  }, [roadPrice.fare]);

  const total = aviation
    ? (airAuthority.priced
        ? (airAuthority.price ?? 0)
        : airQuote ? airQuote.customerPrice : quote?.net ?? 0) + groundCost
    : roadFare?.total ?? 0;

  /**
   * Road price estimates must reflect a vehicle that can actually run the
   * mission, so the selected category is matched against the party size,
   * luggage volume and accessibility needs before the units are billed.
   */
  const vehicleFit = useMemo(() => {
    if (aviation || !assetName) return null;
    const party = Math.max(
      1,
      passengers.filter((p) => p.name.trim()).length,
      passengerIntel.vipCount + passengerIntel.childCount + passengerIntel.wheelchairCount,
    );
    return matchVehicle(
      { name: assetName, rate: baseRate, capacity: category?.inventory.find((i) => i.name === assetName)?.capacity },
      {
        passengers: party,
        luggagePieces: passengerIntel.luggagePieces,
        accessibility: passengerIntel.wheelchairCount > 0,
      },
    );
  }, [aviation, assetName, baseRate, category, passengers, passengerIntel]);

  /** Explicit sector flag — the server no longer has to parse the slug. */
  const sector: "aviation" | "road" = aviation ? "aviation" : "road";

  const missionState: MissionState = useMemo(() => ({
    origin: trip.origin,
    destination: trip.destination,
    date: trip.date,
    time: trip.time,
    durationDays: duration,
    units: quantity,
    assetName,
    assetSeats: vehicleFit?.seats ?? 0,
    partySize: Math.max(
      delegateTotal(delegates),
      passengers.filter((p) => p.name.trim()).length,
    ),
    luggagePieces: delegates.luggagePieces || passengerIntel.luggagePieces,
    wheelchairCount: (delegates.wheelchairAccess ? 1 : 0) + passengerIntel.wheelchairCount,
    contactName: contact.name,
    contactEmail: contact.email,
    contactPhone: contact.phone,
    procurementReady: procurementReady(procurement),
    paymentAuthorized: approved,
  }), [trip, duration, quantity, assetName, vehicleFit, delegates, passengers, passengerIntel, contact, procurement, approved]);

  const readiness = useMemo(() => missionReadiness(missionState), [missionState]);
  const advisories = useMemo(() => conciergeAdvisories(missionState), [missionState]);
  const conciergeLabels = conciergeIds
    .map((id) => CONCIERGE_SERVICES.find((s) => s.id === id)?.label)
    .filter((l): l is string => Boolean(l));

  const roadLines = roadFare ? roadFareLines(roadFare, category!.currency) : [];

  /**
   * Applies a one-click conflict resolution. State updates re-run
   * `validateGroundPackage` and the quote preview in the same render pass, and
   * the change is written to the forensic booking audit trail.
   */
  const applyGroundResolution = (resolution: GroundResolution) => {
    const before = { keys: groundKeys, details: groundDetails };
    const after = resolution.apply(before);
    setGroundKeys(after.keys);
    setGroundDetails(after.details);
    toast({ title: "Conflict resolved", description: resolution.hint });
    void recordCharterBookingChange(
      "charter_ground_package_changed",
      { keys: before.keys, details: before.details },
      { keys: after.keys, details: after.details, resolution: resolution.id },
      { entityId: booking?.id ?? null, reference: booking?.reference ?? null, assetName },
    );
  };


  const unit = RATE_UNIT_LABEL[category.rateUnit];

  const submit = async (opts: { pricingVersion?: number; isRetry?: boolean } = {}) => {
    if (!quote || submitting) return;

    setSubmitting(true);
    setRecovery(null);
    setBlockReport(null);
    try {
      await charterApi.savePrefs({ ...prefs, contact_email: contact.email }).catch(() => undefined);
      const saved = await charterApi.createQuote({
        category_slug: category.slug,
        category_label: category.label,
        asset_name: assetName,
        duration,
        quantity,
        controls,
        cost_settings: costs,
        default_cost_settings: defaultCostSettings(category),
        breakdown: airQuote ?? quote,
        pricing_version: opts.pricingVersion ?? pricing?.version ?? 0,
        trip,
        contact,
        currency: category.currency,
        total,
      });
      const confirmed = await charterApi.createBooking({
        quote_id: saved.id,
        category_slug: category.slug,
        category_label: category.label,
        asset_name: assetName,
        passengers: passengers.filter((p) => p.name.trim()),
        contact,
        trip: {
          ...trip,
          cabin_layout: layoutKey,
          cabin_layout_label: layoutByKey(layoutKey)?.label ?? layoutKey,
          cabin_seats: cabinSeats,
          international_sector: internationalSector,
          seats: cabinSelection,
          ground_transport: groundKeys.map((k) => ({ service: k, ...(groundDetails[k] ?? emptyGroundDetail()) })),
          ground_total: groundCost,
        },
        amount: total,
        currency: category.currency,
        payment_method: method,
        sector,
        idempotency_key: submitKey,

      });

      setBooking(confirmed);
      setStep(4);
      toast({ title: "Booking confirmed", description: `Reference ${confirmed.reference}` });
      // Freeze the governed price against the booking reference. Every later
      // total (approval queue, commission, settlement) is read back from this
      // immutable snapshot instead of being recomputed in a browser.
      if (!aviation && roadPrice.input) {
        void snapshotQuote(roadPrice.input, confirmed.reference).catch((e: unknown) => {
          toast({
            title: "Price snapshot not recorded",
            description: e instanceof Error
              ? e.message
              : "The booking is confirmed but its price snapshot failed — operations will price it manually.",
            variant: "destructive",
          });
        });
      }
      void recordCharterBookingChange(
        "charter_cabin_layout_changed",
        {},
        { cabin_layout: layoutKey, seats: cabinSelection, ground: groundKeys, stage: "booking_confirmed" },
        { entityId: confirmed.id, reference: confirmed.reference, assetName: confirmed.asset_name },
      );
      // Secure itinerary PDF is generated immediately after confirmation.
      void generateItinerary(confirmed);
    } catch (e) {
      if (e instanceof CharterApiError && e.code === "pricing_version_stale" && !opts.isRetry) {
        // Self-healing: refetch the version actually in force and resubmit once.
        // Non-governed categories (bus, marine, machinery) should never land
        // here — if they do, we retry without echoing any version at all.
        const quotedVersion = opts.pricingVersion ?? pricing?.version ?? 0;
        const serverActive = Number((e.details as { active_version?: number } | null)?.active_version ?? 0);
        void recordPricingRecovery({
          phase: "retry_started",
          slug: category.slug,
          idempotencyKey: submitKey,
          governed: needsPublishedPricing,
          quotedVersion,
          activeVersion: serverActive,
        });
        const refreshed = needsPublishedPricing ? await loadPricing() : null;
        const nextVersion = needsPublishedPricing
          ? refreshed?.version ?? serverActive
          : 0;
        toast({
          title: "Pricing refreshed",
          description: needsPublishedPricing
            ? "We picked up the latest published pricing and are retrying your booking."
            : "Retrying your booking — this category isn't governed by aviation pricing.",
        });
        setSubmitting(false);
        try {
          await submit({ pricingVersion: nextVersion, isRetry: true });
          void recordPricingRecovery({
            phase: "retry_succeeded",
            slug: category.slug,
            idempotencyKey: submitKey,
            governed: needsPublishedPricing,
            quotedVersion: nextVersion,
            activeVersion: nextVersion,
          });
        } catch (retryError) {
          void recordPricingRecovery({
            phase: "retry_failed",
            slug: category.slug,
            idempotencyKey: submitKey,
            governed: needsPublishedPricing,
            quotedVersion: nextVersion,
            activeVersion: serverActive,
            error: retryError instanceof Error ? retryError.message : String(retryError),
          });
          throw retryError;
        }

        return;
      }
      if (e instanceof CharterApiError && e.code === "validation_failed") {
        const report = charterValidationReport(e);
        setBlockReport(report);
        toast({
          title: "Payment blocked by validation",
          description: charterValidationSummary(report),
          variant: "destructive",
        });
      } else if (isIdempotencyError(e)) {
        // A previous click already reached the server — never resubmit blindly.
        setRecovery({ code: e.code, message: e.message });
        toast({
          title: "Duplicate submission detected",
          description: "We stopped a second booking from being created. Recover the existing confirmation below.",
        });
      } else {
        toast({
          title: "Booking failed",
          description: e instanceof Error ? e.message : "Unexpected error",
          variant: "destructive",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** Fetches the confirmation the earlier submission already created. */
  const recoverBooking = async () => {
    setRecovering(true);
    try {
      const existing = await charterApi.bookingByKey(submitKey);
      setBooking(existing);
      setRecovery(null);
      setStep(4);
      toast({ title: "Existing confirmation found", description: `Reference ${existing.reference}` });
    } catch (e) {
      toast({
        title: "Nothing to recover yet",
        description: e instanceof Error ? e.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setRecovering(false);
    }
  };

  /**
   * Idempotent M-Pesa STK push. The key is derived from the booking, so
   * repeated clicks reuse the same prompt instead of creating a new charge.
   */
  const payWithMpesa = async () => {
    if (!booking || paying) return;
    setPaying(true);
    try {
      const res = await charterApi.initiatePayment({
        booking_id: booking.id,
        phone: payPhone || contact.phone,
        idempotency_key: `pay-${booking.reference}`,
      });
      setPayment(res);
      setPayRecovery(null);
      toast({
        title: res.replayed ? "Prompt already sent" : "Check your phone",
        description: res.message,
      });
      const refreshed = await charterApi.bookingByKey(submitKey).catch(() => null);
      if (refreshed) setBooking(refreshed);
    } catch (e) {
      const code = e instanceof CharterApiError ? e.code : "payment_failed";
      const duplicate = isIdempotencyError(e) || code === "already_paid";
      if (duplicate) {
        setPayRecovery({
          code,
          message: e instanceof Error ? e.message : "A payment for this booking already exists.",
        });
        void loadPaymentState();
      }
      toast({
        title: duplicate ? "Payment already recorded" : "Payment failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: duplicate ? "default" : "destructive",
      });
    } finally {
      setPaying(false);
    }
  };

  /**
   * Pulls the authoritative payment state (and the idempotent M-Pesa callback
   * ledger) so a duplicate prompt shows the confirmation that already exists.
   */
  const loadPaymentState = async () => {
    if (!booking) return;
    setPayChecking(true);
    try {
      const res = await charterApi.paymentStatus({ booking_id: booking.id });
      setBooking(res.booking);
      setPayLedger(res.events ?? []);
      const settled = ["paid", "settled"].includes(String(res.booking.payment_status));
      if (settled) setPayRecovery(null);
      toast({
        title: settled ? "Payment confirmed" : "Payment still pending",
        description: settled
          ? `Reference ${res.booking.reference} is settled — download your receipt below.`
          : "No completed M-Pesa result has arrived yet. Try again in a moment.",
      });
    } catch (e) {
      toast({
        title: "Could not check payment",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setPayChecking(false);
    }
  };

  /** Forensic receipt sharing the itinerary's security marks and fingerprint. */
  const downloadReceipt = async () => {
    if (!booking) return;
    setPdfBusy(true);
    try {
      const { fileName, fingerprint, controlNumber, templateVersion } = await downloadReceiptPdf({
        reference: booking.reference,
        bookingId: booking.id,
        payerName: contact.name || "Charter client",
        payerPhoneMasked: payment?.phone_masked ?? `****${(payPhone || contact.phone).slice(-4)}`,
        amountLabel: formatMoney(Number(booking.amount), category!.currency),
        amountKes: payment?.amount_kes ?? Number(booking.amount),
        method: String(booking.payment_method ?? "mpesa").toUpperCase(),
        checkoutRequestId: payment?.checkout_request_id ?? null,
        route: `${trip.origin || "—"} → ${trip.destination || "—"}`,
        assetName: booking.asset_name,
        lines: quoteLines(),
      });
      await charterApi.registerDocument({
        control_number: controlNumber,
        fingerprint,
        template_version: templateVersion,
        reference: booking.reference,
        booking_id: booking.id,
        document_kind: "receipt",
        file_name: fileName,
        amount_kes: payment?.amount_kes ?? Number(booking.amount),
        approver_name: procurement.approverName || undefined,
        approver_title: procurement.approverTitle || undefined,
        procurement: procurementPayload(procurement),
      }).catch(() => undefined);
      toast({
        title: "Receipt generated",
        description: `${fileName} · Verify with control number ${controlNumber}`,
      });
    } catch (e) {
      toast({
        title: "Receipt failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setPdfBusy(false);
    }
  };

  /** Line items mirroring the sidebar breakdown, reused by the secure PDF. */
  const quoteLines = () => {
    const cur = category!.currency;
    if (airQuote) {
      return [
        { label: `Base (${airQuote.time.billableHours}h)`, value: formatMoney(airQuote.baseCost, cur) },
        { label: "Airport, handling & crew", value: formatMoney(airQuote.operationalTotal, cur) },
        ...airQuote.discounts.map((d) => ({ label: d.label, value: `-${d.amount}%` })),
        { label: "Platform commission", value: formatMoney(airQuote.platformCommission, cur) },
        { label: "Technology fee", value: formatMoney(airQuote.technologyFee, cur) },
        { label: "Payment processing", value: formatMoney(airQuote.paymentProcessing, cur) },
        { label: "Taxes (VAT)", value: formatMoney(airQuote.taxes, cur) },
        { label: "Ground transportation", value: formatMoney(groundCost, "USD") },
      ];
    }
    if (roadFare) return roadFareLines(roadFare, cur);
    // Road charter without a governed price shows no figures at all — the legacy
    // client-side cost build-up is no longer a permitted pricing source.
    if (!aviation) {
      return [{ label: "Pricing", value: "Manual pricing review required" }];
    }
    return [
      { label: "Base + operating", value: formatMoney(quote?.gross ?? 0, cur) },
      { label: "Fuel", value: formatMoney(quote?.fuelCost ?? 0, cur) },
      { label: lex.crewLabel, value: formatMoney(quote?.crewCost ?? 0, cur) },
      { label: lex.feesLabel, value: formatMoney(quote?.airportFees ?? 0, cur) },
      { label: "Ground transportation", value: formatMoney(groundCost, "USD") },
    ];
  };

  /**
   * Security-printed document. Road charters receive the invoice & itinerary
   * confirmation (three-line fare, coordinates, UNPAID stamp); aviation keeps
   * the manifest itinerary.
   */
  const generateItinerary = async (target: CharterBookingRow | null = booking) => {
    if (!category) return;
    if (!aviation && roadFare) {
      setPdfBusy(true);
      try {
        const doc = await downloadRoadInvoicePdf(
          {
            reference: target?.reference ?? `QUOTE-${category.slug.toUpperCase()}`,
            customerName: contact.name || "Charter customer",
            customerPhone: contact.phone,
            customerEmail: contact.email,
            vehicle: target?.asset_name ?? assetName,
            passengers: Math.max(1, passengers.filter((p) => p.name.trim()).length),
            departAt: trip.time ? `${trip.date}T${trip.time}` : trip.date,
            fare: roadFare,
            points: [
              { label: "Pickup", address: trip.origin, lat: originPoint?.lat, lng: originPoint?.lng },
              { label: "Drop-off", address: trip.destination, lat: destinationPoint?.lat, lng: destinationPoint?.lng },
            ],
            notes: [
              trip.notes,
              ...delegateLines(delegates),
              ...(conciergeLabels.length ? [`Concierge: ${conciergeLabels.join(", ")}`] : []),
              ...passengerIntelligenceLines(passengerIntel),
            ]
              .filter(Boolean)
              .join(" · "),

            paymentStatus: target?.payment_status ?? "pending",
            paymentMethod: target?.payment_method ?? method,
            mpesaReceipt: null,
          },
          target?.id,
          procurementPayload(procurement),
        );

        setInvoiceDoc({ controlNumber: doc.controlNumber, fileName: doc.fileName });
        toast({
          title: "Invoice & itinerary generated",
          description: `Control ${doc.controlNumber} · ${doc.fileName}`,
        });
      } catch (e) {
        toast({
          title: "Invoice PDF failed",
          description: e instanceof Error ? e.message : "Unexpected error",
          variant: "destructive",
        });
      } finally {
        setPdfBusy(false);
      }
      return;
    }
    if (!target) return;
    setPdfBusy(true);
    try {
      const fp = await downloadItineraryPdf({
        reference: target.reference,
        categoryLabel: category.label,
        categorySlug: category.slug,
        assetName: target.asset_name,
        aircraftKey,
        layoutKey,
        seats: cabinSelection,
        origin: trip.origin,
        destination: trip.destination,
        date: trip.date,
        passengers: passengers
          .filter((p) => p.name.trim())
          .map((p) => ({
            name: p.name,
            seat: p.seat,
            document: p.passportNumber || p.idNumber,
            phone: p.phone,
            email: p.email,
          })),
        groundKeys,
        groundDetails,
        quoteLines: quoteLines(),
        totalLabel: formatMoney(Number(target.amount), category.currency),
        currency: category.currency,
        paymentMethod: target.payment_method,
        paymentStatus: target.payment_status,
        contactName: contact.name,
      });
      toast({
        title: "Secure itinerary generated",
        description: `Template ${fp.templateVersion} · fingerprint ${fp.fingerprint}`,
      });

    } catch (e) {
      toast({
        title: "Itinerary PDF failed",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setPdfBusy(false);
    }
  };

  /** Cabin/seat change after the initial selection — manifest rows follow. */
  const amendCabin = async (nextLayout: string, nextSeats: string[]) => {
    if (!booking) return;
    const before = { cabin_layout: layoutKey, seats: cabinSelection };
    setAmending(true);
    try {
      const updated = await charterApi.amendCabin({
        booking_id: booking.id,
        cabin_layout: nextLayout,
        cabin_layout_label: layoutByKey(nextLayout)?.label ?? nextLayout,
        seats: nextSeats,
      });
      setBooking(updated);
      setLayoutKey(nextLayout);
      setCabinSelection(nextSeats);
      setPassengers((rows) => rows.map((r, i) => ({ ...r, seat: nextSeats[i] ?? "" })));
      await recordCharterBookingChange(
        "charter_seat_selection_changed",
        before,
        { cabin_layout: nextLayout, seats: nextSeats },
        { entityId: booking.id, reference: booking.reference, assetName: booking.asset_name },
      );
      toast({ title: "Cabin updated", description: "Manifest and itinerary now reflect the new seat map." });
    } catch (e) {
      toast({
        title: "Cabin change rejected",
        description: e instanceof Error ? e.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setAmending(false);
    }
  };

  /** Offline copy of the quote + booking confirmation, mirroring the email summary. */
  const downloadSummary = () => {
    if (!booking || !quote || !category) return;
    const cur = category.currency;
    const lines = [
      `${category.label} — booking summary`,
      `Reference: ${booking.reference}`,
      `Asset: ${booking.asset_name}`,
      `Route: ${trip.origin || "—"} -> ${trip.destination || "—"}`,
      `Departure: ${trip.date || "—"}`,
      `Duration: ${duration} ${unit} x ${quantity}`,
      `Passengers: ${passengers.filter((p) => p.name.trim()).length || 1}`,
      "",
      "Price breakdown",
      `  Base + operating: ${formatMoney(quote.gross, cur)}`,
      `  Fuel: ${formatMoney(quote.fuelCost, cur)}`,
      `  Crew: ${formatMoney(quote.crewCost, cur)}`,
      `  ${lex.feesLabel}: ${formatMoney(quote.airportFees, cur)}`,
      `  Volume tier: -${quote.volumeDiscountPct}%`,
      `  Offer / empty leg: -${quote.offerDiscountPct}%`,
      `  Total: ${formatMoney(Number(booking.amount), cur)}`,
      "",
      `Payment: ${booking.payment_method} (${booking.payment_status})`,
      `Flight status: ${booking.flight_status}`,
      `Generated: ${new Date().toLocaleString()}`,
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `charter-${booking.reference}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Summary downloaded", description: booking.reference });
  };

  /** Resolved endpoints power the sector rule and the airport briefing cards. */
  const originAirport = useMemo(
    () => airportByCode(trip.origin) ?? searchAirports(trip.origin, 1)[0] ?? null,
    [trip.origin],
  );
  const destinationAirport = useMemo(
    () => airportByCode(trip.destination) ?? searchAirports(trip.destination, 1)[0] ?? null,
    [trip.destination],
  );

  /**
   * A sector is international when both endpoints resolve in the airport
   * registry and sit in different countries. Unresolved free-text endpoints
   * stay on the permissive domestic rule so the form is never a dead end.
   */
  const internationalSector = useMemo(
    () => Boolean(originAirport && destinationAirport && originAirport.country !== destinationAirport.country),
    [originAirport, destinationAirport],
  );

  /**
   * Payment is gated on a complete manifest: a travel document appropriate to
   * the sector, plus a reachable phone number and verifiable email for every
   * named passenger.
   */
  const manifestValid = manifestIsValid(passengers, internationalSector);

  /**
   * Reasons the current step cannot be left, surfaced next to the Continue
   * button so a customer is never blocked by an invisible rule.
   */
  const continueBlockers = useMemo(() => {
    const out: string[] = [];
    if (step === 0) {
      if (!trip.origin.trim()) out.push(aviation ? "Enter an origin." : "Enter a pickup location.");
      if (!trip.destination.trim()) out.push(aviation ? "Enter a destination." : "Enter a drop-off location.");
      if (!trip.date) out.push("Choose a departure date.");
      if (!contact.name.trim()) out.push("Enter a contact name.");
      if (!isVerifiableEmail(contact.email)) out.push("Enter a valid contact email.");
      // Every itinerary leg added must carry its own pickup / drop-off detail.
      for (const i of groundIssues) {
        const label = GROUND_SERVICES.find((g) => g.key === i.key)?.label ?? i.key;
        out.push(`${label}: ${i.message}`);
      }
    } else if (step === 1 && !manifestValid) {
      out.push("Complete every passenger's details.");
    }
    return out;
  }, [step, aviation, trip.origin, trip.destination, trip.date, contact.name, contact.email, groundIssues, manifestValid]);

  const canContinue = continueBlockers.length === 0;
  /** Advances the wizard, or reveals the exact blocking reasons when incomplete. */
  const handleContinue = () => {
    if (!canContinue) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    setStep((s) => s + (!aviation && s === 0 ? 2 : 1));
  };
  /** Field-level reason for a given ground leg field, shown once Continue was pressed. */
  const groundFieldError = (key: string, field: string) =>
    attempted ? groundIssues.find((i) => i.key === key && i.field === field)?.message : undefined;

  /** Steps visible for this domain — road charter hides the manifest step. */
  const visibleStepIndexes = STEPS.map((_, i) => i).filter(
    (i) => aviation || ROAD_STEP_INDEXES.includes(i as 0 | 2 | 3 | 4),
  );
  const visibleStepCount = visibleStepIndexes.length;
  const visibleStepIndex = Math.max(0, visibleStepIndexes.indexOf(step));


  /**
   * Mission planning now lives in the Charter Business Portal. When rendered
   * under /dashboard the marketing shell is dropped so the dashboard chrome
   * (rail + header) is not duplicated.
   */
  const Shell = inPortal ? PortalShell : MarketingPage;

  return (
    <Shell>
      <SeoHead
        title={`Book ${category.label} | SAFARID`}
        description={`Request a quote, add passenger details and confirm your ${category.label.toLowerCase()} booking.`}
        path={`/charter/${category.slug}/book`}
      />

      <section className="relative overflow-hidden border-b border-border bg-gradient-to-br from-primary/15 via-background to-primary-glow/10">
        {!aviation && (
          <div className="pointer-events-none absolute inset-0">
            <img
              src={vehicleImageFor(assetName, category.label)}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover opacity-[0.18]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
          </div>
        )}
        <div className="relative container mx-auto px-4 py-12 max-w-4xl">
          <Link to={`/charter/${category.slug}`} className="inline-flex items-center text-sm text-primary">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to {category.label}
          </Link>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            {aviation ? "Private aviation mission" : "Executive mobility mission"}
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-2">Reserve {assetName}</h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Plan and orchestrate executive mobility with enterprise precision. Configure delegates, routes,
            schedules, security and concierge services through one intelligent booking experience built for
            governments, multinationals, NGOs, protocol offices and premium travel.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {["Licensed operator", "Fully insured", "Vetted chauffeurs", "Enterprise billing", "Live GPS", "24/7 operations", "Corporate support", "SLA guaranteed"].map((t) => (
              <li
                key={t}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-primary" /> {t}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${readiness.score}%` }}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              Mission readiness {readiness.score}% · step {visibleStepIndex + 1} of {visibleStepCount}
            </span>
          </div>
          <ol className="flex flex-wrap gap-2 mt-6">
            {STEPS.filter((_, i) => aviation || ROAD_STEP_INDEXES.includes(i as 0 | 2 | 3 | 4)).map((s) => {
              const i = STEPS.indexOf(s);
              return (
              <li key={s}>
                <span
                  className={`px-3 py-1.5 rounded-full text-sm border ${
                    i === step
                      ? "bg-primary text-primary-foreground border-primary"
                      : i < step
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-card text-muted-foreground border-border"
                  }`}
                >
                  {s}
                </span>
              </li>
            );})}
          </ol>
        </div>
      </section>

      <section className="container mx-auto px-4 py-12 grid gap-8 lg:grid-cols-3 max-w-6xl">
        <div className="lg:col-span-2 space-y-6">
          {step === 0 && (
            <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
              <h2 className="font-semibold text-lg">Trip &amp; contact</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {aviation ? (
                  <>
                    <Field id="origin" label="Origin" value={trip.origin} onChange={(v) => setTrip({ ...trip, origin: v })} />
                    <Field id="destination" label="Destination" value={trip.destination} onChange={(v) => setTrip({ ...trip, destination: v })} />
                  </>
                ) : (
                  <>
                    <div>
                      <div>
                        <AddressSearchInput
                          id="origin"
                          label="Pickup"
                          badge="A"
                          placeholder="Search a pickup location"
                          value={originPoint}
                          onResolve={(pt) => { setOriginPoint(pt); setTrip((t) => ({ ...t, origin: pt?.address ?? "" })); }}
                          onFreeText={(v) => setTrip((t) => ({ ...t, origin: v }))}
                        />
                        {attempted && !trip.origin.trim() && (
                          <p className="mt-1 text-xs text-destructive" role="alert">A pickup location is required for this leg.</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <div>
                        <AddressSearchInput
                          id="destination"
                          label="Drop-off"
                          badge="B"
                          placeholder="Search a drop-off location"
                          value={destinationPoint}
                          onResolve={(pt) => { setDestinationPoint(pt); setTrip((t) => ({ ...t, destination: pt?.address ?? "" })); }}
                          onFreeText={(v) => setTrip((t) => ({ ...t, destination: v }))}
                        />
                        {attempted && !trip.destination.trim() && (
                          <p className="mt-1 text-xs text-destructive" role="alert">A drop-off location is required for this leg.</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="dtime">Departure time</Label>
                      <Input id="dtime" type="time" className="mt-2" value={trip.time} onChange={(e) => setTrip({ ...trip, time: e.target.value })} />
                      <p className="mt-1 text-xs text-muted-foreground">
                        A ×1.25 surcharge applies only to vehicles booked at night or on a Sunday.
                      </p>
                    </div>
                  </>
                )}
                <div>
                  <Label htmlFor="date">Departure date</Label>
                  <Input id="date" type="date" className="mt-2" value={trip.date} onChange={(e) => setTrip({ ...trip, date: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="dur">Duration</Label>
                  <Select value={String(duration)} onValueChange={(v) => setDuration(Math.max(1, Number(v) || 1))}>
                    <SelectTrigger id="dur" className="mt-2">
                      <SelectValue placeholder={`Select ${unit}s`} />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} {unit}{n === 1 ? "" : "s"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="qty">Units</Label>
                  <Input id="qty" type="number" min={1} className="mt-2" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
                  {vehicleFit && (
                    <p className={`mt-1 text-xs ${vehicleFit.fits ? "text-muted-foreground" : "text-destructive"}`}>
                      {vehicleFit.reason}
                      {vehicleFit.fits && vehicleFit.unitsRequired !== quantity && (
                        <button
                          type="button"
                          className="ml-1 underline"
                          onClick={() => setQuantity(vehicleFit.unitsRequired)}
                        >
                          Use {vehicleFit.unitsRequired} unit{vehicleFit.unitsRequired === 1 ? "" : "s"}
                        </button>
                      )}
                    </p>
                  )}
                </div>

                <Field id="cname" label="Contact name" value={contact.name} onChange={(v) => setContact({ ...contact, name: v })} />
                <Field id="cemail" label="Email" type="email" value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} />
                <Field id="cphone" label="Phone" value={contact.phone} onChange={(v) => setContact({ ...contact, phone: v })} />
                <Field id="ccompany" label="Company (optional)" value={contact.company} onChange={(v) => setContact({ ...contact, company: v })} />
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" className="mt-2" maxLength={1000} value={trip.notes} onChange={(e) => setTrip({ ...trip, notes: e.target.value })} />
              </div>

              {aviation && (originAirport || destinationAirport) && (
                <div className="grid gap-4 md:grid-cols-2">
                  {originAirport && <AirportIntelPanel airport={originAirport} role="Departure" />}
                  {destinationAirport && <AirportIntelPanel airport={destinationAirport} role="Arrival" />}
                </div>
              )}

              <div className="rounded-xl border border-border p-4 space-y-3">
                <div>
                  <h3 className="font-semibold text-sm">Ground transportation (optional)</h3>
                  <p className="text-xs text-muted-foreground">
                    Bundle chauffeur and transfer legs into the itinerary. Pickup details are required for each leg you add.
                  </p>
                </div>
                {GROUND_SERVICES.map((g) => {
                  const on = groundKeys.includes(g.key);
                  const detail = groundDetails[g.key] ?? emptyGroundDetail();
                  const patchDetail = (v: Partial<GroundDetail>) =>
                    setGroundDetails((p) => ({ ...p, [g.key]: { ...detail, ...v } }));
                  return (
                    <div key={g.key} className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Label htmlFor={`gt-${g.key}`} className="font-medium">
                            {g.label} <span className="text-muted-foreground">· from {formatMoney(g.price, "USD")}</span>
                          </Label>
                          <p className="text-xs text-muted-foreground">{g.blurb}</p>
                        </div>
                        <Switch
                          id={`gt-${g.key}`}
                          checked={on}
                          onCheckedChange={(v) => {
                            const before = [...groundKeys];
                            const next = v ? [...groundKeys, g.key] : groundKeys.filter((k) => k !== g.key);
                            setGroundKeys(next);
                            void recordCharterBookingChange(
                              "charter_ground_package_changed",
                              { ground: before },
                              { ground: next, changed: g.key },
                              { entityId: booking?.id ?? null, reference: booking?.reference ?? null, assetName },
                            );
                          }}
                        />
                      </div>
                      {on && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Field
                              id={`gl-${g.key}`} label={g.locationLabel}
                              value={detail.location} onChange={(v) => patchDetail({ location: v })}
                            />
                            {groundFieldError(g.key, "location") && (
                              <p className="mt-1 text-xs text-destructive" role="alert">{groundFieldError(g.key, "location")}</p>
                            )}
                          </div>
                          {g.timed && (
                            <div>
                              <Label htmlFor={`gtm-${g.key}`}>Pickup time</Label>
                              <Input
                                id={`gtm-${g.key}`} type="time" className="mt-2"
                                value={detail.time} onChange={(e) => patchDetail({ time: e.target.value })}
                              />
                              {groundFieldError(g.key, "time") && (
                                <p className="mt-1 text-xs text-destructive" role="alert">{groundFieldError(g.key, "time")}</p>
                              )}
                            </div>
                          )}
                          <div>
                            <Label htmlFor={`gp-${g.key}`}>Passengers</Label>
                            <Input
                              id={`gp-${g.key}`} type="number" min={1} className="mt-2"
                              value={detail.passengers}
                              onChange={(e) => patchDetail({ passengers: Math.max(1, Number(e.target.value) || 1) })}
                            />
                            {groundFieldError(g.key, "passengers") && (
                              <p className="mt-1 text-xs text-destructive" role="alert">{groundFieldError(g.key, "passengers")}</p>
                            )}
                          </div>
                          <Field
                            id={`gn-${g.key}`} label="Notes for the chauffeur (optional)"
                            value={detail.notes} onChange={(v) => patchDetail({ notes: v })}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                {groundIssues.length > 0 && (
                  <ul className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-3">
                    {groundIssues.map((i) => (
                      <li key={`${i.key}-${i.field}-${i.message}`} className="space-y-1.5">
                        <p className="text-xs text-destructive">
                          {GROUND_SERVICES.find((g) => g.key === i.key)?.label ?? i.key}: {i.message}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {groundResolutions(
                            i,
                            { keys: groundKeys, details: groundDetails },
                            {
                              origin: trip.origin, destination: trip.destination, date: trip.date,
                              manifestPassengers: namedPassengers, cabinSeats,
                            },
                          ).map((r) => (
                            <Button
                              key={r.id} type="button" size="sm" variant="outline"
                              className="h-7 text-[11px]" title={r.hint}
                              onClick={() => applyGroundResolution(r)}
                            >
                              {r.label}
                            </Button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {groundKeys.length > 0 && (
                  <p className="text-sm font-medium">
                    Ground package total: {formatMoney(groundCost, "USD")}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 0 && !aviation && (
            <>
              <RoadRouteMap
                origin={trip.origin}
                destination={trip.destination}
                originPoint={originPoint}
                destinationPoint={destinationPoint}
                departAt={trip.time ? `${trip.date}T${trip.time}` : trip.date}
              />
              <DelegateCompositionPanel value={delegates} onChange={setDelegates} />
              <PassengerIntelligencePanel
                value={passengerIntel}
                onChange={setPassengerIntel}
                passengers={passengers.length}
              />
              <ConciergeServicesPanel
                selected={conciergeIds}
                onToggle={(id, on) =>
                  setConciergeIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)))
                }
              />
            </>
          )}

          {step === 0 && (
            <EnterpriseProcurementPanel
              value={procurement}
              onChange={setProcurement}
              signedIn={Boolean(user)}
            />
          )}



          {step === 1 && (
            <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
              <div>
                <h2 className="font-semibold text-lg">{lex.manifestLabel}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {internationalSector
                    ? "This sector crosses a border — a valid passport number is required for every passenger."
                    : "Domestic sector — a national ID or a passport is accepted for every passenger."}
                </p>
              </div>
              {passengers.map((p, i) => {
                const patch = (v: Partial<Passenger>) =>
                  setPassengers(passengers.map((x, j) => (j === i ? { ...x, ...v } : x)));
                return (
                  <div key={i} className="rounded-xl border border-border/70 bg-secondary/20 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">Passenger {i + 1}{p.seat ? ` · seat ${p.seat}` : ""}</h3>
                      <Button variant="ghost" size="icon" aria-label={`Remove passenger ${i + 1}`} onClick={() => setPassengers(passengers.filter((_, j) => j !== i))} disabled={passengers.length === 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field id={`pn-${i}`} label="Full name (as on travel document)" value={p.name} onChange={(v) => patch({ name: v, document: v ? p.document : "" })} />
                      <Field id={`pid-${i}`} label={internationalSector ? "National ID (optional)" : "National ID"} value={p.idNumber} onChange={(v) => patch({ idNumber: v, document: p.passportNumber || v })} />
                      <Field id={`ppt-${i}`} label={internationalSector ? "Passport number (required)" : "Passport number (optional)"} value={p.passportNumber} onChange={(v) => patch({ passportNumber: v, document: v || p.idNumber })} />
                      <Field id={`pph-${i}`} label="Phone (required)" value={p.phone} onChange={(v) => patch({ phone: v })} />
                      <Field id={`pem-${i}`} label="Email (required)" type="email" value={p.email} onChange={(v) => patch({ email: v })} />
                      <Field id={`pst-${i}`} label="Seat (optional)" value={p.seat} onChange={(v) => patch({ seat: v })} />
                    </div>
                    {(() => {
                      const issues = passengerIssues(p, internationalSector);
                      if (!issues.length) return null;
                      return (
                        <ul className="space-y-0.5 text-xs text-destructive" role="alert">
                          {issues.map((issue) => (
                            <li key={issue}>Required: {MANIFEST_ISSUE_LABEL[issue]}</li>
                          ))}
                        </ul>
                      );
                    })()}
                  </div>
                );
              })}
              <Button variant="outline" size="sm" onClick={() => setPassengers([...passengers, emptyPassenger()])}>
                <Plus className="mr-1 h-4 w-4" /> Add passenger
              </Button>

              <div className="rounded-xl border border-border p-4 space-y-5">
                <div>
                  <h3 className="font-semibold text-sm">Cabin experience</h3>
                  <p className="text-xs text-muted-foreground">
                    Preview the {lex.assetLabel.toLowerCase()}, choose the {lex.seatingLabel.toLowerCase()} and pick your party's seats.
                  </p>
                </div>
                <AircraftGallery aircraftKey={aircraftKey} aircraftLabel={assetName} layoutKey={layoutKey} />
                <CabinSeatPicker
                  aircraftKey={aircraftKey}
                  aircraftLabel={assetName}
                  capacity={cabinSeats}
                  layoutKey={layoutKey}
                  onLayoutChange={(k) => {
                    void recordCharterBookingChange(
                      "charter_cabin_layout_changed",
                      { cabin_layout: layoutKey, seats: cabinSelection },
                      { cabin_layout: k, seats: [] },
                      { entityId: booking?.id ?? null, reference: booking?.reference ?? null, assetName },
                    );
                    setLayoutKey(k);
                    setCabinSelection([]);
                  }}
                  selectedSeats={cabinSelection}
                  onToggleSeat={(id) =>
                    setCabinSelection((prev) => {
                      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
                      // Keep the manifest rows aligned with the chosen seats.
                      setPassengers((rows) => rows.map((r, idx) => ({ ...r, seat: next[idx] ?? "" })));
                      void recordCharterBookingChange(
                        "charter_seat_selection_changed",
                        { seats: prev },
                        { seats: next, cabin_layout: layoutKey },
                        { entityId: booking?.id ?? null, reference: booking?.reference ?? null, assetName },
                      );
                      return next;
                    })
                  }
                  maxSeats={Math.max(passengers.length, cabinSeats)}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
              <h2 className="font-semibold text-lg">Notification preferences</h2>
              <p className="text-sm text-muted-foreground">
                Choose what we send to {contact.email || "your email"}. You can change this at any time.
              </p>
              {PREF_OPTIONS.map((o) => (
                <div key={o.key} className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
                  <div>
                    <Label htmlFor={`pref-${o.key}`} className="font-medium">{o.label}</Label>
                    <p className="text-xs text-muted-foreground">{o.hint}</p>
                  </div>
                  <Switch
                    id={`pref-${o.key}`}
                    checked={Boolean(prefs[o.key])}
                    onCheckedChange={(v) => setPrefs((p) => ({ ...p, [o.key]: v }))}
                  />
                </div>
              ))}
              {user && (
                <Button
                  variant="outline" size="sm" disabled={prefsSaving}
                  onClick={async () => {
                    setPrefsSaving(true);
                    try {
                      await charterApi.savePrefs({ ...prefs, contact_email: contact.email });
                      toast({ title: "Preferences saved" });
                    } catch (e) {
                      toast({ title: "Could not save preferences", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
                    } finally {
                      setPrefsSaving(false);
                    }
                  }}
                >
                  {prefsSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save preferences
                </Button>
              )}
            </div>
          )}

          {step === 2 && !aviation && roadFare && (
            <DocumentPreviewCard
              reference={booking?.reference ?? `QUOTE-${category.slug.toUpperCase()}`}
              customerName={contact.name}
              vehicle={booking?.asset_name ?? assetName}
              passengers={Math.max(1, passengers.filter((p) => p.name.trim()).length)}
              route={roadRouteLabel([
                { label: "Pickup", address: trip.origin, lat: originPoint?.lat, lng: originPoint?.lng },
                { label: "Drop-off", address: trip.destination, lat: destinationPoint?.lat, lng: destinationPoint?.lng },
              ])}
              itinerary={roadItineraryLines({
                reference: booking?.reference ?? "",
                customerName: contact.name,
                vehicle: booking?.asset_name ?? assetName,
                passengers: Math.max(1, passengers.filter((p) => p.name.trim()).length),
                departAt: trip.time ? `${trip.date}T${trip.time}` : trip.date,
                fare: roadFare,
                points: [
                  { label: "Pickup", address: trip.origin, lat: originPoint?.lat, lng: originPoint?.lng },
                  { label: "Drop-off", address: trip.destination, lat: destinationPoint?.lat, lng: destinationPoint?.lng },
                ],
                notes: [trip.notes, ...passengerIntelligenceLines(passengerIntel)]
                  .filter(Boolean)
                  .join(" · "),
              })}
              fare={roadFare}
              paymentStatus={booking?.payment_status ?? null}
              onDownload={() => void generateItinerary()}
              downloading={pdfBusy}
            />
          )}

          {step === 3 && !aviation && roadFare && (

            <>
              <RoadQuoteApproval
                reference={booking?.reference ?? `QUOTE-${category.slug.toUpperCase()}`}
                itinerary={{
                  assetName,
                  origin: trip.origin,
                  destination: trip.destination,
                  originPoint,
                  destinationPoint,
                  date: trip.time ? `${trip.date} ${trip.time}` : trip.date,
                  duration,
                  unit,
                  quantity,
                  passengers: Math.max(1, passengers.filter((x) => x.name.trim()).length),
                  notes: trip.notes,
                }}
                fareLines={roadLines}
                totalLabel={formatMoney(roadFare.total, category.currency)}
                totalKes={roadFare.total}
                contact={contact}
                method={method}
                onMethodChange={(m) => {
                  setMethod(m);
                  if (booking?.id) {
                    void charterApi
                      .selectRoadPaymentRoute({ booking_id: booking.id, method: m })
                      .then((updated) => {
                        setBooking(updated);
                        toast({
                          title: "Payment route recorded",
                          description: roadPaymentLabel(updated.payment_status),
                        });
                      })
                      .catch(() => {
                        /* Selection still applies locally; admin queue picks it up on payment. */
                      });
                  }
                }}
                approved={approved}
                onApprovedChange={setApproved}
                procurement={procurement}
                onProcurementChange={setProcurement}
                bookingId={booking?.id ?? null}
                signedIn={Boolean(user)}
                onWalletSettled={() => {
                  if (booking?.id) {
                    void charterApi
                      .selectRoadPaymentRoute({ booking_id: booking.id, method: "corporate_wallet" })
                      .then(setBooking)
                      .catch(() => undefined);
                  }
                }}
                onDownloadInvoice={() => void generateItinerary()}
                downloading={pdfBusy}
                paymentStatus={booking?.payment_status ?? "pending"}
                invoice={invoiceDoc}
              />
              {!authLoading && !user && (
                <p className="text-sm text-destructive">
                  Sign in to confirm this booking.{" "}
                  <Link className="underline" to={corporateLoginHref(charterPlannerPath(slug))}>Sign in</Link>
                </p>
              )}
            </>
          )}

          {step === 3 && (aviation || !roadFare) && (
            <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
              <h2 className="font-semibold text-lg">Payment method</h2>
              <RadioGroup value={method} onValueChange={setMethod} className="space-y-3">
                {PAYMENT_METHODS.map((m) => (
                  <div key={m.id} className="flex items-start gap-3 rounded-xl border border-border p-4">
                    <RadioGroupItem value={m.id} id={`pm-${m.id}`} className="mt-1" />
                    <div>
                      <Label htmlFor={`pm-${m.id}`} className="font-medium">{m.label}</Label>
                      <p className="text-xs text-muted-foreground">{m.hint}</p>
                    </div>
                  </div>
                ))}
              </RadioGroup>
              {!authLoading && !user && (
                <p className="text-sm text-destructive">
                  Sign in to confirm this booking.{" "}
                  <Link className="underline" to={corporateLoginHref(charterPlannerPath(slug))}>Sign in</Link>
                </p>
              )}
            </div>
          )}

          {step === 4 && booking && (
            <div className="rounded-2xl border border-primary/40 bg-card p-6 space-y-3">
              <CheckCircle2 className="h-10 w-10 text-status-success" />
              <h2 className="text-xl font-semibold">{lex.brandEmoji} {lex.confirmationTitle}</h2>
              <p className="text-sm text-muted-foreground">
                Reference <span className="font-mono font-semibold text-foreground">{booking.reference}</span> ·{" "}
                {booking.asset_name} · {formatMoney(Number(booking.amount), category.currency)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className={
                    isRoadUnpaid(booking.payment_status) && !aviation
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : undefined
                  }
                >
                  Payment: {aviation ? booking.payment_status : roadPaymentLabel(booking.payment_status)}
                </Badge>
                <Badge variant="outline">Status: {booking.status}</Badge>
                {aviation ? (
                  <Badge variant="outline">Flight: {booking.flight_status}</Badge>
                ) : (
                  <Badge variant="outline">
                    Travel approval:{" "}
                    {ROAD_TRAVEL_STAGE_LABELS[
                      roadTravelStage({ status: booking.status, payment_status: booking.payment_status })
                    ]}
                  </Badge>
                )}
              </div>

              {aviation && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{lex.seatingLabel} (contracted)</p>
                  <p className="text-sm font-semibold">
                    {(booking.trip as Record<string, string>)?.cabin_layout_label ??
                      layoutByKey(String((booking.trip as Record<string, string>)?.cabin_layout ?? layoutKey))?.label ??
                      "Operator standard"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Seats:{" "}
                    {(Array.isArray((booking.trip as Record<string, unknown>)?.seats)
                      ? ((booking.trip as Record<string, unknown>).seats as string[])
                      : cabinSelection
                    ).join(", ") || "Assigned at boarding"}
                  </p>
                </div>
              )}

              {aviation ? (
                <AircraftGallery
                  aircraftKey={aircraftKey}
                  aircraftLabel={booking.asset_name}
                  layoutKey={layoutKey}
                  className="pt-2"
                />
              ) : (
                <VehicleImage assetName={booking.asset_name} className="pt-2" />
              )}

              {aviation && (
                <details className="rounded-xl border border-border/60 p-4">
                  <summary className="cursor-pointer text-sm font-semibold">Change {lex.seatingLabel.toLowerCase()} or seats</summary>
                  <div className="pt-4">
                    <CabinSeatPicker
                      aircraftKey={aircraftKey}
                      aircraftLabel={booking.asset_name}
                      capacity={cabinSeats}
                      layoutKey={layoutKey}
                      onLayoutChange={(k) => void amendCabin(k, [])}
                      selectedSeats={cabinSelection}
                      onToggleSeat={(id) =>
                        void amendCabin(
                          layoutKey,
                          cabinSelection.includes(id)
                            ? cabinSelection.filter((s) => s !== id)
                            : [...cabinSelection, id],
                        )
                      }
                      maxSeats={Math.max(passengers.length, cabinSeats)}
                    />
                    {amending && <p className="pt-2 text-xs text-muted-foreground">Updating manifest…</p>}
                  </div>
                </details>
              )}

              {groundKeys.length > 0 && (
                <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                  <p className="mb-2 text-sm font-semibold">Ground transportation</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {groundSummaryLines(groundKeys, groundDetails).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}


              <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="mb-3 text-sm font-semibold">{aviation ? "Flight status" : "Travel approval status"}</p>
                {aviation ? (
                  <FlightTimeline currentStatus={booking.flight_status} events={booking.flight_events ?? []} />
                ) : (
                  <RoadApprovalTimeline status={booking.status} paymentStatus={booking.payment_status} />
                )}
              </div>

              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <p className="text-sm font-semibold">Pay with M-Pesa</p>
                <p className="text-xs text-muted-foreground">
                  We send an STK prompt to your phone — approve it with your M-Pesa PIN to settle{" "}
                  {formatMoney(Number(booking.amount), category.currency)}. Repeated clicks reuse the same
                  prompt and can never create a second charge.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={payPhone || contact.phone}
                    onChange={(e) => setPayPhone(e.target.value)}
                    placeholder="2547XXXXXXXX"
                    className="max-w-[220px]"
                    inputMode="tel"
                  />
                  <Button onClick={() => void payWithMpesa()} disabled={paying || booking.payment_status === "paid"}>
                    {paying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {booking.payment_status === "paid" ? "Paid" : "Send STK prompt"}
                  </Button>
                </div>
                {payment && (
                  <p className="text-xs text-muted-foreground">
                    Prompt sent to {payment.phone_masked} for KES {payment.amount_kes.toLocaleString()}.{" "}
                    {payment.checkout_request_id ? `Ref ${payment.checkout_request_id}.` : ""} {payment.message}
                  </p>
                )}
                {payRecovery && (
                  <div className="rounded-xl border border-status-warning/40 bg-status-warning/10 p-3 space-y-2">
                    <p className="text-xs font-semibold">
                      {payRecovery.code === "already_paid"
                        ? "This booking is already paid"
                        : "A payment prompt for this booking already exists"}
                    </p>
                    <p className="text-xs text-muted-foreground">{payRecovery.message}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void loadPaymentState()} disabled={payChecking}>
                        {payChecking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        View existing payment confirmation
                      </Button>
                      <Button data-analytics="charterbooking.download" size="sm" variant="outline" onClick={() => void downloadReceipt()} disabled={pdfBusy}>
                        Download receipt
                      </Button>
                    </div>
                  </div>
                )}
                {payLedger.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-muted-foreground">
                    {payLedger.slice(0, 4).map((ev) => (
                      <li key={ev.created_at} className="flex flex-wrap gap-2">
                        <span className="font-medium text-foreground">{ev.applied_status}</span>
                        <span>{ev.mpesa_receipt ?? ev.result_desc ?? "—"}</span>
                        <span>{new Date(ev.created_at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button data-analytics="charterbooking.download" onClick={() => void generateItinerary()} disabled={pdfBusy}>
                  {pdfBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                  Download secure itinerary (PDF)
                </Button>
                <Button data-analytics="charterbooking.download" variant="outline" onClick={() => void downloadReceipt()} disabled={pdfBusy}>
                  <FileText className="mr-2 h-4 w-4" /> Download secure receipt (PDF)
                </Button>
                {prefs.downloadable_summaries && (
                  <Button data-analytics="charterbooking.download" variant="outline" onClick={downloadSummary}>
                    <Download className="mr-2 h-4 w-4" /> Download summary
                  </Button>
                )}
                <Button variant="outline" onClick={() => navigate(`/charter/${category.slug}`)}>Back to marketplace</Button>
                <Button asChild><Link to="/charter">Explore more charters</Link></Button>

              </div>
            </div>
          )}

          {recovery && step === 3 && (
            <div className="rounded-2xl border border-status-warning/40 bg-status-warning/10 p-5 space-y-3">
              <p className="text-sm font-semibold">
                {recovery.code === "duplicate_in_flight"
                  ? "This booking is already being confirmed"
                  : "This submission was already used"}
              </p>
              <p className="text-xs text-muted-foreground">{recovery.message}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void recoverBooking()} disabled={recovering}>
                  {recovering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  View existing confirmation
                </Button>
                <Button size="sm" variant="outline" onClick={() => void submit()} disabled={submitting}>
                  Safely retry
                </Button>
              </div>
            </div>
          )}

          {step < 4 && (
            <div className="space-y-3">
              {step === 3 && needsPublishedPricing && (pricingBlocked || pricingError) && (
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  {pricingBlocked ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  )}
                  <div>
                    <p className="font-medium">
                      {pricingBlocked ? "Waiting for published pricing" : "Pricing is updating"}
                    </p>
                    <p className="text-muted-foreground">
                      {pricingBlocked
                        ? "This category is priced from the governed SAFARID Air pricing version. Confirm unlocks the moment it loads."
                        : pricingError}
                    </p>
                  </div>
                  {!pricingBlocked && (
                    <Button variant="outline" size="sm" className="ml-auto" onClick={() => void loadPricing()}>
                      Retry
                    </Button>
                  )}
                </div>
              )}
              {blockReport && (
                <ValidationBlockerAlert
                  report={blockReport}
                  onFocusField={(field) => {
                    const el = document.getElementById(field.split(".").pop() ?? field);
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    (el as HTMLElement | null)?.focus?.();
                  }}
                />
              )}
              {step < 3 && continueBlockers.length > 0 && (
                <ul
                  role={attempted ? "alert" : undefined}
                  data-testid="continue-blockers"
                  className={`rounded-xl border p-3 space-y-1 ${
                    attempted ? "border-destructive/50 bg-destructive/5" : "border-border bg-secondary/20"
                  }`}
                >
                  {attempted && (
                    <li className="text-xs font-semibold text-destructive">
                      Complete the following before continuing:
                    </li>
                  )}
                  {continueBlockers.map((b) => (
                    <li key={b} className={`text-xs ${attempted ? "text-destructive" : "text-muted-foreground"}`}>• {b}</li>
                  ))}
                </ul>
              )}
              <div className="flex justify-between">

                <Button variant="outline" onClick={() => { setAttempted(false); setStep((s) => Math.max(0, s - (!aviation && s === 2 ? 2 : 1))); }} disabled={step === 0}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                {step < 3 ? (
                  <Button
                    onClick={handleContinue}
                    aria-disabled={!canContinue}
                    title={continueBlockers.join(" ")}
                  >
                    Continue <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button onClick={() => void submit()} disabled={submitting || !user || pricingBlocked || (!aviation && !approved)}>
                    {(submitting || pricingBlocked) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {pricingBlocked ? "Waiting for published pricing…" : "Confirm booking"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6 h-fit lg:sticky lg:top-24">
        <MissionSummarySidebar
          status={readiness.score >= 100 ? "Ready for approval" : `Readiness ${readiness.score}%`}
          assetName={assetName}
          units={vehicleFit?.unitsRequired ?? quantity}
          partySize={missionState.partySize}
          durationLabel={`${duration} ${unit}${duration === 1 ? "" : "s"}`}
          departure={trip.origin || "Pickup pending"}
          arrival={trip.destination || "Drop-off pending"}
          currency={category.currency}
          estimatedCost={total}
          extras={conciergeLabels}
          quoteExpiry={`Quote valid until ${new Date(Date.now() + 48 * 60 * 60 * 1000).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })} (48 hours from issue)`}
          supportContact="support@safarid.org · +254 142 970050"
        />
        <aside className="rounded-2xl border border-border bg-card p-6 space-y-2 text-sm">
          <h2 className="font-semibold">Quote summary</h2>
          <p className="text-xs text-muted-foreground">{assetName}</p>
          {/* The governed breakdown is shown only when the authority actually priced it. */}
          {airAuthority.priced && airAuthority.quote && (
            <div className="pt-2" data-testid="ap360-authoritative">
              <PricingExplained quote={airAuthority.quote} loading={airAuthority.loading} />
            </div>
          )}
          {!airAuthority.priced && airQuote && (
            <p
              className="pt-2 text-xs text-warning-foreground"
              data-testid="ap360-indicative-notice"
              role="status"
              aria-live="polite"
              aria-label="Indicative estimate — no authoritative price has been applied"
            >
              Indicative estimate — {airAuthority.blockedReason ??
                "no published Asset Pricing 360 version governs this aircraft category yet"}
              , so this figure is confirmed by our charter desk before payment.
            </p>
          )}
          {!airAuthority.priced && airQuote ? (
            <div className="space-y-1.5 pt-2">
              <SummaryRow
                label={`Base (${airQuote.time.billableHours}h × ${formatMoney(airQuote.hourlyRate, category.currency)})`}
                value={formatMoney(airQuote.baseCost, category.currency)}
              />
              <SummaryRow label="Airport, handling & crew" value={formatMoney(airQuote.operationalTotal, category.currency)} />
              {airQuote.multiplierEffect !== 1 && (
                <SummaryRow label="Demand & season" value={`×${airQuote.multiplierEffect.toFixed(2)}`} />
              )}
              {airQuote.discounts.map((d) => (
                <SummaryRow key={d.label} label={d.label} value={`−${d.amount}%`} />
              ))}
              <SummaryRow label="Platform commission" value={formatMoney(airQuote.platformCommission, category.currency)} />
              <SummaryRow label="Technology fee" value={formatMoney(airQuote.technologyFee, category.currency)} />
              <SummaryRow label="Payment processing" value={formatMoney(airQuote.paymentProcessing, category.currency)} />
              {airQuote.taxes > 0 && <SummaryRow label="Taxes (VAT)" value={formatMoney(airQuote.taxes, category.currency)} />}
              <div className="border-t border-border pt-2 mt-2 flex justify-between font-semibold text-base">
                <span>Total</span>
                <span>{formatMoney(airQuote.customerPrice, category.currency)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                ≈ KES {airQuote.customerPriceKes.toLocaleString()} · generated price, not a manual quotation
              </p>
              {airQuote.emptyLeg && (
                <div className="rounded-lg border border-status-success/30 bg-status-success/5 p-3 mt-3 space-y-1">
                  <p className="text-xs font-semibold text-status-success dark:text-status-success">
                    Empty-leg saving applied — {airQuote.emptyLeg.pct}%
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Regulated band {airQuote.emptyLeg.minPct}–{airQuote.emptyLeg.maxPct}%
                    {airQuote.emptyLeg.clamped
                      ? ` · operator requested ${airQuote.emptyLeg.requestedPct}%, held inside the platform limit`
                      : " · within operator limits"}
                  </p>
                </div>
              )}

              <details className="mt-3 rounded-lg border border-border p-3">
                <summary className="text-xs font-semibold cursor-pointer">Cancellation & refund policy</summary>
                <ul className="mt-2 space-y-1">
                  {airQuote.cancellationPolicy.tiers.map((t) => (
                    <li key={t.key} className="flex justify-between gap-3 text-[11px]">
                      <span className="text-muted-foreground">{t.label} · {t.window}</span>
                      <span className="whitespace-nowrap">
                        fee {formatMoney(t.feeAmount, category.currency)} · refund {formatMoney(t.refundAmount, category.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {airQuote.cancellationPolicy.summary} Refunds settle within{" "}
                  {airQuote.cancellationPolicy.refundProcessingDays} business days.
                </p>
              </details>

              <p className="text-[11px] text-muted-foreground">
                Pricing version {pricing?.version ?? 0}
                {pricing?.fallback ? " (platform defaults)" : ""}
              </p>

            </div>
          ) : roadFare ? (
            <div className="space-y-1.5 pt-2">
              {roadLines.map((l) => (
                <SummaryRow key={l.label} label={l.label} value={l.value} />
              ))}
              <div className="border-t border-border pt-2 mt-2 flex justify-between font-semibold text-base">
                <span>Total</span>
                <span>{formatMoney(roadFare.total, category.currency)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatMoney(roadFare.perUnit, category.currency)} per {unit}
              </p>
              {roadPrice.fare && (
                <p className="text-[11px] text-muted-foreground">
                  Rate card {roadPrice.fare.rateCardVersion ?? "—"} · commercial rules{" "}
                  {roadPrice.fare.ruleSetVersion ?? "—"}
                </p>
              )}
            </div>
          ) : !aviation ? (
            <div className="space-y-2 pt-2">
              {roadPrice.loading ? (
                <p className="text-sm text-muted-foreground">Retrieving the published rate…</p>
              ) : (
                <>
                  <p className="text-sm font-medium">Manual pricing review required</p>
                  <p className="text-xs text-muted-foreground">
                    {roadPrice.blockedReason ??
                      "Enter the vehicle and route to retrieve the published rate."}
                  </p>
                </>
              )}
            </div>
          ) : quote && (
            <div className="space-y-1.5 pt-2">
              <SummaryRow label="Base + operating" value={formatMoney(quote.gross, category.currency)} />
              <SummaryRow label="Fuel" value={formatMoney(quote.fuelCost, category.currency)} />
              <SummaryRow label={lex.crewLabel} value={formatMoney(quote.crewCost, category.currency)} />
              <SummaryRow label={lex.feesLabel} value={formatMoney(quote.airportFees, category.currency)} />
              <SummaryRow label="Demand × season" value={`×${(quote.demandMultiplier * quote.seasonMultiplier).toFixed(2)}`} />
              <SummaryRow label="Volume tier" value={`−${quote.volumeDiscountPct}%`} />
              {quote.offerDiscountPct > 0 && <SummaryRow label="Empty-leg / offer" value={`−${quote.offerDiscountPct}%`} />}
              <div className="border-t border-border pt-2 mt-2 flex justify-between font-semibold text-base">
                <span>Total</span>
                <span>{formatMoney(quote.net, category.currency)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatMoney(quote.effectiveRate, category.currency)} per {unit}
              </p>
            </div>
          )}

          {groundKeys.length > 0 && (
            <div className="border-t border-border pt-3 mt-3 space-y-1.5">
              <p className="font-semibold">Ground transportation</p>
              {groundKeys.map((k) => {
                const svc = GROUND_SERVICES.find((g) => g.key === k);
                if (!svc) return null;
                return <SummaryRow key={k} label={svc.label} value={formatMoney(svc.price, "USD")} />;
              })}
              <div className="flex justify-between font-semibold">
                <span>Itinerary total</span>
                <span>{formatMoney(total, category.currency)}</span>
              </div>
            </div>
          )}
        </aside>
        <MissionReadinessPanel readiness={readiness} />
        <AiConciergeFeed advisories={advisories} />
        </div>


      </section>
    </Shell>
  );
};

function parseCosts(raw: string | null): Partial<CostSettings> {
  if (!raw) return {};
  try {
    return JSON.parse(decodeURIComponent(raw)) as Partial<CostSettings>;
  } catch {
    return {};
  }
}

const Field = ({
  id, label, value, onChange, type = "text",
}: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string }) => (
  <div>
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} type={type} className="mt-2" maxLength={200} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between text-muted-foreground">
    <span>{label}</span>
    <span className="text-foreground">{value}</span>
  </div>
);

export default CharterBooking;
