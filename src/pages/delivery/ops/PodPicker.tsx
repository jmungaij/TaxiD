import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ClipboardCheck } from "lucide-react";

interface Pkg {
  id: string;
  tracking_number: string;
  status: string;
  recipient_name: string | null;
}

export default function PodPicker() {
  const [rows, setRows] = useState<Pkg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("packages")
      .select("id, tracking_number, status, recipient_name")
      .in("status", ["in_transit", "picked_up"])
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setRows((data as Pkg[]) ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <MarketingLayout>
      <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardCheck className="h-6 w-6" /> Proof of Delivery</h1>
          <p className="opacity-90 text-sm">Capture POD for packages currently out for delivery.</p>
        </div>
      </section>
      <section className="container mx-auto px-4 py-8 max-w-3xl space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">No packages awaiting POD.</Card>
        ) : (
          rows.map((p) => (
            <Card key={p.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-mono text-sm">{p.tracking_number}</div>
                <div className="text-xs text-muted-foreground">→ {p.recipient_name ?? "—"} <Badge variant="outline" className="ml-2 capitalize">{p.status.replace("_", " ")}</Badge></div>
              </div>
              <Button asChild size="sm"><Link to={`/delivery/ops/pod/${p.id}`}>Capture POD</Link></Button>
            </Card>
          ))
        )}
      </section>
    </MarketingLayout>
  );
}
