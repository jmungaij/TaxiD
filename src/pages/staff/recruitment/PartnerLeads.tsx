import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CheckCircle2, UserRound } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import {
  linkLeadToRequisition, loadPartnerLeads, loadRequisitionOptions,
  type PartnerLeadRow,
} from "@/lib/partners/recruitmentLink";

/**
 * Partner leads in the recruiter workspace.
 *
 * Each saved "Become a Partner" application already carries a Recruitment 360
 * candidate (created by the database when the application is saved). A recruiter
 * attaches the lead to a vacancy here; the server creates the recruitment
 * application and records who linked it.
 */
export default function PartnerLeads() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<PartnerLeadRow | null>(null);
  const [vacancyId, setVacancyId] = useState("");
  const [notes, setNotes] = useState("");

  const leads = useQuery({ queryKey: ["partner-leads"], queryFn: loadPartnerLeads });
  const vacancies = useQuery({ queryKey: ["partner-leads", "requisitions"], queryFn: loadRequisitionOptions });

  const link = useMutation({
    mutationFn: () =>
      linkLeadToRequisition({
        partnerApplicationId: target!.id,
        vacancyId,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Lead linked to the vacancy — it now appears in the applicant pipeline.");
      setTarget(null);
      setVacancyId("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["partner-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = leads.data ?? [];
    if (!q) return all;
    return all.filter((r) =>
      [r.organisation_name, r.contact_name, r.contact_email, r.reference]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [leads.data, search]);

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="Partner leads in Recruitment 360"
        lede="Every partner application is mapped to a candidate record. Attach a lead to a vacancy to create its recruitment application."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Partner applications</CardTitle>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organisation, contact or reference"
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent className="p-0">
          {leads.isLoading && <div className="p-6 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
          {leads.isError && <p className="p-6 text-sm text-destructive">{(leads.error as Error).message}</p>}
          {!leads.isLoading && rows.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">No partner applications yet.</p>
          )}
          <div className="divide-y">
            {rows.map((row) => (
              <div key={row.id} className="p-4 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-[16rem] space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {row.organisation_name}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground">{row.reference}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.contact_name} · {row.contact_email}
                    {row.contact_phone ? ` · ${row.contact_phone}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[row.city, row.country].filter(Boolean).join(", ") || "Location not given"} ·{" "}
                    {new Date(row.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div className="space-y-1 text-sm">
                  {row.candidate ? (
                    <p className="flex items-center gap-2">
                      <UserRound className="h-4 w-4 text-muted-foreground" />
                      <Link className="underline" to={`/staff/recruitment/candidates?candidate=${row.candidate.id}`}>
                        {row.candidate.candidate_no} · {row.candidate.full_name}
                      </Link>
                    </p>
                  ) : (
                    <Badge variant="secondary">No candidate record</Badge>
                  )}
                  {row.vacancy && row.application ? (
                    <p className="flex items-center gap-2 text-success">
                      <CheckCircle2 className="h-4 w-4" />
                      {row.vacancy.title} · {row.application.application_no} ({row.application.stage})
                    </p>
                  ) : (
                    <Badge variant="outline">Not attached to a vacancy</Badge>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {row.application && (
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/staff/recruitment/applications/${row.application.id}`}>Open application</Link>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      setTarget(row);
                      setVacancyId(row.vacancy?.id ?? "");
                      setNotes(row.link?.notes ?? "");
                    }}
                  >
                    {row.application ? "Change vacancy" : "Attach to vacancy"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attach partner lead to a vacancy</DialogTitle>
            <DialogDescription>
              {target?.organisation_name} — {target?.contact_name}. The recruitment application is created by the
              server with this partner reference recorded as its source.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Vacancy</Label>
              <Select value={vacancyId} onValueChange={setVacancyId}>
                <SelectTrigger><SelectValue placeholder="Choose a vacancy" /></SelectTrigger>
                <SelectContent>
                  {(vacancies.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title} · {v.vacancy_no}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Note for the record (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button disabled={!vacancyId || link.isPending} onClick={() => link.mutate()}>
              {link.isPending ? "Linking…" : "Link lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
