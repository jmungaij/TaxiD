/**
 * BANK GUARANTEES & CREDIT CONTROL (finance authority).
 *
 * TaxiD rides are cash-first. This console is the only place a guarantee-backed
 * credit facility can come into existence, and every step is decided by the
 * database, never here:
 *   • corp_guarantee_transition — lifecycle (submit, document check, bank check,
 *     record external verification, verify, approve, activate, suspend, revoke,
 *     reject). Only finance authority may act past submission, and "verify" is
 *     refused until an independent bank confirmation has been recorded.
 *   • corp_credit_facility_upsert / corp_credit_facility_transition — the credit
 *     amount TaxiD actually authorises, which is never assumed to be the
 *     guarantee amount.
 *   • corp_payment_policy_propose / corp_payment_policy_approve — the company's
 *     versioned payment rule.
 * There is deliberately no "enable credit" switch.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { untypedDb } from "@/integrations/supabase/untyped";
import { RequireRole } from "@/components/auth/RequireRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, RefreshCw, ShieldAlert, Info } from "lucide-react";
import {
  CONTROL_VERDICT_LABEL,
  CREDIT_WARNING,
  facilityTransition,
  facilityUpsert,
  guaranteeTransition,
  loadGuarantees,
  loadPaymentControls,
  loadPaymentDecisions,
  money,
  reasonText,
  type BankGuaranteeRow,
  type GuaranteeAction,
  type PaymentControlRow,
} from "@/lib/corporate/payments";
import { LodgeGuaranteeForm } from "@/components/corporate/LodgeGuaranteeForm";
import { FinanceMoneyPanel } from "@/components/corporate/FinanceMoneyPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface FacilityRow {
  id: string;
  corporate_id: string;
  guarantee_id: string;
  approved_credit_limit_cents: number;
  utilized_credit_cents: number;
  currency: string;
  state: string;
  effective_date: string;
  expiry_date: string;
}

const NEXT_ACTIONS: Record<string, GuaranteeAction[]> = {
  UPLOADED: ["SUBMIT_VERIFICATION", "REJECT"],
  VALIDATING: ["START_DOCUMENT_VERIFICATION", "REJECT"],
  DOCUMENT_VERIFICATION: ["START_BANK_VERIFICATION", "REJECT"],
  BANK_VERIFICATION: ["RECORD_EXTERNAL_VERIFICATION", "VERIFY", "REJECT"],
  PENDING_APPROVAL: ["APPROVE", "REJECT"],
  APPROVED: ["ACTIVATE", "REVOKE"],
  ACTIVE: ["SUSPEND", "REVOKE"],
  EXPIRING: ["SUSPEND", "REVOKE"],
  SUSPENDED: ["REINSTATE", "REVOKE"],
};

const ACTION_LABEL: Record<GuaranteeAction, string> = {
  SUBMIT_VERIFICATION: "Submit for verification",
  START_DOCUMENT_VERIFICATION: "Start document check",
  START_BANK_VERIFICATION: "Start bank check",
  RECORD_EXTERNAL_VERIFICATION: "Record bank confirmation",
  VERIFY: "Verify",
  APPROVE: "Approve",
  ACTIVATE: "Activate",
  SUSPEND: "Suspend",
  REINSTATE: "Reinstate",
  REVOKE: "Revoke",
  REJECT: "Reject",
};

function BankGuaranteesInner() {
  const [guarantees, setGuarantees] = useState<BankGuaranteeRow[]>([]);
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [controls, setControls] = useState<PaymentControlRow[]>([]);
  const [decisions, setDecisions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [limitInput, setLimitInput] = useState<Record<string, string>>({});
  const [lodgeCorp, setLodgeCorp] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, f, c, ctrl, dec] = await Promise.all([
        loadGuarantees(),
        untypedDb.from("corporate_credit_facilities").select("*").order("created_at", { ascending: false }),
        untypedDb.from("corporate_accounts").select("id,legal_name"),
        loadPaymentControls(),
        loadPaymentDecisions(undefined, 25),
      ]);
      setGuarantees(g);
      setFacilities((f.data ?? []) as FacilityRow[]);
      const map: Record<string, string> = {};
      for (const row of (c.data ?? []) as { id: string; legal_name: string }[]) map[row.id] = row.legal_name;
      setCompanies(map);
      setControls(ctrl);
      setDecisions((dec ?? []) as Record<string, unknown>[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the guarantee register");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (id: string, action: GuaranteeAction) => {
      const reason =
        action === "RECORD_EXTERNAL_VERIFICATION" || action === "REJECT" || action === "REVOKE" || action === "SUSPEND"
          ? window.prompt(
              action === "RECORD_EXTERNAL_VERIFICATION"
                ? "Record how the issuing bank confirmed this guarantee (who confirmed it, when, and by what means):"
                : "Reason:",
            )
          : null;
      if (
        (action === "RECORD_EXTERNAL_VERIFICATION" || action === "REJECT" || action === "REVOKE") &&
        (!reason || reason.trim().length < 5)
      ) {
        toast.error("A written reason is required.");
        return;
      }
      setActing(id + action);
      const res = await guaranteeTransition(id, action, reason ?? undefined);
      setActing(null);
      if (!res.ok) {
        toast.error(res.message ?? res.error ?? "Refused");
        return;
      }
      toast.success(`Guarantee is now ${String(res.state).split("_").join(" ").toLowerCase()}`);
      void load();
    },
    [load],
  );

  const configureFacility = useCallback(
    async (g: BankGuaranteeRow) => {
      const raw = limitInput[g.id];
      const amount = Number(raw);
      if (!raw || !Number.isFinite(amount) || amount <= 0) {
        toast.error("Enter the credit limit TaxiD authorises, in shillings.");
        return;
      }
      setActing(g.id + "facility");
      const res = await facilityUpsert({
        guaranteeId: g.id,
        approvedLimitCents: Math.round(amount * 100),
        effectiveDate: g.effective_date,
        expiryDate: g.expiry_date,
        riskMarginBps: 3000,
      });
      setActing(null);
      if (!res.ok) {
        toast.error(res.error ?? "Refused");
        return;
      }
      toast.success("Credit facility recorded as a draft. It must be activated separately.");
      void load();
    },
    [limitInput, load],
  );

  const facilityFor = useMemo(
    () => (guaranteeId: string) => facilities.find((f) => f.guarantee_id === guaranteeId) ?? null,
    [facilities],
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bank guarantees &amp; credit control</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{CREDIT_WARNING}</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </header>

      <Tabs defaultValue="guarantees">
        <TabsList>
          <TabsTrigger value="guarantees">Guarantees</TabsTrigger>
          <TabsTrigger value="lodge">Lodge a guarantee</TabsTrigger>
          <TabsTrigger value="money">Money &amp; ledger</TabsTrigger>
          <TabsTrigger value="decisions">Decision log</TabsTrigger>
          <TabsTrigger value="controls">Certification controls</TabsTrigger>
        </TabsList>

        <TabsContent value="guarantees" className="space-y-4 pt-4">
          {guarantees.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" aria-hidden />
              <AlertDescription>
                No bank guarantee has been lodged. Until one is lodged, verified, approved and activated, every trip is
                paid by M-Pesa PayBill or bank transfer and no company can ride on credit.
              </AlertDescription>
            </Alert>
          ) : null}

          {guarantees.map((g) => {
            const f = facilityFor(g.id);
            return (
              <Card key={g.id}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {companies[g.corporate_id] ?? "Company"} · {g.guarantee_number}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {g.issuing_bank} · {money(g.guaranteed_amount_cents, g.currency)} · valid {g.effective_date} to{" "}
                      {g.expiry_date}
                    </p>
                  </div>
                  <Badge variant={g.state === "ACTIVE" ? "default" : "secondary"}>
                    {g.state.split("_").join(" ").toLowerCase()}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {g.external_verification_required ? (
                    <Alert>
                      <ShieldAlert className="h-4 w-4" aria-hidden />
                      <AlertDescription>
                        External verification required. This guarantee cannot be verified until an independent
                        confirmation from the issuing bank has been recorded.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {(NEXT_ACTIONS[g.state] ?? []).map((a) => (
                      <Button
                        key={a}
                        size="sm"
                        variant={a === "REVOKE" || a === "REJECT" ? "destructive" : "outline"}
                        disabled={acting === g.id + a}
                        onClick={() => void runAction(g.id, a)}
                      >
                        {acting === g.id + a ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {ACTION_LABEL[a]}
                      </Button>
                    ))}
                  </div>

                  <div className="rounded-md border border-border p-3">
                    <p className="text-sm font-medium">Credit facility</p>
                    {f ? (
                      <div className="mt-1 space-y-2 text-sm text-muted-foreground">
                        <p>
                          {money(f.approved_credit_limit_cents, f.currency)} authorised · used{" "}
                          {money(f.utilized_credit_cents, f.currency)} · {f.state.toLowerCase()} · valid to{" "}
                          {f.expiry_date}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {f.state !== "ACTIVE" ? (
                            <Button
                              size="sm"
                              onClick={async () => {
                                const res = await facilityTransition(f.id, "ACTIVATE");
                                if (!res.ok) toast.error(res.error ?? "Refused");
                                else {
                                  toast.success("Credit facility active");
                                  void load();
                                }
                              }}
                            >
                              Activate facility
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const res = await facilityTransition(f.id, "SUSPEND", "suspended by finance");
                                if (!res.ok) toast.error(res.error ?? "Refused");
                                else {
                                  toast.success("Credit facility suspended");
                                  void load();
                                }
                              }}
                            >
                              Suspend facility
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <div>
                          <Label htmlFor={`limit-${g.id}`} className="text-xs">
                            Credit limit TaxiD authorises (KES)
                          </Label>
                          <Input
                            id={`limit-${g.id}`}
                            inputMode="numeric"
                            value={limitInput[g.id] ?? ""}
                            onChange={(e) => setLimitInput((s) => ({ ...s, [g.id]: e.target.value }))}
                            className="w-48"
                          />
                        </div>
                        <Button
                          size="sm"
                          disabled={acting === g.id + "facility"}
                          onClick={() => void configureFacility(g)}
                        >
                          Record facility
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Never assume the full guarantee value is available for spending.
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="lodge" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Which company is this guarantee for?</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={lodgeCorp} onValueChange={setLodgeCorp}>
                <SelectTrigger className="max-w-md">
                  <SelectValue placeholder="Choose a company" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(companies).map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          {lodgeCorp ? (
            <LodgeGuaranteeForm
              corporateId={lodgeCorp}
              defaultEntityName={companies[lodgeCorp]}
              onLodged={() => void load()}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="money" className="pt-4">
          <FinanceMoneyPanel />
        </TabsContent>

        <TabsContent value="decisions" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recorded payment and credit decisions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {decisions.length === 0 ? (
                <p className="text-muted-foreground">No decisions recorded yet.</p>
              ) : (
                decisions.map((d) => (
                  <div key={String(d.id)} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{String(d.requested_mode)}</Badge>
                      <span className="font-medium">{String(d.decision).split("_").join(" ").toLowerCase()}</span>
                      <span className="text-muted-foreground">
                        {money(Number(d.requested_amount_cents))} · {new Date(String(d.created_at)).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {(d.reason_codes as string[] | null)?.map(reasonText).join("; ")}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="controls" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment &amp; credit certification controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {controls.map((c) => (
                <div key={c.code} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{c.code}</span>
                    <span className="font-medium">{c.title}</span>
                    <Badge variant={c.verdict === "IMPLEMENTED" ? "default" : "secondary"}>
                      {CONTROL_VERDICT_LABEL[c.verdict]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">Expected: {c.expectation}</p>
                  {c.observation ? <p className="mt-1">{c.observation}</p> : null}
                  {c.environment ? <p className="mt-1 text-xs text-muted-foreground">{c.environment}</p> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function BankGuarantees() {
  return (
    <RequireRole roles={["finance_admin", "super_admin", "admin"]}>
      <BankGuaranteesInner />
    </RequireRole>
  );
}
