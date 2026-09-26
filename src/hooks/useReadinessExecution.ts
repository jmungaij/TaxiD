/**
 * Loads the readiness execution inputs (evidence register, pilot runs, isolated
 * environment register) and derives the command-centre view. All writes go
 * through guarded RPCs — there is no client path that sets a control to PASS.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildCommandCenterView,
  type CommandCenterView,
  type EvidenceRecord,
  type PilotRunRecord,
  type InfraTargetRecord,
  type StExecutionRecord,
} from "@/lib/logistics/readiness/execution";
import type { RemediationClass } from "@/lib/logistics/readiness/classification";
import { publishSealedEvidence } from "@/lib/logistics/domain/sealedEvidence";
import { infrastructureSatisfied } from "@/lib/logistics/readiness/execution";

export interface EvidenceSubmission {
  control_id: string;
  remediation_class: RemediationClass;
  evidence_ref: string;
  approver_email?: string | null;
  document_path?: string | null;
  issuing_authority?: string | null;
  jurisdiction?: string | null;
  effective_at?: string | null;
  expiry_at?: string | null;
  owner_role?: string | null;
  comments?: string | null;
  payload?: Record<string, unknown>;
}

export interface ReadinessAuditRecord {
  control_id: string;
  action: string;
  from_state: string | null;
  to_state: string | null;
  actor_email: string | null;
  comments: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export function useReadinessExecution() {
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [pilotRuns, setPilotRuns] = useState<PilotRunRecord[]>([]);
  const [infraTargets, setInfraTargets] = useState<InfraTargetRecord[]>([]);
  const [stExecutions, setStExecutions] = useState<StExecutionRecord[]>([]);
  const [audit, setAudit] = useState<ReadinessAuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [e, p, i, s, envs, ind, a] = await Promise.all([
      supabase
        .from("logistics_readiness_evidence")
        .select("control_id, remediation_class, workflow_state, evidence_ref, document_path, effective_at, expiry_at, approver_email, decided_at, comments"),
      supabase.from("logistics_pilot_runs").select("scenario_id, result, evidence_ref, observed_outcome, executed_at"),
      supabase
        .from("logistics_infra_targets")
        .select("target_role, label, endpoint_ref, synthetic_fixtures_loaded, isolation_verified, verified_at"),
      supabase
        .from("st_control_executions")
        .select("control_id, result, environment_key, environment_fingerprint, evidence_sha256, first_failure, error_message, finished_at, expires_at, invalidated_at")
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false }),
      // Authoritative DI-00 registry — the orchestrator owns environment identity.
      supabase
        .from("infra_environments")
        .select("environment_key, environment_name, environment_type, environment_fingerprint, production_flag, synthetic_data_flag, verification_status, di00_state, last_verified_at"),
      supabase
        .from("infra_independence_assertions")
        .select("result, failed_invariants, asserted_at")
        .order("asserted_at", { ascending: false })
        .limit(1),
      supabase
        .from("logistics_readiness_audit")
        .select("control_id, action, from_state, to_state, actor_email, comments, payload, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    const firstError = [e, p, i, s, envs, ind, a].find((r) => r.error)?.error;
    setError(firstError ? firstError.message : null);
    setEvidence((e.data ?? []) as EvidenceRecord[]);
    setPilotRuns((p.data ?? []) as PilotRunRecord[]);
    setStExecutions((s.data ?? []) as unknown as StExecutionRecord[]);
    setAudit((a.data ?? []) as unknown as ReadinessAuditRecord[]);

    // DI-00 clearance is derived from the DI-00 orchestrator registry rather than
    // a second manual list: an environment counts only when it is non-production,
    // synthetic, verification PASS, and the latest independence assertion PASSES.
    const independent = ((ind.data ?? [])[0] as { result?: string } | undefined)?.result === "PASS";
    const derived: InfraTargetRecord[] = ((envs.data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => r.environment_type === "STAGING" || r.environment_type === "RESTORE")
      .map((r) => ({
        target_role: r.environment_type === "STAGING" ? "staging" : "restore",
        label: String(r.environment_name ?? r.environment_key),
        endpoint_ref: String(r.environment_fingerprint ?? r.environment_key),
        synthetic_fixtures_loaded: r.synthetic_data_flag === true,
        isolation_verified:
          independent && r.production_flag === false && r.verification_status === "PASS",
        verified_at: (r.last_verified_at as string | null) ?? null,
      }));
    const manual = (i.data ?? []) as InfraTargetRecord[];
    const merged = [...derived];
    for (const m of manual) if (!merged.some((d) => d.target_role === m.target_role)) merged.push(m);
    setInfraTargets(merged);

    // Publish the sealed evidence to the DF-10 / staging engines so every
    // surface renders one authoritative projection instead of inferring the
    // environment from build-time variables.
    const nowIso = new Date().toISOString();
    const latest: Record<string, {
      control_id: string; result: string; environment_key: string | null; environment_fingerprint: string | null;
      evidence_sha256: string | null; finished_at: string | null; valid: boolean;
    }> = {};
    for (const r of ((s.data ?? []) as unknown as StExecutionRecord[])) {
      if (!r.finished_at) continue;
      const prev = latest[r.control_id];
      if (prev && (prev.finished_at ?? "") >= r.finished_at) continue;
      latest[r.control_id] = {
        control_id: r.control_id,
        result: r.result,
        environment_key: r.environment_key,
        environment_fingerprint: r.environment_fingerprint,
        evidence_sha256: r.evidence_sha256,
        finished_at: r.finished_at,
        valid: !r.invalidated_at && !(r.expires_at && new Date(r.expires_at) < new Date(nowIso)),
      };
    }
    const ready = infrastructureSatisfied(merged);
    publishSealedEvidence({
      st: latest,
      infraReady: ready,
      provenance: ready
        ? `independence-verified staging + restore pair, latest verification ${merged.map((t) => t.verified_at ?? "unverified").sort().slice(-1)[0] ?? "unknown"}`
        : "no independence-verified staging + restore pair registered",
    });

    setLoading(false);
  }, []);


  useEffect(() => {
    void load();
  }, [load, tick]);

  const view: CommandCenterView = useMemo(
    () => buildCommandCenterView({ evidence, pilotRuns, infraTargets, stExecutions }),
    [evidence, pilotRuns, infraTargets, stExecutions],
  );

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const submitEvidence = useCallback(
    async (s: EvidenceSubmission) => {
      const { error: err } = await supabase.rpc("logistics_readiness_submit_evidence", {
        p_control_id: s.control_id,
        p_class: s.remediation_class,
        p_evidence_ref: s.evidence_ref,
        p_approver_email: s.approver_email ?? null,
        p_document_path: s.document_path ?? null,
        p_issuing_authority: s.issuing_authority ?? null,
        p_jurisdiction: s.jurisdiction ?? null,
        p_effective_at: s.effective_at ?? null,
        p_expiry_at: s.expiry_at ?? null,
        p_owner_role: s.owner_role ?? null,
        p_comments: s.comments ?? null,
        p_declaration: true,
        p_payload: (s.payload ?? {}) as never,
      });
      if (err) throw new Error(err.message);
      refresh();
    },
    [refresh],
  );

  const decide = useCallback(
    async (controlId: string, decision: "APPROVE" | "REJECT" | "REQUEST_REVISION", comments?: string) => {
      const { error: err } = await supabase.rpc("logistics_readiness_decide", {
        p_control_id: controlId,
        p_decision: decision,
        p_comments: comments ?? null,
      });
      if (err) throw new Error(err.message);
      refresh();
    },
    [refresh],
  );

  const recordPilotRun = useCallback(
    async (args: { scenario_id: string; expected_outcome: string; observed_outcome: string; result: "PASS" | "FAIL"; evidence_ref: string }) => {
      const { error: err } = await supabase.rpc("logistics_pilot_record_run", {
        p_scenario_id: args.scenario_id,
        p_expected_outcome: args.expected_outcome,
        p_observed_outcome: args.observed_outcome,
        p_result: args.result,
        p_evidence_ref: args.evidence_ref,
        p_environment: "isolated_staging",
        p_payload: {} as never,
      });
      if (err) throw new Error(err.message);
      refresh();
    },
    [refresh],
  );

  const registerTarget = useCallback(
    async (args: { target_role: "staging" | "restore"; label: string; endpoint_ref: string; synthetic_fixtures_loaded: boolean; isolation_verified: boolean; notes?: string }) => {
      const { error: err } = await supabase.rpc("logistics_infra_target_upsert", {
        p_target_role: args.target_role,
        p_label: args.label,
        p_endpoint_ref: args.endpoint_ref,
        p_synthetic_fixtures_loaded: args.synthetic_fixtures_loaded,
        p_isolation_verified: args.isolation_verified,
        p_notes: args.notes ?? null,
      });
      if (err) throw new Error(err.message);
      refresh();
    },
    [refresh],
  );

  return { view, evidence, pilotRuns, infraTargets, stExecutions, audit, loading, error, refresh, submitEvidence, decide, recordPilotRun, registerTarget };
}
