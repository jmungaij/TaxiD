import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { DataErrorBanner } from "@/components/platform/DataErrorBanner";

export default function NocConsole() {
  const qc = useQueryClient();
  const incidents = useQuery({
    queryKey: ["noc-incidents"],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_incidents").select("*").order("detected_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15_000,
  });
  const alerts = useQuery({
    queryKey: ["noc-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("service_alerts").select("*").eq("state", "firing").order("fired_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });
  const runbooks = useQuery({
    queryKey: ["noc-runbooks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("noc_runbooks").select("*").order("title");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase.channel(`noc-rt-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_incidents" }, () => qc.invalidateQueries({ queryKey: ["noc-incidents"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "service_alerts" }, () => qc.invalidateQueries({ queryKey: ["noc-alerts"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const openCount = incidents.data?.filter((i: { status: string }) => !["resolved","postmortem"].includes(i.status)).length ?? 0;
  const sev1Count = incidents.data?.filter((i: { severity: string; status: string }) => i.severity === "SEV1" && !["resolved","postmortem"].includes(i.status)).length ?? 0;

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Network Operations Center</h1>
        <p className="text-sm text-muted-foreground">Live incidents, firing alerts, runbooks.</p>
      </header>

      <DataErrorBanner
        error={incidents.error ?? alerts.error ?? runbooks.error}
        label="NOC telemetry"
      />

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-bold text-status-danger">{sev1Count}</div><div className="text-xs uppercase text-muted-foreground">Open SEV1</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{openCount}</div><div className="text-xs uppercase text-muted-foreground">Open incidents</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold text-status-warning">{alerts.data?.length ?? 0}</div><div className="text-xs uppercase text-muted-foreground">Alerts firing</div></CardContent></Card>
      </div>

      <Tabs defaultValue="incidents">
        <TabsList>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="runbooks">Runbooks</TabsTrigger>
        </TabsList>
        <TabsContent value="incidents">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Incident</TableHead><TableHead>Service</TableHead><TableHead>Severity</TableHead>
                <TableHead>Status</TableHead><TableHead>Detected</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(incidents.data ?? []).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">{i.incident_number}</TableCell>
                    <TableCell>{i.service_name}</TableCell>
                    <TableCell><Badge variant="outline">{i.severity}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{i.status}</Badge></TableCell>
                    <TableCell className="text-xs">{new Date(i.detected_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {(incidents.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No incidents.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="alerts">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Fired</TableHead><TableHead>Service</TableHead><TableHead>Metric</TableHead>
                <TableHead>Observed / Threshold</TableHead><TableHead>Severity</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(alerts.data ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs">{new Date(a.fired_at).toLocaleString()}</TableCell>
                    <TableCell>{a.service_name}</TableCell>
                    <TableCell className="text-xs">{a.metric}</TableCell>
                    <TableCell className="text-xs">{a.observed ?? "—"} / {a.threshold ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{a.severity}</Badge></TableCell>
                  </TableRow>
                ))}
                {(alerts.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No alerts firing.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="runbooks">
          <div className="grid gap-3 md:grid-cols-2">
            {(runbooks.data ?? []).map((r) => (
              <Card key={r.id}>
                <CardContent className="p-4 space-y-1">
                  <div className="font-semibold">{r.title}</div>
                  <div className="text-xs text-muted-foreground">{r.service_name ?? "general"}</div>
                  <pre className="mt-2 text-xs whitespace-pre-wrap font-sans text-muted-foreground line-clamp-6">{r.content_md}</pre>
                </CardContent>
              </Card>
            ))}
            {(runbooks.data ?? []).length === 0 && <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No runbooks defined.</CardContent></Card>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
