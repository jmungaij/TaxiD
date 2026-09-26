/**
 * ACTIVATION PLAN — pick a signed contract, set the service start date and the
 * onboarding owner, then hand it to the database.
 *
 * The page holds no commercial state: `contract_activation_plan` lists what may
 * be activated and what is still missing, and `contract_activation_plan_apply`
 * records the two chosen facts, posts the single revenue entry and opens the
 * onboarding task for the chosen owner in one atomic step.
 */
import * as React from "react";
import { AlertTriangle, CalendarCheck, CheckCircle2, Loader2, Rocket, UserCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  applyActivationPlan,
  CONTRACT_STATUS_LABEL,
  fetchActivationPlan,
  formatContractValue,
  type ActivationOwnerOption,
  type ActivationPlanContract,
} from "@/lib/commercial/contractExecution";
import { ActivationAssignments } from "@/components/staff/workspace/ActivationAssignments";
import { FleetRegisterPanel } from "@/components/staff/fleet/FleetRegisterPanel";


const today = () => new Date().toISOString().slice(0, 10);

const friendly = (code: string | undefined): string => {
  switch (code) {
    case "NOT_AUTHORISED":
      return "You can only activate contracts you own, unless you manage the commercial book.";
    case "NOT_AUTHENTICATED":
      return "Sign in again to see contracts waiting for activation.";
    case "SERVICE_START_REQUIRED":
      return "Choose the date service starts for the customer.";
    case "OWNER_REQUIRED":
    case "OWNER_NOT_FOUND":
      return "Choose the colleague who will run onboarding.";
    case "ACTIVATION_BLOCKED":
      return "Some details are still missing on this contract — they are listed on the card.";
    default:
      return code ?? "Something went wrong. Nothing was recorded.";
  }
};

interface DoneState {
  contract: string;
  amount: string;
  taskTitle: string | null;
  dueAt: string | null;
  ownerName: string | null;
}

function ContractRow({
  contract,
  owners,
  defaultOwner,
  onDone,
}: {
  contract: ActivationPlanContract;
  owners: ActivationOwnerOption[];
  defaultOwner: string | null;
  onDone: (d: DoneState) => void;
}) {
  const [selected, setSelected] = React.useState(false);
  const [serviceStart, setServiceStart] = React.useState(
    contract.effective_date ?? contract.term_start ?? contract.execution_date ?? today(),
  );
  const [owner, setOwner] = React.useState(contract.owner_staff_id ?? defaultOwner ?? "");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!serviceStart) return toast.error(friendly("SERVICE_START_REQUIRED"));
    if (!owner) return toast.error(friendly("OWNER_REQUIRED"));
    setBusy(true);
    const res = await applyActivationPlan({
      contractId: contract.contract_id,
      serviceStart,
      ownerStaffId: owner,
      reason: note || undefined,
    });
    setBusy(false);
    if (!res || res.ok === false) {
      toast.error(friendly(res && "error" in res ? String(res.error) : undefined));
      return;
    }
    if (res.already_activated) {
      toast.info("This contract was already activated — nothing was recorded twice.");
    } else {
      toast.success("Contract activated and onboarding task created.");
    }
    onDone({
      contract: contract.contract_number ?? contract.customer ?? "Contract",
      amount: formatContractValue(res.amount ?? contract.value_amount, res.currency ?? contract.currency),
      taskTitle: res.onboarding_task?.title ?? null,
      dueAt: res.onboarding_task?.due_at ?? null,
      ownerName: owners.find((o) => o.staff_id === owner)?.full_name ?? null,
    });
  };

  return (
    <Card className={selected ? "border-primary/50" : undefined}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{contract.customer ?? contract.title ?? "Unnamed customer"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {contract.contract_number ?? "No number"} · {CONTRACT_STATUS_LABEL[contract.status] ?? contract.status} ·{" "}
              {formatContractValue(contract.value_amount, contract.currency)}
              {contract.execution_date ? ` · signed ${new Date(contract.execution_date).toLocaleDateString()}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {contract.can_activate ? (
                <Badge className="text-[10px]">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Ready to activate
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  {contract.blockers.length} item{contract.blockers.length === 1 ? "" : "s"} outstanding
                </Badge>
              )}
              {contract.owner_name && (
                <Badge variant="outline" className="text-[10px]">
                  Owner {contract.owner_name}
                </Badge>
              )}
              {contract.is_test && (
                <Badge variant="outline" className="text-[10px]">
                  Test
                </Badge>
              )}
            </div>
          </div>
          <Button size="sm" variant={selected ? "outline" : "default"} onClick={() => setSelected((v) => !v)}>
            {selected ? "Close" : "Plan activation"}
          </Button>
        </div>

        {selected && (
          <div className="space-y-4 rounded-md border bg-muted/30 p-4">
            {!contract.can_activate && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" /> Still needed before this contract can go live
                </p>
                <ul className="mt-1.5 space-y-1">
                  {contract.blockers.map((b, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      {b.label}
                      {b.detail ? ` — ${b.detail}` : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Add the missing details on the contract in My contracts, then come back here.
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Service starts on</Label>
                <Input type="date" value={serviceStart} onChange={(e) => setServiceStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Onboarding owner</Label>
                <Select value={owner} onValueChange={setOwner}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a colleague" />
                  </SelectTrigger>
                  <SelectContent>
                    {owners.map((o) => (
                      <SelectItem key={o.staff_id} value={o.staff_id}>
                        {o.full_name ?? "Unnamed colleague"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Note for the record (optional)</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything the onboarding owner should know — kickoff arrangements, billing contact, first booking."
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={submit} disabled={busy || !contract.can_activate}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Rocket className="mr-1.5 h-3.5 w-3.5" />}
                Activate &amp; create onboarding task
              </Button>
              <p className="text-xs text-muted-foreground">
                This records the value once and opens the onboarding task for the chosen owner.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ActivationPlan() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [contracts, setContracts] = React.useState<ActivationPlanContract[]>([]);
  const [owners, setOwners] = React.useState<ActivationOwnerOption[]>([]);
  const [myStaffId, setMyStaffId] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<DoneState[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetchActivationPlan();
    if (!res || res.ok === false) {
      setError(friendly(res && "error" in res ? String(res.error) : undefined));
      setContracts([]);
      setOwners([]);
    } else {
      setError(null);
      setContracts(res.contracts ?? []);
      setOwners(res.owners ?? []);
      setMyStaffId(res.my_staff_id ?? null);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const ready = contracts.filter((c) => c.can_activate).length;

  return (
    <div className="space-y-5">
      <header className="hero-band px-6 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">My workspace</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Activation plan</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-85">
          Choose a signed contract, set the date service starts and who runs onboarding. Activating records the contract
          value once and opens the onboarding task automatically.
          {contracts.length > 0 ? ` ${ready} of ${contracts.length} are ready to activate.` : ""}
        </p>
      </header>

      {done.length > 0 && (
        <Card className="border-primary/40">
          <CardContent className="space-y-2 pt-5">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <CalendarCheck className="h-4 w-4" /> Activated in this session
            </p>
            {done.map((d, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {d.contract} · {d.amount}
                {d.taskTitle ? ` · task created: ${d.taskTitle}` : ""}
                {d.ownerName ? ` · owner ${d.ownerName}` : ""}
                {d.dueAt ? ` · due ${new Date(d.dueAt).toLocaleDateString()}` : ""}
              </p>
            ))}
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Refresh list
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading contracts waiting for activation…
        </div>
      )}

      {!loading && error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-8 text-center">
            <p className="text-sm font-semibold">Activation is not available for your account</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && contracts.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm font-semibold">No contracts are waiting for activation</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              A contract appears here once it exists in your book and has not been activated. Raise or progress one in My
              contracts.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading &&
        !error &&
        contracts.map((c) => (
          <ContractRow
            key={c.contract_id}
            contract={c}
            owners={owners}
            defaultOwner={myStaffId}
            onDone={(d) => {
              setDone((prev) => [d, ...prev]);
              setContracts((prev) => prev.filter((x) => x.contract_id !== c.contract_id));
            }}
          />
        ))}

      {!loading && !error && <ActivationAssignments />}

      {!loading && !error && <FleetRegisterPanel />}


      {!loading && !error && owners.length === 0 && contracts.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <UserCheck className="h-3.5 w-3.5" /> No colleagues are available to own onboarding yet.
        </p>
      )}
    </div>
  );
}
