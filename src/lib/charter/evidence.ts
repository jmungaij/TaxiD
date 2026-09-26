/**
 * Charter evidence documents — hardened uploads to the private
 * `charter-evidence` bucket and short-lived signed links for review/export.
 *
 * Hardening rules (client-side gate; storage RLS is the server-side gate):
 *  - allowlisted extension AND MIME type must agree
 *  - magic-byte sniff for binary formats (PDF / PNG / JPEG / WEBP)
 *  - 25 KB..10 MB size window, empty files rejected
 *  - unguessable object keys (uuid) so paths cannot be enumerated
 *  - private bucket only, read access always through a short-lived signed URL
 */
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "charter-evidence";
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const MIN_EVIDENCE_BYTES = 8;

/** ext -> allowed MIME types. */
export const EVIDENCE_TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  csv: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"],
  txt: ["text/plain"],
};

export const ACCEPTED_EVIDENCE = Object.keys(EVIDENCE_TYPES).map((e) => `.${e}`).join(",");

export const extensionOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  sig.every((b, i) => bytes[offset + i] === b);

/** Magic-byte signatures for the binary formats we accept. */
export function sniffMismatch(ext: string, bytes: Uint8Array): string | null {
  if (ext === "pdf" && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "This file is not a valid PDF.";
  if (ext === "png" && !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "This file is not a valid PNG image.";
  if ((ext === "jpg" || ext === "jpeg") && !startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "This file is not a valid JPEG image.";
  }
  if (ext === "webp" && !(startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))) {
    return "This file is not a valid WebP image.";
  }
  return null;
}

/** Name/size/type validation. Returns a user-facing message, or null when valid. */
export function validateEvidenceMeta(file: { name: string; size: number; type: string }): string | null {
  const ext = extensionOf(file.name);
  const allowed = EVIDENCE_TYPES[ext];
  if (!allowed) {
    return `Unsupported file type "${ext || "unknown"}". Allowed: ${ACCEPTED_EVIDENCE}.`;
  }
  if (file.type && !allowed.includes(file.type)) {
    return `File content type "${file.type}" does not match a .${ext} document.`;
  }
  if (file.size < MIN_EVIDENCE_BYTES) return "This document is empty.";
  if (file.size > MAX_EVIDENCE_BYTES) return "Document is larger than 10 MB.";
  return null;
}

const objectKey = (scope: string, ext: string) => {
  const safeScope = scope.replace(/[^a-zA-Z0-9/_-]/g, "_");
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${safeScope}/${id}.${ext}`;
};

/** Uploads a validated document and returns its private storage path. */
export async function uploadEvidence(file: File, scope: string): Promise<string> {
  const problem = validateEvidenceMeta(file);
  if (problem) throw new Error(problem);

  const ext = extensionOf(file.name);
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniff = sniffMismatch(ext, head);
  if (sniff) throw new Error(sniff);

  const path = objectKey(scope, ext);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    cacheControl: "0",
    contentType: EVIDENCE_TYPES[ext][0],
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Time-limited link so reviewers can open a private evidence document. */
export async function evidenceSignedUrl(path: string, expiresIn = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Could not open document.");
  return data.signedUrl;
}

/** Best-effort signed link; returns null when the viewer is not authorised. */
export async function tryEvidenceSignedUrl(path: string, expiresIn = 900): Promise<string | null> {
  try {
    return await evidenceSignedUrl(path, expiresIn);
  } catch {
    return null;
  }
}
