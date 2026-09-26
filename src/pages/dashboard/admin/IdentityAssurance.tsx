import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const SEV: Record<string, string> = {
  CRITICAL: "bg-status-danger/15 text-status-danger border-status-danger/30",
  HIGH: "bg-status-warning/15 text-status-warning border-status-warning/30",
  MEDIUM: "bg-status-warning/15 text-status-warning border-status-warning/30",
  LOW: "bg-status-success/15 text-status-success border-status-success/30",
};

export default function IdentityAssurance() {
  const qc = useQueryClient();

  const ato = useQuery({
    queryKey: ["ato-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("account_takeover_alerts").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });
  const gps = useQuery({
    queryKey: ["gps-events"],
    queryFn: async () => {
      const { data, error } = await supabase.from("location_integrity_events").select("*").order("detected_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });
  const phishing = useQuery({
    queryKey: ["phishing"],
    queryFn: async () => {
      const { data, error } = await supabase.from("phishing_reports").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15_000,
  });
  const logins = useQuery({
    queryKey: ["login-risk"],
    queryFn: async () => {
      const { data, error } = await supabase.from("login_risk_scores").select("*").order("computed_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 10_000,
  });

  useEffect(() => {
    const ch = supabase.channel("identity-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "account_takeover_alerts" }, () => qc.invalidateQueries({ queryKey: ["ato-alerts"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "location_integrity_events" }, () => qc.invalidateQueries({ queryKey: ["gps-events"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "phishing_reports" }, () => qc.invalidateQueries({ queryKey: ["phishing"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  async function applyAto(alertId: string, action: string) {
    try {
      const { error } = await supabase.functions.invoke("ato-defense", { body: { alert_id: alertId, action } });
      if (error) throw error;
      toast({ title: "Countermeasure applied" });
      ato.refetch();
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Identity Assurance</h1>
        <p className="text-sm text-muted-foreground">Login risk feed, account-takeover alerts, GPS-spoofing events, and phishing reports.</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-bold text-status-danger">{ato.data?.length ?? 0}</div><div className="text-xs uppercase text-muted-foreground">Open ATO alerts</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold text-status-warning">{gps.data?.filter((g: { severity: string }) => g.severity === "CRITICAL" || g.severity === "HIGH").length ?? 0}</div><div className="text-xs uppercase text-muted-foreground">GPS integrity flags</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{phishing.data?.filter((p: { status: string }) => p.status === "new").length ?? 0}</div><div className="text-xs uppercase text-muted-foreground">New phishing reports</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{logins.data?.filter((l: { band: string }) => l.band === "high" || l.band === "critical").length ?? 0}</div><div className="text-xs uppercase text-muted-foreground">High-risk logins (50)</div></CardContent></Card>
      </div>

      <Tabs defaultValue="ato">
        <TabsList>
          <TabsTrigger value="ato">ATO Alerts</TabsTrigger>
          <TabsTrigger value="gps">GPS Spoofing</TabsTrigger>
          <TabsTrigger value="phishing">Phishing</TabsTrigger>
          <TabsTrigger value="logins">Login Risk</TabsTrigger>
        </TabsList>

        <TabsContent value="ato">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>User</TableHead><TableHead>Status</TableHead>
                <TableHead>Severity</TableHead><TableHead>Countermeasures</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(ato.data ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{a.user_id?.slice(0,8)}</TableCell>
                    <TableCell><Badge variant="secondary">{a.status}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className={SEV[a.severity] ?? ""}>{a.severity}</Badge></TableCell>
                    <TableCell className="space-x-2">
                      <Button size="sm" variant="destructive" onClick={() => applyAto(a.id, "lock_account")}>Lock account</Button>
                      <Button size="sm" variant="outline" onClick={() => applyAto(a.id, "revoke_devices")}>Revoke devices</Button>
                      <Button size="sm" variant="ghost" onClick={() => applyAto(a.id, "clear")}>Clear</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(ato.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No open alerts.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="gps">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>Driver</TableHead><TableHead>Signal</TableHead>
                <TableHead>Severity</TableHead><TableHead>Δ m / Δ s</TableHead><TableHead>Countermeasure</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(gps.data ?? []).map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="text-xs">{new Date(g.detected_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{g.driver_id?.slice(0,8) ?? "—"}</TableCell>
                    <TableCell>{g.signal}</TableCell>
                    <TableCell><Badge variant="outline" className={SEV[g.severity] ?? ""}>{g.severity}</Badge></TableCell>
                    <TableCell className="text-xs">{g.delta_meters ? `${Number(g.delta_meters).toFixed(0)}m / ${Number(g.delta_seconds).toFixed(0)}s` : "—"}</TableCell>
                    <TableCell className="text-xs">{g.countermeasure ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {(gps.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No GPS events.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="phishing">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Ref</TableHead><TableHead>When</TableHead><TableHead>Channel</TableHead>
                <TableHead>Artifact</TableHead><TableHead>Status</TableHead><TableHead>Severity</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(phishing.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.report_number}</TableCell>
                    <TableCell className="text-xs">{new Date(p.created_at).toLocaleString()}</TableCell>
                    <TableCell>{p.channel}</TableCell>
                    <TableCell className="font-mono text-xs max-w-xs truncate">{p.artifact_value}</TableCell>
                    <TableCell><Badge variant="secondary">{p.status}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className={SEV[p.severity] ?? ""}>{p.severity}</Badge></TableCell>
                  </TableRow>
                ))}
                {(phishing.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No reports.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="logins">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>User</TableHead><TableHead>Score</TableHead>
                <TableHead>Band</TableHead><TableHead>Decision</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(logins.data ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{new Date(l.computed_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{l.user_id?.slice(0,8) ?? "—"}</TableCell>
                    <TableCell className="font-bold">{Number(l.score).toFixed(0)}</TableCell>
                    <TableCell><Badge variant="outline">{l.band}</Badge></TableCell>
                    <TableCell className="text-xs">{l.decision}</TableCell>
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
