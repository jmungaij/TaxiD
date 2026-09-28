/**
 * WHITE-LABEL API SURFACE — the tenant-scoped view of the one API contract.
 *
 * There is no separate white-label API. Every operation here is an operation
 * declared in `apiPlatform.ts`; white-label adds exactly two things on top:
 *   • a mandatory tenant header (`X-Yalla-Tenant`) that binds the call to one
 *     isolated tenant, and
 *   • tenant identity fields on the webhook envelope.
 *
 * Statuses are the white-label vocabulary (`CapabilityStatus`), so a branded
 * surface can never be advertised at a higher maturity than the underlying API
 * capability it is built on.
 */
import {
  API_BASE_URL, API_ENDPOINTS, API_SANDBOX_URL, CAPABILITY_DOMAINS, WEBHOOK_EVENTS,
  type ApiEndpoint,
} from "./apiPlatform";
import { operationKey, type ChangelogEntry } from "./apiVersions";
import type { CapabilityStatus } from "./whiteLabel";

/** Header every tenant-scoped request must carry. */
export const TENANT_HEADER = "X-Yalla-Tenant";

/** Tenant fields added to every webhook envelope in a white-label programme. */
export const TENANT_WEBHOOK_FIELDS = ["tenant_id", "tenant_code", "environment"] as const;

export interface WhiteLabelDomain {
  key: string;
  name: string;
  purpose: string;
  /** White-label maturity of the branded surface built on this domain. */
  status: CapabilityStatus;
  /** Why the status is what it is — no unevidenced claims. */
  evidence: string;
}

/**
 * Domain maturity for white-label use. Keys must exist in
 * `CAPABILITY_DOMAINS`; the contract test asserts that.
 */
const DOMAIN_STATUS: Record<string, { status: CapabilityStatus; evidence: string }> = {
  quoting: { status: "LIVE", evidence: "Server-governed quoting, identical to the API partner surface." },
  orders: { status: "LIVE", evidence: "Canonical mobility order with idempotency keys and a closed state machine." },
  tracking: { status: "LIVE", evidence: "Scoped share tokens safe to render inside the partner brand." },
  documents: { status: "CONFIGURED", evidence: "Partner brand on receipts and invoices; statutory identifiers fixed by the issuing entity." },
  settlement: { status: "CONFIGURED", evidence: "Tenant-scoped statements enabled per programme at provisioning." },
  identity: { status: "LIVE", evidence: "Per-tenant, per-environment credentials with rotation and an append-only audit trail." },
};

export const WHITE_LABEL_DOMAINS: WhiteLabelDomain[] = CAPABILITY_DOMAINS.map((d) => ({
  key: d.key,
  name: d.name,
  purpose: d.summary,
  status: DOMAIN_STATUS[d.key]?.status ?? "ROADMAP",
  evidence: DOMAIN_STATUS[d.key]?.evidence ?? "Not admitted to the white-label programme.",
}));

export const whiteLabelDomain = (key: string) => WHITE_LABEL_DOMAINS.find((d) => d.key === key);

/** The tenant-scoped operations: every API operation in an admitted domain. */
export function tenantScopedEndpoints(): ApiEndpoint[] {
  const admitted = new Set(
    WHITE_LABEL_DOMAINS.filter((d) => d.status !== "ROADMAP").map((d) => d.key),
  );
  return API_ENDPOINTS.filter((e) => admitted.has(e.domain));
}

export interface WhiteLabelWebhookContract {
  event: string;
  when: string;
  /** Payload keys, including the tenant identity fields. */
  payloadKeys: string[];
}

/** Webhook events carry no domain in the API contract; derive it from the event name. */
export function webhookDomain(event: string): string {
  const prefix = event.split(".")[0];
  if (prefix === "order") return "orders";
  if (prefix === "payment" || prefix === "reconciliation") return "settlement";
  if (prefix === "document") return "documents";
  return "identity";
}

export function tenantWebhookContracts(): WhiteLabelWebhookContract[] {
  const admitted = new Set(WHITE_LABEL_DOMAINS.filter((d) => d.status !== "ROADMAP").map((d) => d.key));
  return WEBHOOK_EVENTS.filter((w) => admitted.has(webhookDomain(w.event))).map((w) => ({
    event: w.event,
    when: w.description,
    payloadKeys: [...TENANT_WEBHOOK_FIELDS, ...w.payloadKeys],
  }));
}

/* ------------------------------------------------------------------ *
 * Versioning
 * ------------------------------------------------------------------ */

export interface WhiteLabelRelease {
  version: string;
  releasedOn: string;
  status: "current" | "supported" | "deprecated";
  sunsetOn?: string;
  headline: string;
  /** Operation keys (`METHOD path`) exposed to tenants in this release. */
  operations: string[];
  changelog: ChangelogEntry[];
}

const ALL_TENANT_OPS = tenantScopedEndpoints().map(operationKey);

export const WHITE_LABEL_RELEASES: WhiteLabelRelease[] = [
  {
    version: "wl-2026.08.1",
    releasedOn: "2026-08-24",
    status: "current",
    headline: "Tenant-scoped settlement statements and tenant identity on every webhook envelope.",
    operations: ALL_TENANT_OPS,
    changelog: [
      { kind: "added", domain: "settlement", summary: "Statement reads are tenant-scoped; a tenant can never read another tenant's position.", breaking: false },
      { kind: "changed", domain: "identity", summary: `Webhook envelopes carry ${TENANT_WEBHOOK_FIELDS.join(", ")}.`, breaking: true },
      { kind: "security", domain: "identity", summary: `${TENANT_HEADER} is mandatory; a mismatch against the credential's tenant is rejected with 403.`, breaking: true },
    ],
  },
  {
    version: "wl-2026.05.1",
    releasedOn: "2026-05-27",
    status: "supported",
    sunsetOn: "2027-02-28",
    headline: "Branded documents and tracking share tokens for tenant customer portals.",
    operations: ALL_TENANT_OPS.filter((k) => !k.startsWith("GET /settlement")),
    changelog: [
      { kind: "added", domain: "documents", summary: "Receipts and invoices render the tenant brand while keeping statutory identifiers of the issuing entity.", breaking: false },
      { kind: "added", domain: "tracking", summary: "Share tokens are tenant-bound and expire, so a link cannot be replayed across tenants.", breaking: false },
    ],
  },
  {
    version: "wl-2026.02.0",
    releasedOn: "2026-02-10",
    status: "deprecated",
    sunsetOn: "2026-11-30",
    headline: "First white-label release: tenant provisioning, quoting and ordering.",
    operations: ALL_TENANT_OPS.filter(
      (k) => !k.startsWith("GET /settlement") && !k.includes("/tracking") && !k.includes("/documents"),
    ),
    changelog: [
      { kind: "added", domain: "quoting", summary: "Tenant-scoped quoting with governed pricing.", breaking: false },
      { kind: "added", domain: "orders", summary: "Tenant-scoped ordering and cancellation with idempotency keys.", breaking: false },
    ],
  },
];

export const currentWhiteLabelRelease = () =>
  WHITE_LABEL_RELEASES.find((r) => r.status === "current") ?? WHITE_LABEL_RELEASES[0];

export const whiteLabelReleaseByVersion = (version: string) =>
  WHITE_LABEL_RELEASES.find((r) => r.version === version);

export interface WhiteLabelDiff {
  from: string;
  to: string;
  addedOperations: string[];
  removedOperations: string[];
  breakingChanges: ChangelogEntry[];
  otherChanges: ChangelogEntry[];
}

/** Structural + narrative diff between two white-label releases. */
export function diffWhiteLabelReleases(fromVersion: string, toVersion: string): WhiteLabelDiff | null {
  const from = whiteLabelReleaseByVersion(fromVersion);
  const to = whiteLabelReleaseByVersion(toVersion);
  if (!from || !to) return null;

  const fromOps = new Set(from.operations);
  const toOps = new Set(to.operations);
  const fromIndex = WHITE_LABEL_RELEASES.indexOf(from);
  const toIndex = WHITE_LABEL_RELEASES.indexOf(to);
  const [lo, hi] = fromIndex > toIndex ? [toIndex, fromIndex] : [fromIndex, toIndex];
  const spanned = WHITE_LABEL_RELEASES.slice(lo, hi).flatMap((r) => r.changelog);

  return {
    from: from.version,
    to: to.version,
    addedOperations: [...toOps].filter((k) => !fromOps.has(k)),
    removedOperations: [...fromOps].filter((k) => !toOps.has(k)),
    breakingChanges: spanned.filter((c) => c.breaking),
    otherChanges: spanned.filter((c) => !c.breaking),
  };
}

/** OpenAPI 3.1 document for one white-label release, with the tenant header applied. */
export function buildWhiteLabelOpenApi(version: string = currentWhiteLabelRelease().version) {
  const release = whiteLabelReleaseByVersion(version) ?? currentWhiteLabelRelease();
  const included = tenantScopedEndpoints().filter((e) => release.operations.includes(operationKey(e)));

  const tenantHeader = {
    name: TENANT_HEADER,
    in: "header",
    required: true,
    description: "Tenant code the call is executed against. Must match the calling credential's tenant.",
    schema: { type: "string" },
  };

  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of included) {
    paths[e.path] = paths[e.path] ?? {};
    const pathParams = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1], in: "path", required: true, schema: { type: "string" },
    }));
    paths[e.path][e.method.toLowerCase()] = {
      operationId: `wl_${e.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      summary: e.name,
      description: e.purpose,
      tags: [e.domain],
      security: e.scope === "—" ? [] : [{ oauth2ClientCredentials: [e.scope] }],
      parameters: [tenantHeader, ...pathParams],
      responses: {
        "200": { description: "Tenant-scoped success response." },
        "403": { description: `${TENANT_HEADER} does not match the credential's tenant.` },
        "429": { description: "Rate limit for the tenant credential exceeded." },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "TaxiD White-Label Platform API",
      version: release.version,
      description:
        "Tenant-scoped view of the TaxiD mobility API. Identical operations to the API partner " +
        `surface, with a mandatory ${TENANT_HEADER} header and tenant identity on webhook envelopes.`,
    },
    servers: [
      { url: API_SANDBOX_URL, description: "Sandbox tenant" },
      { url: API_BASE_URL, description: "Production tenant" },
    ],
    tags: WHITE_LABEL_DOMAINS.filter((d) => d.status !== "ROADMAP").map((d) => ({
      name: d.key,
      description: `${d.purpose} (white-label status: ${d.status})`,
    })),
    paths,
    webhooks: Object.fromEntries(
      tenantWebhookContracts().map((w) => [
        w.event,
        {
          post: {
            summary: w.when,
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: [...TENANT_WEBHOOK_FIELDS],
                    properties: Object.fromEntries(w.payloadKeys.map((k) => [k, { type: "string" }])),
                  },
                },
              },
            },
          },
        },
      ]),
    ),
    components: {
      securitySchemes: {
        oauth2ClientCredentials: {
          type: "oauth2",
          flows: { clientCredentials: { tokenUrl: `${API_BASE_URL}/oauth/token`, scopes: {} } },
        },
      },
    },
  };
}

export const whiteLabelSpecFilename = (version: string) =>
  `yalla-white-label-openapi-${version}.json`;
