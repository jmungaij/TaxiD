/**
 * OPERATOR VERIFICATION DESK
 *
 * One place for our team to see every operator, the documents they have
 * submitted, and to record their standing: in review, verified, suspended or
 * blocked. Suspending or blocking withdraws their live marketplace listings
 * straight away. Every decision is kept permanently.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { BadgeCheck, History, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { DOC_KIND_LABEL, type ProviderDocKind } from "@/lib/provider/documents";
import {
  VERIFICATION_LABEL,
  loadOperatorVerifications,
  loadVerificationHistory,
  setOperatorVerification,
  type OperatorVerificationRow,
  type VerificationState,
} from "@/lib/provider/verification";

function stateTone(state: VerificationState): string {
  switch (state) {
    case "VERIFIED":
      return "border-[hsl(var(--status-success))] text-[hsl(var(--status-success))]";
    case "SUSPENDED":
      return "border-[hsl(var(--status-warning))] text-[hsl(var(--status-warning))]";
    case "BLOCKED":
      return "border-destructive text-destructive";
    default:
      return "";
  }
}

function when(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function missingLabel(row: OperatorVerificationRow): string {
  if (!row.missing_docs || row.missing_docs.length === 0) return "All required documents verified";
  return `Missing: ${row.missing_docs
    .map((k) => DOC_KIND_LABEL[k as ProviderDocKind] ?? k)
    .join(", ")}`;
}

function OperatorHistory({ providerUserId }: { providerUserId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["operator-verification-history", providerUserId],
    queryFn: () => loadVerificationHistory(providerUserId),
  });
  if (isLoading) return <Skeleton className="h-16 w-full" />;
  const rows = data ?? [];
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No decision has been recorded yet.</p>;
  }
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {rows.map((e) => (
        <li key={e.id}>
          {when(e.created_at)} · {e.from_state ? VERIFICATION_LABEL[e.from_state] : "New"} →{" "}
          <span className="font-medium text-foreground">{VERIFICATION_LABEL[e.to_state]}</span>
          {e.reason ? ` · ${e.reason}` : ""}
        </li>
      ))}
    </ul>
  );
}

export default function OperatorVerificationDesk() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["operator-verifications"],
    queryFn: loadOperatorVerifications,
  });
  const [reason, setReason] = React.useState<Record<string, string>>({});
  const [openHistory, setOpenHistory] = React.useState<string | null>(null);

  const decide = useMutation({
    mutationFn: (p: { id: string; state: VerificationState }) =>
      setOperatorVerification({ providerUserId: p.id, state: p.state, reason: reason[p.id] }),
    onSuccess: (res, p) => {
      toast({
        title: `Operator marked ${VERIFICATION_LABEL[p.state].toLowerCase()}`,
        description:
          res.listings_withdrawn > 0
            ? `${res.listings_withdrawn} live listing(s) were taken off the marketplace.`
            : undefined,
      });
      setReason((x) => ({ ...x, [p.id]: "" }));
      void qc.invalidateQueries({ queryKey: ["operator-verifications"] });
      void qc.invalidateQueries({ queryKey: ["operator-verification-history", p.id] });
      void qc.invalidateQueries({ queryKey: ["staff-provider-supply"] });
    },
    onError: (e: Error) =>
      toast({ title: "Decision not recorded", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">This desk could not be opened</CardTitle>
          <CardDescription>{(error as Error).message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const rows = data ?? [];
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Operator verification
        </CardTitle>
        <CardDescription>
          Verify an operator once their licence, insurance and vehicle inspection are all verified and
          in date. Suspend or block an operator who fails verification — their live listings come off
          the marketplace immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          {(["UNVERIFIED", "IN_REVIEW", "VERIFIED", "SUSPENDED", "BLOCKED"] as VerificationState[]).map(
            (s) => (
              <Badge key={s} variant="outline" className={stateTone(s)}>
                {VERIFICATION_LABEL[s]}: {counts[s] ?? 0}
              </Badge>
            ),
          )}
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No operator has submitted documents or listings yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operator</TableHead>
                  <TableHead>Documents</TableHead>
                  <TableHead>Listings</TableHead>
                  <TableHead>Standing</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const canVerify = !r.missing_docs || r.missing_docs.length === 0;
                  const hasReason = (reason[r.provider_user_id] ?? "").trim().length > 0;
                  return (
                    <React.Fragment key={r.provider_user_id}>
                      <TableRow>
                        <TableCell className="align-top">
                          <div className="font-medium">{r.operator_name ?? "Operator account"}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {r.provider_user_id.slice(0, 8)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.bookings_active} active booking(s)
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-xs">
                          <div>{r.docs_verified} verified · {r.docs_awaiting} awaiting review</div>
                          {r.docs_rejected > 0 && (
                            <div className="text-destructive">{r.docs_rejected} not accepted</div>
                          )}
                          <div className="text-muted-foreground">{missingLabel(r)}</div>
                        </TableCell>
                        <TableCell className="align-top text-xs">
                          {r.listings_live} live · {r.listings_awaiting} awaiting approval
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant="outline" className={stateTone(r.state)}>
                            {VERIFICATION_LABEL[r.state]}
                          </Badge>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {when(r.decided_at)}
                          </div>
                          {r.reason && (
                            <div className="mt-1 max-w-[16rem] text-[11px] text-muted-foreground">
                              {r.reason}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col items-end gap-2">
                            <Input
                              className="h-8 w-full max-w-[16rem] text-xs"
                              placeholder="Reason (required to review, suspend or block)"
                              value={reason[r.provider_user_id] ?? ""}
                              onChange={(e) =>
                                setReason((x) => ({ ...x, [r.provider_user_id]: e.target.value }))
                              }
                            />
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                size="sm"
                                disabled={decide.isPending || !canVerify || r.state === "VERIFIED"}
                                onClick={() =>
                                  decide.mutate({ id: r.provider_user_id, state: "VERIFIED" })
                                }
                              >
                                <BadgeCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Verify
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={decide.isPending || !hasReason}
                                onClick={() =>
                                  decide.mutate({ id: r.provider_user_id, state: "IN_REVIEW" })
                                }
                              >
                                Under review
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={decide.isPending || !hasReason}
                                onClick={() =>
                                  decide.mutate({ id: r.provider_user_id, state: "SUSPENDED" })
                                }
                              >
                                <ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Suspend
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={decide.isPending || !hasReason}
                                onClick={() =>
                                  decide.mutate({ id: r.provider_user_id, state: "BLOCKED" })
                                }
                              >
                                <ShieldX className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Block
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setOpenHistory((cur) =>
                                    cur === r.provider_user_id ? null : r.provider_user_id,
                                  )
                                }
                              >
                                <History className="mr-1.5 h-3.5 w-3.5" aria-hidden /> History
                              </Button>
                            </div>
                            {!canVerify && (
                              <p className="max-w-[16rem] text-right text-[11px] text-muted-foreground">
                                Verify their outstanding documents first.
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {openHistory === r.provider_user_id && (
                        <TableRow>
                          <TableCell colSpan={5} className="bg-muted/40">
                            <OperatorHistory providerUserId={r.provider_user_id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
