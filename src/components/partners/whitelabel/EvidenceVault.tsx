/**
 * EVIDENCE VAULT — signed audit artefacts with immutable version history.
 *
 * Uploads land in a private bucket, then the database records the artefact and a
 * hash-chained evidence entry in one call, then the signing function seals the
 * statement the database derived. Nothing here can edit an existing version: a
 * correction is a new version, and the previous one stays exactly as sealed.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck, Download, FileCheck2, Loader2, ShieldAlert, ShieldCheck, Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import {
  artifactDownloadUrl, artifactVersions, fetchArtifacts, fetchSignatures, signEvidence,
  uploadEvidenceArtifact, verifyEvidenceSignature, type VerificationResult,
} from "@/lib/partners/whiteLabelOps";
import { fetchEvidence, verifyEvidenceChain } from "@/lib/partners/whiteLabelTenants";

interface Props {
  tenantId: string;
  partnerId: string;
  /** Managers and platform staff may upload; everyone scoped may read. */
  canWrite?: boolean;
}

const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export default function EvidenceVault({ tenantId, partnerId, canWrite = true }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [documentKey, setDocumentKey] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [verifications, setVerifications] = useState<Record<string, VerificationResult>>({});

  const artifactsQ = useQuery({
    queryKey: ["wl-artifacts", tenantId],
    queryFn: () => fetchArtifacts(tenantId),
    enabled: !!tenantId,
  });
  const evidenceQ = useQuery({
    queryKey: ["wl-evidence", tenantId],
    queryFn: () => fetchEvidence(tenantId),
    enabled: !!tenantId,
  });
  const signaturesQ = useQuery({
    queryKey: ["wl-signatures", tenantId],
    queryFn: () => fetchSignatures(tenantId),
    enabled: !!tenantId,
  });

  const signedIds = useMemo(
    () => new Set((signaturesQ.data ?? []).map((s) => s.evidence_id)),
    [signaturesQ.data],
  );
  const groups = useMemo(() => artifactVersions(artifactsQ.data ?? []), [artifactsQ.data]);
  const chain = useMemo(() => verifyEvidenceChain(evidenceQ.data ?? []), [evidenceQ.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["wl-artifacts", tenantId] });
    void qc.invalidateQueries({ queryKey: ["wl-evidence", tenantId] });
    void qc.invalidateQueries({ queryKey: ["wl-signatures", tenantId] });
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file to upload");
      const key = documentKey.trim() || file.name.replace(/\.[^.]+$/, "").toLowerCase();
      return uploadEvidenceArtifact({
        tenantId,
        partnerId,
        documentKey: key,
        title: title.trim() || key,
        file,
        note: note.trim() || undefined,
      });
    },
    onSuccess: (r) => {
      if (r.signing_error) {
        toast.warning(`Version ${r.version} stored and hashed, but not signed: ${r.signing_error}`);
      } else {
        toast.success(`Version ${r.version} stored, hashed and sealed`);
      }
      setFile(null);
      setDocumentKey("");
      setTitle("");
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const seal = useMutation({
    mutationFn: (evidenceId: string) => signEvidence(evidenceId),
    onSuccess: () => {
      toast.success("Evidence sealed");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verify = useMutation({
    mutationFn: (evidenceId: string) => verifyEvidenceSignature(evidenceId),
    onSuccess: (r, evidenceId) => {
      setVerifications((prev) => ({ ...prev, [evidenceId]: r }));
      if (r.signature_valid) toast.success("Signature verified against the registered key");
      else toast.error(r.reason ?? "Signature did not verify");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const download = async (path: string) => {
    try {
      const url = await artifactDownloadUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the artefact");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {chain.intact
              ? <ShieldCheck className="h-4 w-4 text-primary" />
              : <ShieldAlert className="h-4 w-4 text-destructive" />}
            Audit trail integrity
          </CardTitle>
          <CardDescription>
            {chain.intact
              ? "The tenant evidence chain is unbroken: every entry links to the hash of the one before it."
              : "The evidence chain does not link end to end. Escalate to the SAFARID partner desk."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{(evidenceQ.data ?? []).length} evidence entries</Badge>
          <Badge variant="outline">{(artifactsQ.data ?? []).length} artefact versions</Badge>
          <Badge variant="outline">{signedIds.size} sealed</Badge>
        </CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" /> Upload audit evidence
            </CardTitle>
            <CardDescription>
              The file is hashed in your browser, stored privately, recorded on the tenant's
              hash-chained ledger and then cryptographically sealed. Re-uploading the same document
              key creates a new version; earlier versions are never altered.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ev-key">Document key</Label>
              <Input
                id="ev-key" value={documentKey} placeholder="pen-test-report"
                onChange={(e) => setDocumentKey(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-title">Title</Label>
              <Input
                id="ev-title" value={title} placeholder="Independent penetration test — 2026 H2"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-file">File</Label>
              <Input
                id="ev-file" type="file" ref={fileRef}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-note">Note (optional)</Label>
              <Textarea
                id="ev-note" value={note} rows={2}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
                {upload.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Upload and seal
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" /> Version history
          </CardTitle>
          <CardDescription>
            Newest version first per document. Download links are short-lived; the bucket itself is
            private.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {artifactsQ.isLoading && <p className="text-sm text-muted-foreground">Loading artefacts…</p>}
          {!artifactsQ.isLoading && groups.size === 0 && (
            <p className="text-sm text-muted-foreground">No evidence artefacts uploaded yet.</p>
          )}
          {[...groups.entries()].map(([key, versions]) => (
            <div key={key} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{versions[0].title}</p>
                <Badge variant="outline"><code>{key}</code></Badge>
                <Badge variant="outline">{versions.length} version{versions.length === 1 ? "" : "s"}</Badge>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>SHA-256</TableHead>
                      <TableHead>Seal</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.map((a) => {
                      const sealed = a.evidence_id ? signedIds.has(a.evidence_id) : false;
                      const check = a.evidence_id ? verifications[a.evidence_id] : undefined;
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">v{a.version}</TableCell>
                          <TableCell className="max-w-[16rem]">
                            <p className="truncate">{a.file_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {bytes(a.byte_size)} · {new Date(a.created_at).toLocaleString()}
                            </p>
                          </TableCell>
                          <TableCell><code className="text-xs">{short(a.sha256)}</code></TableCell>
                          <TableCell>
                            {sealed ? (
                              <Badge className="gap-1"><BadgeCheck className="h-3 w-3" />Sealed</Badge>
                            ) : (
                              <Badge variant="outline">Unsealed</Badge>
                            )}
                            {check && (
                              <p
                                className={`mt-1 text-xs ${check.signature_valid ? "text-muted-foreground" : "text-destructive"}`}
                              >
                                {check.signature_valid ? "Signature verified" : check.reason}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="space-x-2 text-right">
                            <Button size="sm" variant="outline" onClick={() => void download(a.storage_path)}>
                              <Download className="mr-1.5 h-3.5 w-3.5" />Open
                            </Button>
                            {a.evidence_id && sealed && (
                              <Button
                                size="sm" variant="ghost"
                                onClick={() => verify.mutate(a.evidence_id!)}
                                disabled={verify.isPending}
                              >
                                Verify
                              </Button>
                            )}
                            {a.evidence_id && !sealed && canWrite && (
                              <Button
                                size="sm" variant="ghost"
                                onClick={() => seal.mutate(a.evidence_id!)}
                                disabled={seal.isPending}
                              >
                                Seal
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
