/**
 * Encrypted QR seal rendering for forensic charter dossiers.
 *
 * The charter API returns an AES-GCM encrypted QR payload for every registered
 * document. This module turns that payload into a print-safe QR image: high
 * error correction (survives folding, stamping and fax-grade reprints), pure
 * black modules on a white plate (no theme colours — a tinted QR fails under
 * monochrome print), and a quiet zone wide enough for phone scanners.
 */
import QRCode from "qrcode";

/** Max characters a version-40 QR holds at error correction level H. */
const MAX_PAYLOAD = 1200;

export interface DocumentQrSeal {
  /** PNG data URL, square, ready for `jsPDF.addImage`. */
  dataUrl: string;
  /** What was actually encoded (payload, or the verify URL fallback). */
  encoded: string;
}

/**
 * Builds the QR image for a document. Prefers the encrypted payload; falls back
 * to the verification URL when the payload is absent or too large to encode at
 * level H, so the seal always scans to something verifiable.
 */
export async function documentQrSeal(input: {
  qrPayload?: string | null;
  verifyUrl?: string | null;
  /** Rendered pixel size — 720px keeps modules crisp at 26mm / 300dpi. */
  size?: number;
}): Promise<DocumentQrSeal | null> {
  const payload = (input.qrPayload ?? "").trim();
  const verifyUrl = (input.verifyUrl ?? "").trim();
  const encoded = payload && payload.length <= MAX_PAYLOAD ? payload : verifyUrl;
  if (!encoded) return null;

  const dataUrl = await QRCode.toDataURL(encoded, {
    errorCorrectionLevel: "H",
    margin: 2,
    width: input.size ?? 720,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  return { dataUrl, encoded };
}
