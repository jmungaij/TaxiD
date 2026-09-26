/**
 * Runtime build manifest — lets an operator tell instantly whether the browser
 * is running the current build, a stale build, or mixed assets.
 *
 * `__BUILD_STAMP__` is injected by Vite at build time (see vite.config.ts) and
 * is deterministic per build, so it doubles as the dependency-optimisation
 * generation marker: two different stamps observed in one page means mixed
 * assets are live.
 */
export interface BuildManifest {
  application_version: string;
  build_id: string;
  commit_sha: string;
  build_timestamp: string;
  environment: string;
  vite_dependency_generation: string;
  react_version: string;
}

const env = (k: string): string | undefined =>
  (import.meta.env as Record<string, string | undefined>)[k];

export function buildManifest(): BuildManifest {
  const stamp = (globalThis as { __BUILD_STAMP__?: string }).__BUILD_STAMP__ ?? "dev";
  return {
    application_version: env("VITE_APP_VERSION") ?? "0.0.0",
    build_id: stamp,
    commit_sha: env("VITE_COMMIT_SHA") ?? "unknown",
    build_timestamp: env("VITE_BUILD_TIME") ?? "unknown",
    environment: env("VITE_ENVIRONMENT") ?? import.meta.env.MODE ?? "unknown",
    vite_dependency_generation: dependencyGeneration(),
    react_version: reactVersion(),
  };
}

function reactVersion(): string {
  const r = (globalThis as { React?: { version?: string } }).React;
  return r?.version ?? "bundled";
}

/**
 * Reads the `?v=` generation Vite appends to pre-bundled dependency URLs.
 * More than one distinct value means two dependency bundles (and therefore
 * potentially two React identities) are live in this document.
 */
export function dependencyGenerations(): string[] {
  if (typeof document === "undefined") return [];
  const gens = new Set<string>();
  for (const el of Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))) {
    const m = el.src.match(/[?&]v=([0-9a-f]+)/i);
    if (m) gens.add(m[1]);
  }
  for (const el of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]'))) {
    const m = el.href.match(/[?&]v=([0-9a-f]+)/i);
    if (m) gens.add(m[1]);
  }
  return [...gens];
}

export function dependencyGeneration(): string {
  const gens = dependencyGenerations();
  if (gens.length === 0) return "unknown";
  return gens.length === 1 ? gens[0] : `MIXED(${gens.join(",")})`;
}

/** True when the document references more than one dependency generation. */
export function hasMixedDependencyBundles(): boolean {
  return dependencyGenerations().length > 1;
}
