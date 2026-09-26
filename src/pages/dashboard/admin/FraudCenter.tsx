import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { applyGuardedTransition, CONFLICT_MESSAGE } from "@/lib/platform/guardedTransition";

export default function FraudCenter() {
  const qc = useQueryClient();
  const cases = useQuery({
    queryKey: ["pf-cases"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payment_fraud_cases").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15_000,
  });
  const sus = useQuery({
    queryKey: ["sus-tx"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suspicious_transactions").select("*").eq("reviewed", false).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });
  const models = useQuery({
    queryKey: ["risk-models"],
    queryFn: async () => {
      const { data, error } = await supabase.from("risk_models").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase.channel("fraud-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_fraud_cases" }, () => qc.invalidateQueries({ queryKey: ["pf-cases"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "suspicious_transactions" }, () => qc.invalidateQueries({ queryKey: ["sus-tx"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  async function review(id: string, outcome: string) {
    const res = await applyGuardedTransition({
      table: "suspicious_transactions",
      id,
      statusColumn: "reviewed",
      expectedStates: [false],
      patch: { reviewed: true, reviewed_at: new Date().toISOString(), outcome },
      audit: { flow: "suspicious_transaction_review", action: `suspicious_transaction.${outcome}`, entity_type: "suspicious_transactions" },
    });
    if (res.outcome === "error") return toast({ title: "Failed", description: res.message, variant: "destructive" });
    if (res.outcome === "conflict") toast({ title: "Already reviewed", description: res.message ?? CONFLICT_MESSAGE });
    else if (res.auditFailed) toast({ title: "Audit write rejected", description: "The review was applied but not audited.", variant: "destructive" });
    sus.refetch();
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Fraud & Financial Crime</h1>
        <p className="text-sm text-muted-foreground">Real-time payment fraud, wallet abuse, and risk-model registry.</p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{cases.data?.filter((c: { status: string }) => c.status === "open").length ?? 0}</div><div className="text-xs uppercase text-muted-foreground">Open cases</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold text-status-warning">{sus.data?.length ?? 0}</div><div className="text-xs uppercase text-muted-foreground">Awaiting review</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{models.data?.filter((m: { active: boolean }) => m.active).length ?? 0}</div><div className="text-xs uppercase text-muted-foreground">Active models</div></CardContent></Card>
      </div>

      <Tabs defaultValue="suspicious">
        <TabsList>
          <TabsTrigger value="suspicious">Suspicious Transactions</TabsTrigger>
          <TabsTrigger value="cases">Fraud Cases</TabsTrigger>
          <TabsTrigger value="models">Risk Models</TabsTrigger>
        </TabsList>

        <TabsContent value="suspicious">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>Entity</TableHead><TableHead>Amount</TableHead>
                <TableHead>Reason</TableHead><TableHead>Score</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(sus.data ?? []).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs">{new Date(s.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{s.entity_type}:{s.entity_id?.slice(0,8)}</TableCell>
                    <TableCell>{s.amount} {s.currency}</TableCell>
                    <TableCell className="text-xs">{s.reason}</TableCell>
                    <TableCell><Badge variant="outline">{Number(s.score).toFixed(0)}</Badge></TableCell>
                    <TableCell className="space-x-2">
                      <Button size="sm" variant="outline" onClick={() => review(s.id, "cleared")}>Clear</Button>
                      <Button size="sm" variant="destructive" onClick={() => review(s.id, "confirmed_fraud")}>Confirm</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(sus.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">Nothing to review.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="cases">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Case</TableHead><TableHead>Status</TableHead><TableHead>Severity</TableHead>
                <TableHead>Entity</TableHead><TableHead>Amount</TableHead><TableHead>Opened</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(cases.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.case_number}</TableCell>
                    <TableCell><Badge variant="secondary">{c.status}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{c.severity}</Badge></TableCell>
                    <TableCell className="text-xs">{c.entity_type}</TableCell>
                    <TableCell>{c.amount} {c.currency}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="models">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Name</TableHead><TableHead>Version</TableHead><TableHead>Active</TableHead>
                <TableHead>Description</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(models.data ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-semibold">{m.name}</TableCell>
                    <TableCell className="font-mono text-xs">{m.version}</TableCell>
                    <TableCell>{m.active ? <Badge className="bg-status-success/15 text-status-success">active</Badge> : <Badge variant="outline">inactive</Badge>}</TableCell>
                    <TableCell className="text-xs">{m.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
