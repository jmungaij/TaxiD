/**
 * Fires a security re-scan once per deployment.
 *
 * The build stamp is injected by Vite at build time, so it changes on every
 * deployment. When the stamp differs from the last one we scanned for, a
 * `deployment`-triggered `paf-scan` run is kicked off exactly once (guarded by
 * localStorage so a page reload does not re-trigger it).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "yalla.security.lastScannedBuild";

export function currentBuildStamp(): string {
  const injected = (globalThis as { __BUILD_STAMP__?: string }).__BUILD_STAMP__;
  return injected ?? "dev";
}

export interface DeploymentScanState {
  running: boolean;
  lastScannedBuild: string | null;
  buildStamp: string;
  error: string | null;
}

export function useDeploymentScan(enabled: boolean, onComplete?: () => void) {
  const buildStamp = currentBuildStamp();
  const [state, setState] = useState<DeploymentScanState>(() => ({
    running: false,
    lastScannedBuild: localStorage.getItem(STORAGE_KEY),
    buildStamp,
    error: null,
  }));
  const started = useRef(false);

  const run = useCallback(async () => {
    setState((s) => ({ ...s, running: true, error: null }));
    try {
      const { error } = await supabase.functions.invoke("paf-scan", {
        body: { trigger: "deployment", build: buildStamp },
      });
      if (error) throw error;
      localStorage.setItem(STORAGE_KEY, buildStamp);
      setState((s) => ({ ...s, running: false, lastScannedBuild: buildStamp }));
      onComplete?.();
    } catch (e) {
      setState((s) => ({ ...s, running: false, error: (e as Error).message }));
    }
  }, [buildStamp, onComplete]);

  useEffect(() => {
    if (!enabled || started.current) return;
    if (buildStamp === "dev") return; // never auto-scan from a dev server
    if (localStorage.getItem(STORAGE_KEY) === buildStamp) return;
    started.current = true;
    void run();
  }, [enabled, buildStamp, run]);

  return { ...state, rescan: run };
}
