/**
 * Audit view of every change made to `nav_integrity_thresholds`.
 * Reads from `nav_integrity_threshold_audit` (populated by the
 * `log_nav_threshold_change` trigger). Admins only.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface AuditRow {
  id: string;
  environment: string;
  action: "insert" | "update" | "delete";
  changed_by: string | null;
  changed_by_email: string | null;
  diff: Record<string, { old: unknown; new: unknown }> | null;
  changed_at: string;
}

export default function IntegrityThresholdAudit() {
  const [rows, setRows] = React.useState<AuditRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [env, setEnv] = React.useState<string>("all");

  React.useEffect(() => {
    setLoading(true);
    let q = supabase
      .from("nav_integrity_threshold_audit")
      .select("id,environment,action,changed_by,changed_by_email,diff,changed_at")
      .order("changed_at", { ascending: false })
      .limit(200);
    if (env !== "all") q = q.eq("environment", env);
    q.then(({ data }) => {
      setRows((data as any) ?? []);
      setLoading(false);
    });
  }, [env]);

  const environments = Array.from(new Set(rows.map(r => r.environment)));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Threshold Audit Log</h1>
          <p className="text-muted-foreground">
            Every change to navigation-integrity gate thresholds, per environment.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={env} onValueChange={setEnv}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All environments</SelectItem>
              {environments.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard/admin/integrity-gates">Edit gates</Link>
          </Button>
        </div>
      </div>

      {loading ? <Skeleton className="h-64 w-full" /> : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          No threshold changes recorded yet.
        </CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Recent changes</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Env</th>
                    <th className="py-2 pr-4">Action</th>
                    <th className="py-2 pr-4">Who</th>
                    <th className="py-2">Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-4 whitespace-nowrap">{new Date(r.changed_at).toLocaleString()}</td>
                      <td className="py-2 pr-4"><Badge variant="outline">{r.environment}</Badge></td>
                      <td className="py-2 pr-4">
                        <Badge variant={r.action === "delete" ? "destructive" : r.action === "insert" ? "default" : "secondary"}>
                          {r.action}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">{r.changed_by_email ?? <span className="text-muted-foreground">system</span>}</td>
                      <td className="py-2">
                        {r.diff && Object.keys(r.diff).length > 0 ? (
                          <ul className="space-y-0.5">
                            {Object.entries(r.diff).map(([k, v]) => (
                              <li key={k} className="text-xs">
                                <code className="text-muted-foreground">{k}:</code>{" "}
                                <span className="line-through text-destructive">{JSON.stringify(v.old)}</span>{" "}
                                → <span className="text-status-success">{JSON.stringify(v.new)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
