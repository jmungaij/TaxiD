/**
 * People Management Console — People & Partners workspace.
 *
 * Lightweight admin surface for creating, viewing, and updating rider /
 * passenger records. Reuses the certified primitives and the existing
 * `profiles` table exposed via the Supabase client. No new components are
 * introduced — this page composes shadcn primitives already in the design
 * system.
 */
import { useEffect, useMemo, useState } from "react";
import { Users, RefreshCw, Search, UserPlus, Save } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface PersonRow {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
}

const personSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(120),
  phone: z
    .string()
    .trim()
    .max(32)
    .optional()
    .or(z.literal("")),
});

export default function PeopleConsole() {
  const { user } = useAuth();
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", phone: "" });

  const load = async () => {
    setLoading(true);
    setError(null);
    let query = supabase
      .from("profiles")
      .select("id, user_id, full_name, phone, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (dq.trim()) {
      const like = `%${dq.trim()}%`;
      query = query.or(`full_name.ilike.${like},phone.ilike.${like}`);
    }
    const { data, error: err } = await query;
    if (err) setError(err.message);
    setRows(((data ?? []) as unknown) as PersonRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ full_name: "", phone: "" });
    setDialogOpen(true);
  };

  const openEdit = (row: PersonRow) => {
    setEditingId(row.id);
    setForm({
      full_name: row.full_name ?? "",
      phone: row.phone ?? "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    const parsed = personSchema.safeParse(form);
    if (!parsed.success) {
      toast({
        title: "Please fix the form",
        description: parsed.error.issues.map((i) => i.message).join(" · "),
        variant: "destructive",
      });
      return;
    }
    if (!user) {
      toast({ title: "Not signed in", variant: "destructive" });
      return;
    }
    const payload = {
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
    };
    if (editingId) {
      const { error: err } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", editingId);
      if (err) {
        toast({ title: "Update failed", description: err.message, variant: "destructive" });
        return;
      }
      toast({ title: "Profile updated" });
    } else {
      const { error: err } = await supabase
        .from("profiles")
        .insert({ ...payload, user_id: user.id });
      if (err) {
        toast({ title: "Create failed", description: err.message, variant: "destructive" });
        return;
      }
      toast({ title: "Profile created" });
    }
    setDialogOpen(false);
    load();
  };

  const isEmpty = useMemo(() => !loading && rows.length === 0, [loading, rows]);

  return (
    <div className="space-y-6">
      <EnterpriseHeroBand
        eyebrow={<span>People &amp; Partners · Console</span>}
        title={
          <span className="flex items-center gap-2">
            <Users className="h-6 w-6" /> People Management Console
          </span>
        }
        subtitle="Create, review, and update rider and passenger records with certified layout, tokens, and controls."
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={load}
            aria-label="Refresh people console"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        }
      />

      <AsyncState loading={loading} error={error} onRetry={load} isEmpty={false}>
        <SectionErrorBoundary sectionName="People Directory">
          <section aria-label="People directory" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="relative w-full sm:max-w-sm">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name or phone"
                  aria-label="Search people"
                  className="pl-9"
                />
              </div>
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2" onClick={openCreate}>
                    <UserPlus className="h-4 w-4" /> Add person
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {editingId ? "Update person" : "Create person"}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="pp-name">Full name</Label>
                      <Input
                        id="pp-name"
                        value={form.full_name}
                        onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="pp-phone">Phone</Label>
                      <Input
                        id="pp-phone"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={save} disabled={!user} className="gap-2">
                      <Save className="h-4 w-4" />{" "}
                      {editingId ? "Save changes" : "Create person"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div className="rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.full_name ?? "—"}
                      </TableCell>
                      <TableCell>{r.phone ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {isEmpty && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center text-muted-foreground py-8"
                      >
                        No people match the current filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </SectionErrorBoundary>
      </AsyncState>
    </div>
  );
}
