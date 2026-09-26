/**
 * Deploy Health — browser-side verification of a *distributed* build.
 *
 * Everything here runs against the host that served the app (cPanel, Lovable
 * hosting, a static mirror), using only files the release packager ships:
 *   - /build-info            → build id, git commit, release hash, sourcemaps
 *   - /release-manifest.json → per-file SHA-256 + byte sizes
 *   - the main JS bundle     → role-guard runtime presence, no leaked secrets
 *
 * Used by /health (fast shell check) and /deploy-smoke (full asset sweep).
 */

export interface BuildInfo {
  name?: string;
  version?: string;
  build_id?: string;
  built_at?: string;
  git_commit?: string | null;
  git_branch?: string | null;
  release?: string;
  release_sha256?: string;
  source_maps_available?: boolean;
  source_map_count?: number;
  signature?: { algorithm?: string; key_id?: string; key_source?: string; manifest_sha256?: string };
}

export interface ReleaseManifest {
  release?: string;
  build_id?: string;
  release_sha256?: string;
  source_maps_included?: boolean;
  file_count?: number;
  files: { path: string; bytes: number; sha256: string }[];
}

export type CheckState = "pass" | "fail" | "warn" | "pending";

export interface HealthCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
}

export interface HealthReport {
  checks: HealthCheck[];
  buildInfo: BuildInfo | null;
  manifest: ReleaseManifest | null;
  overall: CheckState;
  checkedAt: string;
}

export interface AssetResult {
  path: string;
  kind: "js" | "css" | "map" | "other";
  status: number | null;
  ok: boolean;
  expectedBytes: number;
  actualBytes: number | null;
  reason?: string;
}

export interface SmokeReport {
  assets: AssetResult[];
  buildInfo: BuildInfo | null;
  manifest: ReleaseManifest | null;
  origin: string;
  missing: number;
  mismatched: number;
  checkedAt: string;
}

const ok = (id: string, label: string, detail: string): HealthCheck => ({ id, label, state: "pass", detail });
const bad = (id: string, label: string, detail: string): HealthCheck => ({ id, label, state: "fail", detail });
const warn = (id: string, label: string, detail: string): HealthCheck => ({ id, label, state: "warn", detail });

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadBuildInfo(): Promise<BuildInfo | null> {
  return (await fetchJson<BuildInfo>("/build-info")) ?? (await fetchJson<BuildInfo>("/build-info.json"));
}

export async function loadReleaseManifest(): Promise<ReleaseManifest | null> {
  return fetchJson<ReleaseManifest>("/release-manifest.json");
}

/** Entry HTML asset references — the exact URLs the browser was told to load. */
export async function loadIndexAssetRefs(): Promise<string[]> {
  try {
    const res = await fetch("/index.html", { cache: "no-store" });
    if (!res.ok) return [];
    const html = await res.text();
    return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  } catch {
    return [];
  }
}

function classify(path: string): AssetResult["kind"] {
  if (path.endsWith(".map")) return "map";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".css")) return "css";
  return "other";
}

/** Fast shell/bundle health used by /health. */
export async function runHealthReport(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  // 1. App shell actually mounted (this code runs inside React, so it did).
  const rootMounted = typeof document !== "undefined" && !!document.getElementById("root")?.childElementCount;
  checks.push(
    rootMounted
      ? ok("shell", "App shell", "React root mounted and rendering")
      : bad("shell", "App shell", "React root is empty"),
  );

  // 2. build-info endpoint.
  const buildInfo = await loadBuildInfo();
  if (!buildInfo) {
    checks.push(warn("build-info", "Build info endpoint", "/build-info not served (expected on dev servers only)"));
  } else {
    const missingKeys = ["build_id", "release_sha256"].filter((k) => !(k in buildInfo));
    checks.push(
      missingKeys.length === 0
        ? ok(
            "build-info",
            "Build info endpoint",
            `build ${buildInfo.build_id} · commit ${(buildInfo.git_commit ?? "unknown").slice(0, 8)}`,
          )
        : bad("build-info", "Build info endpoint", `missing field(s): ${missingKeys.join(", ")}`),
    );
  }

  // 3. Release manifest present and consistent with build-info.
  const manifest = await loadReleaseManifest();
  if (!manifest) {
    checks.push(warn("manifest", "Release manifest", "release-manifest.json not served (dev server)"));
  } else if (buildInfo && manifest.release_sha256 !== buildInfo.release_sha256) {
    checks.push(bad("manifest", "Release manifest", "release hash does not match /build-info — mixed deployment"));
  } else {
    checks.push(ok("manifest", "Release manifest", `${manifest.files?.length ?? 0} files declared`));
  }

  // 4. Source maps.
  const smExpected = buildInfo?.source_maps_available ?? manifest?.source_maps_included ?? null;
  if (smExpected === null) {
    checks.push(warn("sourcemaps", "Source maps", "unknown — no release metadata served"));
  } else if (!smExpected) {
    checks.push(warn("sourcemaps", "Source maps", "not included in this release"));
  } else {
    const firstMap = manifest?.files?.find((f) => f.path.endsWith(".js.map"));
    if (!firstMap) {
      checks.push(warn("sourcemaps", "Source maps", "flagged available but none listed in manifest"));
    } else {
      const res = await fetch(`/${firstMap.path}`, { method: "GET", cache: "no-store" }).catch(() => null);
      checks.push(
        res?.ok
          ? ok("sourcemaps", "Source maps", `${firstMap.path} resolves`)
          : bad("sourcemaps", "Source maps", `${firstMap.path} not served (status ${res?.status ?? "network error"})`),
      );
    }
  }

  // 5. Role-guard runtime shipped in the main bundle (RBAC posture of the build).
  const refs = await loadIndexAssetRefs();
  const mainJs =
    refs.find((r) => /\/assets\/index-.*\.js$/.test(r)) ?? refs.find((r) => r.endsWith(".js")) ?? null;
  if (!mainJs) {
    checks.push(warn("role-guard", "Role-guard bundle", "no hashed JS bundle referenced (dev server)"));
  } else {
    try {
      const code = await (await fetch(mainJs, { cache: "no-store" })).text();
      const guarded = /RequireRole|has_role|rolesAllowed/.test(code);
      const leaked = /service_role|SERVICE_ROLE_KEY/.test(code);
      checks.push(
        leaked
          ? bad("role-guard", "Role-guard bundle", "bundle references a service-role key — do not serve this build")
          : guarded
            ? ok("role-guard", "Role-guard bundle", `role guards present in ${mainJs.split("/").pop()}`)
            : bad("role-guard", "Role-guard bundle", "no role-guard runtime found in shipped bundle"),
      );
    } catch {
      checks.push(bad("role-guard", "Role-guard bundle", `could not download ${mainJs}`));
    }
  }

  const overall: CheckState = checks.some((c) => c.state === "fail")
    ? "fail"
    : checks.some((c) => c.state === "warn")
      ? "warn"
      : "pass";

  return { checks, buildInfo, manifest, overall, checkedAt: new Date().toISOString() };
}

/**
 * Full asset sweep used by /deploy-smoke: every hashed asset and source map in
 * the manifest is requested from the serving host and compared to the declared
 * byte size (content-length or downloaded length).
 */
export async function runDeploySmoke(
  onProgress?: (done: number, total: number) => void,
): Promise<SmokeReport> {
  const [buildInfo, manifest] = await Promise.all([loadBuildInfo(), loadReleaseManifest()]);
  const declared = (manifest?.files ?? []).filter((f) => f.path.startsWith("assets/"));
  const results: AssetResult[] = [];

  const CONCURRENCY = 6;
  let index = 0;
  let done = 0;

  async function worker() {
    while (index < declared.length) {
      const entry = declared[index++];
      const url = `/${entry.path}`;
      let result: AssetResult = {
        path: entry.path,
        kind: classify(entry.path),
        status: null,
        ok: false,
        expectedBytes: entry.bytes,
        actualBytes: null,
      };
      try {
        const res = await fetch(url, { cache: "no-store" });
        const buf = res.ok ? await res.arrayBuffer() : null;
        const actual = buf ? buf.byteLength : null;
        result = {
          ...result,
          status: res.status,
          actualBytes: actual,
          ok: res.ok && actual === entry.bytes,
          reason: !res.ok
            ? `HTTP ${res.status}`
            : actual !== entry.bytes
              ? `size mismatch (expected ${entry.bytes}, got ${actual})`
              : undefined,
        };
      } catch (err) {
        result.reason = err instanceof Error ? err.message : "network error";
      }
      results.push(result);
      done++;
      onProgress?.(done, declared.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, declared.length) }, worker));
  results.sort((a, b) => a.path.localeCompare(b.path));

  return {
    assets: results,
    buildInfo,
    manifest,
    origin: typeof window !== "undefined" ? window.location.origin : "",
    missing: results.filter((r) => !r.ok && r.status !== 200).length,
    mismatched: results.filter((r) => r.status === 200 && !r.ok).length,
    checkedAt: new Date().toISOString(),
  };
}
