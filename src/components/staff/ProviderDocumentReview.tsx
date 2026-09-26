/**
 * STAFF REVIEW OF OPERATOR DOCUMENTS
 *
 * Shows every document an operator has submitted and lets an administrator or
 * operations admin verify it or send it back with a reason. Only verified,
 * in-date licence, insurance and inspection documents let a listing go live.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck } from "lucide-react";
import {
  DOC_KIND_LABEL, DOC_STATUS_LABEL, decideProviderDocument, signProviderDocument,
  type ProviderDocKind, type ProviderDocStatus,
} from "@/lib/provider/documents";

interface Row {
  id: string;
  provider_user_id: string;
  doc_kind: ProviderDocKind;
  reference_no: string | null;
  expires_on: string | null;
  object_path: string;
  file_name: string | null;
  status: ProviderDocStatus;
  created_at: string;
}

async function loadQueue(): Promise<Row[]> {
   
  const { data, error } = await untypedDb
    .from("provider_documents")
    .select("id,provider_user_id,doc_kind,reference_no,expires_on,object_path,file_name,status,created_at")
    .in("status", ["SUBMITTED", "VERIFIED", "REJECTED"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

export default function ProviderDocumentReview() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["staff-provider-documents"], queryFn: loadQueue });
  const rows = data ?? [];
  const [note, setNote] = React.useState<Record<string, string>>({});

  const decide = useMutation({
    mutationFn: (p: { id: string; decision: "VERIFIED" | "REJECTED" }) =>
      decideProviderDocument(p.id, p.decision, note[p.id]),
    onSuccess: () => {
      toast({ title: "Decision recorded" });
      void qc.invalidateQueries({ queryKey: ["staff-provider-documents"] });
    },
    onError: (e: Error) =>
      toast({ title: "Decision not recorded", description: e.message, variant: "destructive" }),
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
          <ShieldCheck className="h-4 w-4" />Operator documents
        </CardTitle>
        <CardDescription>
          Verify each operator's licence, insurance and inspection certificate. Listings stay off the marketplace until
          all three are verified and in date.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No operator documents have been submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 text-left">Operator</th>
                  <th className="py-1 pr-3 text-left">Document</th>
                  <th className="py-1 pr-3 text-left">Reference</th>
                  <th className="py-1 pr-3 text-left">Valid until</th>
                  <th className="py-1 pr-3 text-left">Status</th>
                  <th className="py-1 text-right">Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/50 align-top">
                    <td className="py-2 pr-3 font-mono">{r.provider_user_id.slice(0, 8)}</td>
                    <td className="py-2 pr-3">
                      <button className="underline" onClick={() => void open(r.object_path)}>
                        {DOC_KIND_LABEL[r.doc_kind]}
                      </button>
                    </td>
                    <td className="py-2 pr-3 font-mono">{r.reference_no ?? "—"}</td>
                    <td className="py-2 pr-3">{r.expires_on ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline">{DOC_STATUS_LABEL[r.status]}</Badge>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Input
                          className="h-8 w-40"
                          placeholder="Note / reason"
                          value={note[r.id] ?? ""}
                          onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          disabled={decide.isPending || r.status === "VERIFIED"}
                          onClick={() => decide.mutate({ id: r.id, decision: "VERIFIED" })}
                        >
                          Verify
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: r.id, decision: "REJECTED" })}
                        >
                          Send back
                        </Button>
                      </div>
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
