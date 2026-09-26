import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Violation {
  id: string; decision: string; reason: string;
  ride_type: string | null; fare_cents: number | null;
  created_at: string; user_id: string | null;
}

export default function CorporateViolations({ corporateId }: { corporateId: string | null }) {
  const [items, setItems] = useState<Violation[]>([]);
  useEffect(() => {
    if (!corporateId) return;
    supabase.from("corporate_policy_violations")
      .select("*").eq("corporate_id", corporateId)
      .order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => setItems((data ?? []) as Violation[]));
  }, [corporateId]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-status-warning" /> Policy violations</h2>
      {items.map(v => (
        <Card key={v.id} className="p-3 flex justify-between items-center text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={v.decision === "block" ? "destructive" : "secondary"}>{v.decision}</Badge>
            <span className="font-medium">{v.reason}</span>
            {v.ride_type && <span className="text-muted-foreground">· {v.ride_type}</span>}
            {v.fare_cents != null && <span className="text-muted-foreground">· KES {(v.fare_cents / 100).toLocaleString()}</span>}
          </div>
          <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(v.created_at))} ago</span>
        </Card>
      ))}
      {items.length === 0 && <Card className="p-6 text-center text-muted-foreground">No violations recorded.</Card>}
    </div>
  );
}
