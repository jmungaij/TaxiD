import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Link } from "react-router-dom";
import { StaffPageHeader } from "@/components/staff/primitives";
import {
  ROLE_BLUEPRINTS,
  MANAGEMENT_RULES,
  PRIORITY_LABEL,
  EVIDENCE_LABEL,
  LEVER_LABEL,
  ATTRIBUTION_LABEL,
  auditBlueprint,
  capacityFor,
  minutesToHours,
  type RoleBlueprint,
} from "@/lib/workforce";

/**
 * ROLE BLUEPRINT LIBRARY — the contract between the operating model and a role.
 *
 * Read-only reference surface: purpose, accountabilities, required outcomes,
 * KPIs with weights, standard work, authority and escalation. Activation of a
 * blueprint for a named person happens in the Workforce Launchpad.
 */
function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</div>
      <ul className="mt-1 space-y-1 text-sm">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlueprintCard({ bp }: { bp: RoleBlueprint }) {
  const defects = auditBlueprint(bp);
  const capacity = capacityFor(bp);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{bp.title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{bp.purpose}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{bp.department}</Badge>
            <Badge variant="outline">{bp.grade}</Badge>
            <Badge variant={defects.length === 0 ? "default" : "destructive"}>
              {defects.length === 0 ? "Complete" : `${defects.length} defect(s)`}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2 text-xs">
          {bp.valuePath.map((step, i) => (
            <span key={step} className="rounded-md border bg-muted/40 px-2 py-1">
              {i + 1}. {step}
            </span>
          ))}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Section title="Accountabilities" items={bp.accountabilities} />
          <Section title="Required outcomes" items={bp.outcomes} />
          <Section title="Decision authority" items={bp.authority} />
          <Section title="Must escalate" items={bp.escalation} />
          <Section title="Capabilities" items={bp.capabilities} />
          <Section title="Required training" items={bp.requiredTraining} />
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Objectives &amp; KPIs
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Objective</th>
                  <th className="py-1 pr-3">KPI</th>
                  <th className="py-1 pr-3">Target</th>
                  <th className="py-1 pr-3">Weight</th>
                  <th className="py-1 pr-3">Value lever</th>
                  <th className="py-1">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {bp.kpis.map((k) => (
                  <tr key={k.key} className="border-t">
                    <td className="py-2 pr-3">{k.objective}</td>
                    <td className="py-2 pr-3">{k.kpiLabel}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {k.target} {k.unit} <span className="text-muted-foreground">/ {k.period}</span>
                    </td>
                    <td className="py-2 pr-3">{k.weightPct}%</td>
                    <td className="py-2 pr-3">
                      {LEVER_LABEL[k.lever]} · {ATTRIBUTION_LABEL[k.attribution]}
                    </td>
                    <td className="py-2">{EVIDENCE_LABEL[k.evidence]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Standard work
            </div>
            <div className="text-xs text-muted-foreground">
              {minutesToHours(capacity.committedMinutes)}h committed of {minutesToHours(capacity.monthlyCapacityMinutes)}h
              capacity · {capacity.utilisationPct}% utilisation
            </div>
          </div>
          <div className="mt-2 space-y-2">
            {bp.standardWork.map((t) => (
              <div key={t.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.cadence} · {t.effortMinutes} min · evidence: {EVIDENCE_LABEL[t.evidence]}
                    {t.requiresApproval ? " · approval required" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{PRIORITY_LABEL[t.priority]}</Badge>
                  <Badge variant="secondary">{t.phase}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button asChild size="sm">
            <Link to={`/staff/workforce/launchpad?blueprint=${bp.key}`}>Activate for an employee</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RoleBlueprints() {
  const [open, setOpen] = useState<string | undefined>(ROLE_BLUEPRINTS[0]?.key);

  return (
    <>
      <StaffPageHeader
        eyebrow="TaxiD Workforce Operating System"
        title="Role blueprints"
        lede="Why each position exists, what it owns, what must change because it exists, how that is measured, and the standard work that produces it. Every blueprint is validated against the management rule before it can be activated."
      />

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">The management rule</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-1 text-sm sm:grid-cols-2">
            {MANAGEMENT_RULES.map((r, i) => (
              <li key={r} className="text-muted-foreground">
                <span className="mr-2 font-semibold text-foreground">{i + 1}.</span>
                {r}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Accordion type="single" collapsible value={open} onValueChange={setOpen} className="space-y-3">
        {ROLE_BLUEPRINTS.map((bp) => (
          <AccordionItem key={bp.key} value={bp.key} className="rounded-lg border px-4">
            <AccordionTrigger className="text-left">
              <span className="font-semibold">{bp.title}</span>
              <span className="ml-3 text-xs font-normal text-muted-foreground">{bp.department}</span>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <BlueprintCard bp={bp} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </>
  );
}
