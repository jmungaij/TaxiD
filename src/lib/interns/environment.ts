/**
 * INTERNS 360 — data environment boundary.
 *
 * LIVE renders authoritative records only. DEMO renders a clearly labelled
 * seeded cohort so the cockpit can be evaluated without inventing production
 * performance. TEST is reserved for automated synthetic runs.
 *
 * The environment is a presentation-layer selector only: it never widens
 * server-side authority, and DEMO figures are never written back or counted as
 * production analytics.
 */
import { useCallback, useEffect, useState } from "react";

export const INTERNS_ENVIRONMENTS = ["LIVE", "DEMO", "TEST"] as const;
export type InternsEnvironment = (typeof INTERNS_ENVIRONMENTS)[number];

export const ENVIRONMENT_LABEL: Record<InternsEnvironment, string> = {
  LIVE: "Live",
  DEMO: "Demo",
  TEST: "Test",
};

export const ENVIRONMENT_NOTE: Record<InternsEnvironment, string> = {
  LIVE: "Authoritative records only. Absent data shows as NO LIVE DATA — never as a fabricated figure.",
  DEMO: "Seeded YMEITA demo cohort. Every figure is labelled DEMO and is excluded from production analytics.",
  TEST: "Automated certification records. Synthetic by construction and never reported as performance.",
};

const KEY = "yalla.interns360.environment";

function read(): InternsEnvironment {
  try {
    const v = localStorage.getItem(KEY);
    return (INTERNS_ENVIRONMENTS as readonly string[]).includes(v ?? "")
      ? (v as InternsEnvironment)
      : "LIVE";
  } catch {
    return "LIVE";
  }
}

/** Persisted environment selector for the Interns 360 cockpit. */
export function useInternsEnvironment(): [InternsEnvironment, (e: InternsEnvironment) => void] {
  const [env, setEnv] = useState<InternsEnvironment>("LIVE");

  useEffect(() => {
    setEnv(read());
  }, []);

  const set = useCallback((next: InternsEnvironment) => {
    setEnv(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable — selection stays in-memory */
    }
  }, []);

  return [env, set];
}
