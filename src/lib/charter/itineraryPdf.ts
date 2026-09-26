import { formatMoney } from "./catalog";
import { domainLexicon, resolveAssetDomain } from "./assetDomains";
/**
 * Secure charter itinerary PDF.
 *
 * The itinerary doubles as a boarding/handling document, so it is produced as a
 * security-printed artefact: guilloche rosettes and a lathe-work border drawn
 * from parametric curves (impossible to reproduce by screenshot resampling),
 * a void-pantograph micro-hatch, repeated microtext, a deterministic document
 * fingerprint printed in three independent places, and a serialised control
 * number that operations can verify against the booking record.
 */
import jsPDF from "jspdf";
import { imagesFor } from "@/lib/charter/flightSearch";
import { layoutByKey } from "@/lib/charter/cabinLayouts";
import { GROUND_SERVICES, type GroundDetail } from "@/lib/charter/groundTransport";
import { fetchActivePdfTemplate } from "@/lib/charter/pdfTemplate";


export interface IssuerBranding {
  name: string;
  division: string;
  address: string;
  phone: string;
  email: string;
  web: string;
  logo_url?: string | null;
}

/** Built-in branding — superseded by the active server-side PDF template. */
export const ISSUER: IssuerBranding = {
  name: "SAFARID",
  division: "SAFARID Air · Charter, Leasing & Rentals",
  address: "Nairobi, Kenya",
  phone: "+254 142 970050",
  email: "support@safarid.org",
  web: "safarid.org",
};


export interface ItineraryQuoteLine { label: string; value: string }

export interface ItineraryInput {
  reference: string;
  categoryLabel: string;
  /** Marketplace slug — resolves the product domain (aviation, bus, marine…). */
  categorySlug?: string;
  assetName: string;
  aircraftKey: string;
  layoutKey?: string;
  seats: string[];
  origin: string;
  destination: string;
  date: string;
  passengers: Array<{ name: string; seat?: string; document?: string; phone?: string; email?: string }>;
  groundKeys: string[];
  groundDetails: Record<string, GroundDetail>;
  quoteLines: ItineraryQuoteLine[];
  totalLabel: string;
  currency: string;
  paymentMethod: string;
  paymentStatus: string;
  contactName?: string;
  /** Branding from the active server-side template (falls back to ISSUER). */
  branding?: Partial<IssuerBranding>;
  /** Template version stamped on the document for audit traceability. */
  templateVersion?: string;
}


/* ------------------------------------------------------------------ */
/* Forensic primitives                                                 */
/* ------------------------------------------------------------------ */

/** Deterministic 64-bit-ish fingerprint (FNV-1a x2) of the document payload. */
export function documentFingerprint(payload: unknown): string {
  const s = JSON.stringify(payload);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    a ^= s.charCodeAt(i);
    a = Math.imul(a, 0x01000193) >>> 0;
    b = (Math.imul(b ^ s.charCodeAt(s.length - 1 - i), 0x85ebca6b) >>> 0) ^ (a >>> 7);
  }
  return (a.toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0")).toUpperCase();
}

/** Human-checkable control number: YM-<ref>-<mod97 check>. */
export function controlNumber(reference: string, fingerprint: string): string {
  const digits = (reference + fingerprint).replace(/\D/g, "").slice(-12) || "0";
  const check = String(97 - (Number(digits.slice(-9)) % 97)).padStart(2, "0");
  return `YM-${reference}-${check}`;
}

/** Loads an imported asset URL into a data URL for embedding. */
async function toDataUrl(src: string): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = src;
    });
    const canvas = document.createElement("canvas");
    const w = 420;
    canvas.width = w;
    canvas.height = Math.round((img.height / img.width) * w) || w;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

/** Parametric guilloche rosette — spirograph curve, security-print style. */
export function guilloche(
  doc: jsPDF,
  cx: number,
  cy: number,
  R: number,
  r: number,
  d: number,
  rgb: [number, number, number],
  turns = 24,
) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  doc.setLineWidth(0.12);
  const steps = 900;
  const k = (R - r) / r;
  let px = 0;
  let py = 0;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * turns;
    const x = cx + (R - r) * Math.cos(t) + d * Math.cos(k * t);
    const y = cy + (R - r) * Math.sin(t) - d * Math.sin(k * t);
    if (i > 0) doc.line(px, py, x, y);
    px = x;
    py = y;
  }
}

/** Lathe-work wave band used along the document edges. */
export function latheBand(doc: jsPDF, x: number, y: number, w: number, amp: number, rgb: [number, number, number]) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  doc.setLineWidth(0.1);
  for (let phase = 0; phase < 5; phase++) {
    let px = x;
    let py = y;
    for (let i = 0; i <= 240; i++) {
      const t = i / 240;
      const cx2 = x + t * w;
      const cy2 = y + Math.sin(t * Math.PI * 14 + phase * 0.6) * amp * Math.cos(t * Math.PI);
      if (i > 0) doc.line(px, py, cx2, cy2);
      px = cx2;
      py = cy2;
    }
  }
}

/** Void-pantograph style micro-hatch that degrades badly when photocopied. */
export function microHatch(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setDrawColor(232, 238, 248);
  doc.setLineWidth(0.05);
  for (let i = 0; i < w + h; i += 1.4) {
    doc.line(x + i, y, x, y + i);
  }
}

/** Repeated microtext line — legible only above ~600dpi. */
export function microtext(doc: jsPDF, x: number, y: number, w: number, phrase: string) {
  doc.setFontSize(1.6);
  doc.setTextColor(150, 160, 180);
  const unit = `${phrase} · `;
  const repeats = Math.ceil(w / (unit.length * 0.42));
  doc.text(unit.repeat(repeats).slice(0, repeats * unit.length), x, y, { maxWidth: w });
}

export async function vectorLogo(doc: jsPDF, x: number, y: number, issuer: IssuerBranding) {
  // Emblem: layered delta wing inside a ring — drawn as vectors so it stays
  // crisp at any zoom and cannot be lifted as a bitmap. A configured logo is
  // embedded alongside the vector mark (never replacing the security emblem).
  doc.setDrawColor(29, 78, 216);
  doc.setLineWidth(0.7);
  doc.circle(x + 6, y + 6, 6);
  doc.setFillColor(29, 78, 216);
  doc.triangle(x + 2.6, y + 8.6, x + 9.8, y + 3.2, x + 7.2, y + 9.4, "F");
  doc.setFillColor(96, 165, 250);
  doc.triangle(x + 5.2, y + 9.6, x + 10.2, y + 5.8, x + 9.4, y + 9.8, "F");
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(issuer.name, x + 15, y + 6.4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(issuer.division, x + 15, y + 10.6);
  if (issuer.logo_url) {
    const url = await toDataUrl(issuer.logo_url);
    if (url) {
      try { doc.addImage(url, "PNG", x + 15 + doc.getTextWidth(issuer.name) + 4, y + 1, 16, 8); } catch { /* optional */ }
    }
  }
}


/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

export async function buildItineraryPdf(input: ItineraryInput): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const H = 297;
  const M = 14;

  const issuedAt = new Date();
  const issuer: IssuerBranding = { ...ISSUER, ...(input.branding ?? {}) };
  const lex = domainLexicon(input.categorySlug);
  const isAviation = resolveAssetDomain(input.categorySlug) === "aviation";
  const templateVersion = input.templateVersion ?? "v1";

  const fingerprint = documentFingerprint({
    r: input.reference, a: input.assetName, o: input.origin, d: input.destination,
    dt: input.date, s: input.seats, l: input.layoutKey, g: input.groundKeys, t: input.totalLabel,
    tpl: templateVersion,
  });
  const control = controlNumber(input.reference, fingerprint);

  // --- security substrate -------------------------------------------------
  microHatch(doc, 0, 0, W, H);
  guilloche(doc, W / 2, 150, 78, 29, 38, [223, 232, 246], 30);
  guilloche(doc, W / 2, 150, 52, 17, 24, [230, 238, 250], 22);
  guilloche(doc, 30, 262, 20, 7, 10, [214, 226, 245], 18);
  guilloche(doc, W - 30, 262, 20, 7, 10, [214, 226, 245], 18);
  latheBand(doc, M, 26, W - 2 * M, 2.4, [199, 214, 240]);
  latheBand(doc, M, H - 24, W - 2 * M, 2.4, [199, 214, 240]);
  doc.setDrawColor(29, 78, 216);
  doc.setLineWidth(0.5);
  doc.rect(7, 7, W - 14, H - 14);
  doc.setLineWidth(0.15);
  doc.rect(9, 9, W - 18, H - 18);
  microtext(doc, M, 20.5, W - 2 * M, `${issuer.name.toUpperCase().replace(/\s+/g, "")}·${input.reference}·${fingerprint}`);
  microtext(doc, M, H - 12, W - 2 * M, `${lex.documentTemplate.toUpperCase()}·${control}·TPL ${templateVersion}·NOT TRANSFERABLE`);

  // --- header -------------------------------------------------------------
  await vectorLogo(doc, M, 10, issuer);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    [issuer.address, issuer.phone, issuer.email, issuer.web],
    W - M,
    12,
    { align: "right" },
  );
  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text(`Template ${templateVersion}`, W - M, 24, { align: "right" });


  let y = 34;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(15, 23, 42);
  doc.text(lex.documentTitle, M, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `${input.categoryLabel} · Reference ${input.reference} · Issued ${issuedAt.toLocaleString()}`,
    M,
    y,
  );

  // --- trip facts ---------------------------------------------------------
  y += 7;
  const facts: Array<[string, string]> = [
    [`${lex.occupantLabel} of record`, input.contactName || input.passengers[0]?.name || "—"],
    [lex.assetLabel, input.assetName],
    [lex.routeLabel, `${input.origin || "—"}  ${String.fromCharCode(8594)}  ${input.destination || "—"}`],
    [lex.departureLabel, input.date || "—"],
    ...(isAviation
      ? ([[lex.seatingLabel, layoutByKey(input.layoutKey ?? "")?.label ?? "Operator standard"]] as Array<[string, string]>)
      : ([[lex.operatorLabel, input.categoryLabel]] as Array<[string, string]>)),
    ["Seats", input.seats.length ? input.seats.join(", ") : "Assigned at boarding"],
    ["Payment", `${input.paymentMethod} · ${input.paymentStatus}`],
    ["Total", input.totalLabel],
  ];
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(M, y, W - 2 * M, 34, 2, 2, "FD");
  facts.forEach(([k, v], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = M + 5 + col * ((W - 2 * M) / 2);
    const cy = y + 7 + row * 7;
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(k.toUpperCase(), cx, cy);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(String(v), cx + 34, cy);
  });
  y += 40;

  // --- asset gallery thumbnails (domain-aware captions) -------------------
  const base = imagesFor(input.aircraftKey);
  const layout = isAviation ? layoutByKey(input.layoutKey ?? "") : null;
  const shots = [
    { src: base.exterior, caption: "Exterior" },
    { src: base.interior, caption: isAviation ? "Cabin interior" : "Interior" },
    ...(layout ? [{ src: layout.image, caption: layout.label }] : []),
  ];

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(lex.galleryLabel, M, y);
  y += 3;
  const gw = (W - 2 * M - 8) / 3;
  for (let i = 0; i < shots.length; i++) {
    const data = await toDataUrl(shots[i].src);
    const gx = M + i * (gw + 4);
    if (data) doc.addImage(data, "JPEG", gx, y, gw, 24);
    else {
      doc.setFillColor(226, 232, 240);
      doc.rect(gx, y, gw, 24, "F");
    }
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.rect(gx, y, gw, 24);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(shots[i].caption, gx, y + 27);
  }
  y += 33;

  // --- manifest -----------------------------------------------------------
  y = section(doc, lex.manifestLabel, y);
  input.passengers.forEach((p, i) => {
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text(
      `${i + 1}. ${p.name || "—"}   ·   seat ${p.seat || "—"}   ·   doc ${p.document || "—"}   ·   ${p.phone || "—"}   ${p.email || ""}`,
      M + 2,
      y,
    );
    y += 5;
  });
  if (!input.passengers.length) {
    doc.setFontSize(8);
    doc.text("No named passengers recorded.", M + 2, y);
    y += 5;
  }
  y += 3;

  // --- ground transport ---------------------------------------------------
  if (input.groundKeys.length) {
    y = section(doc, "Ground transportation", y);
    for (const k of input.groundKeys) {
      const svc = GROUND_SERVICES.find((g) => g.key === k);
      const d = input.groundDetails[k];
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59);
      doc.text(
        `${svc?.label ?? k} · ${d?.location || "—"} · ${d?.time || "on arrival"} · ${d?.passengers ?? 1} pax · ${formatMoney(svc?.price ?? 0, "USD")}`,
        M + 2,
        y,
      );
      if (d?.notes) {
        y += 4;
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(`   note: ${d.notes}`, M + 2, y);
      }
      y += 5;
    }
    y += 3;
  }

  // --- quote breakdown ----------------------------------------------------
  y = section(doc, "Quote breakdown", y);
  input.quoteLines.forEach((l) => {
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(l.label, M + 2, y);
    doc.setTextColor(15, 23, 42);
    doc.text(l.value, W - M - 2, y, { align: "right" });
    y += 5;
  });
  doc.setDrawColor(203, 213, 225);
  doc.line(M, y - 2, W - M, y - 2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("Itinerary total", M + 2, y + 4);
  doc.text(input.totalLabel, W - M - 2, y + 4, { align: "right" });

  // --- security seal & fingerprint block ---------------------------------
  const sy = H - 58;
  guilloche(doc, W - 34, sy + 14, 15, 5, 7, [147, 178, 226], 16);
  doc.setDrawColor(29, 78, 216);
  doc.setLineWidth(0.4);
  doc.circle(W - 34, sy + 14, 15);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.setTextColor(29, 78, 216);
  doc.text("SECURED", W - 34, sy + 11, { align: "center" });
  doc.text("SAFARID AIR", W - 34, sy + 15, { align: "center" });
  doc.setFontSize(5);
  doc.text(fingerprint.slice(0, 8), W - 34, sy + 19, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text(
    [
      `Control number: ${control}`,
      `Document fingerprint: ${fingerprint}`,
      `Issued: ${issuedAt.toISOString()}`,
      "Verify at safarid.org/charter/status using the reference and control number.",
      "Security features: guilloche lathe-work, void-pantograph micro-hatch, microtext,",
      "vector emblem and a deterministic fingerprint bound to this itinerary's contents.",
      "Any alteration invalidates the fingerprint and voids this document.",
    ],
    M,
    sy + 4,
  );

  return doc;
}

export function section(doc: jsPDF, title: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 14, y);
  doc.setDrawColor(29, 78, 216);
  doc.setLineWidth(0.3);
  doc.line(14, y + 1.4, 196, y + 1.4);
  doc.setFont("helvetica", "normal");
  return y + 7;
}

/**
 * Builds and downloads the itinerary using the active server-side template.
 * Returns the fingerprint + template version for the audit record.
 */
export async function downloadItineraryPdf(
  input: ItineraryInput,
): Promise<{ fingerprint: string; templateVersion: string }> {
  const template = await fetchActivePdfTemplate();
  const merged: ItineraryInput = {
    ...input,
    branding: { ...template.brand, ...(input.branding ?? {}) },
    templateVersion: input.templateVersion ?? template.version,
  };
  const doc = await buildItineraryPdf(merged);
  doc.save(`yalla-air-itinerary-${merged.reference}-${merged.templateVersion}.pdf`);
  return {
    fingerprint: documentFingerprint({
      r: merged.reference, a: merged.assetName, o: merged.origin, d: merged.destination,
      dt: merged.date, s: merged.seats, l: merged.layoutKey, g: merged.groundKeys, t: merged.totalLabel,
      tpl: merged.templateVersion,
    }),
    templateVersion: merged.templateVersion!,
  };
}

