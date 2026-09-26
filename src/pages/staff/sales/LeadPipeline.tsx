/**
 * Lead pipeline.
 *
 * One page showing every live lead: the stage it has reached, the next action
 * outstanding on it, and the specialist who owns it. Every figure is read from
 * the database projections behind `LeadFlowBoard` — nothing is estimated here.
 */
import * as React from "react";
import LeadFlowBoard from "@/components/sales/LeadFlowBoard";

export default function LeadPipeline() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Lead pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Where every lead stands, what happens next, and who is carrying it. Leads move here the
          moment a record changes.
        </p>
      </header>
      <LeadFlowBoard />
    </div>
  );
}
