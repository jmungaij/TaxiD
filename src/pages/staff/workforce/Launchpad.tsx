import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { StaffPageHeader } from "@/components/staff/primitives";
import { getOrganisation, listStaff } from "@/lib/staff/org/api";
import type { OrgEntity, StaffMember } from "@/lib/staff/org/types";
import {
  ROLE_BLUEPRINTS,
  blueprintByKey,
  buildActivationPlan,
  activateWorkforcePlan,
  minutesToHours,
  PRIORITY_LABEL,
  EVIDENCE_LABEL,
  LEVER_LABEL,
} from "@/lib/workforce";

/**
 * WORKFORCE LAUNCHPAD — Day-1 activation.
 *
 * Select a person and a role blueprint; the engine previews the objectives,
 * KPIs, 30/60/90 ramp, scheduled standard work and capacity commitment.
 * Activation writes into the existing organisation spine (objectives and staff
 * work items), so the work immediately appears in My Workspace under the same
 * SLA, review and audit governance as event-generated work.
 */
export default function WorkforceLaunchpad() {
  const [params, setParams] = useSearchParams();
  const [org, setOrg] = useState<OrgEntity | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffId, setStaffId] = useState<string>("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [activated, setActivated] = useState<{ objectivesCreated: number; tasksCreated: number } | null>(null);

  const blueprintKey = params.get("blueprint") ?? ROLE_BLUEPRINTS[0].key;
  const blueprint = blueprintByKey(blueprintKey) ?? ROLE_BLUEPRINTS[0];

  useEffect(() => {
    (async () => {
      try {
        const [o, s] = await Promise.all([getOrganisation(), listStaff()]);
        setOrg(o);
        setStaff(s);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not load the staff register");
      }
    })();
  }, []);

  const plan = useMemo(() => buildActivationPlan(blueprint, startDate), [blueprint, startDate]);
  const person = staff.find((s) => s.id === staffId) ?? null;

  const activate = async () => {
    if (!person || !org) return;
    setBusy(true);
    try {
      const result = await activateWorkforcePlan(plan, {
        staffId: person.id,
        orgId: org.id,
        unitId: person.unit_id,
        fullName: person.full_name,
      });
      setActivated(result);
      toast.success(
        `${person.full_name} activated — ${result.objectivesCreated} objectives and ${result.tasksCreated} work items created.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Activation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <StaffPageHeader
        eyebrow="TaxiD Workforce Operating System"
        title="Workforce launchpad"
        lede="Turn a role blueprint into a working Day-1 plan for a named employee: objectives, KPIs, a 30/60/90 ramp, scheduled standard work and a capacity commitment — reviewed before anything is written."
      />

      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Activation inputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger><SelectValue placeholder="Select an employee" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name} · {s.staff_no}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {staff.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No staff records yet. Add people in the staff register first.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Role blueprint</Label>
              <Select
                value={blueprint.key}
                onValueChange={(v) => {
                  setActivated(null);
                  setParams({ blueprint: v });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_BLUEPRINTS.map((b) => (
                    <SelectItem key={b.key} value={b.key}>{b.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{blueprint.purpose}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="start">Start date</Label>
              <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>

            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Capacity committed</span>
                <span className="font-semibold">{plan.capacity.utilisationPct}%</span>
              </div>
              <Progress value={Math.min(plan.capacity.utilisationPct, 100)} className="mt-2" />
              <p className="mt-2 text-xs text-muted-foreground">
                {minutesToHours(plan.capacity.committedMinutes)}h of{" "}
                {minutesToHours(plan.capacity.monthlyCapacityMinutes)}h monthly capacity ·{" "}
                {minutesToHours(plan.capacity.headroomMinutes)}h headroom
              </p>
              {plan.capacity.overloaded && (
                <p className="mt-1 text-xs text-destructive">
                  Standard work exceeds contracted capacity — reduce scope or add headcount.
                </p>
              )}
            </div>

            {plan.defects.length > 0 && (
              <div className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">
                {plan.defects.map((d) => (
                  <p key={`${d.rule}${d.detail}`}>{d.rule} — {d.detail}</p>
                ))}
              </div>
            )}

            <Button className="w-full" disabled={!person || !org || busy || !plan.activatable} onClick={activate}>
              {busy ? "Activating…" : "Activate plan"}
            </Button>
            {activated && (
              <p className="text-xs text-muted-foreground">
                Created {activated.objectivesCreated} objectives and {activated.tasksCreated} work items. They now appear
                in My Workspace and the performance scorecards.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">30 / 60 / 90 ramp</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              {plan.ramp.map((r) => (
                <div key={r.phase} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{r.label}</span>
                    <Badge variant="outline">{r.targetPct}% of target</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.intent}</p>
                  <p className="mt-2 text-xs">
                    {r.startDate} → {r.endDate}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {r.focus.map((f) => <li key={f}>• {f}</li>)}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground"><strong>Gate:</strong> {r.gate}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Objectives to be created</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {plan.objectives.map((o) => (
                <div key={o.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{o.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {o.kpiLabel} · target {o.target} {o.unit} · {o.periodStart} → {o.periodEnd} · evidence:{" "}
                      {EVIDENCE_LABEL[o.evidence]}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{LEVER_LABEL[o.lever]}</Badge>
                    <Badge variant="outline">{o.weightPct}%</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Scheduled work, ordered by business value</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {plan.tasks.map((t) => (
                <div key={t.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">
                      Moves “{t.kpiLabel}” · {t.cadence} · {t.effortMinutes} min · due {t.dueDate}
                      {t.slaMinutes ? ` · SLA ${t.slaMinutes} min` : ""}
                      {t.requiresApproval ? " · approval required" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{PRIORITY_LABEL[t.priority]}</Badge>
                    <Badge>{t.valueScore}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
