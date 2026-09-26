/**
 * Preflight hook: validates the tax reporting schema contract before panels render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkTaxSchema, describeSchemaReport, emptySchemaReport, type TaxSchemaReport,
} from "@/lib/tax/schemaContract";
import { captureSchemaAlert } from "@/lib/tax/schemaAlerts";
import { newTaxRequestId } from "@/lib/tax/syncRunAudit";

export interface UseTaxSchemaCheckResult {
  report: TaxSchemaReport | null;
  checking: boolean;
  /** True once the preflight has completed and the contract is satisfied. */
  ready: boolean;
  /** True when the preflight completed and found drift or failed to run. */
  blocked: boolean;
  requestId: string;
  recheck: () => Promise<void>;
}

export function useTaxSchemaCheck(report: string = "tax_report_overview"): UseTaxSchemaCheckResult {
  const [result, setResult] = useState<TaxSchemaReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [requestId, setRequestId] = useState(() => newTaxRequestId("tax_report_schema_check" as never));
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const run = useCallback(async (rid: string) => {
    setChecking(true);
    const next = await checkTaxSchema();
    if (!mounted.current) return;
    setResult(next);
    setChecking(false);
    if (!next.ok) {
      const failure =
        next.failure ?? {
          kind: "schema_drift" as const,
          title: "Reporting schema is out of date",
          reason: describeSchemaReport(next),
          hint: "Apply the pending backend reporting migrations, then retry.",
          retryable: false,
        };
      void captureSchemaAlert({ requestId: rid, report, failure, missing: next });
    }
  }, [report]);

  const recheck = useCallback(async () => {
    const rid = newTaxRequestId("tax_report_schema_check" as never);
    setRequestId(rid);
    await run(rid);
  }, [run]);

  useEffect(() => {
    void run(requestId);
    // mount-only preflight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = result ?? (checking ? null : emptySchemaReport());
  return {
    report: current,
    checking,
    ready: !checking && !!current?.ok,
    blocked: !checking && !!current && !current.ok,
    requestId,
    recheck,
  };
}
