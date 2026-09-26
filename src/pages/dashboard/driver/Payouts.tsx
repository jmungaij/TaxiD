import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { WithdrawDialog } from "@/components/driver/WithdrawDialog";
import {
  Smartphone, Landmark, Star, Trash2, Plus, ArrowUpRight, RefreshCw,
} from "lucide-react";

/**
 * Driver payout methods + payout history.
 * driver_payout_methods.driver_id and driver_payouts.driver_id are both the
 * authenticated user id (RLS: driver_id = auth.uid()).
 */

interface Method {
  id: string;
  method_type: "MPESA" | "BANK_TRANSFER" | "CARD";
  msisdn: string | null;
  bank_code: string | null;
  bank_account: string | null;
  account_name: string | null;
  verified: boolean;
  is_default: boolean;
  created_at: string;
}

interface Payout {
  id: string;
  amount_cents: number;
  net_payout_cents: number | null;
  tax_withheld_cents: number | null;
  status: string;
  reference: string | null;
  created_at: string;
  paid_at: string | null;
}

const kes = (cents: number | null | undefined) =>
  `KES ${((cents ?? 0) / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

function normaliseMsisdn(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

function statusTone(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toUpperCase();
  if (s === "SUCCESS") return "default";
  if (s === "FAILED" || s === "REVERSED" || s === "CANCELLED") return "destructive";
  return "secondary";
}

export default function DriverPayoutsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [methods, setMethods] = useState<Method[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [balanceCents, setBalanceCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ kind: "MPESA" as Method["method_type"], msisdn: "", bank_code: "", bank_account: "", account_name: "" });

  const refresh = useCallback(async () => {
    if (!user) return;
    const c: any = supabase;
    const [{ data: m, error: mErr }, { data: p, error: pErr }, { data: w }] = await Promise.all([
      c.from("driver_payout_methods")
        .select("id,method_type,msisdn,bank_code,bank_account,account_name,verified,is_default,created_at")
        .eq("driver_id", user.id)
        .order("is_default", { ascending: false }),
      c.from("driver_payouts")
        .select("id,amount_cents,net_payout_cents,tax_withheld_cents,status,reference,created_at,paid_at")
        .eq("driver_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("wallets").select("balance_cents").eq("user_id", user.id).eq("wallet_type", "driver").maybeSingle(),
    ]);
    setMethods((m as Method[]) ?? []);
    setPayouts((p as Payout[]) ?? []);
    setBalanceCents(w?.balance_cents ?? 0);
    setLoadError(mErr?.message ?? pErr?.message ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  async function addMethod() {
    if (!user) return;
    let payload: Record<string, unknown>;
    if (form.kind === "MPESA") {
      const msisdn = normaliseMsisdn(form.msisdn);
      if (!msisdn) {
        toast({ title: "Invalid M-Pesa number", description: "Use a Kenyan mobile number, e.g. 0712345678.", variant: "destructive" });
        return;
      }
      payload = { method_type: "MPESA", msisdn };
    } else {
      if (!form.bank_code.trim() || !form.bank_account.trim() || !form.account_name.trim()) {
        toast({ title: "Bank details incomplete", description: "Bank code, account number and account name are all required.", variant: "destructive" });
        return;
      }
      payload = {
        method_type: "BANK_TRANSFER",
        bank_code: form.bank_code.trim(),
        bank_account: form.bank_account.trim(),
        account_name: form.account_name.trim(),
      };
    }

    setBusy(true);
    try {
      const { error } = await (supabase as any).from("driver_payout_methods").insert({
        driver_id: user.id,
        ...payload,
        is_default: methods.length === 0,
      });
      if (error) throw error;
      toast({ title: "Payout method added", description: methods.length === 0 ? "Set as your default destination." : "Available for your next withdrawal." });
      setForm({ kind: form.kind, msisdn: "", bank_code: "", bank_account: "", account_name: "" });
      await refresh();
    } catch (err) {
      toast({ title: "Could not save method", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(id: string) {
    if (!user) return;
    setBusy(true);
    try {
      const c: any = supabase;
      const { error: clearErr } = await c.from("driver_payout_methods")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("driver_id", user.id);
      if (clearErr) throw clearErr;
      const { error } = await c.from("driver_payout_methods")
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Default updated" });
      await refresh();
    } catch (err) {
      toast({ title: "Could not set default", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function removeMethod(id: string) {
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("driver_payout_methods").delete().eq("id", id);
      if (error) throw error;
      toast({ title: "Payout method removed" });
      await refresh();
    } catch (err) {
      toast({
        title: "Could not remove method",
        description: err?.message?.includes("foreign key")
          ? "This method is referenced by an existing payout and must stay on record."
          : err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/10 via-background to-primary-glow/10 p-6 border-b">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge variant="secondary" className="mb-1">Payouts</Badge>
              <h1 className="text-2xl md:text-3xl font-bold">Payout destinations</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Withdrawable balance <span className="font-semibold text-foreground">{kes(balanceCents)}</span> · paid to your default destination.
              </p>
            </div>
            <div className="flex gap-2">
              <WithdrawDialog driverId={user?.id ?? ""} availableCents={balanceCents} onRequested={refresh} />
              <Button variant="outline" onClick={refresh}>
                <RefreshCw className="h-4 w-4 mr-2" /> Refresh
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {loadError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Payout data could not be loaded. {loadError}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saved destinations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : methods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payout destination yet. Add an M-Pesa number to enable withdrawals.</p>
            ) : (
              methods.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {m.method_type === "MPESA" ? <Smartphone className="h-4 w-4 text-muted-foreground" /> : <Landmark className="h-4 w-4 text-muted-foreground" />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {m.method_type === "MPESA" ? m.msisdn : `${m.bank_code} · ${m.bank_account}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.method_type === "MPESA" ? "M-Pesa" : m.account_name}
                        {m.verified ? " · verified" : " · pending verification"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {m.is_default ? (
                      <Badge><Star className="h-3 w-3 mr-1" /> Default</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => makeDefault(m.id)}>
                        Set default
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => removeMethod(m.id)} aria-label="Remove payout method">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a destination</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              {(["MPESA", "BANK_TRANSFER"] as Method["method_type"][]).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={form.kind === k ? "default" : "outline"}
                  onClick={() => setForm((f) => ({ ...f, kind: k }))}
                >
                  {k === "MPESA" ? "M-Pesa" : "Bank transfer"}
                </Button>
              ))}
            </div>

            {form.kind === "MPESA" ? (
              <div>
                <Label htmlFor="pm-msisdn">M-Pesa number</Label>
                <Input
                  id="pm-msisdn"
                  placeholder="0712345678"
                  value={form.msisdn}
                  onChange={(e) => setForm((f) => ({ ...f, msisdn: e.target.value }))}
                />
              </div>
            ) : (
              <div className="grid gap-3">
                <div>
                  <Label htmlFor="pm-bank">Bank code</Label>
                  <Input id="pm-bank" placeholder="e.g. 01 (KCB)" value={form.bank_code} onChange={(e) => setForm((f) => ({ ...f, bank_code: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="pm-acct">Account number</Label>
                  <Input id="pm-acct" value={form.bank_account} onChange={(e) => setForm((f) => ({ ...f, bank_account: e.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="pm-name">Account name</Label>
                  <Input id="pm-name" value={form.account_name} onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))} />
                </div>
              </div>
            )}

            <Button onClick={addMethod} disabled={busy}>
              <Plus className="h-4 w-4 mr-2" /> {busy ? "Saving…" : "Save destination"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Finance verifies new destinations before large payouts. M-Pesa numbers must be registered in your own name.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4" /> Withdrawal history
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No withdrawals yet.</p>
          ) : (
            payouts.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <div>
                  <div className="font-medium">{kes(p.amount_cents)}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString("en-KE")}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {(p.tax_withheld_cents ?? 0) > 0 && (
                    <span className="text-xs text-muted-foreground">Withheld {kes(p.tax_withheld_cents)}</span>
                  )}
                  <span className="text-xs text-muted-foreground">Net {kes(p.net_payout_cents ?? p.amount_cents)}</span>
                  <Badge variant={statusTone(p.status)}>{p.status}</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
