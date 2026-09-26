/**
 * SOCIAL DISTRIBUTION — AUTHORITATIVE CONTROL PLANE
 * /dashboard/admin/social-distribution
 *
 * Ownership, verification, approval, activation, suspension, archiving and the
 * audit trail. Every action calls a governed Postgres routine that validates
 * the destination hostname, enforces the lifecycle and writes an audit event —
 * the UI has no authority of its own.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PublishingConsole from "@/components/social/PublishingConsole";

import { useToast } from "@/hooks/use-toast";
import {
  activateAccount,
  approveAccount,
  archiveAccount,
  deactivateAccount,
  listAccountEvents,
  listAllAccounts,
  listHealth,
  setAccountUrl,
  verifyAccount,
  type SocialAccount,
  type SocialAccountEvent,
  type SocialHealthRow,
} from "@/lib/social/api";
import { canTransition, isApprovedSocialUrl, PLATFORM_HOSTNAMES } from "@/lib/social/platforms";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_VERIFICATION: "bg-warning/15 text-warning",
  VERIFIED: "bg-info/15 text-info",
  APPROVED: "bg-info/15 text-info",
  ACTIVE: "bg-success/15 text-success",
  SUSPENDED: "bg-destructive/15 text-destructive",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export default function SocialDistribution() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [events, setEvents] = useState<SocialAccountEvent[]>([]);
  const [health, setHealth] = useState<SocialHealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SocialAccount | null>(null);
  const [url, setUrl] = useState("");
  const [handle, setHandle] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [a, e, h] = await Promise.all([listAllAccounts(), listAccountEvents(undefined, 200), listHealth(50)]);
      setAccounts(a);
      setEvents(e);
      setHealth(h);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the social register");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const published = useMemo(() => accounts.filter((a) => a.status === "ACTIVE"), [accounts]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast({ title: label, description: "Change recorded in the social audit trail." });
      setEditing(null);
      setEvidence("");
      setReason("");
      await refresh();
    } catch (err) {
      toast({
        variant: "destructive",
        title: `${label} refused`,
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  const urlValid = !editing || url === "" || isApprovedSocialUrl(editing.platform_slug, url);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Social Distribution — Control Plane</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Authoritative ownership, verification, approval and activation of Yalla Mobility's official social channels.
          No destination becomes a public footer link until it is verified, approved and activated here.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Channels registered</CardDescription></CardHeader>
          <CardContent className="text-2xl font-semibold">{accounts.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Published publicly</CardDescription></CardHeader>
          <CardContent className="text-2xl font-semibold">{published.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Awaiting destination</CardDescription></CardHeader>
          <CardContent className="text-2xl font-semibold">
            {accounts.filter((a) => !a.profile_url).length}
          </CardContent>
        </Card>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <Tabs defaultValue="register">
        <TabsList className="flex-wrap">
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="publishing">Publishing</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
          <TabsTrigger value="health">Link health</TabsTrigger>
        </TabsList>

        <TabsContent value="publishing" className="mt-4">
          <PublishingConsole scope="PLATFORM" />
        </TabsContent>


        <TabsContent value="register" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Official accounts</CardTitle>
              <CardDescription>
                Lifecycle: Draft → Destination supplied → Ownership verified → Approved → Active → Public footer.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={5} className="text-muted-foreground">Loading…</TableCell></TableRow>
                  )}
                  {!loading && accounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium capitalize">
                        {a.platform_slug}
                        <span className="ml-2 text-xs text-muted-foreground">{a.market}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_TONE[a.status] ?? ""} variant="secondary">{a.status}</Badge>
                      </TableCell>
                      <TableCell>{a.verification_status === "VERIFIED" ? "Yes" : "No"}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-sm text-muted-foreground">
                        {a.profile_url ?? "— not supplied —"}
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        <Button size="sm" variant="outline" onClick={() => { setEditing(a); setUrl(a.profile_url ?? ""); setHandle(a.handle ?? ""); }}>
                          {a.profile_url ? "Edit destination" : "Supply destination"}
                        </Button>
                        {canTransition(a.status, "VERIFIED") && a.profile_url && (
                          <Button size="sm" variant="outline" onClick={() => { setEditing(a); setUrl(a.profile_url ?? ""); }}>Verify</Button>
                        )}
                        {canTransition(a.status, "APPROVED") && (
                          <Button size="sm" disabled={busy} onClick={() => run("Account approved", () => approveAccount(a.id, "Approved in control plane"))}>Approve</Button>
                        )}
                        {canTransition(a.status, "ACTIVE") && (
                          <Button size="sm" disabled={busy} onClick={() => run("Account activated", () => activateAccount(a.id, "Activated in control plane"))}>Activate</Button>
                        )}
                        {canTransition(a.status, "SUSPENDED") && (
                          <Button size="sm" variant="destructive" disabled={busy} onClick={() => run("Account suspended", () => deactivateAccount(a.id, "Suspended in control plane"))}>Deactivate</Button>
                        )}
                        {canTransition(a.status, "ARCHIVED") && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("Account archived", () => archiveAccount(a.id, "Archived in control plane"))}>Archive</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audit trail</CardTitle>
              <CardDescription>Append-only. Every configuration change is attributable.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead><TableHead>Platform</TableHead><TableHead>Action</TableHead><TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-muted-foreground">No changes recorded yet.</TableCell></TableRow>
                  )}
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-sm">{new Date(e.created_at).toLocaleString()}</TableCell>
                      <TableCell className="capitalize">{e.platform_slug ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{e.action}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{e.reason ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Destination health</CardTitle>
              <CardDescription>
                Active destinations are re-checked periodically. A transient failure never auto-deactivates a channel —
                it is raised for review.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Checked</TableHead><TableHead>State</TableHead><TableHead>HTTP</TableHead><TableHead>Detail</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {health.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-muted-foreground">No checks recorded — no destination is active.</TableCell></TableRow>
                  )}
                  {health.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap text-sm">{new Date(h.checked_at).toLocaleString()}</TableCell>
                      <TableCell>{h.state}</TableCell>
                      <TableCell>{h.http_status ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{h.redirect_target ?? h.error_detail ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">{editing?.platform_slug} — official destination</DialogTitle>
            <DialogDescription>
              Only https destinations on approved hostnames are accepted:{" "}
              {editing ? (PLATFORM_HOSTNAMES[editing.platform_slug as keyof typeof PLATFORM_HOSTNAMES] ?? []).join(", ") : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="social-url">Profile URL</Label>
              <Input id="social-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-invalid={!urlValid} />
              {!urlValid && (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  Not an approved https destination for this platform.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="social-handle">Handle (optional)</Label>
              <Input id="social-handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="social-reason">Reason / change note</Label>
              <Input id="social-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button
                disabled={busy || !url || !urlValid}
                onClick={() => editing && run("Destination recorded", () => setAccountUrl(editing.id, url, handle || null, null, reason || "Destination supplied"))}
              >
                Save destination
              </Button>
            </div>
            <hr className="border-border" />
            <div>
              <Label htmlFor="social-evidence">Ownership evidence (required to verify)</Label>
              <Textarea
                id="social-evidence"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="How ownership was proven — e.g. admin access confirmed by the brand team on 2026-08-17, page admin: …"
              />
              <Button
                className="mt-2"
                variant="outline"
                disabled={busy || !editing?.profile_url || evidence.trim().length < 10}
                onClick={() => editing && run("Ownership verified", () => verifyAccount(editing.id, evidence, reason || "Ownership verified"))}
              >
                Mark ownership verified
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
