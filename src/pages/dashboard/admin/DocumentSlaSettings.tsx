import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Timer, Save } from "lucide-react";
import { toast } from "sonner";

interface Sla {
  id: string;
  action_id: string;
  rule_key: string | null;
  sla_minutes: number;
  grace_minutes: number;
  due_at: string;
  status: string;
  escalation_level: number;
  completed_at: string | null;
}

export default function DocumentSlaSettings() {
  const [rows, setRows] = useState<Sla[]>([]);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("document_review_sla")
      .select("*")
      .in("status", ["pending", "overdue"])
      .order("due_at", { ascending: true })
      .limit(500);
    setRows((data ?? []) as Sla[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function saveOne(id: string) {
    const grace = edits[id];
    if (grace == null) return;
    const { error } = await (supabase as any)
      .from("document_review_sla")
      .update({ grace_minutes: grace })
      .eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Grace period updated"); void load(); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Timer className="h-6 w-6 text-primary" /> Document SLA Grace Periods
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure per-item grace buffers (minutes) that must elapse <em>after</em> the SLA due time
          before the scheduled escalator triggers an alert.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Open SLA items ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Action</TableHead><TableHead>Rule key</TableHead>
              <TableHead>Due at</TableHead><TableHead>SLA (min)</TableHead>
              <TableHead>Grace (min)</TableHead><TableHead>Status</TableHead>
              <TableHead>Level</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={8}>Loading…</TableCell></TableRow>}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-muted-foreground">No open SLA items.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs font-mono">{r.action_id.slice(0, 8)}</TableCell>
                  <TableCell className="text-xs">{r.rule_key ?? "—"}</TableCell>
                  <TableCell className="text-xs">{new Date(r.due_at).toLocaleString()}</TableCell>
                  <TableCell>{r.sla_minutes}</TableCell>
                  <TableCell>
                    <Input type="number" className="w-24"
                      defaultValue={r.grace_minutes}
                      onChange={(e) => setEdits({ ...edits, [r.id]: Number(e.target.value) })} />
                  </TableCell>
                  <TableCell><Badge variant={r.status === "overdue" ? "destructive" : "outline"}>{r.status}</Badge></TableCell>
                  <TableCell>{r.escalation_level}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => saveOne(r.id)}>
                      <Save className="h-3.5 w-3.5 mr-1" /> Save
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
