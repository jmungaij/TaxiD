import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

interface BudgetRow {
  id: string; scope: "department" | "cost_center"; department: string | null; cost_center_code: string | null;
  limit_cents: number; used_cents: number; enforcement: "warn" | "approval" | "block"; active: boolean;
}
const kes = (c: number) => `KES ${Math.round(c / 100).toLocaleString()}`;
const ENFORCE: Record<BudgetRow["enforcement"], string> = { warn: "Warn only", approval: "Needs approval", block: "Block" };

/** Held company funds + cost-centre budgets. Enforcement happens server-side at booking. */
export default function CostCenterBudgetsPanel({ corporateId }: { corporateId: string | null }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [held, setHeld] = useState(0);
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [enforcement, setEnforcement] = useState<BudgetRow["enforcement"]>("approval");

  const load = useCallback(async () => {
    if (!corporateId) return;
    const { data, error } = await supabase.rpc("corporate_budget_overview", { _c: corporateId } as never);
    if (error) { toast({ title: "Could not load budgets", description: error.message, variant: "destructive" }); return; }
    const d = data as { held_cents: number; budgets: BudgetRow[] };
    setHeld(d?.held_cents ?? 0);
    setRows(d?.budgets ?? []);
  }, [corporateId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const cents = Math.round(parseFloat(amount) * 100);
    if (!corporateId || !code.trim() || !Number.isFinite(cents) || cents < 0) {
      toast({ title: "Enter a cost centre and amount", variant: "destructive" }); return;
    }
    const { error } = await supabase.from("corporate_budgets").upsert({
      corporate_id: corporateId, scope: "cost_center", cost_center_code: code.trim(),
      monthly_amount_cents: cents, enforcement, created_by: user?.id, active: true,
    } as never);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    setCode(""); setAmount(""); load();
  };

  const toggle = async (r: BudgetRow) => {
    const { error } = await supabase.from("corporate_budgets").update({ active: !r.active } as never).eq("id", r.id);
    if (error) toast({ title: "Could not update", description: error.message, variant: "destructive" });
    load();
  };

  if (!corporateId) return null;
  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Funds held for confirmed trips</p>
          <p className="text-2xl font-semibold">{kes(held)}</p>
        </div>
        <p className="text-xs text-muted-foreground max-w-xs">Held when a trip is confirmed, released if cancelled, charged when the trip is settled.</p>
      </Card>

      <Card className="p-4 space-y-3">
        <h4 className="font-semibold text-sm">Cost-centre budgets (monthly)</h4>
        <div className="grid sm:grid-cols-4 gap-2">
          <Input placeholder="Cost centre code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Cost centre code" />
          <Input type="number" placeholder="Amount (KES)" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
          <select aria-label="When exceeded" className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={enforcement} onChange={(e) => setEnforcement(e.target.value as BudgetRow["enforcement"])}>
            <option value="warn">Warn only</option><option value="approval">Needs approval</option><option value="block">Block</option>
          </select>
          <Button onClick={add}>Save budget</Button>
        </div>
        <div className="space-y-3">
          {rows.map((r) => {
            const pct = r.limit_cents ? Math.min(100, (r.used_cents / r.limit_cents) * 100) : 0;
            return (
              <div key={r.id} className={`space-y-1 ${r.active ? "" : "opacity-50"}`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{r.scope === "department" ? r.department : r.cost_center_code}
                    <Badge variant="secondary" className="ml-2">{r.scope === "department" ? "Department" : "Cost centre"}</Badge>
                    <Badge variant="outline" className="ml-1">{ENFORCE[r.enforcement]}</Badge></span>
                  <span className="text-muted-foreground">{kes(r.used_cents)} of {kes(r.limit_cents)}
                    {r.scope === "cost_center" && <Button variant="ghost" size="sm" onClick={() => toggle(r)}>{r.active ? "Turn off" : "Turn on"}</Button>}</span>
                </div>
                <Progress value={pct} />
              </div>
            );
          })}
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No budgets yet.</p>}
        </div>
      </Card>
    </div>
  );
}
