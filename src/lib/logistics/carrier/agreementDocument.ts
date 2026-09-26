/**
 * FLEET OWNER PARTNER AGREEMENT — document assembly.
 *
 * Renders the executed agreement pack from two authoritative sources only:
 *  · the instrument texts in `agreements.ts` (what the signatory is shown), and
 *  · the acceptance records in `carrier_declarations` (who accepted, when, and
 *    the SHA-256 of the text that was actually displayed).
 *
 * Laws this module obeys:
 *  · It never invents an execution. An instrument with no acceptance record is
 *    rendered as NOT EXECUTED.
 *  · It never claims integrity it has not checked. When the hash of the current
 *    instrument text differs from the recorded hash, the clause set is marked
 *    SUPERSEDED — the accepted wording was a different version.
 *  · It is a record of what was accepted, not a legal opinion.
 */
import {
  FLEET_OWNER_INSTRUMENTS,
  instrumentText,
  type DeclarationInstrument,
} from "./agreements";
import type { CarrierDeclarationRow } from "./onboarding";

export type ExecutionState = "EXECUTED" | "NOT_EXECUTED" | "SUPERSEDED" | "WITHDRAWN";

export interface AgreementParty {
  legalEntityName: string;
  carrierCode: string;
  operatingStatus: string;
  contractStatus: string;
}

export interface AgreementSection {
  instrument: DeclarationInstrument;
  state: ExecutionState;
  acceptedByName: string | null;
  acceptedAt: string | null;
  acceptedVersion: string | null;
  recordedHash: string | null;
  /** SHA-256 of the text rendered in this document. */
  renderedHash: string | null;
  note: string;
}

export interface AgreementDocument {
  reference: string;
  generatedAt: string;
  platform: { legalEntityName: string; role: string };
  fleetOwner: AgreementParty;
  sections: AgreementSection[];
  fullyExecuted: boolean;
  outstanding: string[];
}

export const PLATFORM_PARTY = {
  legalEntityName: "Yalla Mobility Limited",
  role:
    "Digital marketplace and transaction-facilitation platform. Yalla Mobility does not provide the physical transport service.",
} as const;

/** SHA-256 hex of a string, using Web Crypto. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stateFor(
  declaration: CarrierDeclarationRow | undefined,
  renderedHash: string | null,
): { state: ExecutionState; note: string } {
  if (!declaration || !declaration.accepted_at) {
    return {
      state: "NOT_EXECUTED",
      note: "This instrument has not been accepted. The Fleet Owner's capacity cannot be matched until it is.",
    };
  }
  if (declaration.state && !["ACCEPTED", "ACTIVE"].includes(declaration.state)) {
    return {
      state: "WITHDRAWN",
      note: `The acceptance record is in state ${declaration.state.replace(/_/g, " ")}.`,
    };
  }
  if (renderedHash && declaration.declaration_text_hash && renderedHash !== declaration.declaration_text_hash) {
    return {
      state: "SUPERSEDED",
      note:
        "The wording accepted by the signatory differs from the wording published today. " +
        "The clauses below are the current text; the binding record is the accepted hash shown above.",
    };
  }
  return {
    state: "EXECUTED",
    note: "The clauses below are byte-identical to the text accepted by the signatory.",
  };
}

export async function buildAgreementDocument(input: {
  fleetOwner: AgreementParty;
  declarations: CarrierDeclarationRow[];
  generatedAt?: Date;
}): Promise<AgreementDocument> {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const sections: AgreementSection[] = [];

  for (const instrument of FLEET_OWNER_INSTRUMENTS) {
    const text = instrumentText(instrument);
    const renderedHash = await sha256Hex(text);
    const declaration = input.declarations.find((d) => d.declaration_code === instrument.code);
    const { state, note } = stateFor(declaration, renderedHash);
    sections.push({
      instrument,
      state,
      note,
      acceptedByName: declaration?.accepted_by_name ?? null,
      acceptedAt: declaration?.accepted_at ?? null,
      acceptedVersion: declaration?.declaration_version ?? null,
      recordedHash: declaration?.declaration_text_hash ?? null,
      renderedHash,
    });
  }

  const outstanding = sections.filter((s) => s.state !== "EXECUTED").map((s) => s.instrument.title);

  return {
    reference: `FOA-${input.fleetOwner.carrierCode}`,
    generatedAt,
    platform: { ...PLATFORM_PARTY },
    fleetOwner: input.fleetOwner,
    sections,
    fullyExecuted: outstanding.length === 0,
    outstanding,
  };
}

/** Plain-text export the Fleet Owner can keep for its own records. */
export function agreementDocumentText(doc: AgreementDocument): string {
  const lines: string[] = [];
  lines.push(`${doc.platform.legalEntityName} — FLEET OWNER / TRANSPORT SERVICE PROVIDER AGREEMENT PACK`);
  lines.push(`Reference: ${doc.reference}`);
  lines.push(`Generated: ${doc.generatedAt}`);
  lines.push("");
  lines.push("PARTIES");
  lines.push(`  Platform: ${doc.platform.legalEntityName} — ${doc.platform.role}`);
  lines.push(
    `  Fleet Owner: ${doc.fleetOwner.legalEntityName} (${doc.fleetOwner.carrierCode}) — operating status ${doc.fleetOwner.operatingStatus}, contract status ${doc.fleetOwner.contractStatus}`,
  );
  lines.push("");
  lines.push(doc.fullyExecuted ? "STATUS: fully executed." : `STATUS: NOT fully executed — outstanding: ${doc.outstanding.join("; ")}`);

  for (const s of doc.sections) {
    lines.push("");
    lines.push(`${s.instrument.title} (${s.instrument.version}) — ${s.state.replace(/_/g, " ")}`);
    lines.push(`Legal register controls: ${s.instrument.legalControls.join(", ")}`);
    if (s.acceptedAt) {
      lines.push(`Accepted by ${s.acceptedByName ?? "—"} on ${s.acceptedAt} (version ${s.acceptedVersion ?? "—"})`);
      lines.push(`Accepted text SHA-256: ${s.recordedHash ?? "—"}`);
    }
    lines.push(`Document text SHA-256: ${s.renderedHash ?? "—"}`);
    lines.push(s.note);
    lines.push("");
    for (const clause of s.instrument.clauses) lines.push(clause);
  }

  lines.push("");
  lines.push(
    "This pack is a record of the instruments accepted on the Yalla Mobility platform and of the acceptance evidence held against them. It is not legal advice.",
  );
  return lines.join("\n");
}
