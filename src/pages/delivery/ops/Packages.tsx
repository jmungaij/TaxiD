import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Package as PackageIcon } from "lucide-react";

interface Pkg {
  id: string;
  tracking_number: string;
  status: string;
  recipient_name: string | null;
  dropoff_address: string | null;
  created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  created: "bg-muted text-muted-foreground",
  accepted: "bg-ai/10 text-ai",
  picked_up: "bg-ai/10 text-ai",
  in_transit: "bg-status-warning/10 text-status-warning",
  delivered: "bg-status-success/10 text-status-success",
  returned: "bg-status-warning/10 text-status-warning",
  cancelled: "bg-status-danger/10 text-status-danger",
};

export default function PackagesPage() {
  const [rows, setRows] = useState<Pkg[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    recipient_name: "",
    recipient_phone: "",
    pickup_address: "",
    dropoff_address: "",
    weight_kg: "",
    notes: "",
  });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("packages")
      .select("id, tracking_number, status, recipient_name, dropoff_address, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast.error("Failed to load packages");
    setRows((data as Pkg[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const createPackage = async () => {
    if (!form.recipient_name || !form.dropoff_address || !form.pickup_address) {
      toast.error("Recipient, pickup and dropoff are required");
      return;
    }
    setSubmitting(true);
    const { data: user } = await supabase.auth.getUser();
    const tracking = `PKG-${Date.now().toString(36).toUpperCase()}`;
    const { data, error } = await supabase
      .from("packages")
      .insert({
        tracking_number: tracking,
        module: "package",
        sender_id: user.user?.id,
        recipient_name: form.recipient_name,
        recipient_phone: form.recipient_phone || null,
        pickup_address: form.pickup_address,
        dropoff_address: form.dropoff_address,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        status: "created",
        metadata: form.notes ? { notes: form.notes } : {},
      })
      .select("id")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Failed to create");
      setSubmitting(false);
      return;
    }
    // Write the immutable "created" event
    await supabase.from("package_events").insert({
      package_id: data.id,
      event_type: "created",
      actor_id: user.user?.id,
      notes: "Package created",
    });
    toast.success(`Package ${tracking} created`);
    setForm({ recipient_name: "", recipient_phone: "", pickup_address: "", dropoff_address: "", weight_kg: "", notes: "" });
    setShowForm(false);
    setSubmitting(false);
    load();
  };

  return (
    <MarketingLayout>
      <section className="bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 py-10 flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Packages</h1>
            <p className="opacity-90 text-sm">Immutable lifecycle: Created → Accepted → Picked Up → In Transit → Delivered.</p>
          </div>
          <Button variant="secondary" onClick={() => setShowForm((s) => !s)}>
            <Plus className="h-4 w-4 mr-1" /> New package
          </Button>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
        {showForm && (
          <Card className="p-5 space-y-4">
            <h2 className="font-semibold">Create package</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Recipient name *</Label>
                <Input value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} maxLength={120} />
              </div>
              <div>
                <Label>Recipient phone</Label>
                <Input value={form.recipient_phone} onChange={(e) => setForm({ ...form, recipient_phone: e.target.value })} maxLength={32} />
              </div>
              <div>
                <Label>Pickup address *</Label>
                <Input value={form.pickup_address} onChange={(e) => setForm({ ...form, pickup_address: e.target.value })} maxLength={240} />
              </div>
              <div>
                <Label>Dropoff address *</Label>
                <Input value={form.dropoff_address} onChange={(e) => setForm({ ...form, dropoff_address: e.target.value })} maxLength={240} />
              </div>
              <div>
                <Label>Weight (kg)</Label>
                <Input type="number" step="0.1" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={createPackage} disabled={submitting}>{submitting ? "Creating…" : "Create package"}</Button>
            </div>
          </Card>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading packages…</p>
        ) : rows.length === 0 ? (
          <Card className="p-10 text-center">
            <PackageIcon className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
            <p className="font-medium">No packages yet</p>
            <p className="text-sm text-muted-foreground">Create your first package to start the lifecycle.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((p) => (
              <Link key={p.id} to={`/delivery/ops/packages/${p.id}`}>
                <Card className="p-4 hover:border-primary/40 transition-colors flex items-center justify-between">
                  <div>
                    <div className="font-mono text-sm">{p.tracking_number}</div>
                    <div className="text-xs text-muted-foreground">
                      → {p.recipient_name ?? "—"} · {p.dropoff_address ?? "—"}
                    </div>
                  </div>
                  <Badge className={STATUS_COLOR[p.status] ?? "bg-muted"}>{p.status.replace("_", " ")}</Badge>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </MarketingLayout>
  );
}
