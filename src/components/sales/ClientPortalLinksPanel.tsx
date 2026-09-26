/**
 * Client portal links.
 *
 * Issue one private link per client account so the client reads their own
 * quotes, contracts and rides instead of being emailed every update. The token
 * is shown once, at issue time; only its fingerprint is stored.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  createPortalGrant,
  listPortalGrants,
  revokePortalGrant,
  searchPortalAccounts,
  type PortalAccount,
} from "@/lib/commercial/customerPortal";

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function ClientPortalLinksPanel() {
  const qc = useQueryClient();
  const [term, setTerm] = React.useState("");
  const [account, setAccount] = React.useState<PortalAccount | null>(null);
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [issued, setIssued] = React.useState<{ url: string; account: string } | null>(null);

  const accounts = useQuery({
    queryKey: ["portal-accounts", term],
    queryFn: () => searchPortalAccounts(term),
  });
  const grants = useQuery({ queryKey: ["portal-grants"], queryFn: () => listPortalGrants() });

  const issue = useMutation({
    mutationFn: async () => {
      if (!account) throw new Error("Choose the client first.");
      return createPortalGrant({ accountId: account.id, email, name });
    },
    onSuccess: (res) => {
      if (!res.ok || !res.path) {
        toast({
          title: "Link not issued",
          description:
            res.error === "NOT_AUTHORISED"
              ? "You do not have permission to issue client links."
              : "That client account could not be read.",
          variant: "destructive",
        });
        return;
      }
      setIssued({ url: `${window.location.origin}${res.path}`, account: res.account ?? account!.name });
      setEmail("");
      setName("");
      void qc.invalidateQueries({ queryKey: ["portal-grants"] });
    },
    onError: (e) => toast({ title: "Link not issued", description: (e as Error).message, variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: revokePortalGrant,
    onSuccess: () => {
      toast({ title: "Link withdrawn", description: "The client can no longer open it." });
      void qc.invalidateQueries({ queryKey: ["portal-grants"] });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Give a client their own view</CardTitle>
          <CardDescription>
            One private link per client. They see their quotes, contracts and ride bookings — no
            password, and it expires in 60 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <Label htmlFor="portal-search">Client</Label>
              <Input
                id="portal-search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search your client accounts"
              />
              {accounts.isLoading && <Skeleton className="mt-2 h-8 w-full" />}
              <div className="mt-2 flex flex-wrap gap-2">
                {(accounts.data ?? []).map((a) => (
                  <Button
                    key={a.id}
                    size="sm"
                    variant={account?.id === a.id ? "secondary" : "outline"}
                    onClick={() => setAccount(a)}
                  >
                    {a.name}
                  </Button>
                ))}
                {!accounts.isLoading && (accounts.data ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No client account matches that name.</p>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="portal-name">Their name (optional)</Label>
              <Input id="portal-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="portal-email">Their email (optional)</Label>
              <Input
                id="portal-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={() => issue.mutate()} disabled={!account || issue.isPending}>
                {issue.isPending ? "Issuing…" : "Issue link"}
              </Button>
            </div>
          </div>

          {issued && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Link for {issued.account} — copy it now, it is shown once.</p>
              <p className="mt-1 break-all font-mono text-xs">{issued.url}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  void navigator.clipboard.writeText(issued.url);
                  toast({ title: "Copied", description: "Send it to your client." });
                }}
              >
                Copy link
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Links you have issued</CardTitle>
          <CardDescription>Whether the client has opened it, and when.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {grants.isLoading && <Skeleton className="h-24 w-full" />}
          {grants.error && (
            <p className="text-sm text-destructive">
              The list could not be read: {(grants.error as Error).message}
            </p>
          )}
          {!grants.isLoading && (grants.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No client link has been issued yet.</p>
          )}
          {(grants.data ?? []).map((g) => (
            <div
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <div>
                <p className="font-medium">{g.recipient_name ?? g.recipient_email ?? "Client link"}</p>
                <p className="text-xs text-muted-foreground">
                  Issued {when(g.created_at)} · expires {when(g.expires_at)} · opened {g.opens} time
                  {g.opens === 1 ? "" : "s"} {g.last_opened_at ? `(last ${when(g.last_opened_at)})` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {g.revoked_at ? (
                  <Badge variant="outline">Withdrawn</Badge>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(g.id)}>
                    Withdraw
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
