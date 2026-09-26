import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature, TimerOff } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import { money, titleise } from "@/lib/recruitment/types";
import type { RecOffer } from "@/lib/recruitment/types";

/**
 * Offer & appointment management.
 *
 * An offer can only exist against a recorded final selection, must be approved
 * by someone other than its author, expires on its expiry date, and acceptance
 * is the single event that opens onboarding and the pre-employment checks.
 */
export default function RecruitmentOffers() {
  const qc = useQueryClient();
  const offers = useQuery({ queryKey: ["rec", "offers"], queryFn: rec.listOffers });
  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });
  const approvals = useQuery({ queryKey: ["rec", "offer-approvals"], queryFn: () => rec.listOfferApprovals() });
  const applications = useQuery({ queryKey: ["rec", "applications"], queryFn: () => rec.listApplications() });
  const candidates = useQuery({ queryKey: ["rec", "candidates"], queryFn: rec.listCandidates });
  const decisions = useQuery({ queryKey: ["rec", "selection-decisions"], queryFn: () => rec.listSelectionDecisions() });

  const titleFor = (id: string) => (vacancies.data ?? []).find((v) => v.id === id)?.title ?? "—";
  const nameFor = (candidateId: string) =>
    (candidates.data ?? []).find((c) => c.id === candidateId)?.full_name ?? "Candidate";

  const [raising, setRaising] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    base_salary: "", allowances: "", start_date: "", expiry_date: "", employment_type: "permanent", terms: "",
  });
  const [responding, setResponding] = useState<{ offer: RecOffer; response: "accepted" | "declined" } | null>(null);
  const [responseReason, setResponseReason] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rec"] });

  /** Selected candidates without an active offer are ready for appointment. */
  const readyForOffer = useMemo(() => {
    const selected = new Set(
      (decisions.data ?? []).filter((d) => d.decision === "selected").map((d) => d.application_id),
    );
    const withOffer = new Set(
      (offers.data ?? []).filter((o) => ["draft", "approval", "approved", "sent", "viewed", "accepted"].includes(o.status))
        .map((o) => o.application_id),
    );
    return (applications.data ?? []).filter((a) => selected.has(a.id) && !withOffer.has(a.id));
  }, [decisions.data, offers.data, applications.data]);

  const create = useMutation({
    mutationFn: () => {
      if (!raising) throw new Error("No application selected.");
      const salary = Math.round(Number(draft.base_salary) * 100);
      if (!Number.isFinite(salary) || salary <= 0) throw new Error("Enter a base salary.");
      if (!draft.start_date) throw new Error("Enter a start date.");
      return rec.createOffer({
        application_id: raising,
        base_salary_cents: salary,
        allowances_cents: Math.round(Number(draft.allowances || 0) * 100),
        start_date: draft.start_date,
        expiry_date: draft.expiry_date || undefined,
        employment_type: draft.employment_type,
        terms: draft.terms.trim() || undefined,
      });
    },
    onSuccess: (r) => {
      toast.success(`Offer ${r.offer_no} drafted. Route it for approval.`);
      setRaising(null);
      setDraft({ base_salary: "", allowances: "", start_date: "", expiry_date: "", employment_type: "permanent", terms: "" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const route = useMutation({
    mutationFn: (id: string) => rec.submitOfferForApproval(id),
    onSuccess: () => { toast.success("Offer routed for approval"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" }) =>
      rec.decideOfferApproval(id, decision, decision === "rejected" ? "Returned to draft by approver" : undefined),
    onSuccess: () => { toast.success("Approval decision recorded"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const send = useMutation({
    mutationFn: (id: string) => rec.sendOffer(id),
    onSuccess: () => { toast.success("Offer issued to the candidate"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const respond = useMutation({
    mutationFn: () => {
      if (!responding) throw new Error("No offer selected.");
      return rec.respondToOffer(responding.offer.id, responding.response, responseReason.trim() || undefined);
    },
    onSuccess: (r) => {
      toast.success(
        r.status === "accepted"
          ? "Offer accepted — onboarding case and pre-employment checks opened."
          : "Offer declined and recorded.",
      );
      setResponding(null);
      setResponseReason("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const expire = useMutation({
    mutationFn: () => rec.expireDueOffers(),
    onSuccess: (r) => { toast.success(`${r.expired} lapsed offer(s) expired`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approvalFor = (offerId: string) => (approvals.data ?? []).find((a) => a.offer_id === offerId);

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Offers & appointments"
        lede="Compensation, maker-checker approval, expiry and candidate response. Acceptance opens onboarding automatically."
      />

      <div className="mb-6 flex justify-end">
        <Button variant="outline" size="sm" onClick={() => expire.mutate()} disabled={expire.isPending}>
          <TimerOff className="mr-1 h-4 w-4" aria-hidden="true" />
          {expire.isPending ? "Sweeping…" : "Expire lapsed offers"}
        </Button>
      </div>

      {readyForOffer.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Selected candidates awaiting an offer ({readyForOffer.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {readyForOffer.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{nameFor(a.candidate_id)}</p>
                  <p className="text-xs text-muted-foreground">{titleFor(a.vacancy_id)}</p>
                </div>
                <Button size="sm" onClick={() => setRaising(a.id)}>Raise offer</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {offers.isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : offers.error ? (
            <p className="p-6 text-sm text-destructive">
              Offers could not be loaded: {(offers.error as Error).message}
            </p>
          ) : (offers.data ?? []).length === 0 ? (
            <div className="p-10 text-center">
              <FileSignature className="h-6 w-6 mx-auto text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">No offers yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Record a final selection on the panel review page to raise one.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Offer</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(offers.data ?? []).map((o) => {
                  const approval = approvalFor(o.id);
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="text-sm font-medium">
                        {o.offer_no}
                        <p className="text-xs text-muted-foreground">v{o.version}</p>
                      </TableCell>
                      <TableCell className="text-sm">{titleFor(o.vacancy_id)}</TableCell>
                      <TableCell className="text-sm">{money(o.base_salary_cents, o.currency)}</TableCell>
                      <TableCell className="text-sm">{o.start_date ?? "—"}</TableCell>
                      <TableCell className="text-sm">{o.expiry_date ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{titleise(o.status)}</Badge>
                        {approval && approval.decision !== "pending" && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Approval {titleise(approval.decision)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {o.status === "draft" && (
                          <Button size="sm" variant="outline" onClick={() => route.mutate(o.id)}>
                            Route for approval
                          </Button>
                        )}
                        {o.status === "approval" && (
                          <>
                            <Button size="sm" onClick={() => approve.mutate({ id: o.id, decision: "approved" })}>
                              Approve offer
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive"
                              onClick={() => approve.mutate({ id: o.id, decision: "rejected" })}>
                              Return to draft
                            </Button>
                          </>
                        )}
                        {o.status === "approved" && (
                          <Button size="sm" onClick={() => send.mutate(o.id)}>Issue to candidate</Button>
                        )}
                        {["sent", "viewed"].includes(o.status) && (
                          <>
                            <Button size="sm" onClick={() => setResponding({ offer: o, response: "accepted" })}>
                              Record acceptance
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive"
                              onClick={() => setResponding({ offer: o, response: "declined" })}>
                              Record decline
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!raising} onOpenChange={(o) => !o && setRaising(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise offer of appointment</DialogTitle>
            <DialogDescription>
              The offer is created as a draft and must be approved by a second authorised person before it is issued.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="offer-salary">Base salary (KES / month)</Label>
                <Input id="offer-salary" inputMode="numeric" value={draft.base_salary}
                  onChange={(e) => setDraft({ ...draft, base_salary: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="offer-allowances">Allowances (KES)</Label>
                <Input id="offer-allowances" inputMode="numeric" value={draft.allowances}
                  onChange={(e) => setDraft({ ...draft, allowances: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="offer-start">Start date</Label>
                <Input id="offer-start" type="date" value={draft.start_date}
                  onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="offer-expiry">Offer expiry</Label>
                <Input id="offer-expiry" type="date" value={draft.expiry_date}
                  onChange={(e) => setDraft({ ...draft, expiry_date: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="offer-type">Employment type</Label>
                <select
                  id="offer-type"
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.employment_type}
                  onChange={(e) => setDraft({ ...draft, employment_type: e.target.value })}
                >
                  <option value="permanent">Permanent</option>
                  <option value="contract">Contract</option>
                  <option value="internship">Internship</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="offer-terms">Terms</Label>
              <Textarea id="offer-terms" rows={3} value={draft.terms}
                onChange={(e) => setDraft({ ...draft, terms: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRaising(null)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create draft offer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!responding} onOpenChange={(o) => !o && setResponding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {responding?.response === "accepted" ? "Record offer acceptance" : "Record offer decline"}
            </DialogTitle>
            <DialogDescription>
              {responding?.response === "accepted"
                ? "Acceptance opens the onboarding case, checklist and pre-employment checks."
                : "The application is closed and the decline reason is audited."}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="offer-response-reason">
              {responding?.response === "accepted" ? "Note (optional)" : "Decline reason"}
            </Label>
            <Textarea id="offer-response-reason" rows={3} value={responseReason}
              onChange={(e) => setResponseReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResponding(null)}>Cancel</Button>
            <Button onClick={() => respond.mutate()} disabled={respond.isPending}>
              {respond.isPending ? "Recording…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
