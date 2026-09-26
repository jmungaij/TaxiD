import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  loadDepartmentBudgets, setDepartmentBudget, money, type DepartmentBudgetRow,
} from "@/lib/corporate/adminControls";

export default function DepartmentBudgetsPanel({ corporateId }: { corporateId: string | null }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<DepartmentBudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!corporateId) return;
    setLoading(true);
    try {
      const data = await loadDepartmentBudgets(corporateId);
      setRows(data);
      setDrafts(Object.fromEntries(data.map((r) => [
        r.department_id, r.monthly_budget_cents ? String(r.monthly_budget_cents / 100) : "",
      ])));
    } catch (e) {
      toast({ title: "Could not load budgets", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [corporateId]);

  useEffect(() => { load(); }, [load]);

  const save = async (row: DepartmentBudgetRow) => {
    if (!corporateId || !user) return;
    const raw = (drafts[row.department_id] ?? "").trim();
    const cents = raw ? Math.round(parseFloat(raw) * 100) : null;
    if (raw && (!Number.isFinite(cents) || (cents ?? 0) < 0)) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setSavingId(row.department_id);
    try {
      await setDepartmentBudget(corporateId, user.id, row.department_id, cents);
      toast({ title: "Budget saved", description: "Rides that would exceed it go to an approver." });
      load();
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  if (!corporateId) return <p className="text-sm text-muted-foreground">No organisation linked to your account yet.</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Set a monthly travel budget per department. Spend below is this month's corporate rides. A ride that would take a
        department over budget is sent to an approver.
      </p>

      <Card className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Department</TableHead>
              <TableHead>People</TableHead>
              <TableHead>Rides this month</TableHead>
              <TableHead>Spend</TableHead>
              <TableHead>Monthly budget (KES)</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const pct = r.monthly_budget_cents > 0
                ? Math.min(100, Math.round((r.spend_cents / r.monthly_budget_cents) * 100))
                : 0;
              const over = r.monthly_budget_cents > 0 && r.spend_cents > r.monthly_budget_cents;
              return (
                <TableRow key={r.department_id}>
                  <TableCell className="font-medium">{r.department_name}</TableCell>
                  <TableCell>{r.employee_count}</TableCell>
                  <TableCell>{r.trip_count}</TableCell>
                  <TableCell className="space-y-1 min-w-[10rem]">
                    <div className="flex items-center gap-2">
                      <span>{money(r.spend_cents)}</span>
                      {over && <Badge variant="destructive">Over budget</Badge>}
                    </div>
                    {r.monthly_budget_cents > 0 && <Progress value={pct} aria-label={`${pct}% of budget used`} />}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="max-w-[9rem]"
                      inputMode="decimal"
                      placeholder="No budget"
                      value={drafts[r.department_id] ?? ""}
                      onChange={(e) => setDrafts((p) => ({ ...p, [r.department_id]: e.target.value }))}
                      aria-label={`Monthly budget for ${r.department_name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => save(r)} disabled={savingId === r.department_id}>
                      {savingId === r.department_id ? "Saving…" : "Save"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Add departments first, then set their budgets here.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
