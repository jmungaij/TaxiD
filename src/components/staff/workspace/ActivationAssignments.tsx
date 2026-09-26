/**
 * WHO AND WHAT IS ON EACH ACTIVATED CONTRACT.
 *
 * The activation plan sets the start date and the onboarding owner. This board
 * records the people and vehicles actually assigned, with their dates, and sets
 * them beside the service really delivered and the invoice position — so a plan
 * can be compared with what happened rather than assumed.
 */
import * as React from "react";
import { CalendarClock, Loader2, Plus, RefreshCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ASSIGNMENT_ROLES,
  ASSIGNMENT_ROLE_LABEL,
  ASSIGNMENT_STATUSES,
  loadActivationBoard,
  loadActivationFleet,
  seedActivationFromContract,
  upsertAssignment,
  type ActivationBoard,
  type ActivationContract,
  type ActivationFleet,
  type AssignmentRole,
  type AssignmentStatus,
} from "@/lib/sales/activationBoard";

const today = () => new Date().toISOString().slice(0, 10);

function AddAssignment({
  contract,
  colleagues,
  fleet,
  onDone,
}: {
  contract: ActivationContract;
  colleagues: { staff_id: string; full_name: string | null }[];
  fleet: ActivationFleet | null;
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [role, setRole] = React.useState<AssignmentRole>("COORDINATOR");
  const [colleague, setColleague] = React.useState<string>("");
  const [person, setPerson] = React.useState("");
  const [driverId, setDriverId] = React.useState("");
  const [vehicleId, setVehicleId] = React.useState("");
  const [start, setStart] = React.useState(contract.term_start?.slice(0, 10) ?? today());
  const [end, setEnd] = React.useState(contract.term_end?.slice(0, 10) ?? "");
  const [busy, setBusy] = React.useState(false);

  const isVehicle = role === "VEHICLE";
  const isDriver = role === "DRIVER";
  const termStart = contract.term_start?.slice(0, 10) ?? null;
  const termEnd = contract.term_end?.slice(0, 10) ?? null;
  const chosenDriver = (fleet?.drivers ?? []).find((d) => d.driver_id === driverId) ?? null;

  const submit = async () => {
    if (isVehicle ? !vehicleId : isDriver ? !driverId : !colleague && !person.trim()) {
      return toast.error(
        isVehicle
          ? "Choose the vehicle from the fleet register."
          : isDriver
            ? "Choose the driver from the driver register."
            : "Choose a colleague or type the person's name.",
      );
    }
    if (termStart && start && start < termStart) {
      return toast.error(`The contract term starts on ${termStart}, so nothing was recorded.`);
    }
    if (termEnd && end && end > termEnd) {
      return toast.error(`The contract term ends on ${termEnd}, so nothing was recorded.`);
    }
    if (start && end && end < start) return toast.error("The end date is before the start date.");
    if (chosenDriver?.licence_expiry && start && chosenDriver.licence_expiry < start) {
      return toast.error(
        `That driver's licence expires on ${chosenDriver.licence_expiry}, before this assignment starts.`,
      );
    }
    setBusy(true);
    try {
      await upsertAssignment({
        contractId: contract.contract_id,
        assignmentRole: role,
        staffMemberId: isVehicle || isDriver ? null : colleague || null,
        driverId: isDriver ? driverId : null,
        vehicleId: isVehicle ? vehicleId : null,
        personLabel: isVehicle || isDriver ? undefined : person.trim() || undefined,
        startDate: start || undefined,
        endDate: end || undefined,
        status: "ACTIVE",
      });
      toast.success("Assignment recorded.");
      setOpen(false);
      setPerson("");
      setDriverId("");
      setVehicleId("");
      setColleague("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nothing was recorded.");
    }
    setBusy(false);
  };


  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Assign staff or vehicle
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Assigned as</Label>
          <Select value={role} onValueChange={(v) => setRole(v as AssignmentRole)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSIGNMENT_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ASSIGNMENT_ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isVehicle ? (
          <div className="space-y-1">
            <Label className="text-xs">Vehicle</Label>
            {(fleet?.vehicles ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No vehicle is on the fleet register yet, so none can be assigned.
              </p>
            ) : (
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {(fleet?.vehicles ?? []).map((v) => (
                    <SelectItem key={v.vehicle_id} value={v.vehicle_id}>
                      {v.label ?? "Registration not recorded"}
                      {v.description ? ` · ${v.description}` : ""}
                      {v.seating_capacity ? ` · ${v.seating_capacity} seats` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : isDriver ? (
          <div className="space-y-1">
            <Label className="text-xs">Driver</Label>
            {(fleet?.drivers ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No active driver is on the driver register yet, so none can be assigned.
              </p>
            ) : (
              <>
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a driver" />
                  </SelectTrigger>
                  <SelectContent>
                    {(fleet?.drivers ?? []).map((d) => (
                      <SelectItem key={d.driver_id} value={d.driver_id}>
                        {d.label || "Name not recorded"}
                        {d.driver_code ? ` · ${d.driver_code}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chosenDriver && (
                  <p className="text-xs text-muted-foreground">
                    {chosenDriver.licence_number
                      ? `Licence ${chosenDriver.licence_number}${chosenDriver.licence_expiry ? ` · expires ${chosenDriver.licence_expiry}` : ""}`
                      : "No licence recorded on this driver yet."}
                  </p>
                )}
              </>
            )}
          </div>

        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Colleague</Label>
              <Select value={colleague} onValueChange={setColleague}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a colleague" />
                </SelectTrigger>
                <SelectContent>
                  {colleagues.map((c) => (
                    <SelectItem key={c.staff_id} value={c.staff_id}>
                      {c.full_name ?? "Unnamed colleague"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`per-${contract.contract_id}`} className="text-xs">
                Or type a name
              </Label>
              <Input
                id={`per-${contract.contract_id}`}
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                placeholder="For someone who is not on the staff register"
              />
            </div>
          </>
        )}
        <div className="space-y-1">
          <Label htmlFor={`st-${contract.contract_id}`} className="text-xs">
            From
          </Label>
          <Input
            id={`st-${contract.contract_id}`}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`en-${contract.contract_id}`} className="text-xs">
            Until (optional)
          </Label>
          <Input id={`en-${contract.contract_id}`} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />} Record assignment
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AssignmentRow({ contractId, a, onDone }: { contractId: string; a: ActivationBoard["contracts"][number]["assignments"][number]; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const setStatus = async (status: AssignmentStatus) => {
    setBusy(true);
    try {
      await upsertAssignment({ assignmentId: a.assignment_id, contractId, status });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The assignment was not changed.");
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">
          {ASSIGNMENT_ROLE_LABEL[a.assignment_role]} · {a.person ?? a.vehicle_label ?? "Not stated"}
        </p>
        <p className="text-xs text-muted-foreground">
          {a.start_date ? new Date(a.start_date).toLocaleDateString() : "no start date"} —{" "}
          {a.end_date ? new Date(a.end_date).toLocaleDateString() : "open ended"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={a.status === "ACTIVE" ? "default" : "secondary"} className="text-[10px]">
          {a.status.charAt(0) + a.status.slice(1).toLowerCase()}
        </Badge>
        <Select value={a.status} onValueChange={(v) => void setStatus(v as AssignmentStatus)} disabled={busy}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSIGNMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function ActivationAssignments() {
  const [board, setBoard] = React.useState<ActivationBoard | null>(null);
  const [fleet, setFleet] = React.useState<ActivationFleet | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [b, f] = await Promise.allSettled([loadActivationBoard(), loadActivationFleet()]);
      if (b.status === "rejected") throw b.reason;
      setBoard(b.value);
      setFleet(f.status === "fulfilled" ? f.value : null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Activation tracking could not be read.");
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading && !board) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading live contracts…
      </div>
    );
  }
  if (error) return <p className="py-4 text-sm text-destructive">{error}</p>;
  if (!board || board.contracts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm font-semibold">No live contracts to staff yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Once a contract is activated above, record the staff, vehicles and dates running it here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4" aria-hidden /> Staff, vehicles and dates on live contracts
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Refresh
        </Button>
      </div>
      {board.contracts.map((c) => (
        <Card key={c.contract_id}>
          <CardContent className="space-y-3 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{c.customer ?? "Unnamed customer"}</p>
                <p className="text-xs text-muted-foreground">
                  {c.contract_number ?? "No number"} ·{" "}
                  {c.value_amount ? `${c.currency ?? "KES"} ${c.value_amount.toLocaleString()}` : "value not recorded"}
                  {c.activated_at ? ` · live since ${new Date(c.activated_at).toLocaleDateString()}` : ""}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  {c.services_delivered} service{c.services_delivered === 1 ? "" : "s"} delivered
                  {c.services_failed > 0 ? ` · ${c.services_failed} did not go to plan` : ""}
                  {c.invoice
                    ? ` · invoice ${c.invoice.invoice_no ?? "draft"} (${c.invoice.status})`
                    : " · no invoice raised yet"}
                </p>
              </div>
            </div>
            {c.assignments.length > 0 && (
              <div className="space-y-1.5">
                {c.assignments.map((a) => (
                  <AssignmentRow key={a.assignment_id} contractId={c.contract_id} a={a} onDone={() => void load()} />
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <AddAssignment contract={c} colleagues={board.colleagues} fleet={fleet} onDone={() => void load()} />
              {c.assignments.length === 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await seedActivationFromContract(c.contract_id);
                      toast.success("The contract's own owner and dates are now on the board.");
                      void load();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Nothing was placed.");
                    }
                  }}
                >
                  Use the contract's owner and dates
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
