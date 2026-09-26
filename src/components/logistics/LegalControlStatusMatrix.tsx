/**
 * LG CONTROL STATUS MATRIX — read-only projection.
 *
 * Renders the six independent status dimensions (legal, engineering, evidence,
 * approval, operational, commercial) for LG-01…LG-15 + LG-GOODS, so an
 * implemented platform gate is never displayed as a legal approval. There is no
 * control here that can close, override or clear anything: closure happens only
 * through the existing approval workflow.
 */
import * as React from "react";
import { Download, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildLegalControlMatrix,
  legalControlMatrixCsv,
  type DimensionStatus,
  type LgApprovalRow,
} from "@/lib/logistics/legal";

const TONE: Record<DimensionStatus, string> = {
  PROVEN: "bg-status-success/15 text-status-success",
  IMPLEMENTED: "bg-status-info/15 text-status-info",
  POPULATION_ENFORCED: "bg-status-info/15 text-status-info",
  PENDING_APPROVAL: "bg-status-warning/15 text-status-warning",
  NOT_PROVEN: "bg-status-warning/15 text-status-warning",
  NOT_IMPLEMENTED: "bg-destructive/15 text-destructive",
  NOT_APPLICABLE: "bg-muted text-muted-foreground",
};

const DIMENSIONS = ["legal", "engineering", "evidence", "approval", "operational", "commercial"] as const;

export function LegalControlStatusMatrix({ approvals }: { approvals: LgApprovalRow[] }) {
  const matrix = React.useMemo(() => buildLegalControlMatrix(approvals), [approvals]);

  const download = () => {
    const blob = new Blob([legalControlMatrixCsv(matrix)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lg-control-status-matrix.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4" aria-hidden /> Legal control status matrix — six independent dimensions
        </CardTitle>
        <Button size="sm" variant="outline" onClick={download} data-analytics="legal_control_matrix_export">
          <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> Export matrix
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{matrix.certification_statement}</p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Control</th>
                <th className="py-2 pr-3 font-medium">Party</th>
                {DIMENSIONS.map((d) => (
                  <th key={d} className="py-2 pr-3 font-medium capitalize">{d}</th>
                ))}
                <th className="py-2 font-medium">Overall</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr key={r.control_id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{r.control_id}</span>
                    <span className="block max-w-[220px] truncate text-muted-foreground">{r.title}</span>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {r.party}
                    <span className="block">{r.evidence_scope === "POPULATION" ? "per Fleet Owner" : "single document"}</span>
                  </td>
                  {DIMENSIONS.map((d) => (
                    <td key={d} className="py-2 pr-3">
                      <Badge variant="outline" className={TONE[r[d].status]} title={r[d].basis}>
                        {r[d].status.replace(/_/g, " ")}
                      </Badge>
                    </td>
                  ))}
                  <td className="py-2">
                    <span className="font-medium">{r.overall}</span>
                    <span className="block text-muted-foreground">{r.next_action}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          Engineering enforcement is not a legal approval, and one Fleet Owner's verified document pack is not
          network-wide compliance. A control becomes LEGALLY CLEARED only when every required approver has recorded a
          decision on the current document version through the existing approval workflow.
        </p>
      </CardContent>
    </Card>
  );
}
