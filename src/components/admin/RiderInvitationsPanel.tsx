import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

type Inv = {
  id: string; email: string; full_name: string | null; phone_number: string | null;
  status: string; welcome_credit_cents: number; credit_applied_at: string | null;
  is_test: boolean; claimed_user_id: string | null; created_at: string;
};

/** Admin rider onboarding: invite → approve → optional welcome credit (super admin). */
export default function RiderInvitationsPanel() {
  const c: any = supabase;
  const [rows, setRows] = useState<Inv[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await c.from("rider_invitations").select("*").order("created_at", { ascending: false }).limit(200);
    setRows((data as Inv[]) ?? []);
  }, [c]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<{ error: any }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success(ok); void load(); }
  };

  const invite = () => run(() => c.rpc("rider_invite", { _email: email, _full_name: name, _phone: phone, _is_test: false }), "Rider invited")
    .then(() => { setEmail(""); setName(""); setPhone(""); });

  const credit = (id: string) => {
    const amt = window.prompt("Welcome credit in KES (max 5,000)");
    if (!amt) return;
    const reason = window.prompt("Reason for this credit (required)");
    if (!reason) return;
    void run(() => c.rpc("rider_invite_set_credit", { _id: id, _amount_kes: Number(amt), _reason: reason }), "Credit saved");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Rider onboarding</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Invite a rider by email. Once approved, they get access when they sign up with that email. Welcome credit
          (super admin only) is added to their wallet once, and is logged.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" />
          <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
          <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="max-w-[180px]" />
          <Button onClick={invite} disabled={busy || !email}>Invite rider</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rider</TableHead><TableHead>Status</TableHead>
              <TableHead className="text-right">Welcome credit</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No invitations yet.</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm">
                  <span className="font-medium">{r.full_name ?? "—"}</span>{" "}
                  {r.is_test && <Badge variant="secondary">TEST</Badge>}
                  <div className="text-xs text-muted-foreground">{r.email} · {r.phone_number ?? "—"}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{r.status}</Badge>
                  {r.claimed_user_id && r.status !== "claimed" && <div className="text-[10px] text-muted-foreground">signed up</div>}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {r.welcome_credit_cents > 0 ? `KES ${(r.welcome_credit_cents / 100).toLocaleString()}` : "—"}
                  {r.credit_applied_at && <div className="text-[10px] text-muted-foreground">added to wallet</div>}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  {(r.status === "invited" || r.status === "rejected") && (
                    <Button size="sm" disabled={busy} onClick={() => run(() => c.rpc("rider_invite_decide", { _id: r.id, _approve: true }), "Approved")}>Approve</Button>
                  )}
                  {(r.status === "invited" || r.status === "approved") && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => c.rpc("rider_invite_decide", { _id: r.id, _approve: false }), "Rejected")}>Reject</Button>
                  )}
                  {!r.credit_applied_at && r.status !== "rejected" && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => credit(r.id)}>Credit</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
