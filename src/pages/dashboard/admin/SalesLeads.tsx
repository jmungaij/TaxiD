import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
import { Loader2, Search, Sparkles, PhoneCall, CheckCircle2, Building2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Lead = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  type: string;
  subject: string | null;
  message: string;
  source_page: string | null;
  employee_count: string | null;
  status: string;
  spam_score: number;
  is_spam: boolean;
  created_at: string;
  notes: string | null;
};

const LEAD_TYPES = ["sales", "demo", "partner"];
const FILTERS = [
  { value: "all", label: "All leads" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "disqualified", label: "Disqualified" },
] as const;

const statusVariant = (s: string) =>
  s === "qualified" ? "default" : s === "contacted" ? "secondary" : s === "disqualified" ? "destructive" : "outline";

export default function SalesLeads() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Lead | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("contact_submissions")
      .select(
        "id,name,email,company,phone,type,subject,message,source_page,employee_count,status,spam_score,is_spam,created_at,notes",
      )
      .in("type", LEAD_TYPES)
      .eq("is_spam", false)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast({ title: "Could not load leads", description: error.message, variant: "destructive" });
    setRows((data as Lead[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return [r.name, r.email, r.company, r.subject, r.message].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  const stats = useMemo(() => ({
    total: rows.length,
    new: rows.filter((r) => r.status === "new").length,
    contacted: rows.filter((r) => r.status === "contacted").length,
    qualified: rows.filter((r) => r.status === "qualified").length,
  }), [rows]);

  const setStatus = async (lead: Lead, status: string, nextNotes?: string) => {
    setSaving(true);
    const payload: { status: string; notes?: string } = { status };
    if (typeof nextNotes === "string") payload.notes = nextNotes;
    const { error } = await supabase.from("contact_submissions").update(payload).eq("id", lead.id);

    setSaving(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === lead.id ? { ...r, status, notes: nextNotes ?? r.notes } : r)));
    setOpen((prev) => (prev && prev.id === lead.id ? { ...prev, status, notes: nextNotes ?? prev.notes } : prev));
    toast({ title: `Lead marked ${status}` });
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> Sales Leads
          </h1>
          <p className="text-sm text-muted-foreground">
            Inbound sales, demo and partner enquiries from the marketing site.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Refresh
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total leads", value: stats.total, icon: Building2 },
          { label: "New", value: stats.new, icon: Sparkles },
          { label: "Contacted", value: stats.contacted, icon: PhoneCall },
          { label: "Qualified", value: stats.qualified, icon: CheckCircle2 },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-muted-foreground">{s.label}</CardTitle>
              <s.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent className="text-3xl font-bold">{s.value}</CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, email, company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search leads"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                {["Lead", "Company", "Type", "Source", "Status", "Received", ""].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading leads…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No leads match this view.</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {r.company ?? "—"}
                    {r.employee_count && <div className="text-xs text-muted-foreground">{r.employee_count} staff</div>}
                  </td>
                  <td className="px-4 py-3 capitalize">{r.type}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{r.source_page ?? "—"}</td>
                  <td className="px-4 py-3"><Badge variant={statusVariant(r.status)}>{r.status}</Badge></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => { setOpen(r); setNotes(r.notes ?? ""); }}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle>{open.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-muted-foreground">Email</span><div className="font-medium break-all">{open.email}</div></div>
                  <div><span className="text-muted-foreground">Phone</span><div className="font-medium">{open.phone ?? "—"}</div></div>
                  <div><span className="text-muted-foreground">Company</span><div className="font-medium">{open.company ?? "—"}</div></div>
                  <div><span className="text-muted-foreground">Employees</span><div className="font-medium">{open.employee_count ?? "—"}</div></div>
                  <div><span className="text-muted-foreground">Type</span><div className="font-medium capitalize">{open.type}</div></div>
                  <div><span className="text-muted-foreground">Spam score</span><div className="font-medium">{open.spam_score}</div></div>
                </div>
                <div>
                  <span className="text-muted-foreground">Subject</span>
                  <div className="font-medium">{open.subject ?? "—"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Message</span>
                  <p className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3">{open.message}</p>
                </div>
                <div>
                  <Label htmlFor="lead-notes">Internal notes</Label>
                  <Textarea id="lead-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button disabled={saving} onClick={() => void setStatus(open, "contacted", notes)}>
                    <PhoneCall className="mr-2 h-4 w-4" />Mark contacted
                  </Button>
                  <Button variant="secondary" disabled={saving} onClick={() => void setStatus(open, "qualified", notes)}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />Mark qualified
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={() => void setStatus(open, "disqualified", notes)}>
                    Disqualify
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
