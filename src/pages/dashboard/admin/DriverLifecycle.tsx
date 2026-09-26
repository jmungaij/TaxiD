import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type LifecycleEntry = {
  id: string;
  driver_id: string;
  from_stage: string | null;
  to_stage: string;
  reason: string | null;
  created_at: string;
};

type Stage = { code: string; name: string; sort_order: number; is_terminal: boolean };

export default function DriverLifecycle() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [history, setHistory] = useState<LifecycleEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [s, h] = await Promise.all([
        supabase.from("driver_lifecycle_stages" as any).select("*").order("sort_order"),
        supabase.from("driver_lifecycle_history" as any)
          .select("id, driver_id, from_stage, to_stage, reason, created_at")
          .order("created_at", { ascending: false }).limit(100),
      ]);
      setStages((s.data as any) ?? []);
      setHistory((h.data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Driver Lifecycle</h1>
        <p className="text-sm text-muted-foreground">15-stage driver journey from applicant to retirement.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Lifecycle stages</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {stages.map(s => (
            <Badge key={s.code} variant={s.is_terminal ? "destructive" : "secondary"}>
              {s.sort_order}. {s.name}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent transitions ({history.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> :
           history.length === 0 ? <p className="text-sm text-muted-foreground">No transitions yet.</p> : (
            <div className="divide-y">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono text-xs">{h.driver_id.slice(0, 8)}…</span>
                  <span>
                    <Badge variant="outline" className="mr-1">{h.from_stage ?? "—"}</Badge>
                    →
                    <Badge className="ml-1">{h.to_stage}</Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">{h.reason ?? ""}</span>
                  <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
