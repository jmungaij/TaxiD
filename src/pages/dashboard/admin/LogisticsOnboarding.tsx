/**
 * Onboarding Approvals — Enterprise Logistics OS · Partner Management.
 *
 * Review queue for logistics partner applications submitted from
 * /delivery/portal. Reuses frozen primitives only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import StatCard from "@/components/common/StatCard";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { ClipboardCheck, Clock, CheckCircle2, XCircle } from "lucide-react";

interface Application {
  id: string;
  user_id: string;
  status: string;
  partner_type: string | null;
  company_name: string | null;
  registration_number: string | null;
  tax_pin: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  country: string | null;
  city: string | null;
  service_area: string | null;
  fleet_size: number | null;
  vehicle_types: string | null;
  monthly_volume: number | null;
  notes: string | null;
  review_notes: string | null;
  submitted_at: string | null;
}

const TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  submitted: "bg-status-warning/12 text-status-warning border-status-warning/25",
  in_review: "bg-status-warning/12 text-status-warning border-status-warning/25",
  approved: "bg-status-success/12 text-status-success border-status-success/25",
  rejected: "bg-status-danger/12 text-status-danger border-status-danger/25",
};

const FILTERS = ["submitted", "in_review", "approved", "rejected", "all"] as const;

export default function LogisticsOnboarding() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("submitted");
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("delivery_onboarding")
      .select("*")
      .eq("module", "logistics_partner")
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) toast({ title: "Could not load applications", description: error.message, variant: "destructive" });
    setRows((data ?? []) as unknown as Application[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(async (row: Application, status: "in_review" | "approved" | "rejected") => {
    setBusy(row.id);
    const { error } = await supabase
      .from("delivery_onboarding")
      .update({
        status,
        review_notes: notes[row.id] ?? row.review_notes ?? null,
        reviewed_by: user?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    setBusy(null);
    if (error) {
      toast({ title: "Decision failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Application ${status.replace("_", " ")}`, description: row.company_name ?? row.contact_email ?? "" });
    void load();
  }, [notes, user, load]);

  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === "submitted").length,
    review: rows.filter((r) => r.status === "in_review").length,
    approved: rows.filter((r) => r.status === "approved").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
  }), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      return [r.company_name, r.contact_email, r.contact_name, r.city, r.partner_type]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  return (
    <div className="space-y-6">
      <EnterpriseHeroBand
        eyebrow="Enterprise Logistics OS · Partner Management"
        title={<h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Onboarding Approvals</h1>}
        subtitle="Governed review queue for courier, fleet, carrier and warehouse partner applications."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Awaiting review" value={counts.pending} icon={<Clock className="h-4 w-4" />} tone="warning" />
        <StatCard title="In review" value={counts.review} icon={<ClipboardCheck className="h-4 w-4" />} tone="primary" />
        <StatCard title="Approved" value={counts.approved} icon={<CheckCircle2 className="h-4 w-4" />} tone="success" />
        <StatCard title="Rejected" value={counts.rejected} icon={<XCircle className="h-4 w-4" />} tone="danger" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f.replace("_", " ")}
          </Button>
        ))}
        <Input
          className="ml-auto h-9 w-full sm:w-64"
          placeholder="Search company, contact, city…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Loading applications…</CardContent></Card>
      ) : visible.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No applications match this view.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {visible.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-base tracking-tight">
                    {r.company_name || r.contact_name || "Unnamed applicant"}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {r.partner_type && <Badge variant="secondary">{r.partner_type}</Badge>}
                    <Badge variant="outline" className={TONE[r.status] ?? TONE.draft}>{r.status.replace("_", " ")}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <Detail label="Contact" value={`${r.contact_name ?? "—"} · ${r.contact_email ?? "—"}`} />
                  <Detail label="Phone" value={r.contact_phone} />
                  <Detail label="Location" value={[r.city, r.country].filter(Boolean).join(", ")} />
                  <Detail label="Registration" value={r.registration_number} />
                  <Detail label="KRA PIN" value={r.tax_pin} />
                  <Detail label="Coverage" value={r.service_area} />
                  <Detail label="Fleet size" value={r.fleet_size != null ? String(r.fleet_size) : null} />
                  <Detail label="Vehicles" value={r.vehicle_types} />
                  <Detail label="Monthly volume" value={r.monthly_volume != null ? String(r.monthly_volume) : null} />
                </dl>
                {r.notes && <p className="text-xs leading-relaxed text-muted-foreground">Applicant note: {r.notes}</p>}
                <Textarea
                  rows={2}
                  placeholder="Reviewer note (recorded with the decision)"
                  value={notes[r.id] ?? r.review_notes ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => decide(r, "approved")} disabled={busy === r.id}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => decide(r, "in_review")} disabled={busy === r.id}>Mark in review</Button>
                  <Button size="sm" variant="destructive" onClick={() => decide(r, "rejected")} disabled={busy === r.id}>Reject</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="truncate">{value || "—"}</dd>
    </div>
  );
}
