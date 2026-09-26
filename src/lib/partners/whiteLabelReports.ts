/**
 * WHITE-LABEL DOWNLOADABLE ARTEFACTS — versioned specs and changelog diffs.
 *
 * Everything downloadable is derived from the canonical contract
 * (`whiteLabelApi.ts`, itself derived from `apiPlatform.ts`), so an artefact a
 * tenant downloads can never describe a surface the platform does not publish.
 *
 * Three artefact families:
 *   • tenant OpenAPI  — one release, with the tenant header already applied and
 *     the tenant's own code shown in the server description
 *   • changelog diff  — machine-readable JSON plus a human-readable Markdown
 *     report between any two releases, with breaking changes called out first
 *   • webhook contract — the tenant-scoped webhook catalogue as JSON Schema, so
 *     a partner can validate deliveries against the published envelope
 *
 * Nothing here embeds a credential or a secret.
 */
import {
  TENANT_HEADER, TENANT_WEBHOOK_FIELDS, WHITE_LABEL_DOMAINS, WHITE_LABEL_RELEASES,
  buildWhiteLabelOpenApi, currentWhiteLabelRelease, diffWhiteLabelReleases,
  tenantWebhookContracts, webhookDomain, whiteLabelReleaseByVersion,
  type WhiteLabelDiff,
} from "./whiteLabelApi";

export interface WlArtifact {
  filename: string;
  mime: string;
  contents: string;
  /** What the artefact is for, shown next to the download control. */
  label: string;
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

/** Tenant code stamped into artefacts; falls back to a neutral placeholder. */
const tenantTag = (tenantCode?: string) => (tenantCode ? slug(tenantCode) : "tenant");

/* ------------------------------------------------------------------ *
 * OpenAPI, scoped to one tenant
 * ------------------------------------------------------------------ */

/**
 * The release spec with the tenant's identity applied: the header example and
 * server descriptions name the tenant, so the file is unambiguous once saved.
 */
export function buildTenantOpenApi(version: string, tenantCode?: string) {
  const spec = buildWhiteLabelOpenApi(version) as Record<string, unknown>;
  if (!tenantCode) return spec;

  const cloned = JSON.parse(JSON.stringify(spec)) as ReturnType<typeof buildWhiteLabelOpenApi>;
  const info = cloned.info as { title: string; description: string };
  info.title = `${info.title} — ${tenantCode}`;
  info.description = `${info.description}\n\nIssued for tenant \`${tenantCode}\`.`;
  for (const server of cloned.servers as { description: string }[]) {
    server.description = `${server.description} (${tenantCode})`;
  }
  for (const methods of Object.values(cloned.paths as Record<string, Record<string, unknown>>)) {
    for (const op of Object.values(methods) as { parameters: { name: string; example?: string }[] }[]) {
      const header = op.parameters.find((p) => p.name === TENANT_HEADER);
      if (header) header.example = tenantCode;
    }
  }
  return cloned;
}

export function tenantOpenApiArtifact(version: string, tenantCode?: string): WlArtifact {
  return {
    filename: `yalla-white-label-openapi-${version}-${tenantTag(tenantCode)}.json`,
    mime: "application/json",
    contents: JSON.stringify(buildTenantOpenApi(version, tenantCode), null, 2),
    label: `OpenAPI 3.1 · ${version}`,
  };
}

/* ------------------------------------------------------------------ *
 * Webhook contract as JSON Schema
 * ------------------------------------------------------------------ */

/** JSON Schema (2020-12) for the tenant webhook envelope of one event. */
export function buildWebhookSchema(event: string) {
  const contract = tenantWebhookContracts().find((w) => w.event === event);
  if (!contract) return null;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://api.yalla.africa/schemas/white-label/${event}.json`,
    title: `SAFARID white-label webhook — ${event}`,
    description: contract.when,
    type: "object",
    required: ["event", "sent_at", "delivery_id", "data"],
    properties: {
      event: { const: event },
      sent_at: { type: "string", format: "date-time" },
      delivery_id: { type: "string" },
      data: {
        type: "object",
        required: [...TENANT_WEBHOOK_FIELDS],
        properties: Object.fromEntries(
          contract.payloadKeys.map((k) => [
            k,
            TENANT_WEBHOOK_FIELDS.includes(k as (typeof TENANT_WEBHOOK_FIELDS)[number])
              ? { type: "string", description: "Tenant identity; verify it matches your tenant." }
              : { type: ["string", "number", "boolean", "object", "null"] },
          ]),
        ),
      },
    },
  };
}

/** The whole tenant webhook catalogue: one schema per event, plus the domain map. */
export function buildWebhookContractBundle(tenantCode?: string) {
  const contracts = tenantWebhookContracts();
  return {
    generated_at: new Date().toISOString(),
    release: currentWhiteLabelRelease().version,
    tenant: tenantCode ?? null,
    signature: {
      header: "SAFARID-Signature",
      scheme: "v2",
      signed_payload: "`${timestamp}.${rawBody}`",
      algorithm: "HMAC-SHA256",
      tolerance_seconds: 300,
    },
    events: contracts.map((c) => ({
      event: c.event,
      domain: webhookDomain(c.event),
      when: c.when,
      schema: buildWebhookSchema(c.event),
    })),
  };
}

export function webhookContractArtifact(tenantCode?: string): WlArtifact {
  return {
    filename: `yalla-white-label-webhooks-${currentWhiteLabelRelease().version}-${tenantTag(tenantCode)}.json`,
    mime: "application/json",
    contents: JSON.stringify(buildWebhookContractBundle(tenantCode), null, 2),
    label: "Webhook contract (JSON Schema)",
  };
}

export function webhookEventSchemaArtifact(event: string): WlArtifact | null {
  const schema = buildWebhookSchema(event);
  if (!schema) return null;
  return {
    filename: `yalla-white-label-webhook-${slug(event)}.schema.json`,
    mime: "application/json",
    contents: JSON.stringify(schema, null, 2),
    label: `${event} envelope schema`,
  };
}

/* ------------------------------------------------------------------ *
 * Changelog diff reports
 * ------------------------------------------------------------------ */

/** Markdown migration report between two releases; breaking changes lead. */
export function buildDiffMarkdown(diff: WlDiffReport): string {
  const { diff: d, tenantCode } = diff;
  const from = whiteLabelReleaseByVersion(d.from);
  const to = whiteLabelReleaseByVersion(d.to);
  const lines: string[] = [
    `# SAFARID white-label API — migration report`,
    "",
    `**From** \`${d.from}\`${from ? ` (released ${from.releasedOn}, ${from.status})` : ""}  `,
    `**To** \`${d.to}\`${to ? ` (released ${to.releasedOn}, ${to.status})` : ""}  `,
    tenantCode ? `**Tenant** \`${tenantCode}\`  ` : "",
    `**Generated** ${new Date().toISOString()}`,
    "",
    `Every operation below is an operation of the single SAFARID API contract, viewed through the`,
    `mandatory \`${TENANT_HEADER}\` header. There is no separate white-label API.`,
    "",
    `## Breaking changes (${d.breakingChanges.length})`,
    "",
  ];

  if (d.breakingChanges.length === 0) {
    lines.push("None. This upgrade is backward compatible.", "");
  } else {
    for (const c of d.breakingChanges) lines.push(`- **${c.domain}** (${c.kind}) — ${c.summary}`);
    lines.push("");
  }

  lines.push(`## Other changes (${d.otherChanges.length})`, "");
  if (d.otherChanges.length === 0) lines.push("None.", "");
  else {
    for (const c of d.otherChanges) lines.push(`- **${c.domain}** (${c.kind}) — ${c.summary}`);
    lines.push("");
  }

  lines.push(`## Operations added (${d.addedOperations.length})`, "");
  lines.push(d.addedOperations.length ? d.addedOperations.map((o) => `- \`${o}\``).join("\n") : "None.");
  lines.push("", `## Operations removed (${d.removedOperations.length})`, "");
  lines.push(d.removedOperations.length ? d.removedOperations.map((o) => `- \`${o}\``).join("\n") : "None.");
  lines.push(
    "",
    "## Webhook envelope",
    "",
    `Tenant identity fields are required on every delivery: ${TENANT_WEBHOOK_FIELDS.map((f) => `\`${f}\``).join(", ")}.`,
    "Verify the signature over the raw body before parsing, and reject deliveries outside the 300s tolerance.",
    "",
    "## Domain maturity at the target release",
    "",
    "| Domain | White-label status | Evidence |",
    "| --- | --- | --- |",
    ...WHITE_LABEL_DOMAINS.map((dm) => `| ${dm.name} | ${dm.status} | ${dm.evidence} |`),
    "",
  );

  return lines.filter((l) => l !== "").join("\n") + "\n";
}

export interface WlDiffReport {
  diff: WhiteLabelDiff;
  tenantCode?: string;
}

/** JSON + Markdown diff artefacts between two releases. */
export function diffArtifacts(fromVersion: string, toVersion: string, tenantCode?: string): WlArtifact[] {
  const diff = diffWhiteLabelReleases(fromVersion, toVersion);
  if (!diff) return [];
  const tag = `${fromVersion}_to_${toVersion}`;
  return [
    {
      filename: `yalla-white-label-diff-${tag}.json`,
      mime: "application/json",
      contents: JSON.stringify(
        { generated_at: new Date().toISOString(), tenant: tenantCode ?? null, ...diff },
        null,
        2,
      ),
      label: `Diff ${fromVersion} → ${toVersion} (JSON)`,
    },
    {
      filename: `yalla-white-label-migration-${tag}.md`,
      mime: "text/markdown",
      contents: buildDiffMarkdown({ diff, tenantCode }),
      label: `Migration report ${fromVersion} → ${toVersion} (Markdown)`,
    },
  ];
}

/** Every artefact offered for one tenant at one release. */
export function tenantArtifacts(version: string, tenantCode?: string): WlArtifact[] {
  const previous = WHITE_LABEL_RELEASES.filter((r) => r.version !== version)[0];
  return [
    tenantOpenApiArtifact(version, tenantCode),
    webhookContractArtifact(tenantCode),
    ...(previous ? diffArtifacts(previous.version, version, tenantCode) : []),
  ];
}

/** Browser download of one artefact. */
export function downloadWlArtifact(artifact: WlArtifact) {
  const blob = new Blob([artifact.contents], { type: `${artifact.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = artifact.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
