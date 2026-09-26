/**
 * D13.0 HOLD gap checklist.
 *
 * Presentation-only. Reads the already-computed release-authority report plus
 * the evidence-lookup diagnostics and renders exactly which evidence items are
 * missing and what values were actually found. No scoring happens here.
 */
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { ProductionValidationReport } from "@/lib/workspace360/productionValidation";
import { REQUIRED_INTEGRATIONS, DR_SCENARIOS } from "@/lib/workspace360/productionValidation";
import { SCALABILITY_FLOOR_TIER, type EvidenceDiagnostics } from "@/lib/workspace360/evpEvidence";

type Status = "ok" | "gap" | "partial";

function StatusIcon({ status }: { status: Status }) {
  if (status === "ok") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-status-success" />;
  if (status === "partial") return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-warning" />;
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-status-danger" />;
}

function GapRow({
  label, status, latest, detail,
}: { label: string; status: Status; latest: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <StatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{label}</span>
          <span className="font-mono text-[10px] text-muted-foreground text-right">{latest}</span>
        </div>
        {detail && <div className="text-[10px] text-muted-foreground break-words">{detail}</div>}
      </div>
    </div>
  );
}

export interface HoldGapChecklistProps {
  validation: ProductionValidationReport;
  diagnostics: EvidenceDiagnostics;
  rebuiltAt: string;
  busy?: boolean;
  onRebuild: () => void;
}

export function HoldGapChecklist({
  validation, diagnostics, rebuiltAt, busy, onRebuild,
}: HoldGapChecklistProps) {
  const intg = validation.integrations;
  const perf = validation.performance;
  const scale = validation.scalability;
  const dr = validation.disasterRecovery;
  const s = diagnostics.scalability;
  const d = diagnostics.disasterRecovery;

  const intgStatus: Status = intg.passed ? "ok" : intg.certified > 0 ? "partial" : "gap";
  const perfStatus: Status = perf.passed ? "ok" : diagnostics.performance.source === "none" ? "gap" : "partial";
  const scaleStatus: Status = scale.passed ? "ok" : s.floorTier ? "partial" : "gap";
  const drStatus: Status = dr.passed ? "ok" : d.rowCount > 0 ? "partial" : "gap";

  const openGaps = [intgStatus, perfStatus, scaleStatus, drStatus].filter((x) => x !== "ok").length;

  return (
    <div className="pt-1 border-t mt-1 space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-medium">HOLD gap checklist</span>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-muted-foreground">
            {openGaps === 0 ? "no gaps" : `${openGaps} evidence gap(s)`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={onRebuild}
            disabled={busy}
            aria-label="Rebuild evidence overlay"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${busy ? "animate-spin" : ""}`} />
            Rebuild
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/50">
        <GapRow
          label="Integration qualification"
          status={intgStatus}
          latest={`${intg.certified}/${REQUIRED_INTEGRATIONS.length} certified · score ${intg.score}`}
          detail={
            diagnostics.integrations.source === "none"
              ? "no EVP integration rollup found — every integration falls back to “no telemetry evidence”"
              : `observed ${diagnostics.integrations.observed.length} integration(s), ${diagnostics.integrations.totalSamples} sample(s)` +
                (intg.missingEvidence.length ? ` · missing: ${intg.missingEvidence.join(", ")}` : "") +
                (intg.failing.length ? ` · failing: ${intg.failing.join(", ")}` : "")
          }
        />

        <GapRow
          label="Performance qualification"
          status={perfStatus}
          latest={`score ${perf.score}${diagnostics.performance.source === "none" ? " (ops fallback, capped 70)" : ""}`}
          detail={
            diagnostics.performance.source === "none"
              ? "no EVP performance rollup — api/db/edge/workspace pillars all read “no evidence”"
              : `api p95 ${diagnostics.performance.apiP95Ms ?? "—"}ms · rpc p95 ${diagnostics.performance.rpcP95Ms ?? "—"}ms · err ${diagnostics.performance.errorRate ?? "—"} · rps ${diagnostics.performance.throughputRps ?? "—"}` +
                (perf.missingEvidence.length ? ` · missing: ${perf.missingEvidence.join(", ")}` : "")
          }
        />

        <GapRow
          label={`Scalability floor (≥${SCALABILITY_FLOOR_TIER.toLocaleString()})`}
          status={scaleStatus}
          latest={`certified tier ${scale.highestCertifiedTier.toLocaleString()} · score ${scale.score}`}
          detail={
            `${s.rowCount} run row(s), ${s.passedRowCount} passed · payment tiers [${
              s.tiersWithPaymentEvidence.map((t) => t.toLocaleString()).join(", ") || "—"
            }] · dispatch tiers [${
              s.tiersWithDispatchEvidence.map((t) => t.toLocaleString()).join(", ") || "—"
            }] · join ${s.floorJoined ? "ok" : "unresolved"}` +
            (s.floorRunId ? ` · run ${s.floorRunId.slice(0, 8)} pay ${s.floorPaymentTps ?? "—"} tps / disp ${s.floorDispatchTps ?? "—"} tps` : "") +
            ` — ${s.floorReason}` +
            (s.queryError ? ` · query error: ${s.queryError}` : "")
          }
        />

        <GapRow
          label="DR drills"
          status={drStatus}
          latest={`${d.scenariosFound.length}/${DR_SCENARIOS.length} scenarios · score ${dr.score}`}
          detail={
            d.rowCount === 0
              ? "no disaster_recovery_tests rows — recovery pillar falls back to the ops replay score (capped 70)"
              : `${d.rowCount} drill row(s) · ${d.passedCount} passed · mean RTO ${
                d.meanRtoSec != null ? `${Math.round(d.meanRtoSec / 60)}m` : "—"
              } · worst RTO ${d.worstRtoSec != null ? `${Math.round(d.worstRtoSec / 60)}m` : "—"}` +
                (dr.missingEvidence.length ? ` · missing: ${dr.missingEvidence.join(", ")}` : "") +
                (d.unmappedScenarios.length ? ` · unmapped: ${d.unmappedScenarios.join(", ")}` : "")
          }
        />
      </div>

      <div className="font-mono text-[10px] text-muted-foreground">
        overlay rebuilt {rebuiltAt ? new Date(rebuiltAt).toLocaleTimeString() : "—"}
      </div>
    </div>
  );
}
