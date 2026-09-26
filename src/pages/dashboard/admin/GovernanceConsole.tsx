import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

export default function GovernanceConsole() {
  const ti = useQuery({ queryKey: ["ti"], queryFn: async () => (await supabase.from("threat_intelligence").select("*").order("last_seen", { ascending: false }).limit(100)).data ?? [] });
  const blocked = useQuery({ queryKey: ["blocked-ips"], queryFn: async () => (await supabase.from("blocked_ips").select("*").eq("active", true).order("blocked_at", { ascending: false }).limit(100)).data ?? [] });
  const backups = useQuery({ queryKey: ["backups"], queryFn: async () => (await supabase.from("backup_jobs").select("*").order("started_at", { ascending: false }).limit(50)).data ?? [] });
  const dr = useQuery({ queryKey: ["dr"], queryFn: async () => (await supabase.from("disaster_recovery_tests").select("*").order("executed_at", { ascending: false }).limit(50)).data ?? [] });
  const cls = useQuery({ queryKey: ["dc"], queryFn: async () => (await supabase.from("data_classifications").select("*").order("schema_name").limit(200)).data ?? [] });
  const rp = useQuery({ queryKey: ["rp-gov"], queryFn: async () => (await supabase.from("retention_policies").select("*").order("dataset")).data ?? [] });
  const pq = useQuery({ queryKey: ["pq"], queryFn: async () => (await supabase.from("privacy_requests").select("*").order("created_at", { ascending: false }).limit(100)).data ?? [] });

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">SOC / BCP / Data Governance</h1>
        <p className="text-sm text-muted-foreground">Threat intel, blocklists, backups, DR tests, data classification, retention, privacy requests.</p>
      </header>

      <Tabs defaultValue="soc">
        <TabsList>
          <TabsTrigger value="soc">SOC</TabsTrigger>
          <TabsTrigger value="bcp">BCP</TabsTrigger>
          <TabsTrigger value="data">Data Governance</TabsTrigger>
          <TabsTrigger value="privacy">Privacy</TabsTrigger>
        </TabsList>

        <TabsContent value="soc" className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Card><CardContent className="p-4"><div className="text-2xl font-bold">{ti.data?.length ?? 0}</div><div className="text-xs uppercase text-muted-foreground">IOCs</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-2xl font-bold text-status-danger">{blocked.data?.length ?? 0}</div><div className="text-xs uppercase text-muted-foreground">Blocked IPs</div></CardContent></Card>
          </div>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Source</TableHead><TableHead>Confidence</TableHead><TableHead>TLP</TableHead></TableRow></TableHeader>
              <TableBody>
                {(ti.data ?? []).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.indicator_type}</TableCell>
                    <TableCell className="font-mono text-xs">{t.indicator_value}</TableCell>
                    <TableCell>{t.source}</TableCell>
                    <TableCell>{t.confidence}</TableCell>
                    <TableCell><Badge variant="outline">{t.tlp}</Badge></TableCell>
                  </TableRow>
                ))}
                {(ti.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No IOCs ingested.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="bcp" className="space-y-3">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Backup</TableHead><TableHead>Target</TableHead><TableHead>Status</TableHead><TableHead>Started</TableHead><TableHead>Size</TableHead></TableRow></TableHeader>
              <TableBody>
                {(backups.data ?? []).map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.job_name}</TableCell>
                    <TableCell className="text-xs">{b.target}</TableCell>
                    <TableCell><Badge variant="secondary">{b.status}</Badge></TableCell>
                    <TableCell className="text-xs">{new Date(b.started_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{b.size_bytes ? `${(b.size_bytes / 1024 / 1024).toFixed(1)} MB` : "—"}</TableCell>
                  </TableRow>
                ))}
                {(backups.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No backup jobs recorded.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>DR Test</TableHead><TableHead>Scenario</TableHead><TableHead>RTO (target/actual)</TableHead><TableHead>RPO (target/actual)</TableHead><TableHead>Passed</TableHead></TableRow></TableHeader>
              <TableBody>
                {(dr.data ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.test_name}</TableCell>
                    <TableCell className="text-xs">{d.scenario}</TableCell>
                    <TableCell className="text-xs">{d.rto_target_minutes} / {d.rto_actual_minutes ?? "—"} min</TableCell>
                    <TableCell className="text-xs">{d.rpo_target_minutes} / {d.rpo_actual_minutes ?? "—"} min</TableCell>
                    <TableCell>{d.passed === null ? "—" : d.passed ? <Badge className="bg-status-success/15 text-status-success">pass</Badge> : <Badge variant="destructive">fail</Badge>}</TableCell>
                  </TableRow>
                ))}
                {(dr.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No DR tests recorded.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-3">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Schema.Table</TableHead><TableHead>Column</TableHead><TableHead>Classification</TableHead><TableHead>PII</TableHead></TableRow></TableHeader>
              <TableBody>
                {(cls.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.schema_name}.{c.table_name}</TableCell>
                    <TableCell className="font-mono text-xs">{c.column_name ?? "*"}</TableCell>
                    <TableCell><Badge variant="outline">{c.classification}</Badge></TableCell>
                    <TableCell>{c.pii ? <Badge variant="destructive">PII</Badge> : "—"}</TableCell>
                  </TableRow>
                ))}
                {(cls.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-sm text-muted-foreground">No classifications recorded.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Dataset</TableHead><TableHead>Retention (days)</TableHead><TableHead>Strategy</TableHead><TableHead>Legal hold</TableHead></TableRow></TableHeader>
              <TableBody>
                {(rp.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.dataset}</TableCell>
                    <TableCell>{r.retention_days}</TableCell>
                    <TableCell className="text-xs">{r.delete_strategy}</TableCell>
                    <TableCell>{r.legal_hold ? <Badge variant="destructive">yes</Badge> : "no"}</TableCell>
                  </TableRow>
                ))}
                {(rp.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-sm text-muted-foreground">No retention policies.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="privacy">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Type</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead>SLA Due</TableHead></TableRow></TableHeader>
              <TableBody>
                {(pq.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.request_number}</TableCell>
                    <TableCell>{p.request_type}</TableCell>
                    <TableCell className="text-xs">{p.requester_email}</TableCell>
                    <TableCell><Badge variant="secondary">{p.status}</Badge></TableCell>
                    <TableCell className="text-xs">{p.sla_due_at ? new Date(p.sla_due_at).toLocaleString() : "—"}</TableCell>
                  </TableRow>
                ))}
                {(pq.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No privacy requests.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
