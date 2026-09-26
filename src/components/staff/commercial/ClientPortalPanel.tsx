/**
 * CLIENT PORTAL & ONBOARDING CLOSURE — issue a client link for a contract, watch
 * whether the client opened and accepted it, and close onboarding.
 *
 * Nothing is decided here: the database issues the token, records acceptance and
 * — when onboarding completes — posts revenue once and moves the account live.
 */
import * as React from "react";
import { CheckCircle2, Copy, Link2, Loader2, PlayCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useStaffAccess } from "@/components/staff/StaffAccessProvider";
import { fetchMyContractBook, type ContractRecord, CONTRACT_STATUS_LABEL } from "@/lib/commercial/contractExecution";
import {
  completeContractOnboarding,
  createPortalInvite,
  fetchOnboardingTasks,
  fetchPortalInvites,
  revokePortalInvite,
  type OnboardingTaskRow,
  type PortalInviteRow,
} from "@/lib/commercial/clientPortal";

export default function ClientPortalPanel() {
  const { identity } = useStaffAccess();
  const [loading, setLoading] = React.useState(true);
  const [contracts, setContracts] = React.useState<ContractRecord[]>([]);
  const [invites, setInvites] = React.useState<PortalInviteRow[]>([]);
  const [tasks, setTasks] = React.useState<OnboardingTaskRow[]>([]);
  const [contractId, setContractId] = React.useState<string>("");
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const book = (await fetchMyContractBook()) as { ok: boolean; items?: ContractRecord[] };
    const items = book?.items ?? [];
    setContracts(items);
    const [inv, tk] = await Promise.all([
      fetchPortalInvites(items.map((c) => c.contract_id)),
      identity?.staffId ? fetchOnboardingTasks(identity.staffId) : Promise.resolve([]),
    ]);
    setInvites(inv);
    setTasks(tk);
    setLoading(false);
  }, [identity?.staffId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const openContracts = contracts.filter((c) => !c.activated_at);
  const contractLabel = (c: ContractRecord) =>
    `${c.contract_number ?? "Unnumbered"} · ${c.customer ?? "Customer not recorded"} · ${
      CONTRACT_STATUS_LABEL[c.status] ?? c.status
    }`;

  async function issue() {
    if (!contractId) {
      toast.error("Choose the contract to send");
      return;
    }
    setBusy("issue");
    const res = await createPortalInvite({ contractId, email: email.trim() || undefined, name: name.trim() || undefined });
    setBusy(null);
    if (!res.ok || !res.path) {
      toast.error(res.error ?? "The link could not be created");
      return;
    }
    const url = `${window.location.origin}${res.path}`;
    setIssued(url);
    await navigator.clipboard.writeText(url).catch(() => undefined);
    toast.success("Client link created and copied");
    void load();
  }

  async function complete(task: OnboardingTaskRow) {
    setBusy(task.work_item_id);
    const res = await completeContractOnboarding(task.work_item_id, "Onboarding completed");
    setBusy(null);
    if (!res.ok) {
      toast.error(
        res.error === "ACTIVATION_BLOCKED"
          ? "The contract still has missing execution details, so revenue cannot be recorded yet."
          : res.error ?? "Onboarding could not be closed",
      );
      return;
    }
    toast.success(`${res.contract_number ?? "Contract"} is now active and its revenue is recorded`);
    void load();
  }

  const inviteState = (i: PortalInviteRow) =>
    i.completed_at
      ? { label: "Signed copy received", variant: "default" as const }
      : i.revoked_at
        ? { label: "Withdrawn", variant: "outline" as const }
        : new Date(i.expires_at) < new Date()
          ? { label: "Expired", variant: "outline" as const }
          : i.opened_at
            ? { label: "Opened by client", variant: "secondary" as const }
            : { label: "Sent, not opened", variant: "secondary" as const };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" /> Client signing portal
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Send the client a private link. They upload their signed copy and confirm acceptance themselves, which
            marks the contract signed and opens your onboarding task — no admin step in between.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading your contracts…
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <Label>Contract</Label>
                  <Select value={contractId} onValueChange={setContractId}>
                    <SelectTrigger>
                      <SelectValue placeholder={openContracts.length ? "Choose a contract" : "No contract is awaiting signature"} />
                    </SelectTrigger>
                    <SelectContent>
                      {openContracts.map((c) => (
                        <SelectItem key={c.contract_id} value={c.contract_id}>
                          {contractLabel(c)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="portal-invite-name">Client contact name</Label>
                  <Input id="portal-invite-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="portal-invite-email">Client email</Label>
                  <Input
                    id="portal-invite-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={issue} disabled={busy === "issue"} className="w-full">
                    {busy === "issue" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create client link
                  </Button>
                </div>
              </div>

              {issued && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3">
                  <code className="min-w-0 flex-1 truncate text-xs">{issued}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(issued);
                      toast.success("Link copied");
                    }}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                  </Button>
                </div>
              )}

              {invites.length > 0 && (
                <div className="space-y-2">
                  {invites.map((i) => {
                    const state = inviteState(i);
                    const contract = contracts.find((c) => c.contract_id === i.contract_id);
                    return (
                      <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {contract?.customer ?? "Customer"} · {contract?.contract_number ?? "Contract"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {i.recipient_email ?? "No email recorded"} · expires{" "}
                            {new Date(i.expires_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={state.variant} className="text-[10px]">
                            {state.label}
                          </Badge>
                          {!i.completed_at && !i.revoked_at && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                const res = await revokePortalInvite(i.id);
                                if (!res.ok) toast.error(res.error ?? "Could not withdraw the link");
                                else {
                                  toast.success("Link withdrawn");
                                  void load();
                                }
                              }}
                            >
                              Withdraw
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PlayCircle className="h-4 w-4" /> Onboarding closure
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Completing onboarding records the contract revenue once and moves the account to Active, so the pipeline
            updates itself.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No contract is waiting for onboarding.</p>
          ) : (
            tasks.map((t) => (
              <div key={t.work_item_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.entity_ref ?? "Contract"}
                    {t.due_at ? ` · due ${new Date(t.due_at).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <Button size="sm" onClick={() => void complete(t)} disabled={busy === t.work_item_id}>
                  {busy === t.work_item_id ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Onboarding complete
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
