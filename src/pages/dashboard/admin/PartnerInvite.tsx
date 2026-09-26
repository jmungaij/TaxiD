/**
 * Partner Onboarding & Invite Flow — People & Partners workspace.
 *
 * Reuses the certified layout primitives and the existing
 * `corporate_invitations` table + audit log RLS surface. No new components,
 * routes, or schemas are introduced.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Mail,
  RefreshCw,
  Send,
  UserPlus,
} from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Corporate {
  id: string;
  legal_name: string | null;
  status: string | null;
}

interface Invite {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string | null;
  created_at: string;
  corporate_id: string;
}

const inviteSchema = z.object({
  corporate_id: z.string().uuid("Select a partner"),
  email: z.string().trim().email("Valid email required").max(255),
  full_name: z.string().trim().max(120).optional().or(z.literal("")),
  role: z.enum(["corporate_admin", "corporate_manager", "corporate_employee"]),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export default function PartnerInvite() {
  const { user } = useAuth();
  const [corporates, setCorporates] = useState<Corporate[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    corporate_id: "",
    email: "",
    full_name: "",
    role: "corporate_admin" as "corporate_admin" | "corporate_manager" | "corporate_employee",
    note: "",
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    const [c, i] = await Promise.all([
      supabase
        .from("corporate_accounts")
        .select("id, legal_name, status")
        .order("legal_name", { ascending: true })
        .limit(200),
      supabase
        .from("corporate_invitations")
        .select("id, email, full_name, role, status, created_at, corporate_id")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (c.error) setError(c.error.message);
    setCorporates((c.data ?? []) as Corporate[]);
    setInvites((i.data ?? []) as Invite[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const send = async () => {
    const parsed = inviteSchema.safeParse(form);
    if (!parsed.success) {
      toast({
        title: "Please fix the form",
        description: parsed.error.issues.map((i) => i.message).join(" · "),
        variant: "destructive",
      });
      return;
    }
    if (!user) return;
    const { error: err } = await supabase.from("corporate_invitations").insert({
      corporate_id: parsed.data.corporate_id,
      email: parsed.data.email,
      full_name: parsed.data.full_name || null,
      role: parsed.data.role,
      invited_by: user.id,
    });
    if (err) {
      toast({ title: "Invite failed", description: err.message, variant: "destructive" });
      return;
    }
    toast({ title: "Invitation queued", description: `Sent to ${parsed.data.email}` });
    setForm({
      corporate_id: "",
      email: "",
      full_name: "",
      role: "corporate_admin",
      note: "",
    });
    load();
  };

  const corporateName = useMemo(() => {
    const map = new Map(corporates.map((c) => [c.id, c.legal_name ?? "—"]));
    return (id: string) => map.get(id) ?? "—";
  }, [corporates]);

  return (
    <div className="space-y-6">
      <EnterpriseHeroBand
        eyebrow={<span>People &amp; Partners · Onboarding</span>}
        title={
          <span className="flex items-center gap-2">
            <Building2 className="h-6 w-6" /> Partner Onboarding &amp; Invite
          </span>
        }
        subtitle="Invite corporate partners and their admins into SAFARID with certified layout and audited RLS-protected writes."
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={load}
            aria-label="Refresh partner invites"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        }
      />

      <AsyncState loading={loading} error={error} onRetry={load}>
        <SectionErrorBoundary sectionName="Invite Form">
          <section aria-label="Partner invite form">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <UserPlus className="h-4 w-4" /> Send a partner invitation
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label htmlFor="pp-corp">Partner (corporate account)</Label>
                  <Select
                    value={form.corporate_id}
                    onValueChange={(v) => setForm({ ...form, corporate_id: v })}
                  >
                    <SelectTrigger id="pp-corp">
                      <SelectValue placeholder="Select a corporate partner" />
                    </SelectTrigger>
                    <SelectContent>
                      {corporates.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.legal_name ?? c.id} {c.status ? `· ${c.status}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="pp-inv-email">Email</Label>
                  <Input
                    id="pp-inv-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="pp-inv-name">Full name (optional)</Label>
                  <Input
                    id="pp-inv-name"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="pp-inv-role">Role</Label>
                  <Select
                    value={form.role}
                    onValueChange={(v) =>
                      setForm({ ...form, role: v as typeof form.role })
                    }
                  >
                    <SelectTrigger id="pp-inv-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="corporate_admin">Corporate Admin</SelectItem>
                      <SelectItem value="corporate_manager">Corporate Manager</SelectItem>
                      <SelectItem value="corporate_employee">Corporate Employee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="pp-inv-note">Note (internal, optional)</Label>
                  <Textarea
                    id="pp-inv-note"
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                    rows={2}
                  />
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button className="gap-2" onClick={send}>
                    <Send className="h-4 w-4" /> Send invitation
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Recent Invitations">
          <section aria-label="Recent partner invitations" className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Mail className="h-4 w-4" /> Recent invitations
            </h2>
            <div className="rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">
                        {corporateName(i.corporate_id)}
                      </TableCell>
                      <TableCell>{i.email}</TableCell>
                      <TableCell>{i.role.replace("corporate_", "")}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            i.status === "accepted"
                              ? "default"
                              : i.status === "revoked"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {i.status ?? "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(i.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {invites.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-muted-foreground py-8"
                      >
                        No invitations sent yet.
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
