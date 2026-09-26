/**
 * Partner links.
 *
 * Issue one private link per approved partner so the partner reads their own
 * enquiry, quotes, contracts and rides instead of being emailed every update.
 * The token is shown once, at issue time; only its fingerprint is stored.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Copy, Link2, Ban } from "lucide-react";
import {
  createPartnerPortalGrant,
  listPartnerPortalGrants,
  revokePartnerPortalGrant,
  searchApprovedPartners,
} from "@/lib/commercial/partnerPortal";

const when = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString("en-KE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export default function PartnerPortalLinksPanel() {
  const qc = useQueryClient();
  const [term, setTerm] = React.useState("");
  const [issued, setIssued] = React.useState<{ partner: string; url: string } | null>(null);

  const partners = useQuery({
    queryKey: ["partner-portal-partners", term],
    queryFn: () => searchApprovedPartners(term),
  });
  const grants = useQuery({ queryKey: ["partner-portal-grants"], queryFn: () => listPartnerPortalGrants() });

  const issue = useMutation({
    mutationFn: (applicationId: string) => createPartnerPortalGrant({ applicationId }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(
          res.error === "APPLICATION_NOT_APPROVED"
            ? "Only approved partners can be given a link."
            : res.error === "NOT_AUTHORISED"
              ? "You do not have permission to issue partner links."
              : "The link could not be issued.",
        );
        return;
      }
      setIssued({
        partner: res.partner ?? "Partner",
        url: `${window.location.origin}${res.path}`,
      });
      void qc.invalidateQueries({ queryKey: ["partner-portal-grants"] });
      toast.success("Link issued. Copy it now — it is shown only once.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: (grantId: string) => revokePartnerPortalGrant(grantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["partner-portal-grants"] });
      toast.success("Link withdrawn. It stops working immediately.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const nameFor = (applicationId: string) =>
    (partners.data ?? []).find((p) => p.id === applicationId)?.organisation_name ?? applicationId;

  return (
    <div className="space-y-4">
      {issued && (
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Link for {issued.partner}</CardTitle>
            <CardDescription>Shown once. Send it to your partner contact.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 text-xs">{issued.url}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(issued.url);
                toast.success("Link copied.");
              }}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Copy link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
              Done
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Approved partners</CardTitle>
          <CardDescription>
            Only approved partner applications can be given a link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Search partners by name"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="max-w-sm"
          />
          {partners.isLoading && <Skeleton className="h-24 w-full" />}
          {!partners.isLoading && (partners.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No approved partner matches that search.</p>
          )}
          {(partners.data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{p.organisation_name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.reference ?? "no reference"} · {p.city ?? "location not recorded"} ·{" "}
                  {p.contact_email ?? "no email on record"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={issue.isPending}
                onClick={() => issue.mutate(p.id)}
              >
                <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Issue link
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Links issued</CardTitle>
          <CardDescription>Withdraw a link and it stops working at once.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {grants.isLoading && <Skeleton className="h-24 w-full" />}
          {!grants.isLoading && (grants.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No partner link has been issued yet.</p>
          )}
          {(grants.data ?? []).map((g) => (
            <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="text-sm">
                <p className="font-medium">{g.recipient_name ?? nameFor(g.application_id)}</p>
                <p className="text-xs text-muted-foreground">
                  {g.recipient_email ?? "no email recorded"} · expires {when(g.expires_at)} · opened{" "}
                  {g.opens} time{g.opens === 1 ? "" : "s"} · last opened {when(g.last_opened_at)}
                </p>
              </div>
              {g.revoked_at ? (
                <Badge variant="outline">Withdrawn {when(g.revoked_at)}</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(g.id)}
                >
                  <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Withdraw
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
