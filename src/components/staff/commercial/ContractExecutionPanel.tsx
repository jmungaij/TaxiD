/**
 * CONTRACT EXECUTION & VALUE CAPTURE — execution surface.
 *
 * This panel does not hold commercial state. It records execution facts against
 * the authoritative contract record, shows the database-computed activation gate
 * (what is missing, in plain words) and calls the single activation RPC, which
 * atomically posts exactly one revenue entry, moves the opportunity to Won,
 * advances the commercial lifecycle and opens the onboarding task.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileSignature,
  Loader2,
  Lock,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  activateContract,
  CONTRACT_STATUS_LABEL,
  CONTRACT_VALUE_TYPES,
  fetchContractControlCentre,
  fetchContractGate,
  fetchMyContractBook,
  formatContractValue,
  recordContractExecution,
  uploadContractDocument,
  type ContractControlCentre,
  type ContractGate,
  type ContractRecord,
  type ContractValueType,
} from "@/lib/commercial/contractExecution";
import {
  AcceptanceForm,
  AmendmentForm,
  AmendmentHistory,
  CreateContractDialog,
  StageMover,
} from "@/components/staff/commercial/ContractLifecycleControls";
import ContractsManagerDashboard from "@/components/staff/commercial/ContractsManagerDashboard";
import ContractControlCentrePanel from "@/components/staff/commercial/ContractControlCentre";
import RevenueReconciliationPanel from "@/components/staff/commercial/RevenueReconciliationPanel";
import PipelineValuePanel from "@/components/staff/commercial/PipelineValuePanel";

const HEALTH_LABEL: Record<string, string> = {
  missing_opportunity: "Contracts with no linked opportunity",
  missing_value: "Contracts with no value recorded",
  missing_owner: "Contracts with no owner",
  missing_executed_document: "Signed contracts with no signed copy on file",
  contracted_without_revenue_event: "Contracted with no revenue entry",
};

function GateList({ gate }: { gate: ContractGate }) {
  return (
    <ul className="space-y-1.5">
      {gate.checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 text-xs">
          {c.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          )}
          <span className={c.ok ? "text-muted-foreground" : "font-medium"}>
            {c.label}
            {!c.ok && c.detail ? <span className="block font-normal text-muted-foreground">{c.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface DraftState {
  value_amount: string;
  currency: string;
  value_type: ContractValueType;
  revenue_period: string;
  execution_date: string;
  signature_date: string;
  customer_signatory: string;
  company_signatory: string;
  term_start: string;
  term_end: string;
  billing_frequency: string;
  payment_terms: string;
  variance_reason: string;
}

const draftFrom = (c: ContractRecord): DraftState => ({
  value_amount: c.value_amount == null ? "" : String(c.value_amount),
  currency: c.currency ?? "KES",
  value_type: c.value_type ?? "one_time",
  revenue_period: c.revenue_period ?? "",
  execution_date: c.execution_date ?? "",
  signature_date: c.signature_date ?? "",
  customer_signatory: c.customer_signatory ?? "",
  company_signatory: c.company_signatory ?? "",
  term_start: c.term_start ?? "",
  term_end: c.term_end ?? "",
  billing_frequency: "",
  payment_terms: "",
  variance_reason: c.variance_reason ?? "",
});

function ContractCard({ contract, onChanged }: { contract: ContractRecord; onChanged: () => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [gate, setGate] = React.useState<ContractGate | null>(null);
  const [draft, setDraft] = React.useState<DraftState>(() => draftFrom(contract));
  const [busy, setBusy] = React.useState<string | null>(null);

  const activated = Boolean(contract.activated_at) || contract.revenue.length > 0;

  const loadGate = React.useCallback(async () => {
    const g = await fetchContractGate(contract.contract_id);
    setGate("checks" in g ? (g as ContractGate) : null);
  }, [contract.contract_id]);

  React.useEffect(() => {
    if (open) void loadGate();
  }, [open, loadGate]);

  const set = (k: keyof DraftState, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy("save");
    const patch: Record<string, unknown> = {
      currency: draft.currency.toUpperCase() || null,
      value_type: draft.value_type,
      value_amount: draft.value_amount ? Number(draft.value_amount) : null,
      revenue_period: draft.revenue_period || null,
      execution_date: draft.execution_date || null,
      signature_date: draft.signature_date || null,
      customer_signatory: draft.customer_signatory || null,
      company_signatory: draft.company_signatory || null,
      term_start: draft.term_start || null,
      term_end: draft.term_end || null,
      billing_frequency: draft.billing_frequency || null,
      payment_terms: draft.payment_terms || null,
      variance_reason: draft.variance_reason || null,
    };
    const res = await recordContractExecution(contract.contract_id, patch);
    setBusy(null);
    if (!res || res.ok === false) {
      toast.error(res && "error" in res ? String(res.error) : "Could not save the contract details");
      return;
    }
    toast.success("Contract details saved");
    await loadGate();
    onChanged();
  };

  const upload = async (file: File, kind: "executed" | "acceptance_evidence") => {
    setBusy(kind);
    const res = await uploadContractDocument(contract.contract_id, kind, file);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error ?? "Upload failed");
      return;
    }
    toast.success(kind === "executed" ? "Signed contract filed" : "Acceptance evidence filed");
    await loadGate();
    onChanged();
  };

  const activate = async () => {
    setBusy("activate");
    const res = await activateContract(contract.contract_id);
    setBusy(null);
    if (!res || res.ok === false) {
      if (res && "gate" in res && res.gate) setGate(res.gate);
      toast.error("Cannot mark as contracted yet — the outstanding items are listed below");
      return;
    }
    if (res.already_activated) toast.info("This contract was already counted — nothing was posted twice");
    else
      toast.success(
        `Contracted. ${formatContractValue(res.amount ?? null, res.currency ?? null)} recorded for ${res.revenue_period}`,
      );
    await loadGate();
    onChanged();
  };

  return (
    <Card className={activated ? "border-primary/40" : undefined}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {contract.customer ?? contract.title ?? "Unnamed counterparty"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {contract.contract_number ?? "No number"} · {CONTRACT_STATUS_LABEL[contract.status] ?? contract.status}
              {" · "}
              {formatContractValue(contract.value_amount, contract.currency)}
              {contract.execution_date ? ` · signed ${new Date(contract.execution_date).toLocaleDateString()}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {activated ? (
                <Badge className="text-[10px]">
                  <Lock className="mr-1 h-3 w-3" /> Revenue recorded once
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  Awaiting activation
                </Badge>
              )}
              {contract.documents.some((d) => d.document_type === "executed") && (
                <Badge variant="outline" className="text-[10px]">
                  Signed copy on file
                </Badge>
              )}
              {contract.is_test && (
                <Badge variant="outline" className="text-[10px]">
                  Test
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {contract.account_id && (
              <Button size="sm" variant="ghost" onClick={() => navigate(`/staff/customers/accounts`)}>
                Account
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
              {open ? "Close" : "Execution"} <ChevronDown className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {open && (
          <div className="space-y-4 rounded-md border bg-muted/30 p-4">
            {activated ? (
              <p className="text-xs text-muted-foreground">
                This contract is activated. Its value is locked to the revenue entry already posted; corrections are
                made through an amendment so the history stays intact.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Contract value</Label>
                    <Input
                      inputMode="decimal"
                      value={draft.value_amount}
                      onChange={(e) => set("value_amount", e.target.value)}
                      placeholder="Agreed amount"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Currency</Label>
                    <Input
                      value={draft.currency}
                      maxLength={3}
                      onChange={(e) => set("currency", e.target.value.toUpperCase())}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Value type</Label>
                    <Select value={draft.value_type} onValueChange={(v) => set("value_type", v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTRACT_VALUE_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Revenue month</Label>
                    <Input type="month" value={draft.revenue_period} onChange={(e) => set("revenue_period", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Date signed</Label>
                    <Input type="date" value={draft.execution_date} onChange={(e) => set("execution_date", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Customer signature date</Label>
                    <Input type="date" value={draft.signature_date} onChange={(e) => set("signature_date", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Signed for the customer by</Label>
                    <Input
                      value={draft.customer_signatory}
                      onChange={(e) => set("customer_signatory", e.target.value)}
                      placeholder="Full name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Signed for TaxiD by</Label>
                    <Input
                      value={draft.company_signatory}
                      onChange={(e) => set("company_signatory", e.target.value)}
                      placeholder="Full name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Billing frequency</Label>
                    <Input
                      value={draft.billing_frequency}
                      onChange={(e) => set("billing_frequency", e.target.value)}
                      placeholder="e.g. monthly in arrears"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Service start</Label>
                    <Input type="date" value={draft.term_start} onChange={(e) => set("term_start", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Service end</Label>
                    <Input type="date" value={draft.term_end} onChange={(e) => set("term_end", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Payment terms</Label>
                    <Input
                      value={draft.payment_terms}
                      onChange={(e) => set("payment_terms", e.target.value)}
                      placeholder="e.g. 14 days from invoice"
                    />
                  </div>
                </div>

                {gate?.variance_pct != null && Math.abs(gate.variance_pct) > 10 && (
                  <div className="space-y-1">
                    <Label className="text-xs">
                      Why the value differs from the opportunity by {gate.variance_pct}%
                    </Label>
                    <Textarea
                      value={draft.variance_reason}
                      onChange={(e) => set("variance_reason", e.target.value)}
                      placeholder="Explain the change agreed with the customer"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={save} disabled={busy !== null}>
                    {busy === "save" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Save details
                  </Button>
                  <label className="inline-flex">
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload(f, "executed");
                        e.target.value = "";
                      }}
                    />
                    <Button size="sm" variant="outline" asChild disabled={busy !== null}>
                      <span>
                        {busy === "executed" ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Upload signed contract
                      </span>
                    </Button>
                  </label>
                  <label className="inline-flex">
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.png,.jpg,.jpeg,.eml,.msg"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload(f, "acceptance_evidence");
                        e.target.value = "";
                      }}
                    />
                    <Button size="sm" variant="outline" asChild disabled={busy !== null}>
                      <span>
                        {busy === "acceptance_evidence" ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Upload acceptance
                      </span>
                    </Button>
                  </label>
                </div>
              </>
            )}

            <div className="rounded-md border bg-background p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                <ShieldCheck className="h-3.5 w-3.5" /> Activation requirements
              </p>
              {gate ? <GateList gate={gate} /> : <p className="text-xs text-muted-foreground">Checking…</p>}
              {gate && !activated && (
                <Button className="mt-3" size="sm" onClick={activate} disabled={!gate.can_activate || busy !== null}>
                  {busy === "activate" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Mark as contracted &amp; record revenue
                </Button>
              )}
            </div>

            {!activated && (
              <>
                <StageMover contract={contract} onChanged={onChanged} />
                <AcceptanceForm contract={contract} onChanged={onChanged} />
              </>
            )}

            {activated && <AmendmentForm contract={contract} onChanged={onChanged} />}

            <AmendmentHistory amendments={contract.amendments ?? []} />

            {(contract.tasks?.length ?? 0) > 0 && (
              <div className="rounded-md border bg-background p-3">
                <p className="mb-1.5 text-xs font-semibold">Open tasks on this contract</p>
                {contract.tasks?.map((t) => (
                  <p key={t.work_item_id} className="text-xs text-muted-foreground">
                    {t.title}
                    {t.due_at ? ` — due ${new Date(t.due_at).toLocaleDateString()}` : ""}
                  </p>
                ))}
              </div>
            )}

            {(contract.timeline?.length ?? 0) > 0 && (
              <div className="rounded-md border bg-background p-3">
                <p className="mb-1.5 text-xs font-semibold">History</p>
                <ul className="space-y-1">
                  {contract.timeline?.slice(0, 8).map((e, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleDateString()} · {e.event_type.replace(/_/g, " ").toLowerCase()}
                      {e.to_status ? ` → ${CONTRACT_STATUS_LABEL[e.to_status] ?? e.to_status}` : ""}
                      {e.reason ? ` — ${e.reason}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {contract.documents.length > 0 && (
              <div className="text-xs text-muted-foreground">
                On file:{" "}
                {contract.documents
                  .map((d) => `${d.document_type.replace(/_/g, " ")} v${d.version}`)
                  .join(" · ")}
              </div>
            )}
            {contract.revenue.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Revenue recorded:{" "}
                {contract.revenue
                  .map((r) => `${formatContractValue(r.amount, r.currency)} (${r.revenue_period})`)
                  .join(" · ")}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ContractExecutionPanel() {
  const [loading, setLoading] = React.useState(true);
  const [items, setItems] = React.useState<ContractRecord[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [centre, setCentre] = React.useState<ContractControlCentre | null>(null);

  const load = React.useCallback(async () => {
    const [book, cc] = await Promise.all([fetchMyContractBook(), fetchContractControlCentre()]);
    if (!book || book.ok === false) {
      setError(book && "error" in book ? String(book.error) : "Contracts are not released to your account");
      setItems([]);
    } else {
      setError(null);
      setItems(book.items ?? []);
    }
    setCentre(cc && "pipeline" in cc && cc.ok ? (cc as ContractControlCentre) : null);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading your contracts…
      </div>
    );
  }

  const mine = (
    <div className="space-y-4">
      {centre && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileSignature className="h-4 w-4" /> Contract control centre
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Awaiting signature", String(centre.awaiting_signature)],
                ["Signed, not yet counted", String(centre.executed_pending_activation)],
                ["Value waiting on activation", formatContractValue(centre.revenue_pending_activation, "KES")],
                ["Contracted this month", formatContractValue(centre.contracted_revenue_month, "KES")],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>
            {Object.entries(centre.health).some(([, n]) => n > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(centre.health)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => (
                    <Badge key={k} variant="secondary" className="text-[10px]">
                      {HEALTH_LABEL[k] ?? k}: {n}
                    </Badge>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-8 text-center">
            <p className="text-sm font-semibold">Contract data is not released to your account</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      )}

      {!error && items.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm font-semibold">No contracts are attributed to you</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              A contract appears here as soon as it is raised against one of your accounts. You then record the value
              and signatures, file the signed copy, and mark it contracted.
            </p>
          </CardContent>
        </Card>
      )}

      {items.map((c) => (
        <ContractCard key={c.contract_id} contract={c} onChanged={load} />
      ))}
    </div>
  );

  return (
    <Tabs defaultValue="mine" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="mine">My contracts</TabsTrigger>
          {centre && <TabsTrigger value="dashboard">Contracts dashboard</TabsTrigger>}
          <TabsTrigger value="control">Control centre</TabsTrigger>
          <TabsTrigger value="finance">Finance reconciliation</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline value</TabsTrigger>
        </TabsList>
        <CreateContractDialog onCreated={load} />
      </div>
      <TabsContent value="mine">{mine}</TabsContent>
      {centre && (
        <TabsContent value="dashboard">
          <ContractsManagerDashboard />
        </TabsContent>
      )}
      <TabsContent value="control">
        <ContractControlCentrePanel />
      </TabsContent>
      <TabsContent value="finance">
        <RevenueReconciliationPanel />
      </TabsContent>
      <TabsContent value="pipeline">
        <PipelineValuePanel />
      </TabsContent>
    </Tabs>
  );
}
