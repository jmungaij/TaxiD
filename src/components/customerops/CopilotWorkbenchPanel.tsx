/**
 * Customer Operations — AI Copilot workbench.
 *
 * Role-aware catalogue of copilot capabilities plus a live assist card for the
 * selected case: sentiment, risk flags, drafted reply and compensation sizing.
 */
import { useMemo, useState } from "react";
import { Bot, ShieldAlert, Sparkle, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import StatCard from "@/components/common/StatCard";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import {
  COPILOT_CATEGORY_LABEL,
  availableCopilotActions,
  classifySentiment,
  draftReply,
  recommendCompensation,
  type CopilotCategory,
} from "@/lib/customerops/copilot";
import { resolveBusinessLine } from "@/lib/customerops/businessLines";
import type { CaseType } from "@/lib/customerops/taxonomy";

export interface CopilotCaseContext {
  caseNumber: string;
  subject: string;
  description: string | null;
  category: string | null;
  tags?: string[] | null;
  caseType: CaseType;
  customerName?: string | null;
  isCorporate?: boolean;
  slaBreached?: boolean;
  tripValueCents?: number;
  nextActions?: string[];
}

const kes = (cents: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(cents / 100);

export function CopilotWorkbenchPanel({
  roles,
  agentName,
  context,
}: {
  roles: string[];
  agentName?: string | null;
  context: CopilotCaseContext | null;
}) {
  const [draft, setDraft] = useState("");

  const actions = useMemo(() => availableCopilotActions(roles), [roles]);
  const grouped = useMemo(() => {
    const map = new Map<CopilotCategory, typeof actions>();
    for (const a of actions) map.set(a.category, [...(map.get(a.category) ?? []), a]);
    return [...map.entries()];
  }, [actions]);

  const assist = useMemo(() => {
    if (!context) return null;
    const line = resolveBusinessLine({
      subject: context.subject,
      description: context.description,
      category: context.category,
      tags: context.tags ?? null,
    }).line;
    const sentiment = classifySentiment({
      text: `${context.subject} ${context.description ?? ""}`,
      isCorporate: context.isCorporate,
    });
    const compensation = recommendCompensation({
      tripValueCents: context.tripValueCents ?? 0,
      sentiment,
      slaBreached: Boolean(context.slaBreached),
      line,
    });
    const reply = draftReply({
      customerName: context.customerName,
      subject: context.subject,
      caseNumber: context.caseNumber,
      caseType: context.caseType,
      line,
      sentiment,
      nextActions: context.nextActions ?? [],
      agentName,
    });
    return { line, sentiment, compensation, reply };
  }, [context, agentName]);

  return (
    <SectionErrorBoundary sectionName="AI Copilot Workbench">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Copilot capabilities"
            value={actions.length}
            icon={<Bot className="h-5 w-5 text-primary" />}
            description="Available to your role"
          />
          <StatCard
            title="Write actions"
            value={actions.filter((a) => a.writes).length}
            icon={<Wand2 className="h-5 w-5 text-primary" />}
            description="Audited platform mutations"
          />
          <StatCard
            title="Sentiment"
            value={assist ? assist.sentiment.label : "—"}
            icon={<Sparkle className="h-5 w-5 text-primary" />}
            description={assist ? `Intensity ${assist.sentiment.intensity}/100` : "Select a case in the queue"}
          />
          <StatCard
            title="Risk flags"
            value={assist ? assist.sentiment.risks.length : 0}
            icon={<ShieldAlert className="h-5 w-5 text-primary" />}
            description={assist?.sentiment.escalate ? "Escalation recommended" : "No escalation trigger"}
          />
        </div>

        {assist && context ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Assist · {context.caseNumber} · {assist.line.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={assist.sentiment.escalate ? "destructive" : "secondary"}>
                    {assist.sentiment.label}
                  </Badge>
                  {assist.sentiment.risks.map((r) => (
                    <Badge key={r} variant="outline">
                      {r.replace("_", " ")}
                    </Badge>
                  ))}
                </div>
                {assist.sentiment.signals.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Signals: {assist.sentiment.signals.join(", ")}
                  </p>
                )}
                <div className="rounded-lg border p-3">
                  <p className="font-medium">Recommended service recovery</p>
                  <p className="mt-1 text-lg font-semibold">{kes(assist.compensation.amountCents)}</p>
                  <p className="text-xs text-muted-foreground">
                    {assist.compensation.instrument.replace("_", " ")} · {assist.compensation.rationale}
                  </p>
                  {assist.compensation.requiresApproval && (
                    <Badge variant="destructive" className="mt-2">
                      Finance approval required
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">Drafted reply</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setDraft(assist.reply)}>
                    Generate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!draft}
                    onClick={() => {
                      void navigator.clipboard?.writeText(draft);
                      toast({ title: "Reply copied", description: "Paste into the customer's channel." });
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={12}
                  placeholder="Generate a draft, then edit before sending."
                />
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Select a case in the queue to unlock sentiment analysis, drafted replies and compensation sizing.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {grouped.map(([category, list]) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="text-base">{COPILOT_CATEGORY_LABEL[category]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {list.map((a) => (
                  <div key={a.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{a.label}</span>
                      <span className="flex gap-2">
                        {a.writes && <Badge variant="destructive">writes</Badge>}
                        <Badge variant="outline">{a.reuses}</Badge>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </SectionErrorBoundary>
  );
}

export default CopilotWorkbenchPanel;
