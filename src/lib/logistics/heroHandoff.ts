/**
 * DELIVERY HERO → BOOKING HANDOFF CONTRACT
 *
 * The marketing hero captures intent facts. This module is the single place
 * that (a) declares which facts are mandatory before a handoff is allowed and
 * (b) translates human-readable hero answers into the canonical booking
 * parameters consumed by `/delivery/book` and `/delivery/enquiry`.
 *
 * No pricing, no persistence — the authoritative rating and compliance checks
 * remain server-side in `logistics-quote` / `logistics-book`.
 */

import { affordances, commitmentForOffering } from "./domain/commitment";

export type HeroIntent = "parcel" | "documents" | "express" | "freight" | "truck" | "business";

/** Fields that must be answered before the CTA may hand off. */
export const REQUIRED_FIELDS: Record<HeroIntent, string[]> = {
  parcel: ["pickup", "dropoff", "parcelType", "weight", "speed"],
  documents: ["pickup", "dropoff", "docType", "speed"],
  express: ["pickup", "dropoff", "weight"],
  freight: ["origin", "destination", "cargo", "tonnage"],
  truck: ["origin", "destination", "vehicle", "date"],
  business: ["company", "volume", "service"],
};

export const FIELD_LABELS: Record<string, string> = {
  pickup: "Pickup address",
  dropoff: "Delivery address",
  origin: "Origin",
  destination: "Destination",
  parcelType: "Parcel type",
  docType: "Document type",
  weight: "Weight",
  speed: "Delivery speed",
  cargo: "Cargo type",
  tonnage: "Tonnage",
  vehicle: "Vehicle class",
  date: "Pickup date",
  company: "Company",
  volume: "Monthly volume",
  service: "Requirement",
};

/** Human parcel/document answers → canonical catalogue package types. */
const PACKAGE_TYPE_MAP: Record<string, string> = {
  "Small parcel": "SMALL_PARCEL",
  Box: "PARCEL",
  Electronics: "PARCEL",
  Fragile: "PARCEL",
  Perishable: "PARCEL",
  Legal: "DOCUMENT",
  Medical: "DOCUMENT",
  Financial: "DOCUMENT",
  Government: "DOCUMENT",
  General: "DOCUMENT",
};

/** Speed answers that require the express offering rather than standard parcel. */
const EXPRESS_SPEEDS = new Set(["Express (≤ 60 min)"]);

export interface HeroValidation {
  ok: boolean;
  errors: Record<string, string>;
}

export function validateHero(intent: HeroIntent, values: Record<string, string>): HeroValidation {
  const errors: Record<string, string> = {};
  for (const field of REQUIRED_FIELDS[intent] ?? []) {
    const raw = (values[field] ?? "").trim();
    if (!raw) {
      errors[field] = `${FIELD_LABELS[field] ?? field} is required`;
      continue;
    }
    if (field === "weight" || field === "tonnage") {
      const n = Number(raw.replace(/[^\d.]/g, ""));
      if (!Number.isFinite(n) || n <= 0) errors[field] = `Enter a valid ${FIELD_LABELS[field].toLowerCase()}`;
    }
    if ((field === "pickup" || field === "dropoff" || field === "origin" || field === "destination") && raw.length < 3) {
      errors[field] = `${FIELD_LABELS[field]} is too short`;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Build the destination URL for a validated hero submission.
 * `base` is the intent's configured target (may already carry query params).
 */
export function buildHandoffUrl(intent: HeroIntent, base: string, values: Record<string, string>): string {
  const [basePath, existingQuery] = base.split("?");
  let path = basePath;
  const params = new URLSearchParams(existingQuery ?? "");
  params.set("intent", intent);

  Object.entries(values).forEach(([k, v]) => {
    const value = (v ?? "").trim();
    if (value) params.set(k, value);
  });

  // Canonical package type for the booking engine.
  const humanType = values.parcelType || values.docType;
  if (humanType && PACKAGE_TYPE_MAP[humanType]) params.set("packageType", PACKAGE_TYPE_MAP[humanType]);

  // Express speed overrides the offering so the price shown matches the promise —
  // but only while Express is actually bookable. Express city is currently
  // ENQUIRY_ONLY (pilot), so handing it to /delivery/book guarantees a
  // SERVICE_PILOT_ONLY refusal. Send those requests to the enquiry desk instead.
  if (intent === "parcel" && values.speed && EXPRESS_SPEEDS.has(values.speed)) {
    params.set("offering", "EXPRESS_CITY");
    if (path === "/delivery/book" && !affordances(commitmentForOffering("EXPRESS_CITY")).bookNow) {
      path = "/delivery/enquiry";
    }
  }

  // Numeric weight only — the booking form expects a number.
  if (values.weight) {
    const n = values.weight.replace(/[^\d.]/g, "");
    if (n) params.set("weight", n);
  }

  // Route facts are complete, so skip the booking wizard ahead to the package step.
  if (path === "/delivery/book" && values.pickup?.trim() && values.dropoff?.trim()) {
    params.set("step", "3");
  }

  return `${path}?${params.toString()}`;
}
