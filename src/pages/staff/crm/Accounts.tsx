import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, CalendarClock, MessageSquare, Users } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import * as crm from "@/lib/crm/api";
import { ACCOUNT_IMPORTANCE_TIERS, ACCOUNT_SIZE_BANDS, CONTACT_ROLES, INTERACTION_TYPES, titleise } from "@/lib/crm/types";
import type { ContactRole, InteractionType } from "@/lib/crm/types";
import * as org from "@/lib/staff/org/api";
import FulfilmentJourneyPanel from "@/components/staff/crm/FulfilmentJourneyPanel";


const STAGE_TONE: Record<string, string> = {
  won: "bg-success/10 text-success border-success/30",
  lost: "bg-destructive/10 text-destructive border-destructive/30",
  negotiation: "bg-warning/10 text-warning-foreground border-warning/30",
};

function StageBadge({ stage }: { stage: string }) {
  return (
    <Badge variant="outline" className={STAGE_TONE[stage] ?? "border-border text-muted-foreground"}>
      {titleise(stage)}
    </Badge>
  );
}

/**
 * Account 360 — the commercial relationship surface. Accounts hold
 * relationship state; opportunities, work items and transactions stay in the
 * existing spine and are only referenced here.
 */
export default function CrmAccounts() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const accountsQ = useQuery({ queryKey: ["crm", "accounts"], queryFn: crm.listAccounts });
  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });

  const accounts = accountsQ.data ?? [];
  const staff = staffQ.data ?? [];
  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0] ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      [a.name, a.account_ref, a.industry ?? "", a.city ?? "", a.lifecycle_stage].join(" ").toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const create = useMutation({
    mutationFn: crm.createAccount,
    onSuccess: (row) => {
      toast.success(`Account ${row.account_ref} created`);
      setSelectedId(row.id);
      qc.invalidateQueries({ queryKey: ["crm", "accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminOnly roles={["admin", "super_admin", "operations_admin", "operations_manager", "compliance_admin", "finance_admin"]}>
      <StaffPageHeader
        eyebrow="Commercial"
        title="Account 360"
        lede="Customer relationship state — accounts, contacts, unified timeline and next actions. Execution stays in work items; revenue stays in the transaction spine."
        actions={<NewAccountDialog onSubmit={(v) => create.mutate(v)} pending={create.isPending} staff={staff} />}
      />

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr] px-6 pb-10">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Accounts ({accounts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Search accounts…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {accountsQ.isLoading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No accounts yet. Create the first commercial account to begin the chain.
              </p>
            ) : (
              <ul className="space-y-1 max-h-[32rem] overflow-y-auto">
                {filtered.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                        selected?.id === a.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <span className="block text-sm font-medium">{a.name}</span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">{a.account_ref}</span>
                        <StageBadge stage={a.lifecycle_stage} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {selected ? <AccountDetail accountId={selected.id} /> : (
          <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">
            Select an account to open its 360 view.
          </CardContent></Card>
        )}
      </div>
    </AdminOnly>
  );
}

function NewAccountDialog({
  onSubmit, pending, staff,
}: {
  onSubmit: (v: crm.NewAccount) => void;
  pending: boolean;
  staff: { id: string; full_name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<crm.NewAccount>({ name: "", country: "KE", size_band: "unknown", lifecycle_stage: "prospect", importance_tier: "standard", source: "outbound" });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New account</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New commercial account</DialogTitle>
          <DialogDescription>Relationship state only — no revenue is implied by creating an account.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="acc-name">Company name</Label>
            <Input id="acc-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="acc-industry">Industry</Label>
              <Input id="acc-industry" value={form.industry ?? ""} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="acc-city">City</Label>
              <Input id="acc-city" value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Size band</Label>
              <Select value={form.size_band} onValueChange={(v) => setForm({ ...form, size_band: v as crm.NewAccount["size_band"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ACCOUNT_SIZE_BANDS.map((s) => <SelectItem key={s} value={s}>{titleise(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Importance</Label>
              <Select value={form.importance_tier} onValueChange={(v) => setForm({ ...form, importance_tier: v as crm.NewAccount["importance_tier"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ACCOUNT_IMPORTANCE_TIERS.map((s) => <SelectItem key={s} value={s}>{titleise(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Owning employee</Label>
            <Select value={form.owner_staff_id ?? ""} onValueChange={(v) => setForm({ ...form, owner_staff_id: v })}>
              <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || form.name.trim().length < 2}
            onClick={() => { onSubmit(form); setOpen(false); }}
          >
            Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountDetail({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const accountQ = useQuery({ queryKey: ["crm", "account", accountId], queryFn: () => crm.getAccount(accountId) });
  const contactsQ = useQuery({ queryKey: ["crm", "contacts", accountId], queryFn: () => crm.listContacts(accountId) });
  const timelineQ = useQuery({ queryKey: ["crm", "interactions", accountId], queryFn: () => crm.listInteractions(accountId) });
  const actionsQ = useQuery({ queryKey: ["crm", "next-actions", accountId], queryFn: () => crm.listNextActions(accountId) });
  const oppsQ = useQuery({ queryKey: ["crm", "opps", accountId], queryFn: () => crm.listAccountOpportunities(accountId) });
  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });

  const account = accountQ.data;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["crm"] });

  const logInteraction = useMutation({
    mutationFn: crm.logInteraction,
    onSuccess: () => { toast.success("Interaction recorded"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addContact = useMutation({
    mutationFn: crm.createContact,
    onSuccess: () => { toast.success("Contact added"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addAction = useMutation({
    mutationFn: crm.createNextAction,
    onSuccess: (r) => { toast.success(`Next action created — work item ${r.workItemId.slice(0, 8)}`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (accountQ.isLoading || !account) return <Skeleton className="h-96 w-full" />;

  const contacts = contactsQ.data ?? [];
  const timeline = timelineQ.data ?? [];
  const actions = actionsQ.data ?? [];
  const opps = oppsQ.data ?? [];
  const staff = staffQ.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">{account.name}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-mono">{account.account_ref}</span> · {account.industry ?? "Industry not recorded"} ·{" "}
                {account.city ?? "—"}, {account.country}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StageBadge stage={account.lifecycle_stage} />
              <Badge variant="outline">{titleise(account.importance_tier)}</Badge>
              <Badge variant="outline">{titleise(account.size_band)}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4 text-sm">
          <Metric label="Contacts" value={contacts.length} />
          <Metric label="Interactions" value={timeline.length} />
          <Metric label="Open next actions" value={actions.filter((a) => a.status === "open").length} />
          <Metric label="Linked opportunities" value={opps.length} />
        </CardContent>
      </Card>

      <Tabs defaultValue="fulfilment">
        <TabsList>
          <TabsTrigger value="fulfilment">Fulfilment</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="actions">Next actions</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="fulfilment">
          <FulfilmentJourneyPanel
            accountId={accountId}
            accountName={account.name}
            ownerStaffId={account.owner_staff_id}
          />
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4">

          <LogInteractionForm
            pending={logInteraction.isPending}
            contacts={contacts}
            onSubmit={(v) => logInteraction.mutate({ account_id: accountId, ...v })}
          />
          {timeline.length === 0 ? (
            <EmptyRow icon={MessageSquare} text="No interactions recorded for this account yet." />
          ) : (
            <ul className="space-y-2">
              {timeline.map((i) => (
                <li key={i.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{titleise(i.interaction_type)}</Badge>
                    <span>{titleise(i.direction)}</span>
                    <span>·</span>
                    <span>{new Date(i.occurred_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium">{i.subject}</p>
                  {i.summary ? <p className="mt-1 text-sm text-muted-foreground">{i.summary}</p> : null}
                  {i.outcome ? <p className="mt-1 text-xs text-muted-foreground">Outcome: {i.outcome}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="contacts" className="space-y-4">
          <AddContactForm pending={addContact.isPending} onSubmit={(v) => addContact.mutate({ account_id: accountId, ...v })} />
          {contacts.length === 0 ? (
            <EmptyRow icon={Users} text="No contacts recorded. Add the primary contact and decision maker." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead><TableHead>Role</TableHead>
                  <TableHead>Title</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.full_name}</TableCell>
                    <TableCell><Badge variant="outline">{titleise(c.contact_role)}</Badge></TableCell>
                    <TableCell>{c.job_title ?? "—"}</TableCell>
                    <TableCell>{c.email ?? "—"}</TableCell>
                    <TableCell>{c.phone ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="actions" className="space-y-4">
          <AddNextActionForm
            pending={addAction.isPending}
            staff={staff}
            onSubmit={(v) => addAction.mutate({ accountId, ...v })}
          />
          {actions.length === 0 ? (
            <EmptyRow icon={CalendarClock} text="No next actions. Every commitment must exist as executable work." />
          ) : (
            <ul className="space-y-2">
              {actions.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Due {a.due_at ? new Date(a.due_at).toLocaleDateString() : "unscheduled"} · work item{" "}
                      <span className="font-mono">{a.work_item_id.slice(0, 8)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{titleise(a.priority)}</Badge>
                    <Badge variant="outline">{titleise(a.status)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="pipeline">
          {opps.length === 0 ? (
            <EmptyRow icon={Building2} text="No opportunity linked to this account yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead><TableHead>Title</TableHead>
                  <TableHead>Stage</TableHead><TableHead className="text-right">Pipeline value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opps.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.opportunity?.opportunity_ref ?? "—"}</TableCell>
                    <TableCell>{l.opportunity?.title ?? "—"}</TableCell>
                    <TableCell><StageBadge stage={l.opportunity?.stage ?? "unknown"} /></TableCell>
                    <TableCell className="text-right">
                      {l.opportunity?.expected_value_cents != null
                        ? `${l.opportunity.currency ?? "KES"} ${(l.opportunity.expected_value_cents / 100).toLocaleString()}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Pipeline value is expected value, not revenue. Revenue is only recognised in the transaction spine.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function EmptyRow({ icon: Icon, text }: { icon: typeof Users; text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
      <Icon className="mx-auto mb-2 h-5 w-5" />
      {text}
    </div>
  );
}

function LogInteractionForm({
  onSubmit, pending, contacts,
}: {
  onSubmit: (v: { interaction_type: InteractionType; subject: string; summary?: string; contact_id?: string | null }) => void;
  pending: boolean;
  contacts: { id: string; full_name: string }[];
}) {
  const [type, setType] = useState<InteractionType>("meeting");
  const [subject, setSubject] = useState("");
  const [summary, setSummary] = useState("");
  const [contactId, setContactId] = useState<string>("");

  return (
    <Card>
      <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Interaction type</Label>
          <Select value={type} onValueChange={(v) => setType(v as InteractionType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{INTERACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{titleise(t)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Contact</Label>
          <Select value={contactId} onValueChange={setContactId}>
            <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
            <SelectContent>{contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="int-subject">Subject</Label>
          <Input id="int-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="int-summary">What actually happened</Label>
          <Textarea id="int-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Button
            size="sm"
            disabled={pending || subject.trim().length < 3}
            onClick={() => {
              onSubmit({ interaction_type: type, subject, summary: summary || undefined, contact_id: contactId || null });
              setSubject(""); setSummary("");
            }}
          >
            Record interaction
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddContactForm({
  onSubmit, pending,
}: {
  onSubmit: (v: { full_name: string; contact_role: ContactRole; job_title?: string; email?: string; phone?: string }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<ContactRole>("primary");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  return (
    <Card>
      <CardContent className="grid gap-3 pt-6 sm:grid-cols-5">
        <div className="grid gap-1.5"><Label htmlFor="c-name">Name</Label>
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as ContactRole)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CONTACT_ROLES.map((r) => <SelectItem key={r} value={r}>{titleise(r)}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="grid gap-1.5"><Label htmlFor="c-title">Job title</Label>
          <Input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="c-email">Email</Label>
          <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="c-phone">Phone</Label>
          <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="sm:col-span-5">
          <Button
            size="sm"
            disabled={pending || name.trim().length < 2}
            onClick={() => {
              onSubmit({ full_name: name, contact_role: role, job_title: title || undefined, email: email || undefined, phone: phone || undefined });
              setName(""); setTitle(""); setEmail(""); setPhone("");
            }}
          >
            Add contact
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddNextActionForm({
  onSubmit, pending, staff,
}: {
  onSubmit: (v: { staffId: string; title: string; dueAt?: string | null; priority?: "low" | "medium" | "high" | "critical" }) => void;
  pending: boolean;
  staff: { id: string; full_name: string }[];
}) {
  const [staffId, setStaffId] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");

  return (
    <Card>
      <CardContent className="grid gap-3 pt-6 sm:grid-cols-4">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="na-title">Next action</Label>
          <Input id="na-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Send rate card to procurement" />
        </div>
        <div className="grid gap-1.5">
          <Label>Owner</Label>
          <Select value={staffId} onValueChange={setStaffId}>
            <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="na-due">Due</Label>
          <Input id="na-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Priority</Label>
          <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["low", "medium", "high", "critical"] as const).map((p) => (
                <SelectItem key={p} value={p}>{titleise(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-4 flex items-center gap-3">
          <Button
            size="sm"
            disabled={pending || !staffId || title.trim().length < 3}
            onClick={() => {
              onSubmit({ staffId, title, dueAt: due ? new Date(due).toISOString() : null, priority });
              setTitle(""); setDue("");
            }}
          >
            Create next action + work item
          </Button>
          <span className="text-xs text-muted-foreground">
            A next action always creates a matching work item, so CRM state can never drift from execution.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
