/**
 * GUIDED LEAD IMPORT — template, column mapping and row validation.
 *
 * Nothing here talks to the database. Its only job is to turn a pasted or
 * uploaded sheet into rows the desk can accept, and to say — in plain words,
 * against a line number — what is wrong with the rest. Only clean rows are ever
 * submitted, so an import never half-succeeds because of a typo.
 */
import type { BulkImportRow } from "@/lib/sales/journey";

export interface ImportColumn {
  key: keyof BulkImportRow;
  header: string;
  required?: boolean;
  hint: string;
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "organisation_name", header: "Organisation", required: true, hint: "The company name, exactly as they use it" },
  { key: "contact_name", header: "Contact name", hint: "Who you spoke to, if you know" },
  { key: "contact_email", header: "Email", hint: "A working email address" },
  { key: "contact_phone", header: "Phone", hint: "Kenyan mobile, e.g. 0712345678 or +254712345678" },
  { key: "service_interest", header: "Service needed", hint: "e.g. Staff transport, Airport transfers" },
  { key: "estimated_value_kes", header: "Estimated value", hint: "Numbers only, in KES" },
  { key: "notes", header: "Notes", hint: "Anything the next person should know" },
];

const HEADER_ALIASES: Record<string, keyof BulkImportRow> = {
  organisation: "organisation_name",
  organization: "organisation_name",
  company: "organisation_name",
  "company name": "organisation_name",
  client: "organisation_name",
  "contact name": "contact_name",
  contact: "contact_name",
  "contact person": "contact_name",
  name: "contact_name",
  email: "contact_email",
  "email address": "contact_email",
  phone: "contact_phone",
  "phone number": "contact_phone",
  mobile: "contact_phone",
  telephone: "contact_phone",
  "service needed": "service_interest",
  service: "service_interest",
  "service interest": "service_interest",
  requirement: "service_interest",
  "estimated value": "estimated_value_kes",
  value: "estimated_value_kes",
  "estimated value kes": "estimated_value_kes",
  budget: "estimated_value_kes",
  notes: "notes",
  note: "notes",
  comments: "notes",
};

export const TEMPLATE_CSV =
  IMPORT_COLUMNS.map((c) => c.header).join(",") +
  "\n" +
  "Acme Ltd,Jane Mwangi,jane@acme.co.ke,0712345678,Staff transport,1200000,Met at the Nairobi expo\n";

export function downloadTemplate(filename = "yalla-lead-import-template.csv") {
  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ parsing */

function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (!quoted && (ch === "," || ch === "\t" || ch === ";")) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function normaliseHeader(v: string) {
  return v.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Detect a header row and return the column order it declares. */
function readHeader(cells: string[]): { map: (keyof BulkImportRow | null)[]; unknown: string[] } | null {
  const mapped = cells.map((c) => HEADER_ALIASES[normaliseHeader(c)] ?? null);
  const known = mapped.filter(Boolean).length;
  if (known < 2) return null;
  const unknown = cells.filter((c, i) => c && mapped[i] === null);
  return { map: mapped, unknown };
}

export interface ParsedRow {
  line: number;
  row: BulkImportRow;
  errors: string[];
  warnings: string[];
}

export interface ParsedSheet {
  rows: ParsedRow[];
  ready: ParsedRow[];
  rejected: ParsedRow[];
  headerDetected: boolean;
  unknownColumns: string[];
  blankLines: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function validPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 9) return false;
  if (/^0[17]\d{8}$/.test(digits)) return true; // 07xx / 01xx
  if (/^254[17]\d{8}$/.test(digits)) return true;
  if (/^[17]\d{8}$/.test(digits)) return true;
  return digits.length >= 9 && digits.length <= 15;
}

export function parseSheet(text: string): ParsedSheet {
  const rawLines = text.split(/\r?\n/);
  let headerMap: (keyof BulkImportRow | null)[] | null = null;
  let unknownColumns: string[] = [];
  let headerDetected = false;
  let blankLines = 0;
  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();

  rawLines.forEach((raw, idx) => {
    const line = idx + 1;
    if (!raw.trim()) {
      blankLines += 1;
      return;
    }
    const cells = splitCells(raw);
    if (!headerDetected && rows.length === 0) {
      const header = readHeader(cells);
      if (header) {
        headerMap = header.map;
        unknownColumns = header.unknown;
        headerDetected = true;
        return;
      }
    }

    const row: BulkImportRow = { organisation_name: "" };
    const order: (keyof BulkImportRow | null)[] =
      headerMap ?? IMPORT_COLUMNS.map((c) => c.key as keyof BulkImportRow);
    cells.forEach((cell, i) => {
      const key = order[i];
      if (!key || !cell) return;
      (row as unknown as Record<string, string>)[key] = cell;
    });

    const errors: string[] = [];
    const warnings: string[] = [];

    row.organisation_name = (row.organisation_name ?? "").trim();
    if (!row.organisation_name) errors.push("the organisation name is missing");
    else if (row.organisation_name.length > 160) errors.push("the organisation name is too long");

    if (row.contact_email) {
      row.contact_email = row.contact_email.toLowerCase();
      if (!EMAIL.test(row.contact_email)) errors.push(`"${row.contact_email}" is not a valid email address`);
    }
    if (row.contact_phone && !validPhone(row.contact_phone)) {
      errors.push(`"${row.contact_phone}" is not a usable phone number`);
    }
    if (row.estimated_value_kes) {
      const cleaned = row.estimated_value_kes.replace(/[,\s]/g, "").replace(/^KES/i, "");
      if (!/^\d+(\.\d+)?$/.test(cleaned)) {
        errors.push(`the estimated value "${row.estimated_value_kes}" is not a number`);
      } else {
        row.estimated_value_kes = cleaned;
      }
    }
    if (!row.contact_email && !row.contact_phone) {
      warnings.push("no email and no phone — nobody can be contacted from this row");
    }
    if (!row.contact_name) warnings.push("no contact person recorded");
    if (!row.service_interest) warnings.push("no service recorded — it will read “To be confirmed”");

    const fingerprint = [
      row.organisation_name.toLowerCase(),
      row.contact_email ?? "",
      (row.contact_phone ?? "").replace(/\D/g, ""),
    ].join("|");
    const first = seen.get(fingerprint);
    if (first) errors.push(`the same organisation and contact already appear on line ${first}`);
    else seen.set(fingerprint, line);

    rows.push({ line, row, errors, warnings });
  });

  return {
    rows,
    ready: rows.filter((r) => r.errors.length === 0),
    rejected: rows.filter((r) => r.errors.length > 0),
    headerDetected,
    unknownColumns,
    blankLines,
  };
}

export const SERVER_SKIP_LABEL: Record<string, string> = {
  MISSING_ORGANISATION: "no organisation name",
  ALREADY_ON_THE_DESK: "already on the desk",
};

export function skipReasonLabel(reason: string) {
  return SERVER_SKIP_LABEL[reason] ?? reason.split("_").join(" ").toLowerCase();
}
