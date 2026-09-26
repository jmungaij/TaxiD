/**
 * OPERATOR DOCUMENTS PANEL
 *
 * Operators upload their operating licence, insurance and vehicle inspection
 * (plus identification and tax compliance if they wish). Nothing is published
 * to the marketplace until the three mandatory documents are verified and in
 * date, and this panel says plainly what is still outstanding.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle2, FileText, Upload } from "lucide-react";
import {
  DOC_KIND_LABEL, DOC_STATUS_LABEL, MANDATORY_DOC_KINDS,
  explainDocRefusal, loadMyDocuments, missingMandatory, signProviderDocument,
  uploadProviderDocument,
  type ProviderDocKind, type ProviderDocStatus,
} from "@/lib/provider/documents";
import { VERIFICATION_LABEL, loadMyVerification } from "@/lib/provider/verification";

const KINDS = Object.keys(DOC_KIND_LABEL) as ProviderDocKind[];

const TONE: Record<ProviderDocStatus, string> = {
  VERIFIED:
    "border-[hsl(var(--status-success)/0.45)] bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))]",
  SUBMITTED:
    "border-[hsl(var(--status-warning)/0.5)] bg-[hsl(var(--status-warning)/0.12)] text-[hsl(var(--status-warning))]",
  REJECTED: "border-destructive/40 bg-destructive/10 text-destructive",
  SUPERSEDED: "border-border bg-muted text-muted-foreground",
};

export default function ProviderDocuments() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["provider-documents"], queryFn: loadMyDocuments });
  const rows = data ?? [];
  const outstanding = missingMandatory(rows);
  const { data: standing } = useQuery({
    queryKey: ["provider-my-verification"],
    queryFn: loadMyVerification,
  });

  const [kind, setKind] = React.useState<ProviderDocKind>("OPERATING_LICENCE");
  const [reference, setReference] = React.useState("");
  const [expires, setExpires] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadProviderDocument({ kind, file, referenceNo: reference, expiresOn: expires }),
    onSuccess: () => {
      toast({ title: "Document uploaded", description: "Our team will review it shortly." });
      setReference("");
      setExpires("");
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["provider-documents"] });
    },
    onError: (e: Error) =>
      toast({ title: "Upload not completed", description: explainDocRefusal(e.message), variant: "destructive" }),
  });

  async function open(path: string) {
    const url = await signProviderDocument(path);
    if (url) window.open(url, "_blank", "noopener");
    else toast({ title: "Could not open that file", variant: "destructive" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />Your documents
        </CardTitle>
        <CardDescription>
          Before any of your vehicles can appear in the marketplace we need a verified, in-date operating licence,
          insurance certificate and vehicle inspection certificate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : outstanding.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md bg-[hsl(var(--status-success)/0.1)] p-3 text-sm text-[hsl(var(--status-success))]">
            <CheckCircle2 className="h-4 w-4" />
            All required documents are verified — your approved listings can go live.
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-md bg-[hsl(var(--status-warning)/0.12)] p-3 text-sm text-[hsl(var(--status-warning))]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Still needed: {outstanding.map((k) => DOC_KIND_LABEL[k]).join(", ")}.
          </p>
        )}

        {standing && (
          <p
            className={
              standing.state === "VERIFIED"
                ? "rounded-md bg-[hsl(var(--status-success)/0.1)] p-3 text-sm text-[hsl(var(--status-success))]"
                : standing.state === "SUSPENDED" || standing.state === "BLOCKED"
                  ? "rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                  : "rounded-md bg-muted p-3 text-sm text-muted-foreground"
            }
          >
            Your account standing: {VERIFICATION_LABEL[standing.state]}.
            {standing.state === "VERIFIED"
              ? " Approved listings can appear in the marketplace."
              : standing.state === "SUSPENDED" || standing.state === "BLOCKED"
                ? ` Your listings are off the marketplace. ${standing.reason ?? ""}`
                : " Our team reviews your documents before your listings can go live."}
          </p>
        )}


        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label className="text-xs">Document</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ProviderDocKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {DOC_KIND_LABEL[k]}{MANDATORY_DOC_KINDS.includes(k) ? " (required)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Reference number</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <Label className="text-xs">Valid until</Label>
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            <Upload className="mr-1.5 h-4 w-4" aria-hidden />
            {upload.isPending ? "Uploading…" : "Upload document"}
          </Button>
          <span className="text-xs text-muted-foreground">PDF or photo, up to 15 MB.</span>
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 text-left">Document</th>
                  <th className="py-1 pr-3 text-left">Reference</th>
                  <th className="py-1 pr-3 text-left">Valid until</th>
                  <th className="py-1 pr-3 text-left">Status</th>
                  <th className="py-1 text-right">File</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/50">
                    <td className="py-1 pr-3">{DOC_KIND_LABEL[r.doc_kind]}</td>
                    <td className="py-1 pr-3 font-mono">{r.reference_no ?? "—"}</td>
                    <td className="py-1 pr-3">{r.expires_on ?? "—"}</td>
                    <td className="py-1 pr-3">
                      <Badge variant="outline" className={TONE[r.status]}>{DOC_STATUS_LABEL[r.status]}</Badge>
                      {r.review_note && <span className="ml-2 text-muted-foreground">{r.review_note}</span>}
                    </td>
                    <td className="py-1 text-right">
                      <Button variant="ghost" size="sm" onClick={() => void open(r.object_path)}>View</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
