import { useEffect, useState } from "react";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

interface Row {
  id: string;
  document_name: string;
  document_code: string;
  applies_to: string;
  required: boolean;
  expiry_required: boolean;
  verification_required: boolean;
  display_order: number;
  is_active: boolean;
}

export default function KycTypes() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    document_name: "",
    document_code: "",
    applies_to: "driver",
    required: true,
    expiry_required: false,
    verification_required: true,
    display_order: 0,
    is_active: true,
  });

  async function load() {
    setLoading(true);
    const { data, error } = await untypedDb
      .from("kyc_document_types")
      .select("*")
      .order("applies_to")
      .order("display_order");
    if (error) toast.error(error.message);
    setRows((data as Row[] | null) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!form.document_name || !form.document_code) { toast.error("Name and code required"); return; }
    const { error } = await untypedDb.from("kyc_document_types").insert(form);
    if (error) return toast.error(error.message);
    toast.success("KYC requirement added");
    setForm({ ...form, document_name: "", document_code: "" });
    load();
  }

  async function toggle(r: Row, field: "is_active" | "required" | "expiry_required") {
    const { error } = await untypedDb.from("kyc_document_types").update({ [field]: !r[field] }).eq("id", r.id);
    if (error) return toast.error(error.message);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this KYC requirement?")) return;
    const { error } = await untypedDb.from("kyc_document_types").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removed");
    load();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">KYC Requirements</h1>
        <p className="text-muted-foreground text-sm">Add, edit, enable, or remove KYC documents without code changes.</p>
      </header>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="w-5 h-5" /> Add KYC requirement</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-4">
          <div className="space-y-1"><Label>Document name</Label><Input value={form.document_name} onChange={(e) => setForm({ ...form, document_name: e.target.value })} placeholder="e.g. Driving Licence" /></div>
          <div className="space-y-1"><Label>Code (unique)</Label><Input value={form.document_code} onChange={(e) => setForm({ ...form, document_code: e.target.value.toUpperCase() })} placeholder="DRIVING_LICENCE" /></div>
          <div className="space-y-1"><Label>Applies to</Label>
            <Select value={form.applies_to} onValueChange={(v) => setForm({ ...form, applies_to: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="driver">Driver</SelectItem><SelectItem value="vehicle">Vehicle</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2"><Switch checked={form.required} onCheckedChange={(v) => setForm({ ...form, required: v })} /><Label>Required</Label></div>
          <div className="flex items-center gap-2"><Switch checked={form.expiry_required} onCheckedChange={(v) => setForm({ ...form, expiry_required: v })} /><Label>Expiry required</Label></div>
          <div className="flex items-center gap-2"><Switch checked={form.verification_required} onCheckedChange={(v) => setForm({ ...form, verification_required: v })} /><Label>Verification required</Label></div>
          <div className="space-y-1"><Label>Display order</Label><Input type="number" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) })} /></div>
          <div className="md:col-span-3"><Button onClick={create}>Add requirement</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>All KYC requirements ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-muted-foreground">Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Applies to</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.display_order}</TableCell>
                    <TableCell className="font-medium">{r.document_name}</TableCell>
                    <TableCell><code className="text-xs">{r.document_code}</code></TableCell>
                    <TableCell><Badge variant="outline">{r.applies_to}</Badge></TableCell>
                    <TableCell><Switch checked={r.required} onCheckedChange={() => toggle(r, "required")} /></TableCell>
                    <TableCell><Switch checked={r.expiry_required} onCheckedChange={() => toggle(r, "expiry_required")} /></TableCell>
                    <TableCell><Switch checked={r.is_active} onCheckedChange={() => toggle(r, "is_active")} /></TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => remove(r.id)}><Trash2 className="w-4 h-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
