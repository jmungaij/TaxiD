import type { LooseRow } from "@/lib/types/loose";
import { useEffect, useState } from "react";
import { supabase as supabaseClient } from "@/integrations/supabase/client";
const supabase: LooseRow = supabaseClient;
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldAlert, Users, FileWarning, AlertTriangle } from "lucide-react";

export default function Compliance() {
  const [totals, setTotals] = useState({ drivers: 0, pendingDocs: 0, expired: 0, incidents: 0 });
  const [queue, setQueue] = useState<LooseRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [drivers, pendingDocs, incidents, q] = await Promise.all([
        supabase.from("drivers" as LooseRow).select("*", { count: "exact", head: true }),
        supabase.from("document_verification_queue" as LooseRow).select("*", { count: "exact", head: true }).eq("review_status", "pending"),
        supabase.from("driver_incidents" as LooseRow).select("*", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("document_verification_queue" as LooseRow).select("id, priority, review_status, created_at").order("priority").order("created_at").limit(20),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const expired = await supabase.from("driver_documents" as LooseRow).select("*", { count: "exact", head: true }).lt("expiry_date", today);
      const firstError = [drivers, pendingDocs, incidents, q, expired].find((r: LooseRow) => r?.error)?.error;
      setLoadError(firstError ? firstError.message : null);
      setTotals({
        drivers: drivers.count ?? 0,
        pendingDocs: pendingDocs.count ?? 0,
        expired: expired.count ?? 0,
        incidents: incidents.count ?? 0,
      });
      setQueue((q.data as LooseRow) ?? []);
    })();
  }, []);


  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Compliance Command Center</h1>
        <p className="text-muted-foreground text-sm">Drivers, documents, expiries, incidents — live across the fleet.</p>
      </header>
      {loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Compliance data failed to load — the figures below are not authoritative. {loadError}
        </div>
      )}
      <div className="grid md:grid-cols-4 gap-4">
        <Stat icon={Users} label="Drivers" value={totals.drivers} />
        <Stat icon={FileWarning} label="Pending verifications" value={totals.pendingDocs} />
        <Stat icon={ShieldAlert} label="Expired documents" value={totals.expired} />
        <Stat icon={AlertTriangle} label="Open incidents" value={totals.incidents} />
      </div>
      <Card>
        <CardHeader><CardTitle>Verification queue</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead><TableHead>Queue ID</TableHead></TableRow></TableHeader>
            <TableBody>
              {queue.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Queue empty</TableCell></TableRow> :
                queue.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell><Badge variant={q.priority <= 2 ? "destructive" : "outline"}>P{q.priority}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{q.review_status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(q.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{q.id.slice(0, 8)}…</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: LooseRow) {
  return (
    <Card><CardContent className="pt-6">
      <Icon className="w-5 h-5 text-primary mb-2" />
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </CardContent></Card>
  );
}
