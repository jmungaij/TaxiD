/**
 * ONBOARD AN ORGANISATION, AND KEEP ITS DOCUMENTS CURRENT
 *
 * One place for a corporate sales specialist to record the organisation being
 * sold to and to file its documents at any point in the conversation. Filing a
 * document again keeps the earlier copy, so the history of what was shared and
 * when stays intact.
 */
import * as React from "react";
import { Building2, Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import {
  ORG_DOC_CHECKLIST, ORG_DOC_LABEL, loadOrgOverview, orgDocumentUrl, outstandingDocuments,
  saveOrganisation, uploadOrgDocument, type OrgDocType, type OrgOverview,
} from "@/lib/sales/organisationOnboarding";

export interface OrganisationOnboardingDialogProps {
  leadId?: string | null;
  organisation: string;
  accountId?: string | null;
  onSaved?: () => void;
}

export function OrganisationOnboardingDialog({
  leadId, organisation, accountId, onSaved,
}: OrganisationOnboardingDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState<OrgDocType | null>(null);
  const [overview, setOverview] = React.useState<OrgOverview | null>(null);
  const [form, setForm] = React.useState({
    name: organisation, legalName: "", registrationNumber: "", taxIdentifier: "",
    industry: "", city: "", phone: "", website: "", notes: "",
  });

  const load = React.useCallback(async () => {
    try {
      const data = await loadOrgOverview({ leadId, accountId });
      setOverview(data);
      if (data.account) {
        setForm({
          name: data.account.name,
          legalName: data.account.legal_name ?? "",
          registrationNumber: data.account.registration_number ?? "",
          taxIdentifier: data.account.tax_identifier ?? "",
          industry: data.account.industry ?? "",
          city: data.account.city ?? "",
          phone: data.account.phone ?? "",
          website: data.account.website ?? "",
          notes: "",
        });
      }
    } catch (e) {
      toast({ title: "Could not open the organisation", description: (e as Error).message, variant: "destructive" });
    }
  }, [leadId, accountId]);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const account = overview?.account ?? null;
  const documents = overview?.documents ?? [];
  const missing = outstandingDocuments(documents);

  async function save() {
    setBusy(true);
    try {
      await saveOrganisation({ leadId, accountId: account?.id ?? accountId ?? null, ...form });
      toast({ title: "Organisation saved" });
      await load();
      onSaved?.();
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function upload(docType: OrgDocType, file: File) {
    if (!account?.id) {
      toast({ title: "Save the organisation first", description: "The document needs an organisation to sit against.", variant: "destructive" });
      return;
    }
    setUploading(docType);
    try {
      await uploadOrgDocument({
        accountId: account.id,
        docType,
        file,
        sharedWithCustomer: docType === "rate_card" || docType === "proforma_invoice" || docType === "service_contract",
      });
      toast({ title: `${ORG_DOC_LABEL[docType]} filed` });
      await load();
      onSaved?.();
    } catch (e) {
      toast({ title: "Not filed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setUploading(null);
    }
  }

  async function openFile(path: string) {
    const url = await orgDocumentUrl(path);
    if (url) window.open(url, "_blank", "noopener");
    else toast({ title: "Could not open that file", variant: "destructive" });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Building2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          Organisation &amp; documents
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Organisation and documents</DialogTitle>
          <DialogDescription>
            Record who you are selling to, then file their documents as they arrive. Filing again keeps
            the earlier copy.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="org-name">Organisation</Label>
            <Input id="org-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="org-legal">Registered legal name</Label>
            <Input id="org-legal" value={form.legalName} placeholder="As it appears on the certificate"
              onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="org-reg">Registration number</Label>
            <Input id="org-reg" value={form.registrationNumber}
              onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="org-pin">KRA PIN</Label>
            <Input id="org-pin" value={form.taxIdentifier}
              onChange={(e) => setForm({ ...form, taxIdentifier: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="org-industry">Industry</Label>
            <Input id="org-industry" value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="org-city">Town or city</Label>
            <Input id="org-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="org-phone">Telephone</Label>
            <Input id="org-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="org-web">Website</Label>
            <Input id="org-web" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="org-notes">Add a note (optional)</Label>
            <Textarea id="org-notes" rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        <Button onClick={() => void save()} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {account ? "Save the organisation" : "Onboard this organisation"}
        </Button>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Documents</h3>
            {account && (
              <span className="text-xs text-muted-foreground">
                {missing.length === 0 ? "Everything expected is on file" : `${missing.length} still outstanding`}
              </span>
            )}
          </div>

          {!account && (
            <p className="text-sm text-muted-foreground">
              Save the organisation first, then you can file its documents here.
            </p>
          )}

          {account &&
            ORG_DOC_CHECKLIST.map((docType) => {
              const held = documents.find((d) => d.doc_type === docType);
              return (
                <div key={docType} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                  <div className="min-w-[200px]">
                    <p className="font-medium">{ORG_DOC_LABEL[docType]}</p>
                    <p className="text-xs text-muted-foreground">
                      {held ? (
                        <>
                          {held.file_name ?? "File on record"} · {held.version_label ?? "v1.0"}
                          {held.versions > 1 ? ` of ${held.versions} copies` : ""}
                          {held.uploaded_at
                            ? ` · filed ${new Date(held.uploaded_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}`
                            : ""}
                          {held.uploaded_by ? ` by ${held.uploaded_by}` : ""}
                        </>
                      ) : (
                        "Not received yet"
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {held ? <Badge variant="secondary">On file</Badge> : <Badge variant="outline">Outstanding</Badge>}
                    {held?.storage_path && (
                      <Button size="sm" variant="ghost" onClick={() => void openFile(held.storage_path as string)}>
                        <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        Open
                      </Button>
                    )}
                    <Button size="sm" variant="outline" asChild disabled={uploading === docType}>
                      <label className="cursor-pointer">
                        {uploading === docType ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Upload className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {held ? "Replace" : "Upload"}
                        <input
                          type="file"
                          className="sr-only"
                          accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void upload(docType, file);
                          }}
                        />
                      </label>
                    </Button>
                  </div>
                </div>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default OrganisationOnboardingDialog;
