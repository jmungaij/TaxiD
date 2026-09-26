import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { applyGuardedTransition, CONFLICT_MESSAGE } from "@/lib/platform/guardedTransition";

type Alert = {
  id: string;
  alert_code: string;
  severity: string;
  status: string;
  title: string;
  driver_id: string | null;
  vehicle_id: string | null;
  created_at: string;
  details: Record<string, unknown>;
};

const SEV_COLOR: Record<string, string> = {
  LOW: "bg-muted text-muted-foreground",
  MEDIUM: "bg-status-warning/15 text-status-warning dark:text-status-warning",
  HIGH: "bg-status-warning/15 text-status-warning dark:text-status-warning",
  CRITICAL: "bg-destructive/15 text-destructive",
};

export default function ComplianceAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("compliance_alerts" as any)
      .select("id, alert_code, severity, status, title, driver_id, vehicle_id, created_at, details")
      .eq("status", "OPEN")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setAlerts((data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runScan = async () => {
    setScanning(true);
    const { data, error } = await supabase.functions.invoke("compliance-scanner", { body: {} });
    setScanning(false);
    if (error) return toast.error(error.message);
    toast.success(`Scan complete: ${(data as any)?.scanned ?? 0} checked, ${(data as any)?.alerts ?? 0} new alerts`);
    load();
  };

  const ack = async (id: string, status: "ACK" | "RESOLVED" | "DISMISSED") => {
    const res = await applyGuardedTransition({
      table: "compliance_alerts",
      id,
      expectedStates: ["OPEN"],
      patch: { status, resolved_at: status === "RESOLVED" ? new Date().toISOString() : null },
      audit: { flow: "compliance_alert_review", action: `compliance_alert.${status.toLowerCase()}`, entity_type: "compliance_alerts" },
    });
    if (res.outcome === "error") return toast.error(res.message ?? "Update failed");
    if (res.outcome === "conflict") {
      toast.warning(res.message ?? CONFLICT_MESSAGE);
      return load();
    }
    if (res.auditFailed) toast.warning("Alert updated but the audit entry was rejected.");
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Compliance Alerts</h1>
          <p className="text-sm text-muted-foreground">Open alerts from the automated compliance scanner.</p>
        </div>
        <Button onClick={runScan} disabled={scanning}>
          {scanning ? "Scanning…" : "Run scan now"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Open alerts ({alerts.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">All clear. No open alerts.</p>
          ) : (
            <div className="space-y-2">
              {alerts.map(a => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge className={SEV_COLOR[a.severity] ?? ""}>{a.severity}</Badge>
                      <span className="font-medium">{a.title}</span>
                      <span className="text-xs text-muted-foreground">{a.alert_code}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {a.driver_id ? `Driver ${a.driver_id.slice(0, 8)}…` : a.vehicle_id ? `Vehicle ${a.vehicle_id.slice(0, 8)}…` : ""}
                      {" · "}{new Date(a.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => ack(a.id, "ACK")}>Ack</Button>
                    <Button size="sm" onClick={() => ack(a.id, "RESOLVED")}>Resolve</Button>
                    <Button size="sm" variant="ghost" onClick={() => ack(a.id, "DISMISSED")}>Dismiss</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
