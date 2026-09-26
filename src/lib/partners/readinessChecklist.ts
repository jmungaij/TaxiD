/**
 * INTEGRATION READINESS CHECKLIST — a downloadable, level-specific preparation
 * document for a prospective partner.
 *
 * The checklist states only what SAFARID actually asks for during admission:
 * commercial agreement, company and tax verification, workspace configuration,
 * and (for embedded, API and white-label partners) sandbox certification before
 * production. No timelines, volumes, rates, uptime figures or guarantees are
 * stated anywhere in this document.
 *
 * Rendering is dependency-light: jsPDF is imported dynamically so the marketing
 * bundle never pays for it, and all copy is Latin-1 safe because jsPDF's
 * built-in fonts are WinAnsi.
 */
import { findLevel, MATURITY_LEVELS, type MaturityLevelMeta } from "@/lib/partners/intent";
import { COMMERCIAL_MODEL_LABEL } from "@/lib/partners/api";

export interface ChecklistItem {
  t: string;
  d: string;
}

export interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
}

export interface ReadinessChecklist {
  level: MaturityLevelMeta;
  /** Level position, e.g. "Level 2 of 6". */
  position: string;
  purpose: string;
  sections: ChecklistSection[];
  notes: string[];
}

const COMMERCIAL: ChecklistSection = {
  title: "Commercial readiness",
  items: [
    { t: "Named commercial owner", d: "The person who agrees margin, settlement terms and escalation on your side." },
    { t: "Services you intend to sell or supply", d: "Rides, charter, delivery, logistics, rental or leasing - and the routes or areas involved." },
    { t: "Preferred commercial model", d: "Net rate, markup, commission, revenue share, fixed fee or tiered rate." },
    { t: "Settlement details", d: "The banking or wallet arrangement the reconciled settlement is paid against." },
  ],
};

const VERIFICATION: ChecklistSection = {
  title: "Company and compliance verification",
  items: [
    { t: "Certificate of incorporation or registration", d: "The registered legal entity that will hold the partner agreement." },
    { t: "Tax identity", d: "Tax registration for the jurisdiction the entity operates in (KRA PIN in Kenya)." },
    { t: "Verified contact identity", d: "Work email and phone for the primary contact, plus a fallback contact." },
    { t: "Sector licences where they apply", d: "Transport, courier, aviation, marine or rental licences held by the entity." },
  ],
};

const WORKSPACE: ChecklistSection = {
  title: "Workspace configuration",
  items: [
    { t: "Users and roles", d: "Who books, who approves and who reads commercial reporting." },
    { t: "Approval route", d: "Whether orders must be approved internally before confirmation." },
    { t: "Customer register", d: "The customers, references and cost centres you will file orders against." },
    { t: "Service scope", d: "The service lines your team is allowed to order." },
  ],
};

const SUPPLY: ChecklistSection = {
  title: "Supply admission",
  items: [
    { t: "Asset register", d: "Vehicles, aircraft, vessels or equipment with registration and class." },
    { t: "Crew and driver records", d: "Licences, PSV or equivalent authorisation, and identity documents." },
    { t: "Insurance cover", d: "Cover in force for the assets and the operations you intend to run." },
    { t: "Inspection and roadworthiness evidence", d: "Current inspection records for each asset offered to the network." },
  ],
};

const TECHNICAL: ChecklistSection = {
  title: "Technical readiness",
  items: [
    { t: "Integration owner and developer contact", d: "The engineer accountable for the build and for production incidents." },
    { t: "Use cases and data flows", d: "Which calls you make, which records you store and which systems are involved on both sides." },
    { t: "Environment separation", d: "Confirmation that sandbox and production credentials are stored separately." },
    { t: "Credential handling", d: "Where scoped keys are stored, who can read them and how they are rotated." },
  ],
};

const CERTIFICATION: ChecklistSection = {
  title: "Sandbox and certification",
  items: [
    { t: "Sandbox flows executed", d: "Quote, book, track, cancel and read settlement data against non-production data." },
    { t: "Agreed certification scenarios", d: "The scenarios to be executed and evidenced before production access is granted." },
    { t: "Error and exception handling", d: "How your system behaves on rejection, cancellation and operational exceptions." },
    { t: "Go-live and rollback position", d: "The controlled cutover plan and the agreed rollback if it is needed." },
  ],
};

const BRAND: ChecklistSection = {
  title: "Brand and customer experience",
  items: [
    { t: "Customer-facing surface", d: "Where SAFARID mobility appears inside your product or under your brand." },
    { t: "Brand assets and terminology", d: "The naming, logo usage and wording your customers will see." },
    { t: "Support routing", d: "Who your customer contacts first, and how it escalates to the SAFARID partner desk." },
    { t: "Document presentation", d: "How sealed commercial documents are surfaced to your customer for verification." },
  ],
};

const SECTIONS_BY_LEVEL: Record<string, ChecklistSection[]> = {
  refer: [COMMERCIAL, VERIFICATION],
  book: [COMMERCIAL, VERIFICATION, WORKSPACE],
  manage: [COMMERCIAL, VERIFICATION, WORKSPACE, SUPPLY],
  embed: [COMMERCIAL, VERIFICATION, WORKSPACE, TECHNICAL, CERTIFICATION, BRAND],
  api: [COMMERCIAL, VERIFICATION, WORKSPACE, TECHNICAL, CERTIFICATION],
  orchestrate: [COMMERCIAL, VERIFICATION, WORKSPACE, SUPPLY, TECHNICAL, CERTIFICATION, BRAND],
};

const PURPOSE: Record<string, string> = {
  refer: "You refer the customer and SAFARID quotes, books and executes the movement. Preparation is commercial and identity verification only.",
  book: "You arrange mobility on your customer's behalf from your own workspace, so your team, customers and approval route are configured before go-live.",
  manage: "You run your own team, customers, approvals, journeys and margin reporting, and may also offer capacity to the network.",
  embed: "SAFARID quoting and booking sit inside your own product journey, so both the commercial and the technical surface are prepared and certified.",
  api: "Your systems quote, book, track and read settlement data programmatically, so credentials, sandbox work and certification come before production.",
  orchestrate: "You operate a mobility product under your own brand across service lines, with SAFARID's execution engine, documents and settlement behind it.",
};

const NOTES = [
  "Nothing goes live before verification, configuration and contracting are recorded.",
  "Pricing is computed server-side from the contracted rate card and pinned to each order.",
  "Financial entries are append-only; wallet credits are recognised only from verified payment callbacks.",
  "Issued commercial documents are sealed with a content fingerprint and can be verified independently.",
];

export function buildReadinessChecklist(levelId: string): ReadinessChecklist {
  const level = findLevel(levelId) ?? MATURITY_LEVELS[0];
  const index = MATURITY_LEVELS.findIndex((l) => l.id === level.id);
  return {
    level,
    position: `Level ${index + 1} of ${MATURITY_LEVELS.length}`,
    purpose: PURPOSE[level.id] ?? PURPOSE.book,
    sections: SECTIONS_BY_LEVEL[level.id] ?? SECTIONS_BY_LEVEL.book,
    notes: NOTES,
  };
}

export const readinessFilename = (levelId: string, now = Date.now()): string =>
  `yalla-partners-readiness-${levelId}-${new Date(now).toISOString().slice(0, 10)}.pdf`;

/** Total checkable items - used by the UI to state the size of the document. */
export const readinessItemCount = (c: ReadinessChecklist): number =>
  c.sections.reduce((n, s) => n + s.items.length, 0);

export async function downloadReadinessChecklistPdf(levelId: string): Promise<void> {
  const c = buildReadinessChecklist(levelId);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const W = 210;
  const M = 16;
  const CW = W - M * 2;
  const NAVY: [number, number, number] = [20, 52, 144];
  let y = 0;
  let page = 1;

  const footer = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(130);
    doc.text("SAFARID - SAFARID Partners - integration readiness checklist", M, 288);
    doc.text(`Page ${page}`, W - M, 288, { align: "right" });
  };

  const banner = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 34, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Integration readiness checklist", M, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text(`${c.position} - ${c.level.label}`, M, 24);
    doc.setFontSize(8);
    doc.setTextColor(220);
    doc.text(COMMERCIAL_MODEL_LABEL[c.level.model], M, 30);
    y = 46;
  };

  const newPage = () => {
    footer();
    doc.addPage();
    page += 1;
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 6, "F");
    y = 20;
  };

  const need = (h: number) => { if (y + h > 278) newPage(); };

  banner();

  doc.setTextColor(40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const purpose = doc.splitTextToSize(c.purpose, CW) as string[];
  doc.text(purpose, M, y);
  y += purpose.length * 5 + 6;

  for (const section of c.sections) {
    need(24);
    doc.setFillColor(238, 243, 252);
    doc.rect(M, y - 5, CW, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...NAVY);
    doc.text(section.title, M + 2, y);
    y += 10;

    for (const item of section.items) {
      const desc = doc.splitTextToSize(item.d, CW - 12) as string[];
      need(desc.length * 4.4 + 10);
      doc.setDrawColor(...NAVY);
      doc.setLineWidth(0.3);
      doc.rect(M + 1, y - 3.4, 4, 4);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(30);
      doc.text(item.t, M + 8, y);
      y += 4.6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(105);
      doc.text(desc, M + 8, y);
      y += desc.length * 4.2 + 4;
    }
    y += 2;
  }

  need(34);
  doc.setDrawColor(220);
  doc.setLineWidth(0.2);
  doc.line(M, y - 2, W - M, y - 2);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...NAVY);
  doc.text("How SAFARID governs the relationship", M, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(105);
  for (const note of c.notes) {
    const lines = doc.splitTextToSize(`- ${note}`, CW) as string[];
    need(lines.length * 4.2 + 3);
    doc.text(lines, M, y);
    y += lines.length * 4.2 + 1.5;
  }

  footer();
  doc.save(readinessFilename(c.level.id));
}
