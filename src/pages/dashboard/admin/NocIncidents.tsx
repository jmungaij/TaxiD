import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SeoHead } from "@/components/seo/SeoHead";
import { Loader2, ShieldAlert, RefreshCw } from "lucide-react";

type Row = Record<string, unknown>;

const SEV_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  sev1: "destructive", sev2: "destructive", sev3: "secondary", sev4: "outline",
};

function useNocTable(table: string, orderBy: string, limit = 100) {
  return useQuery({
    queryKey: ["noc-v2", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as never).select("*").order(orderBy, { ascending: false }).limit(limit);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 15_000,
  });
}

export default function NocIncidents() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [lastScan, setLastScan] = useState<string | null>(null);

  const incidents = useNocTable("incident_nocs", "detected_at");
  const runbooks = useNocTable("incident_runbooks", "created_at", 50);
  const postmortems = useNocTable("incident_postmortems", "created_at", 50);

  const scan = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("noc-alerter", { body: { dry_run: false } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setLastScan(new Date().toLocaleString());
      qc.invalidateQueries({ queryKey: ["noc-v2", "incident_nocs"] });
      toast({
        title: "NOC scan complete",
        description: `${data?.opened ?? 0} incidents opened · ${data?.scanned_signals ?? 0} signals scanned`,
      });
    },
    onError: (e: Error) => toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
  });

  const openIncidents = incidents.data?.filter((r) => !["resolved", "closed"].includes(String(r.status))) ?? [];
  const sev1Open = openIncidents.filter((r) => String(r.severity).toLowerCase() === "sev1").length;

  return (
    <div className="space-y-6 p-6">
      <SeoHead title="NOC Incidents · Admin" description="Network operations center incidents, runbooks and postmortems." path="/dashboard/admin/noc-incidents" />
      <div className="flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldAlert className="h-6 w-6" /> NOC Incidents
          </h1>
          <p className="text-sm text-muted-foreground">
            Incidents auto-opened from ML drift, prediction failures and governance breaches.
            {lastScan && <span className="ml-2">Last scan: {lastScan}</span>}
          </p>
        </div>
        <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
          {scan.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Scan now
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Open incidents" value={openIncidents.length} tone={openIncidents.length ? "danger" : undefined} />
        <Stat label="SEV1 open" value={sev1Open} tone={sev1Open ? "danger" : undefined} />
        <Stat label="Runbooks" value={runbooks.data?.length ?? 0} />
        <Stat label="Postmortems" value={postmortems.data?.length ?? 0} />
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="all">All Incidents</TabsTrigger>
          <TabsTrigger value="runbooks">Runbooks</TabsTrigger>
          <TabsTrigger value="postmortems">Postmortems</TabsTrigger>
        </TabsList>

        <TabsContent value="open">
          <IncidentTable rows={openIncidents} runbooks={runbooks.data ?? []} />
        </TabsContent>
        <TabsContent value="all">
          <IncidentTable rows={incidents.data ?? []} runbooks={runbooks.data ?? []} />
        </TabsContent>

        <TabsContent value="runbooks">
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Runbooks</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead><TableHead>Title</TableHead><TableHead>Category</TableHead>
                    <TableHead>Steps</TableHead><TableHead>Owner</TableHead><TableHead>Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runbooks.data?.map((r) => (
                    <TableRow key={String(r.id)}>
                      <TableCell className="font-mono text-xs">{String(r.runbook_key)}</TableCell>
                      <TableCell className="font-medium">{String(r.title)}</TableCell>
                      <TableCell>{String(r.category)}</TableCell>
                      <TableCell>{Array.isArray(r.steps) ? `${(r.steps as unknown[]).length} steps` : "—"}</TableCell>
                      <TableCell className="text-xs">{String(r.owner ?? "—")}</TableCell>
                      <TableCell>{r.is_active ? <Badge>active</Badge> : <Badge variant="outline">archived</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="postmortems">
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Postmortems</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Summary</TableHead><TableHead>Root cause</TableHead>
                    <TableHead>Action items</TableHead><TableHead>Published</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {postmortems.data?.map((r) => (
                    <TableRow key={String(r.id)}>
                      <TableCell>{String(r.summary)}</TableCell>
                      <TableCell className="text-xs">{String(r.root_cause ?? "—")}</TableCell>
                      <TableCell>{Array.isArray(r.action_items) ? `${(r.action_items as unknown[]).length}` : "0"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.published_at ? new Date(String(r.published_at)).toLocaleString() : "draft"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function IncidentTable({ rows, runbooks }: { rows: Row[]; runbooks: Row[] }) {
  const rbByKey = new Map(runbooks.map((r) => [String(r.runbook_key), r]));
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Incidents ({rows.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead>
              <TableHead>Title</TableHead><TableHead>Services</TableHead><TableHead>Runbook</TableHead>
              <TableHead>Detected</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const sev = String(r.severity).toLowerCase();
              const rbKey = (r.metadata as Record<string, unknown> | undefined)?.runbook_key as string | undefined;
              const rb = rbKey ? rbByKey.get(rbKey) : null;
              return (
                <TableRow key={String(r.id)}>
                  <TableCell className="font-mono text-xs">{String(r.incident_code)}</TableCell>
                  <TableCell><Badge variant={SEV_VARIANT[sev] ?? "outline"}>{String(r.severity)}</Badge></TableCell>
                  <TableCell><Badge variant={String(r.status) === "resolved" ? "default" : "secondary"}>{String(r.status)}</Badge></TableCell>
                  <TableCell className="font-medium">{String(r.title)}</TableCell>
                  <TableCell className="text-xs">{Array.isArray(r.affected_services) ? (r.affected_services as string[]).join(", ") : "—"}</TableCell>
                  <TableCell className="text-xs">{rb ? <span className="font-mono">{String(rb.runbook_key)}</span> : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(String(r.detected_at)).toLocaleString()}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className={`mt-2 text-2xl font-bold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
