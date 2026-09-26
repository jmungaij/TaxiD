/**
 * YALLA API PARTNERS — Postman & SDK export builders.
 *
 * Everything downloadable is derived from the canonical platform contract, so a
 * collection or SDK a partner downloads is always in lockstep with the
 * documented surface and the published OpenAPI release. Nothing here embeds a
 * credential: exports reference environment variables only.
 */

import {
  API_BASE_URL,
  API_SANDBOX_URL,
  API_ENDPOINTS,
  CAPABILITY_DOMAINS,
  COMMERCIAL_TIERS,
  type ApiEndpoint,
} from "./apiPlatform";
import { buildOpenApiSpec, currentRelease } from "./apiVersions";

export type ExportScope = { domain?: string; tier?: string };

/** Domains a tier is entitled to, derived from its declared inclusions. */
export const TIER_DOMAINS: Record<string, string[]> = {
  integrate: ["identity", "quoting", "orders", "tracking", "documents"],
  scale: ["identity", "quoting", "orders", "tracking", "documents", "settlement"],
  infrastructure: CAPABILITY_DOMAINS.map((d) => d.key),
};

export function tierDomains(tier: string): string[] {
  return TIER_DOMAINS[tier] ?? TIER_DOMAINS.integrate;
}

export function scopedEndpoints({ domain, tier }: ExportScope): ApiEndpoint[] {
  const allowed = tier ? new Set(tierDomains(tier)) : null;
  return API_ENDPOINTS.filter(
    (e) => (!domain || e.domain === domain) && (!allowed || allowed.has(e.domain)),
  );
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

const sampleBody = (e: ApiEndpoint): string | null => {
  const curl = e.samples.find((s) => s.lang === "cURL")?.code ?? "";
  const match = curl.match(/-d '([\s\S]*?)'/);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw.startsWith("{")) return null;
  return raw;
};

/**
 * Postman Collection v2.1. Requests are grouped into folders by capability
 * domain and authenticated by a collection-level bearer variable, populated by
 * a pre-request script that performs the client-credentials exchange.
 */
export function buildPostmanCollection(scope: ExportScope = {}) {
  const endpoints = scopedEndpoints(scope);
  const domains = CAPABILITY_DOMAINS.filter((d) => endpoints.some((e) => e.domain === d.key));
  const label = scope.domain
    ? CAPABILITY_DOMAINS.find((d) => d.key === scope.domain)?.name ?? scope.domain
    : scope.tier
      ? `${COMMERCIAL_TIERS.find((t) => t.key === scope.tier)?.name ?? scope.tier} tier`
      : "Full surface";

  return {
    info: {
      name: `Yalla Partner API — ${label} (${currentRelease().version})`,
      description:
        "Generated from the Yalla partner API contract. Set `client_id`, `client_secret` and `base_url` " +
        "in a Postman environment; the pre-request script mints a short-lived bearer token automatically. " +
        "No credentials are embedded in this file.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{access_token}}", type: "string" }] },
    event: [
      {
        listen: "prerequest",
        script: {
          type: "text/javascript",
          exec: [
            "const expiry = pm.collectionVariables.get('access_token_expiry');",
            "if (!expiry || Date.now() > Number(expiry)) {",
            "  pm.sendRequest({",
            "    url: pm.variables.replaceIn('{{base_url}}/oauth/token'),",
            "    method: 'POST',",
            "    header: {",
            "      'Content-Type': 'application/x-www-form-urlencoded',",
            "      Authorization: 'Basic ' + btoa(pm.variables.replaceIn('{{client_id}}:{{client_secret}}')),",
            "    },",
            "    body: { mode: 'urlencoded', urlencoded: [{ key: 'grant_type', value: 'client_credentials' }] },",
            "  }, (err, res) => {",
            "    if (err) { console.error(err); return; }",
            "    const body = res.json();",
            "    pm.collectionVariables.set('access_token', body.access_token);",
            "    pm.collectionVariables.set('access_token_expiry', Date.now() + (body.expires_in - 60) * 1000);",
            "  });",
            "}",
          ],
        },
      },
    ],
    variable: [
      { key: "base_url", value: API_SANDBOX_URL },
      { key: "production_url", value: API_BASE_URL },
      { key: "client_id", value: "" },
      { key: "client_secret", value: "" },
      { key: "access_token", value: "" },
      { key: "access_token_expiry", value: "0" },
    ],
    item: domains.map((d) => ({
      name: d.name,
      description: d.summary,
      item: endpoints
        .filter((e) => e.domain === d.key)
        .map((e) => {
          const body = sampleBody(e);
          return {
            name: e.name,
            request: {
              method: e.method,
              description: `${e.purpose}\n\nScope: ${e.scope}`,
              header: [
                { key: "Content-Type", value: "application/json" },
                ...(e.idempotent && e.method !== "GET"
                  ? [{ key: "Idempotency-Key", value: `{{$guid}}` }]
                  : []),
              ],
              url: {
                raw: `{{base_url}}${e.path}`,
                host: ["{{base_url}}"],
                path: e.path.replace(/^\//, "").split("/"),
              },
              ...(body ? { body: { mode: "raw", raw: body, options: { raw: { language: "json" } } } } : {}),
            },
            event: [
              {
                listen: "test",
                script: {
                  type: "text/javascript",
                  exec: [
                    "pm.test('2xx', () => pm.response.to.be.success);",
                    "pm.test('rate limit headers present', () => pm.expect(pm.response.headers.has('X-RateLimit-Remaining')).to.be.true);",
                  ],
                },
              },
            ],
          };
        }),
    })),
  };
}

/** TypeScript SDK: a single dependency-free module with token caching. */
export function buildTypeScriptSdk(scope: ExportScope = {}): string {
  const endpoints = scopedEndpoints(scope);
  const methods = endpoints
    .map((e) => {
      const name = slug(e.name).replace(/-(\w)/g, (_, c) => c.toUpperCase());
      const hasPathParam = /\{(\w+)\}/.test(e.path);
      const args = [
        ...(hasPathParam ? ["id: string"] : []),
        ...(e.method === "GET" ? [] : ["body: Record<string, unknown> = {}"]),
        ...(e.idempotent && e.method !== "GET" ? ["idempotencyKey?: string"] : []),
      ].join(", ");
      const pathExpr = hasPathParam
        ? "`" + e.path.replace(/\{\w+\}/, "${encodeURIComponent(id)}") + "`"
        : JSON.stringify(e.path);
      return `  /** ${e.purpose} Scope: ${e.scope}. */
  async ${name}(${args}) {
    return this.request(${JSON.stringify(e.method)}, ${pathExpr}${
      e.method === "GET" ? "" : ", body"
    }${e.idempotent && e.method !== "GET" ? ", idempotencyKey" : ""});
  }`;
    })
    .join("\n\n");

  return `/**
 * Yalla Partner API — TypeScript SDK (generated, spec ${currentRelease().version}).
 * Zero dependencies. Node 18+ or any runtime with global fetch.
 *
 * Never hard-code credentials: read them from the environment.
 */

export interface YallaClientOptions {
  clientId: string;
  clientSecret: string;
  /** Sandbox by default. Pass the production base URL to go live. */
  baseUrl?: string;
  scopes?: string[];
  /** Automatic retry for 429 and 5xx with exponential backoff. */
  maxRetries?: number;
}

export class YallaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "YallaApiError";
  }
}

export class YallaClient {
  private token: string | null = null;
  private tokenExpiry = 0;
  private readonly baseUrl: string;

  constructor(private readonly options: YallaClientOptions) {
    this.baseUrl = options.baseUrl ?? ${JSON.stringify(API_SANDBOX_URL)};
  }

  /** Client-credentials exchange with in-memory caching and a 60s safety margin. */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;

    const credentials = btoa(\`\${this.options.clientId}:\${this.options.clientSecret}\`);
    const params = new URLSearchParams({ grant_type: "client_credentials" });
    if (this.options.scopes?.length) params.set("scope", this.options.scopes.join(" "));

    const res = await fetch(\`\${this.baseUrl}/oauth/token\`, {
      method: "POST",
      headers: { Authorization: \`Basic \${credentials}\`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) throw new YallaApiError("token exchange failed", res.status, await res.text());

    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = json.access_token;
    this.tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
    return this.token;
  }

  async request(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<any> {
    const maxRetries = this.options.maxRetries ?? 3;

    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const res = await fetch(\`\${this.baseUrl}\${path}\`, {
        method,
        headers: {
          Authorization: \`Bearer \${token}\`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
      });

      if (res.status === 401 && attempt === 0) {
        // Credential rotated mid-flight: drop the cached token and retry once.
        this.token = null;
        continue;
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxRetries) {
        const reset = Number(res.headers.get("X-RateLimit-Reset") ?? 0);
        const waitMs = reset > 0 ? Math.max(0, reset * 1000 - Date.now()) : 2 ** attempt * 250;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      const text = await res.text();
      const parsed = text ? JSON.parse(text) : null;
      if (!res.ok) {
        throw new YallaApiError(
          \`\${method} \${path} failed with \${res.status}\`,
          res.status,
          parsed,
          res.headers.get("X-Request-Id") ?? undefined,
        );
      }
      return parsed;
    }
  }

${methods}
}

export const createYallaClient = (options: YallaClientOptions) => new YallaClient(options);
`;
}

/** Python SDK: single module, requests-based. */
export function buildPythonSdk(scope: ExportScope = {}): string {
  const endpoints = scopedEndpoints(scope);
  const methods = endpoints
    .map((e) => {
      const name = slug(e.name).replace(/-/g, "_");
      const hasPathParam = /\{(\w+)\}/.test(e.path);
      const args = [
        "self",
        ...(hasPathParam ? ["resource_id: str"] : []),
        ...(e.method === "GET" ? [] : ["payload: dict | None = None"]),
        ...(e.idempotent && e.method !== "GET" ? ["idempotency_key: str | None = None"] : []),
      ].join(", ");
      const pathExpr = hasPathParam
        ? `f"${e.path.replace(/\{\w+\}/, "{resource_id}")}"`
        : `"${e.path}"`;
      return `    def ${name}(${args}):
        """${e.purpose} Scope: ${e.scope}."""
        return self.request("${e.method}", ${pathExpr}${e.method === "GET" ? "" : ", payload"}${
          e.idempotent && e.method !== "GET" ? ", idempotency_key" : ""
        })`;
    })
    .join("\n\n");

  return `"""Yalla Partner API - Python SDK (generated, spec ${currentRelease().version}).

Requires: requests. Read credentials from the environment; never commit them.
"""

from __future__ import annotations

import base64
import os
import time
from typing import Any

import requests

SANDBOX_URL = "${API_SANDBOX_URL}"
PRODUCTION_URL = "${API_BASE_URL}"


class YallaApiError(RuntimeError):
    def __init__(self, message: str, status: int, body: Any = None, request_id: str | None = None):
        super().__init__(message)
        self.status = status
        self.body = body
        self.request_id = request_id


class YallaClient:
    def __init__(
        self,
        client_id: str | None = None,
        client_secret: str | None = None,
        base_url: str = SANDBOX_URL,
        scopes: list[str] | None = None,
        max_retries: int = 3,
    ):
        self.client_id = client_id or os.environ["YALLA_CLIENT_ID"]
        self.client_secret = client_secret or os.environ["YALLA_CLIENT_SECRET"]
        self.base_url = base_url.rstrip("/")
        self.scopes = scopes or []
        self.max_retries = max_retries
        self._token: str | None = None
        self._token_expiry = 0.0
        self._session = requests.Session()

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_expiry:
            return self._token
        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        data = {"grant_type": "client_credentials"}
        if self.scopes:
            data["scope"] = " ".join(self.scopes)
        res = self._session.post(
            f"{self.base_url}/oauth/token",
            headers={"Authorization": f"Basic {basic}"},
            data=data,
            timeout=15,
        )
        if res.status_code >= 400:
            raise YallaApiError("token exchange failed", res.status_code, res.text)
        body = res.json()
        self._token = body["access_token"]
        self._token_expiry = time.time() + body["expires_in"] - 60
        return self._token

    def request(
        self,
        method: str,
        path: str,
        payload: dict | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        attempt = 0
        while True:
            headers = {"Authorization": f"Bearer {self._access_token()}"}
            if idempotency_key:
                headers["Idempotency-Key"] = idempotency_key
            res = self._session.request(
                method, f"{self.base_url}{path}", headers=headers, json=payload, timeout=30
            )

            if res.status_code == 401 and attempt == 0:
                # Credential rotated mid-flight: drop the cached token and retry.
                self._token = None
                attempt += 1
                continue

            if (res.status_code == 429 or res.status_code >= 500) and attempt < self.max_retries:
                reset = float(res.headers.get("X-RateLimit-Reset", 0) or 0)
                wait = max(0.0, reset - time.time()) if reset else (2 ** attempt) * 0.25
                time.sleep(wait)
                attempt += 1
                continue

            if res.status_code >= 400:
                raise YallaApiError(
                    f"{method} {path} failed with {res.status_code}",
                    res.status_code,
                    res.text,
                    res.headers.get("X-Request-Id"),
                )
            return res.json() if res.content else None

${methods}
`;
}

export interface ExportArtifact {
  filename: string;
  mime: string;
  contents: string;
}

export function buildExports(scope: ExportScope = {}): ExportArtifact[] {
  const tag = scope.domain ? slug(scope.domain) : scope.tier ? slug(scope.tier) : "full";
  const version = currentRelease().version;
  return [
    {
      filename: `yalla-api-${tag}-${version}.postman_collection.json`,
      mime: "application/json",
      contents: JSON.stringify(buildPostmanCollection(scope), null, 2),
    },
    {
      filename: `yalla-openapi-${version}.json`,
      mime: "application/json",
      contents: JSON.stringify(buildOpenApiSpec(version), null, 2),
    },
    {
      filename: `yalla-sdk-${tag}.ts`,
      mime: "text/plain",
      contents: buildTypeScriptSdk(scope),
    },
    {
      filename: `yalla_sdk_${tag.replace(/-/g, "_")}.py`,
      mime: "text/plain",
      contents: buildPythonSdk(scope),
    },
  ];
}

/** Browser download helper. */
export function downloadArtifact(artifact: ExportArtifact) {
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
