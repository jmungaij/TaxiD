/**
 * SAFARID API PARTNERS — versioned specification & changelog.
 *
 * The OpenAPI document is *generated* from the canonical platform contract
 * (`apiPlatform.ts`) rather than hand-maintained, so a published spec can never
 * drift from the surface the site documents. Each release pins the endpoint
 * paths that existed at that version, which lets us compute a real structural
 * diff between two releases instead of narrating one by hand.
 */

import {
  API_BASE_URL,
  API_SANDBOX_URL,
  API_ENDPOINTS,
  CAPABILITY_DOMAINS,
  WEBHOOK_EVENTS,
  type ApiEndpoint,
} from "./apiPlatform";

export type ChangeKind = "added" | "changed" | "deprecated" | "removed" | "security";

export interface ChangelogEntry {
  kind: ChangeKind;
  domain: string;
  summary: string;
  breaking: boolean;
}

export interface ApiRelease {
  /** Semantic spec version, e.g. `2026.08.1`. */
  version: string;
  releasedOn: string;
  status: "current" | "supported" | "deprecated";
  sunsetOn?: string;
  headline: string;
  /** Endpoint operation keys (`METHOD path`) present in this release. */
  operations: string[];
  changelog: ChangelogEntry[];
}

/** Canonical operation key used for diffing. */
export const operationKey = (e: Pick<ApiEndpoint, "method" | "path">) => `${e.method} ${e.path}`;

const ALL_OPERATIONS = API_ENDPOINTS.map(operationKey);

export const API_RELEASES: ApiRelease[] = [
  {
    version: "2026.08.1",
    releasedOn: "2026-08-18",
    status: "current",
    headline: "Settlement statements, document content hashes and per-credential rate headers.",
    operations: ALL_OPERATIONS,
    changelog: [
      {
        kind: "added",
        domain: "settlement",
        summary: "GET /settlement/statements returns opening balance, movements, fees and closing position per period.",
        breaking: false,
      },
      {
        kind: "added",
        domain: "documents",
        summary: "Document responses now carry `content_hash`, independently verifiable at /verify/document.",
        breaking: false,
      },
      {
        kind: "security",
        domain: "identity",
        summary: "Every response includes X-RateLimit-Limit / -Remaining / -Reset scoped to the calling credential.",
        breaking: false,
      },
      {
        kind: "changed",
        domain: "orders",
        summary: "Cancellation responses state the fee actually applied rather than the policy maximum.",
        breaking: false,
      },
    ],
  },
  {
    version: "2026.05.2",
    releasedOn: "2026-05-27",
    status: "supported",
    sunsetOn: "2027-02-28",
    headline: "Live tracking share tokens and webhook signature v2 (timestamped HMAC).",
    operations: ALL_OPERATIONS.filter((k) => !k.startsWith("GET /settlement")),
    changelog: [
      {
        kind: "added",
        domain: "tracking",
        summary: "GET /orders/{id}/tracking returns a scoped share token safe to hand to an end customer.",
        breaking: false,
      },
      {
        kind: "security",
        domain: "identity",
        summary: "Webhook signatures moved to v2: `t=<unix>,v1=<hmac-sha256>` over `${t}.${rawBody}`.",
        breaking: true,
      },
      {
        kind: "deprecated",
        domain: "identity",
        summary: "Signature v1 (body-only HMAC) deprecated; removed in 2026.08.1.",
        breaking: false,
      },
    ],
  },
  {
    version: "2026.02.0",
    releasedOn: "2026-02-10",
    status: "deprecated",
    sunsetOn: "2026-11-30",
    headline: "First general-availability release: quoting, orders and sealed receipts.",
    operations: ALL_OPERATIONS.filter(
      (k) => !k.startsWith("GET /settlement") && !k.includes("/tracking"),
    ),
    changelog: [
      { kind: "added", domain: "quoting", summary: "POST /quotes with governed, server-side pricing.", breaking: false },
      { kind: "added", domain: "orders", summary: "POST /orders and POST /orders/{id}/cancel with idempotency keys.", breaking: false },
      { kind: "added", domain: "documents", summary: "GET /orders/{id}/documents for sealed receipts and tax invoices.", breaking: false },
    ],
  },
];

export const currentRelease = () => API_RELEASES.find((r) => r.status === "current") ?? API_RELEASES[0];

export const releaseByVersion = (version: string) =>
  API_RELEASES.find((r) => r.version === version);

export interface ReleaseDiff {
  from: string;
  to: string;
  addedOperations: string[];
  removedOperations: string[];
  breakingChanges: ChangelogEntry[];
  otherChanges: ChangelogEntry[];
}

/**
 * Structural + narrative diff between two releases. `from` is the older
 * release; the changelog entries of every release strictly newer than `from`
 * up to and including `to` are folded in, so a two-version jump shows
 * everything a partner must action.
 */
export function diffReleases(fromVersion: string, toVersion: string): ReleaseDiff | null {
  const from = releaseByVersion(fromVersion);
  const to = releaseByVersion(toVersion);
  if (!from || !to) return null;

  const fromOps = new Set(from.operations);
  const toOps = new Set(to.operations);

  const fromIndex = API_RELEASES.indexOf(from);
  const toIndex = API_RELEASES.indexOf(to);
  // API_RELEASES is newest-first, so the span between the two indices holds
  // every release that landed in between.
  const [lo, hi] = fromIndex > toIndex ? [toIndex, fromIndex] : [fromIndex, toIndex];
  const spanned = API_RELEASES.slice(lo, hi).flatMap((r) => r.changelog);

  return {
    from: from.version,
    to: to.version,
    addedOperations: [...toOps].filter((k) => !fromOps.has(k)),
    removedOperations: [...fromOps].filter((k) => !toOps.has(k)),
    breakingChanges: spanned.filter((c) => c.breaking),
    otherChanges: spanned.filter((c) => !c.breaking),
  };
}

const SCHEMA_REFS: Record<string, string> = {
  quoting: "Quote",
  orders: "Order",
  tracking: "Tracking",
  documents: "DocumentList",
  settlement: "Statement",
  identity: "TokenResponse",
};

/** Build the OpenAPI 3.1 document for a given release. */
export function buildOpenApiSpec(version: string = currentRelease().version) {
  const release = releaseByVersion(version) ?? currentRelease();
  const included = API_ENDPOINTS.filter((e) => release.operations.includes(operationKey(e)));

  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of included) {
    const path = e.path;
    paths[path] = paths[path] ?? {};
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    paths[path][e.method.toLowerCase()] = {
      operationId: e.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase(),
      summary: e.name,
      description: e.purpose,
      tags: [e.domain],
      security: e.scope === "—" ? [] : [{ oauth2ClientCredentials: [e.scope] }],
      parameters: [
        ...params,
        ...(e.idempotent && e.method !== "GET"
          ? [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }]
          : []),
      ],
      responses: {
        "200": {
          description: "Success",
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${SCHEMA_REFS[e.domain] ?? "Object"}` },
            },
          },
        },
        "401": { description: "Missing, expired or out-of-scope credentials" },
        "409": { description: "Idempotency-Key replayed with a different payload" },
        "429": { description: "Rate limit exceeded — retry after X-RateLimit-Reset" },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "SAFARID Partner API",
      version: release.version,
      description: `${release.headline}\n\nStatus: ${release.status}${release.sunsetOn ? ` — sunset ${release.sunsetOn}` : ""}.`,
      contact: { name: "SAFARID integration desk", url: "https://safarid.org/partners/api" },
    },
    servers: [
      { url: API_BASE_URL, description: "Production" },
      { url: API_SANDBOX_URL, description: "Sandbox" },
    ],
    tags: CAPABILITY_DOMAINS.map((d) => ({ name: d.key, description: d.summary })),
    paths,
    webhooks: Object.fromEntries(
      WEBHOOK_EVENTS.map((w) => [
        w.event,
        {
          post: {
            summary: w.description,
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["event", "sent_at", "data"],
                    properties: {
                      event: { type: "string", const: w.event },
                      sent_at: { type: "string", format: "date-time" },
                      data: {
                        type: "object",
                        properties: Object.fromEntries(
                          w.payloadKeys.map((k) => [k, { type: "string" }]),
                        ),
                      },
                    },
                  },
                },
              },
            },
            responses: { "200": { description: "Acknowledged" } },
          },
        },
      ]),
    ),
    components: {
      securitySchemes: {
        oauth2ClientCredentials: {
          type: "oauth2",
          flows: {
            clientCredentials: {
              tokenUrl: `${API_BASE_URL}/oauth/token`,
              scopes: Object.fromEntries(
                [...new Set(API_ENDPOINTS.map((e) => e.scope))]
                  .filter((s) => s !== "—")
                  .map((s) => [s, `Grants ${s}`]),
              ),
            },
          },
        },
      },
      schemas: {
        Quote: {
          type: "object",
          properties: {
            snapshot_ref: { type: "string" },
            total: { type: "number" },
            currency: { type: "string" },
            expires_at: { type: "string", format: "date-time" },
          },
        },
        Order: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string" },
            partner_reference: { type: "string" },
            cancellation_fee: { type: "number" },
          },
        },
        Tracking: {
          type: "object",
          properties: {
            order_id: { type: "string" },
            eta_seconds: { type: "integer" },
            share_url: { type: "string", format: "uri" },
          },
        },
        DocumentList: {
          type: "array",
          items: {
            type: "object",
            properties: {
              document_id: { type: "string" },
              kind: { type: "string" },
              content_hash: { type: "string" },
              url: { type: "string", format: "uri" },
            },
          },
        },
        Statement: {
          type: "object",
          properties: {
            period: { type: "string" },
            opening_balance: { type: "number" },
            net_movement: { type: "number" },
            closing_balance: { type: "number" },
          },
        },
        TokenResponse: {
          type: "object",
          properties: {
            access_token: { type: "string" },
            token_type: { type: "string", const: "Bearer" },
            expires_in: { type: "integer" },
            scope: { type: "string" },
          },
        },
        Object: { type: "object" },
      },
    },
  };
}
