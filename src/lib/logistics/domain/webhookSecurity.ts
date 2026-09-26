/**
 * PHASE 7 — INBOUND WEBHOOK SECURITY.
 *
 * A webhook payload is untrusted input. Arrival is never authority: a callback
 * may not establish a trusted financial or operational state until every control
 * below passes. These functions are executed by the adversarial suite, so the
 * verdicts are real results, not declarations.
 */

export const WEBHOOK_CONTROLS = [
  "signature_verification",
  "timestamp_validation",
  "replay_protection",
  "idempotency",
  "source_identification",
  "schema_validation",
  "authorization",
  "correlation_id",
  "audit_event",
] as const;

export type WebhookControl = (typeof WEBHOOK_CONTROLS)[number];

export interface InboundWebhook {
  endpoint: string;
  source: string;
  signature: string | null;
  signatureAlgorithm: "HMAC-SHA256" | "ED25519" | null;
  timestamp: string | null;
  delivery_id: string | null;
  idempotency_key: string | null;
  correlation_id: string | null;
  body: Record<string, unknown>;
}

export interface WebhookVerificationContext {
  /** Registered sources; anything else is rejected outright. */
  allowedSources: string[];
  /** Deterministic signature oracle for the test harness. */
  expectedSignature: (w: InboundWebhook) => string;
  /** Delivery ids already processed (replay ledger). */
  seenDeliveryIds: Set<string>;
  requiredFields: string[];
  maxSkewSeconds: number;
  now: string;
  /** Endpoints the source is authorised to post to. */
  authorisedEndpoints: Record<string, string[]>;
}

export type WebhookVerdict =
  | { accepted: true; controls: Record<WebhookControl, boolean>; correlation_id: string; audit: Record<string, unknown> }
  | { accepted: false; failedControl: WebhookControl; reason: string; controls: Record<WebhookControl, boolean> };

const allFalse = () =>
  Object.fromEntries(WEBHOOK_CONTROLS.map((c) => [c, false])) as Record<WebhookControl, boolean>;

export function verifyInboundWebhook(w: InboundWebhook, ctx: WebhookVerificationContext): WebhookVerdict {
  const controls = allFalse();
  const fail = (c: WebhookControl, reason: string): WebhookVerdict => ({ accepted: false, failedControl: c, reason, controls });

  if (!w.source || !ctx.allowedSources.includes(w.source)) return fail("source_identification", "unregistered source");
  controls.source_identification = true;

  if (!w.signature || !w.signatureAlgorithm) return fail("signature_verification", "missing signature");
  if (w.signature !== ctx.expectedSignature(w)) return fail("signature_verification", "signature mismatch");
  controls.signature_verification = true;

  if (!w.timestamp) return fail("timestamp_validation", "missing timestamp");
  const skew = Math.abs(Date.parse(ctx.now) - Date.parse(w.timestamp)) / 1000;
  if (!Number.isFinite(skew) || skew > ctx.maxSkewSeconds) return fail("timestamp_validation", `timestamp skew ${skew}s exceeds ${ctx.maxSkewSeconds}s`);
  controls.timestamp_validation = true;

  if (!w.delivery_id) return fail("replay_protection", "missing delivery id");
  if (ctx.seenDeliveryIds.has(w.delivery_id)) return fail("replay_protection", "delivery replayed");
  controls.replay_protection = true;

  if (!w.idempotency_key) return fail("idempotency", "missing idempotency key");
  controls.idempotency = true;

  const missing = ctx.requiredFields.filter((f) => w.body[f] === undefined);
  if (missing.length > 0) return fail("schema_validation", `missing fields: ${missing.join(", ")}`);
  controls.schema_validation = true;

  const allowed = ctx.authorisedEndpoints[w.source] ?? [];
  if (!allowed.includes(w.endpoint)) return fail("authorization", `${w.source} not authorised for ${w.endpoint}`);
  controls.authorization = true;

  if (!w.correlation_id) return fail("correlation_id", "missing correlation id");
  controls.correlation_id = true;

  ctx.seenDeliveryIds.add(w.delivery_id);
  controls.audit_event = true;

  return {
    accepted: true,
    controls,
    correlation_id: w.correlation_id,
    audit: {
      actor_type: "SERVICE",
      service_identity: w.source,
      session_id: null,
      endpoint: w.endpoint,
      delivery_id: w.delivery_id,
      idempotency_key: w.idempotency_key,
      correlation_id: w.correlation_id,
      occurred_at: ctx.now,
    },
  };
}

/** Adversarial webhook probes executed by the suite. */
export interface WebhookProbeResult {
  id: string;
  attack: string;
  expected: WebhookControl | "ACCEPT";
  actual: WebhookControl | "ACCEPT";
  passed: boolean;
}

export function runWebhookProbes(): WebhookProbeResult[] {
  const sign = (w: InboundWebhook) => `sig:${w.source}:${JSON.stringify(w.body)}`;
  const base = (over: Partial<InboundWebhook> = {}): InboundWebhook => {
    const w: InboundWebhook = {
      endpoint: "/mpesa/callback",
      source: "mpesa",
      signature: null,
      signatureAlgorithm: "HMAC-SHA256",
      timestamp: "2026-08-26T21:00:00.000Z",
      delivery_id: `d-${Math.random().toString(36).slice(2)}`,
      idempotency_key: "idem-1",
      correlation_id: "CORR-2026-ABCDEFGH",
      body: { transaction_id: "T1", amount: 500, status: "SUCCESS" },
      ...over,
    };
    return { ...w, signature: over.signature !== undefined ? over.signature : sign(w) };
  };
  const ctx = (): WebhookVerificationContext => ({
    allowedSources: ["mpesa", "partner_carrier"],
    expectedSignature: sign,
    seenDeliveryIds: new Set<string>(),
    requiredFields: ["transaction_id", "amount", "status"],
    maxSkewSeconds: 300,
    now: "2026-08-26T21:02:00.000Z",
    authorisedEndpoints: { mpesa: ["/mpesa/callback"], partner_carrier: ["/partner/tracking"] },
  });

  const probe = (
    id: string,
    attack: string,
    expected: WebhookControl | "ACCEPT",
    run: () => WebhookVerdict,
  ): WebhookProbeResult => {
    const v = run();
    const actual: WebhookControl | "ACCEPT" = "failedControl" in v ? v.failedControl : "ACCEPT";
    return { id, attack, expected, actual, passed: actual === expected };
  };

  const replayCtx = ctx();
  const replayed = base({ delivery_id: "d-fixed" });

  return [
    probe("WH-01", "well-formed signed callback", "ACCEPT", () => verifyInboundWebhook(base(), ctx())),
    probe("WH-02", "unsigned payload claiming SUCCESS", "signature_verification", () =>
      verifyInboundWebhook(base({ signature: null }), ctx())),
    probe("WH-03", "tampered amount after signing", "signature_verification", () => {
      const w = base();
      return verifyInboundWebhook({ ...w, body: { ...w.body, amount: 999999 } }, ctx());
    }),
    probe("WH-04", "stale timestamp (2 hours old)", "timestamp_validation", () =>
      verifyInboundWebhook(base({ timestamp: "2026-08-26T19:00:00.000Z" }), ctx())),
    probe("WH-05", "replayed delivery id", "replay_protection", () => {
      verifyInboundWebhook(replayed, replayCtx);
      return verifyInboundWebhook(replayed, replayCtx);
    }),
    probe("WH-06", "missing idempotency key", "idempotency", () =>
      verifyInboundWebhook(base({ idempotency_key: null }), ctx())),
    probe("WH-07", "schema violation (no amount)", "schema_validation", () =>
      verifyInboundWebhook(base({ body: { transaction_id: "T1", status: "SUCCESS" } }), ctx())),
    probe("WH-08", "unregistered source", "source_identification", () =>
      verifyInboundWebhook(base({ source: "attacker" }), ctx())),
    probe("WH-09", "valid source posting to another source's endpoint", "authorization", () =>
      verifyInboundWebhook(base({ source: "partner_carrier", endpoint: "/mpesa/callback" }), ctx())),
    probe("WH-10", "missing correlation id", "correlation_id", () =>
      verifyInboundWebhook(base({ correlation_id: null }), ctx())),
  ];
}

export function webhookProbeSummary() {
  const results = runWebhookProbes();
  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed),
    status: results.every((r) => r.passed) ? ("PASS" as const) : ("FAIL" as const),
  };
}
