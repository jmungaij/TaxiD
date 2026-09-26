/**
 * Evidence attachment control for a charter pricing/booking audit entry.
 * Operators and admins upload a document; the storage path is written back
 * onto the audit row and included in the CSV export.
 */
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Paperclip, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { charterApi, type CharterAuditRow } from "@/lib/charter/api";
import { ACCEPTED_EVIDENCE, evidenceSignedUrl, uploadEvidence } from "@/lib/charter/evidence";

export function AuditEvidenceCell({
  entry,
  canEdit,
  onSaved,
}: {
  entry: CharterAuditRow;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const path = await uploadEvidence(file, `audit/${entry.id}`);
      await charterApi.attachEvidence(entry.id, path, file.name);
      toast({ title: "Evidence attached", description: file.name });
      onSaved();
    } catch (e) {
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    if (!entry.evidence_url) return;
    try {
      window.open(await evidenceSignedUrl(entry.evidence_url), "_blank", "noopener");
    } catch (e) {
      toast({
        title: "Cannot open document",
        description: e instanceof Error ? e.message : "Error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex items-center gap-2">
      {entry.evidence_url ? (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void open()}>
          <FileText className="mr-1 h-3.5 w-3.5" />
          {entry.evidence_note ?? "Document"}
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">No document</span>
      )}
      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={ACCEPTED_EVIDENCE}
            aria-label={`Attach evidence document to ${entry.reference ?? entry.id}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <Button
            size="sm" variant="outline" className="h-7 px-2 text-xs"
            disabled={busy} onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          </Button>
        </>
      )}
    </div>
  );
}
