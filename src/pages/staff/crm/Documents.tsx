import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText, Plus, ShieldCheck, Send, History, Download, Copy, Archive,
} from "lucide-react";
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

import * as docs from "@/lib/crm/documents";
import type { CrmDocument, DocClass } from "@/lib/crm/documents";
import * as crm from "@/lib/crm/api";
import * as org from "@/lib/staff/org/api";
import { AppButton } from "@/components/nav/AppButton";

const STATE_TONE: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning-foreground border-warning/30",
  muted: "bg-muted text-muted-foreground border-border",
  neutral: "border-border text-muted-foreground",
};

function StateBadge({ state }: { state: docs.DocInternalState }) {
  return (
    <Badge variant="outline" className={STATE_TONE[docs.documentStateTone(state)]}>
      {docs.titleiseDoc(state)}
    </Badge>
  );
}

/**
 * Document OS — master templates, customer instances, immutable versions,
 * approval decisions and the exact artefact shared with each contact.
 */
export default function CrmDocuments() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<DocClass | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const documentsQ = useQuery({ queryKey: ["crm", "documents"], queryFn: () => docs.listDocuments() });
  const accountsQ = useQuery({ queryKey: ["crm", "accounts"], queryFn: crm.listAccounts });
  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });

  const documents = documentsQ.data ?? [];
  const accounts = accountsQ.data ?? [];
  const staff = staffQ.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((d) => {
      if (classFilter !== "all" && d.doc_class !== classFilter) return false;
      if (!q) return true;
      return [d.title, d.doc_type, d.internal_state, d.external_state ?? ""].join(" ").toLowerCase().includes(q);
    });
  }, [documents, search, classFilter]);

  const selected = filtered.find((d) => d.id === selectedId) ?? filtered[0] ?? null;
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "—";

  const create = useMutation({
    mutationFn: docs.createDocument,
    onSuccess: (row) => {
      toast.success(`${docs.titleiseDoc(row.doc_class)} "${row.title}" registered`);
      setSelectedId(row.id);
      qc.invalidateQueries({ queryKey: ["crm", "documents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const instantiate = useMutation({
    mutationFn: docs.instantiateTemplate,
    onSuccess: (row) => {
      toast.success("Customer instance created from template");
      setSelectedId(row.id);
      qc.invalidateQueries({ queryKey: ["crm", "documents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: docs.archiveDocument,
    onSuccess: () => {
      toast.success("Document archived");
      qc.invalidateQueries({ queryKey: ["crm", "documents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminOnly roles={["admin", "super_admin", "operations_admin", "operations_manager", "compliance_admin", "finance_admin"]}>
      <StaffPageHeader
        eyebrow="Commercial"
        title="Document OS"
        lede="One register for master templates and customer instances. Versions are immutable, approvals carry a rationale, and every external share records the exact artefact sent."
        actions={
          <NewDocumentDialog
            accounts={accounts}
            staff={staff}
            pending={create.isPending}
            onSubmit={(v) => create.mutate(v)}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-[24rem_1fr] px-6 pb-10">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Register
            </CardTitle>
            <div className="space-y-2 pt-2">
              <Input placeholder="Search documents…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={classFilter} onValueChange={(v) => setClassFilter(v as DocClass | "all")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All documents</SelectItem>
                  <SelectItem value="master">Master templates</SelectItem>
                  <SelectItem value="customer_instance">Customer instances</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {documentsQ.isLoading ? (
              <>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No documents yet. Register a master template to begin.
              </p>
            ) : (
              filtered.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    selected?.id === d.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-sm">{d.title}</span>
                    <StateBadge state={d.internal_state} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {docs.titleiseDoc(d.doc_type)} · {docs.titleiseDoc(d.doc_class)}
                    {d.account_id ? ` · ${accountName(d.account_id)}` : ""}
                  </p>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {selected ? (
          <DocumentDetail
            document={selected}
            accounts={accounts}
            staff={staff}
            onInstantiate={(v) => instantiate.mutate(v)}
            instantiating={instantiate.isPending}
            onArchive={() => archive.mutate(selected.id)}
          />
        ) : (
          <Card>
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              Select a document to see its version history, approvals and share record.
            </CardContent>
          </Card>
        )}
      </div>
    </AdminOnly>
  );
}

/* ------------------------------ detail panel ----------------------------- */

function DocumentDetail({
  document, accounts, staff, onInstantiate, instantiating, onArchive,
}: {
  document: CrmDocument;
  accounts: { id: string; name: string }[];
  staff: { id: string; full_name?: string | null }[];
  onInstantiate: (v: { masterId: string; accountId: string; title: string; ownerStaffId?: string | null }) => void;
  instantiating: boolean;
  onArchive: () => void;
}) {
  const qc = useQueryClient();
  const versionsQ = useQuery({
    queryKey: ["crm", "documents", document.id, "versions"],
    queryFn: () => docs.listVersions(document.id),
  });
  const approvalsQ = useQuery({
    queryKey: ["crm", "documents", document.id, "approvals"],
    queryFn: () => docs.listApprovals(document.id),
  });
  const sharesQ = useQuery({
    queryKey: ["crm", "documents", document.id, "shares"],
    queryFn: () => docs.listShares(document.id),
  });
  const contactsQ = useQuery({
    queryKey: ["crm", "contacts", document.account_id],
    queryFn: () => crm.listContacts(document.account_id as string),
    enabled: Boolean(document.account_id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm", "documents"] });
  };

  const addVersion = useMutation({
    mutationFn: docs.createVersion,
    onSuccess: () => { toast.success("Version recorded"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: docs.decideVersion,
    onSuccess: (_id, vars) => {
      toast.success(vars.decision === "approved" ? "Version approved" : "Version sent back for revision");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const share = useMutation({
    mutationFn: docs.shareVersion,
    onSuccess: () => { toast.success("Share recorded and logged on the account timeline"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const versions = versionsQ.data ?? [];
  const current = versions[0] ?? null;
  const shareable = docs.canShareExternally(document);

  const download = async (path: string | null) => {
    if (!path) { toast.error("No file attached to this version"); return; }
    try {
      const url = await docs.signedDownloadUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">{document.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {docs.titleiseDoc(document.doc_type)} · {docs.titleiseDoc(document.doc_class)} ·{" "}
                {document.confidentiality}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge state={document.internal_state} />
              {document.external_state && (
                <Badge variant="outline" className="border-border text-muted-foreground">
                  External: {docs.titleiseDoc(document.external_state)}
                </Badge>
              )}
              {document.doc_class === "master" && (
                <InstantiateDialog
                  accounts={accounts}
                  staff={staff}
                  pending={instantiating}
                  onSubmit={(v) => onInstantiate({ ...v, masterId: document.id })}
                />
              )}
              <Button variant="outline" size="sm" onClick={onArchive} disabled={document.internal_state === "archived"}>
                <Archive className="h-4 w-4 mr-1" /> Archive
              </Button>
            </div>
          </div>
        </CardHeader>
        {document.description && (
          <CardContent className="pt-0 text-sm text-muted-foreground">{document.description}</CardContent>
        )}
      </Card>

      <Tabs defaultValue="versions">
        <TabsList>
          <TabsTrigger value="versions"><History className="h-4 w-4 mr-1" /> Versions</TabsTrigger>
          <TabsTrigger value="approvals"><ShieldCheck className="h-4 w-4 mr-1" /> Approvals</TabsTrigger>
          <TabsTrigger value="shares"><Send className="h-4 w-4 mr-1" /> Shared artefacts</TabsTrigger>
        </TabsList>

        <TabsContent value="versions" className="pt-4 space-y-4">
          <NewVersionCard pending={addVersion.isPending} onSubmit={(v) => addVersion.mutate({ documentId: document.id, ...v })} />
          <Card>
            <CardContent className="pt-6">
              {versionsQ.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : versions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No versions yet. Upload the first draft to start the immutable history.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Change note</TableHead>
                      <TableHead>Recorded</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium">{v.version_label}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{v.file_name ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[18rem] truncate">
                          {v.change_note ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(v.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right space-x-2 whitespace-nowrap">
                          <AppButton analytics="crm_document_version_download" action="submit" variant="ghost" size="sm" aria-label={`Download document version ${v.version_label}`} title={`Download document version ${v.version_label}`} onClick={() => download(v.storage_path)}>
                            <Download className="h-4 w-4" />
                          </AppButton>
                          <DecisionDialog
                            versionLabel={v.version_label}
                            pending={decide.isPending}
                            onSubmit={(d) => decide.mutate({ versionId: v.id, ...d })}
                          />
                          <ShareDialog
                            versionLabel={v.version_label}
                            disabled={!shareable}
                            contacts={contactsQ.data ?? []}
                            pending={share.isPending}
                            onSubmit={(s) => share.mutate({ versionId: v.id, ...s })}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {!shareable && current && (
                <p className="text-xs text-muted-foreground pt-3">
                  External sharing is blocked until a version is approved — governance rule, enforced in the database.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvals" className="pt-4">
          <Card>
            <CardContent className="pt-6 space-y-3">
              {(approvalsQ.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No approval decisions recorded.</p>
              ) : (
                (approvalsQ.data ?? []).map((a) => (
                  <div key={a.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {a.version?.version_label ?? "Version"} · {docs.titleiseDoc(a.decision)}
                      </span>
                      <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{a.rationale}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shares" className="pt-4">
          <Card>
            <CardContent className="pt-6 space-y-3">
              {(sharesQ.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Nothing has been shared externally.</p>
              ) : (
                (sharesQ.data ?? []).map((s) => (
                  <div key={s.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {s.version?.version_label ?? "Version"} → {s.recipient_email ?? "customer contact"}
                      </span>
                      <span className="text-xs text-muted-foreground">{new Date(s.shared_at).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Channel: {s.channel}
                      {s.note ? ` · ${s.note}` : ""}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* -------------------------------- dialogs -------------------------------- */

function NewVersionCard({
  pending, onSubmit,
}: { pending: boolean; onSubmit: (v: { file?: File | null; changeNote?: string | null }) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Record a new version</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="doc-file">File</Label>
          <Input id="doc-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="doc-note">Change note</Label>
          <Input id="doc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed and why" />
        </div>
        <Button
          disabled={pending}
          onClick={() => {
            onSubmit({ file, changeNote: note || null });
            setFile(null);
            setNote("");
          }}
        >
          <Plus className="h-4 w-4 mr-1" /> Add version
        </Button>
      </CardContent>
    </Card>
  );
}

function DecisionDialog({
  versionLabel, pending, onSubmit,
}: {
  versionLabel: string;
  pending: boolean;
  onSubmit: (v: { decision: "approved" | "rejected"; rationale: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [rationale, setRationale] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm"><ShieldCheck className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decide {versionLabel}</DialogTitle>
          <DialogDescription>Every decision is immutable and requires a rationale.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Decision</Label>
            <Select value={decision} onValueChange={(v) => setDecision(v as "approved" | "rejected")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Approve</SelectItem>
                <SelectItem value="rejected">Send back for revision</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rationale">Rationale</Label>
            <Textarea id="rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || rationale.trim().length < 5}
            onClick={() => { onSubmit({ decision, rationale }); setOpen(false); setRationale(""); }}
          >
            Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({
  versionLabel, disabled, contacts, pending, onSubmit,
}: {
  versionLabel: string;
  disabled: boolean;
  contacts: { id: string; full_name: string; email: string | null }[];
  pending: boolean;
  onSubmit: (v: { contactId?: string | null; recipientEmail?: string | null; note?: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState<string>("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled} title={disabled ? "Approve the document first" : "Share externally"}>
          <Send className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {versionLabel}</DialogTitle>
          <DialogDescription>
            The exact version shared is recorded permanently and appears on the account timeline.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Contact</Label>
            <Select
              value={contactId}
              onValueChange={(v) => {
                setContactId(v);
                setEmail(contacts.find((c) => c.id === v)?.email ?? "");
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select a contact" /></SelectTrigger>
              <SelectContent>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="share-email">Recipient email</Label>
            <Input id="share-email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="share-note">Note</Label>
            <Textarea id="share-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => {
              onSubmit({ contactId: contactId || null, recipientEmail: email || null, note: note || null });
              setOpen(false);
              setNote("");
            }}
          >
            Record share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewDocumentDialog({
  accounts, staff, pending, onSubmit,
}: {
  accounts: { id: string; name: string }[];
  staff: { id: string; full_name?: string | null }[];
  pending: boolean;
  onSubmit: (v: docs.NewDocument) => void;
}) {
  const [open, setOpen] = useState(false);
  const [docClass, setDocClass] = useState<DocClass>("master");
  const [docType, setDocType] = useState<string>("proposal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState("");
  const [ownerStaffId, setOwnerStaffId] = useState("");

  const valid = title.trim().length > 2 && (docClass === "master" || Boolean(accountId));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-1" /> Register document</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register a document</DialogTitle>
          <DialogDescription>
            Master templates are reusable and governed centrally. Customer instances belong to one account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select value={docClass} onValueChange={(v) => setDocClass(v as DocClass)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {docs.DOC_CLASSES.map((c) => (
                    <SelectItem key={c} value={c}>{docs.titleiseDoc(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {docs.DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{docs.titleiseDoc(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-title">Title</Label>
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {docClass === "customer_instance" && (
            <div className="space-y-1.5">
              <Label>Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Select an account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Owner</Label>
            <Select value={ownerStaffId} onValueChange={setOwnerStaffId}>
              <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.full_name ?? s.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-desc">Description</Label>
            <Textarea id="doc-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !valid}
            onClick={() => {
              onSubmit({
                docClass,
                docType,
                title: title.trim(),
                description: description || null,
                accountId: docClass === "customer_instance" ? accountId : null,
                ownerStaffId: ownerStaffId || null,
              });
              setOpen(false);
              setTitle("");
              setDescription("");
            }}
          >
            Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstantiateDialog({
  accounts, staff, pending, onSubmit,
}: {
  accounts: { id: string; name: string }[];
  staff: { id: string; full_name?: string | null }[];
  pending: boolean;
  onSubmit: (v: { accountId: string; title: string; ownerStaffId?: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [ownerStaffId, setOwnerStaffId] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Copy className="h-4 w-4 mr-1" /> Use template</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a customer instance</DialogTitle>
          <DialogDescription>Lineage back to the master template is preserved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Select an account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inst-title">Instance title</Label>
            <Input id="inst-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Owner</Label>
            <Select value={ownerStaffId} onValueChange={setOwnerStaffId}>
              <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.full_name ?? s.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !accountId || title.trim().length < 3}
            onClick={() => {
              onSubmit({ accountId, title: title.trim(), ownerStaffId: ownerStaffId || null });
              setOpen(false);
              setTitle("");
            }}
          >
            Create instance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
